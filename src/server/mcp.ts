import { Router, type Request, type Response } from "express";
import { origin } from "./env.ts";
import { listMembers } from "./members.ts";
import { logAudit, runAs } from "./journal.ts";
import { RESOURCE_METADATA_URL } from "./oauth.ts";
import { TOOLS, executeWrite, inputError, jsonSchema, runReadTool } from "./tools/index.ts";

/*
 * Serveur MCP (Model Context Protocol, transport « Streamable HTTP » sans état, réponses JSON)
 * pour Claude Code et tout client MCP : mêmes outils que l'assistant intégré. Accès par le jeton
 * d'administration (Bearer API_TOKEN, vue du membre administrateur). Les écritures sont exécutées directement :
 * c'est le client qui demande la permission à l'utilisateur. Chaque écriture est tracée (via « mcp »).
 * Vue par membre : chaque outil accepte en plus `membre` (ajouté ici, pas dans le registre) pour lire ou
 * écrire dans la vue d'un autre membre ; ces appels sont tous tracés, lectures comprises.
 * Appli Claude (web, Desktop, iPhone) : jeton d'accès OAuth accordé par un membre (src/server/oauth.ts) —
 * sa vue seulement, sans `membre`, et sans les actions s'il n'a accordé que la lecture.
 */

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_TEXT = 100_000;

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

/** Consignes données au client : les prénoms viennent de la base, rien n'est écrit pour un foyer précis. */
const INSTRUCTIONS_BASE = `Pécule est l'application de suivi bancaire et patrimonial du foyer : c'est la source de vérité des catégories.
Débits négatifs. Les catégories de type « interne » (C1, C2) sont des mouvements entre comptes du foyer. Référentiel : list_categories.
Factures : search_invoices / get_invoice, find_payment_candidates pour trouver l'opération qui l'a payée, link_invoice pour la relier (les catégories des articles s'appliquent alors à l'opération).
Les actions (categorize_transactions, link_invoice, update_invoice, update_asset…) modifient les données immédiatement : vérifier avant d'agir.`;
const adminInstructions = (holder: string, others: string[]) =>
  `${INSTRUCTIONS_BASE}\nVue : par défaut celle de ${holder} (titulaire du jeton).` +
  (others.length
    ? ` Chaque outil accepte membre: "<prénom>" (${others.join(", ")}) pour lire ou modifier dans la vue d'un autre membre : ses données privées (retraite, bulletins, documents, projections, patrimoine) et ses réglages de comptes. Ces appels sont tracés dans le journal. Les comptes personnels d'un autre membre peuvent être hors statistiques dans la vue du titulaire : list_accounts donne leurs identifiants, search_transactions avec account_id y cherche.`
    : "");

/** Paramètre ajouté à chaque outil pour le jeton d'administration : la vue d'un autre membre. */
const MEMBER_PARAM = "membre";
const memberSchema = (names: string[], holder: string) => ({
  type: "string",
  enum: names,
  description: `Vue du membre dont on lit ou modifie les données (défaut : ${holder}, titulaire du jeton). Un autre membre : ses données privées et ses réglages de comptes ; l'appel est tracé dans le journal.`,
});

const describeTool = (t: (typeof TOOLS)[number], member?: ReturnType<typeof memberSchema>) => {
  const schema = jsonSchema(t.input);
  return {
    name: t.name,
    description: t.description,
    inputSchema: member ? { ...schema, properties: { ...schema.properties, [MEMBER_PARAM]: member } } : schema,
    annotations: { readOnlyHint: t.kind === "read" && !t.mutates, destructiveHint: t.kind === "write" && t.name.startsWith("delete_"), openWorldHint: false },
  };
};
/** Jeton d'administration : tous les outils, avec le paramètre `membre` (les prénoms du moment). */
const adminTools = (names: string[], holder: string) => TOOLS.map((t) => describeTool(t, memberSchema(names, holder)));
/** Jeton OAuth d'un membre : sa vue seulement ; les actions seulement s'il les a accordées. */
const memberTools = TOOLS.map((t) => describeTool(t));
const memberReadTools = memberTools.filter((t) => t.annotations.readOnlyHint);


