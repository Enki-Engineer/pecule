/*
 * Traduction de l'API Messages de Claude vers les API des autres fournisseurs : ce qui leur est commun. Pur.
 *
 * Tout Pécule écrit ses demandes au format de l'API Messages (`WireParams`) et lit des réponses à ce format
 * (`WireReply`). Chaque API a son fichier — `ai-wire-chat.ts` (Chat Completions), `ai-wire-responses.ts`
 * (Responses d'OpenAI), `ai-wire-ollama.ts` (Ollama) — avec deux fonctions : la demande à envoyer, et un lecteur qui
 * reçoit la réponse morceau par morceau (`WireReader`). Le serveur fait le reste : la connexion, les délais, les
 * erreurs (`src/server/ai-wires.ts`).
 *
 * Ce qui ne se traduit pas est écarté sans bruit : les points de cache (chaque fournisseur a les siens), la réflexion
 * signée de Claude. Ce qu'un fournisseur demande de lui rendre tel quel au tour suivant — son raisonnement chiffré,
 * entre un appel d'outil et son résultat — voyage dans la conversation sous la forme d'un bloc opaque (`carrier`),
 * que seule son API relit et que les autres ignorent.
 */

/* ---------- Le format de l'API Messages, pour ce que Pécule en utilise ---------- */

export type WireSource = { type: "base64"; media_type: string; data: string };
export type WireBlock =
  | { type: "text"; text: string; cache_control?: unknown }
  | { type: "image"; source: WireSource; cache_control?: unknown }
  | { type: "document"; source: WireSource; title?: string | null; cache_control?: unknown }
  | { type: "tool_use"; id: string; name: string; input: unknown; cache_control?: unknown }
  | { type: "tool_result"; tool_use_id: string; content?: string | WireBlock[]; is_error?: boolean; cache_control?: unknown }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string };
export type WireMessage = { role: "user" | "assistant"; content: string | WireBlock[] };
export type WireTool = { name: string; description?: string; input_schema: unknown };
export type WireParams = {
  model: string;
  max_tokens: number;
  system?: string | { type: "text"; text: string; cache_control?: unknown }[];
  messages: WireMessage[];
  tools?: WireTool[];
  thinking?: unknown;
  output_config?: { effort?: string | null; format?: { type: "json_schema"; schema: unknown } | null } | null;
};

/** Décompte d'un appel. `cost_usd` : le coût exact, quand le fournisseur le donne ; `label` : le modèle tel qu'il est compté. */
export type WireUsage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; cost_usd?: number; label?: string };
export type WireStop = "end_turn" | "max_tokens" | "tool_use" | "refusal";
export type WireReplyBlock = { type: "text"; text: string; citations: null } | { type: "tool_use"; id: string; name: string; input: unknown } | { type: "redacted_thinking"; data: string };
export type WireReply = { id: string; type: "message"; role: "assistant"; model: string; content: WireReplyBlock[]; stop_reason: WireStop; stop_sequence: null; usage: WireUsage };

/** Ce qu'un morceau de réponse apporte à l'écran : du texte, ou le signe que le modèle réfléchit. */
export type WireEvent = { text: string } | { thinking: string };

/**
 * Où en est la lecture d'une réponse : « vide » (rien de ce qui a été reçu ne ressemble à une réponse de cette API —
 * une page web, un autre service), « coupee » (une réponse commencée, sans son dernier morceau), « finie ».
 */
export type WireState = "vide" | "coupee" | "finie";

/** Lit la réponse d'un fournisseur, morceau par morceau (un objet JSON par morceau). */
export type WireReader = {
  /** Rend ce que ce morceau apporte ; lève `WireError` si le fournisseur y annonce une erreur. */
  push(chunk: unknown): WireEvent[];
  /** La réponse au format de l'API Messages : ce qui est déjà reçu, puis, une fois tout lu, la réponse entière. */
  reply(): WireReply;
  state(): WireState;
};

/** Erreur annoncée par le fournisseur au milieu d'une réponse (le code de la réponse http, lui, disait « 200 »). */
export class WireError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/* ---------- Lecture des demandes ---------- */

export const blocksOf = (content: string | WireBlock[]): WireBlock[] => (typeof content === "string" ? (content ? [{ type: "text", text: content }] : []) : content);

/** Consignes de la demande, en un seul texte. */
export function systemText(system: WireParams["system"]): string {
  if (!system) return "";
  return typeof system === "string" ? system : system.map((b) => b.text).join("\n\n");
}

/** Texte d'un résultat d'outil (ses images, s'il en avait, ne se traduisent pas). */
export function resultText(content: string | WireBlock[] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
}

export const dataUrl = (s: WireSource) => `data:${s.media_type};base64,${s.data}`;

/** Effort demandé (« low », « medium », « high »), dans les mots communs à tous : un effort plus haut vaut « high ». */
export function effortOf(params: WireParams): "low" | "medium" | "high" | null {
  const e = params.output_config?.effort;
  if (e === "low" || e === "medium") return e;
  return e ? "high" : null;
}