const text = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}… (tronqué)` : s;
};

async function handle(req: Request, m: RpcRequest): Promise<RpcResponse | null> {
  const id = m.id ?? null;
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
  const oauth = req.user?.via === "oauth";
  // Notification (pas d'identifiant) : rien à répondre.
  if (m.id === undefined) return null;
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "pecule", title: "Pécule", version: "13.0.0" },
        instructions: !oauth
          ? adminInstructions(req.user!.name, (await listMembers()).map((u) => u.name).filter((n) => n !== req.user!.name))
          : `${INSTRUCTIONS_BASE}\nVue : celle de ${req.user!.name}, qui a accordé cet accès${req.user!.canWrite ? "" : " en lecture seule (aucune action possible)"}.`,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: !oauth ? adminTools((await listMembers()).map((u) => u.name), req.user!.name) : req.user!.canWrite ? memberTools : memberReadTools });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      const { [MEMBER_PARAM]: member, ...args } = (m.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(-32602, `Outil inconnu : ${name}`);
      const actorUserId = req.user!.id;
      try {
        // Vue d'un autre membre : l'outil s'exécute avec son identifiant, le journal garde l'auteur réel.
        let view: { userId: number; name: string } | null = null;
        if (oauth && member !== undefined) return ok({ content: [{ type: "text", text: "Le paramètre membre est réservé au jeton d'administration : cet accès ne donne que la vue du membre qui l'a accordé." }], isError: true });
        if (oauth && (tool.kind === "write" || tool.mutates) && !req.user!.canWrite) return ok({ content: [{ type: "text", text: "Accès en lecture seule : les actions n'ont pas été autorisées pour cette application (Réglages de Pécule → Compte et sécurité pour reconnecter avec les actions)." }], isError: true });
        if (member !== undefined) {
          const members = await listMembers();
          const u = typeof member === "string" ? members.find((x) => x.name.toLowerCase() === member.trim().toLowerCase()) : undefined;
          if (!u) return ok({ content: [{ type: "text", text: `Membre inconnu : ${String(member)} (attendu : ${members.map((x) => x.name).join(" ou ")})` }], isError: true });
          if (u.id !== actorUserId) view = { userId: u.id, name: u.name };
        }
        const ctx = { userId: view?.userId ?? actorUserId };
        let result: unknown;
        if (tool.kind === "read") {
          result = await runReadTool(ctx, name, args);
          if (view) await runAs({ userId: actorUserId, via: "mcp" }, () => logAudit(`mcp lecture ${name}`, null, { vue: view.name, parametres: args }));
        } else result = await executeWrite(ctx, { name, input: args }, "mcp", view ? { actorUserId, view: view.name } : undefined);
        return ok({ content: [{ type: "text", text: text(result) }] });
      } catch (e) {
        // Erreur métier ou de paramètres : renvoyée au modèle pour qu'il corrige.
        return ok({ content: [{ type: "text", text: inputError(e) }], isError: true });
      }
    }
    default:
      return fail(-32601, `Méthode non prise en charge : ${m.method}`);
  }
}

export const mcpRouter = Router();

mcpRouter.post("/", async (req: Request, res: Response) => {
  // Protection contre le rebinding DNS : un navigateur tiers ne doit pas pouvoir appeler le serveur.
  const o = req.get("origin");
  if (o && o !== origin) return res.status(403).json({ error: "Origine refusée" });
  // Sans jeton valide : 401 avec l'adresse des métadonnées, d'où le client OAuth (appli Claude) déduit comment se connecter.
  if (req.user?.via !== "api" && req.user?.via !== "oauth")
    return res.status(401).set("WWW-Authenticate", `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`).json({ error: "Jeton requis : jeton d'administration, ou accès accordé par un membre (OAuth)" });
  const body = req.body as RpcRequest | RpcRequest[];
  const batch = Array.isArray(body);
  const messages = batch ? body : [body];
  if (!messages.length || messages.some((m) => !m || m.jsonrpc !== "2.0" || typeof m.method !== "string"))
    return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Requête JSON-RPC invalide" } });
  const responses = (await Promise.all(messages.map((m) => handle(req, m)))).filter((r): r is RpcResponse => !!r);
  if (!responses.length) return res.status(202).end();
  res.set("Cache-Control", "no-store").json(batch ? responses : responses[0]);
});

// Pas de flux serveur → client ni de session : GET et DELETE ne sont pas pris en charge.
mcpRouter.all("/", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Méthode non prise en charge" }));