/** Schéma de la réponse structurée demandée ; null si la réponse est libre. */
export const schemaOf = (params: WireParams): Record<string, unknown> | null => {
  const f = params.output_config?.format;
  return f && f.type === "json_schema" && f.schema && typeof f.schema === "object" ? (f.schema as Record<string, unknown>) : null;
};

/**
 * Un schéma qu'un fournisseur peut imposer « strictement » (OpenAI) : chaque objet y interdit les champs en plus et
 * rend obligatoires tous les siens. Sinon le schéma est donné sans cette garantie, plutôt que refusé.
 */
export function isStrictSchema(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(isStrictSchema);
  if (!schema || typeof schema !== "object") return true;
  const s = schema as Record<string, unknown>;
  if (s.properties && typeof s.properties === "object") {
    const keys = Object.keys(s.properties);
    const required = Array.isArray(s.required) ? (s.required as unknown[]) : [];
    if (s.additionalProperties !== false || keys.some((k) => !required.includes(k))) return false;
  }
  return Object.values(s).every((v) => (v && typeof v === "object" ? isStrictSchema(v) : true));
}

/**
 * Consigne ajoutée quand la réponse doit suivre un schéma et que le fournisseur ne le garantit pas toujours (un modèle
 * local, un service qui ignore le réglage) : le schéma est redit dans la demande, comme le conseille Ollama.
 */
export const schemaPrompt = (schema: Record<string, unknown>) =>
  `Réponds uniquement par un objet JSON conforme à ce schéma, sans texte avant ni après, sans bloc de code :\n${JSON.stringify(schema)}`;

/**
 * Le JSON d'une réponse structurée, débarrassé de ce qu'un modèle ajoute parfois autour : un bloc de code, une
 * phrase d'introduction. Rend le texte tel quel s'il n'y a pas d'objet à en tirer.
 */
export function jsonText(text: string): string {
  const s = text.trim();
  if (s.startsWith("{") && s.endsWith("}")) return s;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const inner = (fenced ? fenced[1] : s).trim();
  const from = inner.indexOf("{");
  const to = inner.lastIndexOf("}");
  return from >= 0 && to > from ? inner.slice(from, to + 1) : s;
}

/** Clé posée sur les arguments d'un appel d'outil que le modèle a mal écrits : ce qu'il avait écrit y est gardé. */
export const UNREADABLE_ARGS = "__arguments_illisibles";
/** Les arguments de cet appel n'ont pas pu être lus : l'outil ne doit pas être appelé, le modèle doit les récrire. */
export const unreadableArgs = (input: unknown): boolean => !!input && typeof input === "object" && UNREADABLE_ARGS in input;

const asObject = (text: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * Arguments d'un appel d'outil : un objet, que le fournisseur l'ait rendu en JSON écrit ou déjà lu. Un JSON presque
 * juste est repris (bloc de code autour, virgule en trop). Illisible malgré cela : jamais un objet vide — l'outil
 * répondrait sans ses filtres, comme si de rien n'était — mais un objet marqué (`unreadableArgs`), que l'assistant
 * rend au modèle comme une erreur.
 */
export function toolInput(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) return args as Record<string, unknown>;
  if (typeof args !== "string" || !args.trim()) return {};
  const repaired = jsonText(args).replace(/,\s*([}\]])/g, "$1");
  return asObject(args) ?? asObject(repaired) ?? { [UNREADABLE_ARGS]: args.slice(0, 300) };
}

let serial = 0;
/**
 * Identifiant d'un appel d'outil, sous une forme que toutes les API acceptent (lettres, chiffres, tiret, souligné) :
 * une conversation commencée chez un fournisseur doit pouvoir se poursuivre chez un autre. Absent : il est fabriqué.
 */
export function toolId(id: unknown): string {
  const s = typeof id === "string" ? id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) : "";
  return s || `call_${Date.now().toString(36)}${(serial++).toString(36)}`;
}

/** Nombre de jetons d'un texte, à la louche (un jeton pour quatre caractères) : pour un décompte que le fournisseur n'a pas donné. */
export const roughTokens = (chars: number) => Math.ceil(Math.max(0, chars) / 4);

/** Jetons d'une demande, à la louche : consignes, outils et textes de la conversation (les images et les PDF joints ne sont pas comptés). */
export function roughInput(params: WireParams): number {
  let chars = systemText(params.system).length + (params.tools?.length ? JSON.stringify(params.tools).length : 0);
  for (const m of params.messages) {
    for (const b of blocksOf(m.content)) {
      if (b.type === "text") chars += b.text.length;
      else if (b.type === "tool_result") chars += resultText(b.content).length;
      else if (b.type === "tool_use") chars += JSON.stringify(b.input ?? {}).length;
    }
  }
  return roughTokens(chars);
}

/* ---------- Ce qu'un fournisseur demande de lui rendre ---------- */

const CARRIER = "pecule-wire:";
type Wire = "chat" | "responses" | "ollama";

/** Bloc opaque gardé dans la conversation : ce que l'API `wire` a rendu et veut relire au tour suivant. */
export const carrier = (wire: Wire, payload: unknown): { type: "redacted_thinking"; data: string } => ({ type: "redacted_thinking", data: `${CARRIER}${wire}:${JSON.stringify(payload)}` });

export const isCarrier = (b: { type: string; data?: unknown }): boolean => b.type === "redacted_thinking" && typeof b.data === "string" && b.data.startsWith(CARRIER);

/** Ce que l'API `wire` avait confié à ce bloc ; null si ce n'est pas le sien. */
export function carried<T>(b: WireBlock, wire: Wire): T | null {
  if (b.type !== "redacted_thinking" || !b.data.startsWith(`${CARRIER}${wire}:`)) return null;
  try {
    return JSON.parse(b.data.slice(CARRIER.length + wire.length + 1)) as T;
  } catch {
    return null;
  }
}

/**
 * Les messages sans les blocs opaques des autres API : ce qui part chez Claude, qui refuserait une réflexion qui n'est
 * pas la sienne. Rend les mêmes messages quand il n'y en a aucun.
 */
export function withoutCarriers<M extends { role: string; content: unknown }>(messages: M[]): M[] {
  const has = (m: M) => Array.isArray(m.content) && (m.content as { type: string; data?: unknown }[]).some(isCarrier);
  if (!messages.some(has)) return messages;
  return messages.map((m) => {
    if (!has(m)) return m;
    const kept = (m.content as { type: string; data?: unknown }[]).filter((b) => !isCarrier(b));
    // Un message ne part jamais vide : « … » tient sa place.
    return { ...m, content: kept.length ? kept : [{ type: "text", text: "…" }] };
  });
}

/* ---------- Réflexion écrite dans le texte ---------- */

/**
 * Certains serveurs de modèles écrivent la réflexion dans la réponse elle-même, entre « <think> » et « </think> ».
 * Ce découpeur la sépare du texte au fil de l'eau, même quand une balise arrive coupée entre deux morceaux.
 */
export function thinkSplitter() {
  let inside = false;
  let held = "";
  const OPEN = "<think>";
  const CLOSE = "</think>";
  return {
    push(delta: string): WireEvent[] {
      const out: WireEvent[] = [];
      let s = held + delta;
      held = "";
      while (s) {
        const tag = inside ? CLOSE : OPEN;
        const at = s.indexOf(tag);
        if (at >= 0) {
          const before = s.slice(0, at);
          if (before) out.push(inside ? { thinking: before } : { text: before });
          inside = !inside;
          s = s.slice(at + tag.length);
          continue;
        }
        // Un début de balise en fin de morceau attend la suite.
        let keep = 0;
        for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
          if (tag.startsWith(s.slice(-n))) {
            keep = n;
            break;
          }
        }
        const ready = s.slice(0, s.length - keep);
        if (ready) out.push(inside ? { thinking: ready } : { text: ready });
        held = s.slice(s.length - keep);
        s = "";
      }
      return out;
    },
    /** Ce qui restait en attente à la fin de la réponse (un « < » qui n'ouvrait rien). */
    flush(): WireEvent[] {
      const rest = held;
      held = "";
      return rest && !inside ? [{ text: rest }] : [];
    },
  };
}

/* ---------- Écriture des réponses ---------- */

export const emptyUsage = (): WireUsage => ({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
/**
 * Décompte au format de l'API Messages, à partir de ce que comptent les autres : chez eux l'entrée comprend ce qui
 * a été relu du cache et ce qui y a été écrit ; ici ce sont trois nombres séparés.
 */
export function usageFrom(total: unknown, output: unknown, cached: unknown, written: unknown): WireUsage {
  const read = count(cached);
  const write = count(written);
  return { input_tokens: Math.max(0, count(total) - read - write), output_tokens: count(output), cache_creation_input_tokens: write, cache_read_input_tokens: read };
}

export type ReplyParts = { model: string; id?: string; text: string; calls: { id: string; name: string; input: Record<string, unknown> }[]; stop: WireStop; usage: WireUsage; keep?: { type: "redacted_thinking"; data: string } | null; json?: boolean };

/**
 * Réponse au format de l'API Messages. Un appel d'outil l'emporte sur les autres raisons d'arrêt — sauf une réponse
 * coupée par son plafond : ses appels, peut-être écrits à moitié, ne sont pas rendus (aucun ne sera exécuté, et un
 * appel sans résultat rendrait la conversation inutilisable), ni ce que le fournisseur voulait relire avec eux.
 */
export function buildReply(p: ReplyParts): WireReply {
  const text = p.json ? jsonText(p.text) : p.text;
  const cut = p.stop === "max_tokens";
  const calls = cut ? [] : p.calls;
  const content: WireReplyBlock[] = [];
  // Le bloc opaque n'accompagne qu'une réponse qui a un contenu : seul, il ferait un message vide pour les autres API.
  if (p.keep && !cut && (text.trim() || calls.length)) content.push(p.keep);
  if (text.trim()) content.push({ type: "text", text, citations: null });
  for (const c of calls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
  return { id: p.id || `msg_${Date.now().toString(36)}`, type: "message", role: "assistant", model: p.model, content, stop_reason: calls.length ? "tool_use" : p.stop, stop_sequence: null, usage: p.usage };
}
