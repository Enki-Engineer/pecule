import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { unreadableKeyText, useDesktop } from "../desktop.ts";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { api, useMe } from "../api.ts";
import { cn } from "../cn.ts";
import { Card } from "./ui.tsx";
import { Section } from "./SettingsSection.tsx";
import { AI_PROVIDER_INFO, AI_PROVIDER_SPEC, OLLAMA_CONTEXT, type AiConnectorStatus, type AiModelChoice, type AiProvider, type AiStatus } from "../../lib/ai-providers.ts";
import { locale, t, tk, tn } from "../../lib/i18n.ts";

/** `ollamaUrl` : où un Ollama installé sur la même machine se joint depuis Pécule (dans un conteneur, ce n'est pas « localhost »). */
type Status = AiStatus & { voice: boolean; ollamaUrl?: string };
type Test = { ok: boolean; error?: string; ms: number; notes?: string[] };
const QUERY = ["ai-config"];

/** Les deux familles de fournisseurs, dans l'ordre de l'écran. */
const FAMILIES = [
  { id: "claude", title: "Claude" },
  { id: "autres", title: tk("Autres modèles") },
] as const;

/**
 * Fournisseur d'IA (toute la famille) : qui répond à Pécule, avec son adresse, son modèle et sa clé.
 * Un seul répond à la fois ; les autres peuvent être préparés et essayés en réserve.
 */
export function AiSettings() {
  const status = useQuery({ queryKey: QUERY, queryFn: () => api<Status>("/ai/config") });
  const [open, setOpen] = useState<AiProvider | null>(null);
  // Le fournisseur d'IA reçoit les documents de tout le foyer : seul l'administrateur le règle.
  const admin = useMe().data?.user?.admin === true;
  const data = status.data;
  const other = data ? AI_PROVIDER_SPEC[data.provider]?.family === "autres" : false;
  return (
    <Section id="fournisseur" title={t("Fournisseur d'IA")}>
      {data &&
        FAMILIES.map((f) => (
          <div key={f.id} className="mb-3">
            <h3 className="mb-1.5 px-1 text-[13px] font-semibold text-muted">{f.id === "claude" ? f.title : t(f.title)}</h3>
            <Card className="divide-y divide-line">
              {data.connectors
                .filter((c) => AI_PROVIDER_SPEC[c.id]?.family === f.id)
                .map((c) => (
                  <ConnectorRow key={c.id} c={c} ollamaUrl={data.ollamaUrl} open={admin && open === c.id} onToggle={() => admin && setOpen(open === c.id ? null : c.id)} />
                ))}
            </Card>
          </div>
        ))}
      {status.error && <Card className="px-4 py-3 text-sm text-neg">{status.error instanceof Error ? status.error.message : t("Réglage indisponible")}</Card>}
      {!admin && data && <p className="mt-2 px-1 text-xs text-muted">{t("Seul l'administrateur du foyer peut changer ces réglages.")}</p>}
      <p className="mt-2 px-1 text-xs text-muted">
        {t("Réglage commun à toute la famille. Le fournisseur choisi reçoit tout ce que Pécule confie à l'IA : questions à l'assistant, factures, documents et bulletins de paie. Les clés sont chiffrées et ne sont plus jamais affichées. Un fournisseur est essayé avant d'être choisi ou modifié : si l'essai échoue, rien ne change.")}{" "}
        {data && (data.voice ? t("Le mode vocal passe toujours par la ressource Microsoft Foundry.") : t("Le mode vocal a besoin d'une ressource Microsoft Foundry (son nom et sa clé)."))}
      </p>
      <p className={cn("mt-2 px-1 text-xs", other ? "text-ink" : "text-muted")}>
        {t("Pécule a été mis au point avec Claude. Avec un autre modèle, la qualité dépend de lui : il doit savoir appeler des outils pour servir d'assistant, et lire les images pour une photo ou un scan. Essaie-le sur quelques documents avant de lui confier un dossier entier.")}
      </p>
    </Section>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function ConnectorRow({ c, ollamaUrl, open, onToggle }: { c: AiConnectorStatus; ollamaUrl?: string; open: boolean; onToggle: () => void }) {
  const info = AI_PROVIDER_INFO[c.id];
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">{info.label}</span>
          <span className="block truncate text-xs text-muted">{c.ready ? [c.model, c.url && hostOf(c.url)].filter(Boolean).join(" · ") : info.hint}</span>
        </span>
        <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", c.active ? "bg-accent-soft text-accent" : c.ready ? "bg-pos/10 text-pos" : "bg-line/60 text-muted")}>
          {c.active ? (c.ready ? t("Utilisé##fournisseur") : t("Choisi, incomplet")) : c.ready ? t("Prêt##fournisseur") : t("À configurer")}
        </span>
        <ChevronDown size={16} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {/* La fiche repart des valeurs enregistrées après chaque modification (adresse remise en forme, clé vidée). */}
      {open && <ConnectorForm key={[c.url, c.model, c.keySource, c.active, c.context].join("|")} c={c} ollamaUrl={ollamaUrl} />}
    </div>
  );
}

const INPUT = "mt-1 w-full rounded-md bg-bg px-3 py-2 text-[16px] ring-1 ring-line outline-none placeholder:text-muted/70 max-md:focus:ring-2 max-md:focus:ring-accent md:text-[14px]";

/** Taille d'un modèle sur le disque, en gigaoctets. */
const gigas = (bytes: number) => t("{n} Go", { n: (bytes / 1e9).toLocaleString(locale(), { maximumFractionDigits: 1 }) });
const perMillion = (usd: number) => `${usd.toLocaleString(locale(), { maximumFractionDigits: 3 })} $`;

/** Ce que le service dit d'un modèle : ce qu'il sait faire, sa taille, son tarif. */
function traitsOf(m: AiModelChoice): string[] {
  return [
    m.tools === true ? t("outils") : m.tools === false ? t("sans outils") : null,
    m.vision === true ? t("images") : m.vision === false ? t("sans images") : null,
    m.note ?? null,
    m.size ? gigas(m.size) : null,
    m.context ? t("{n} jetons de contexte", { n: m.context.toLocaleString(locale()) }) : null,
    m.price ? t("{entree} l'entrée · {sortie} la sortie, par million de jetons", { entree: perMillion(m.price.input), sortie: perMillion(m.price.output) }) : null,
  ].filter((x): x is string => !!x);
}

function ConnectorForm({ c, ollamaUrl }: { c: AiConnectorStatus; ollamaUrl?: string }) {
  const desktop = useDesktop();
  const info = AI_PROVIDER_INFO[c.id];
  const spec = AI_PROVIDER_SPEC[c.id];
  const qc = useQueryClient();
  const id = useId();
  const [url, setUrl] = useState(c.url ?? "");
  const [model, setModel] = useState(c.model);
  const [key, setKey] = useState("");
  const [context, setContext] = useState(c.context ? String(c.context) : "");
  const [busy, setBusy] = useState<"save" | "test" | "use" | "forget" | "list" | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  // Modèles du service : lus à l'ouverture d'une fiche déjà réglée, ou à la demande avec ce qui vient d'être saisi.
  const [listed, setListed] = useState<AiModelChoice[] | null>(null);
  const canList = spec.lists === true && (spec.address === "fixe" || !!c.url);
  const saved = useQuery({
    queryKey: ["ai-models", c.id, c.url, c.keySet],
    queryFn: () => api<{ models: AiModelChoice[] }>("/ai/models", { method: "POST", json: { provider: c.id } }),
    enabled: canList,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const models = listed ?? saved.data?.models ?? [];

  // Champ vidé : la fenêtre de départ (la fiche n'a alors rien à enregistrer si c'était déjà elle).
  const wantedContext = context.trim() ? Number(context) : OLLAMA_CONTEXT.default;
  const contextOk = Number.isInteger(wantedContext) && wantedContext >= OLLAMA_CONTEXT.min && wantedContext <= OLLAMA_CONTEXT.max;
  // Seul ce qui a changé part : une valeur posée par l'hébergement n'est pas recopiée dans les réglages.
  const changes = {
    ...(info.url && url.trim() !== (c.url ?? "") ? { url: url.trim() } : {}),
    ...(model.trim() !== c.model ? { model: model.trim() } : {}),
    ...(key.trim() ? { key: key.trim() } : {}),
    ...(spec.context && contextOk && wantedContext !== c.context ? { context: wantedContext } : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  async function put(what: "save" | "use" | "forget", body: Record<string, unknown>, done: string) {
    setBusy(what);
    setError("");
    setNotes([]);
    try {
      qc.setQueryData(QUERY, await api<Status>("/ai/config", { method: "PUT", json: { provider: c.id, ...body } }));
      // Le mode vocal dépend de la ressource Foundry : sa disponibilité est relue.
      void qc.invalidateQueries({ queryKey: ["voice-status"] });
      void qc.invalidateQueries({ queryKey: ["assistant-status"] });
      void qc.invalidateQueries({ queryKey: ["connections"] });
      setKey("");
      toast.success(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Réglage non enregistré"));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setError("");
    setNotes([]);
    try {
      const r = await api<Test>("/ai/test", { method: "POST", json: { provider: c.id, ...changes } });
      if (r.ok) {
        toast.success(t("{nom} répond ({duree} s)", { nom: info.label, duree: (r.ms / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) }));
        setNotes(r.notes ?? []);
      } else setError(r.error ?? t("L'essai a échoué"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Essai impossible"));
    } finally {
      setBusy(null);
    }
  }

  /** Demande au service ses modèles, avec l'adresse et la clé telles qu'elles sont saisies. */
  async function list() {
    setBusy("list");
    setError("");
    try {
      // Seules l'adresse et la clé disent où lire la liste.
      const where = { ...("url" in changes ? { url: changes.url } : {}), ...("key" in changes ? { key: changes.key } : {}) };
      const r = await api<{ models: AiModelChoice[] }>("/ai/models", { method: "POST", json: { provider: c.id, ...where } });
      setListed(r.models);
      if (!r.models.length) setError(c.id === "ollama" ? t("Aucun modèle installé dans cet Ollama : installe-en un (« ollama pull », suivi du nom du modèle), puis reviens.") : t("Ce service n'a pas donné de liste : écris le nom du modèle."));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Liste des modèles illisible"));
    } finally {
      setBusy(null);
    }
  }

  function use() {
    if (!confirm(t("Confier l'IA de Pécule à « {nom} » ? Les questions à l'assistant, les factures, les documents et les bulletins de paie lui seront envoyés.", { nom: info.label }))) return;
    void put("use", { ...changes, activate: true }, t("{nom} répond maintenant", { nom: info.label }));
  }

  function forget() {
    if (!confirm(c.id === "foundry" ? t("Retirer la clé enregistrée ici ? Celle de l'hébergement reprendra la main, s'il y en a une.") : t("Retirer la clé enregistrée pour ce fournisseur ?"))) return;
    void put("forget", { key: "" }, t("Clé retirée"));
  }

  const keyHint = c.keyUnreadable
    ? desktop
      ? unreadableKeyText(true)
      : t("La clé enregistrée n'est plus lisible (le secret du serveur a changé) : ressaisis-la.")
    : c.keySource === "reglages"
      ? t("Une clé est enregistrée. Laisse vide pour la garder.")
      : c.keySource === "hebergement"
        ? t("Clé posée par l'hébergement. En saisir une ici la remplace.")
        : spec.keyOptional
          ? c.id === "ollama"
            ? t("Aucune clé : un Ollama installé chez toi n'en demande pas. Il en faut une pour ses modèles en ligne (ollama.com).")
            : t("Aucune clé : un serveur installé chez toi n'en demande pas, le plus souvent.")
          : t("Aucune clé pour l'instant.");

  // Où joindre un serveur de modèles installé sur la même machine que Pécule : cela dépend de la façon dont Pécule est installé.
  const local = c.id === "ollama" ? (ollamaUrl ?? info.url?.placeholder ?? "") : "";
  const localHint =
    c.id !== "ollama"
      ? ""
      : desktop
        ? t("Ollama installé sur cet ordinateur : {adresse}.", { adresse: local })
        : local.includes("host.docker.internal")
          ? t("Pécule tourne dans Docker, où « localhost » ne désigne que lui : un Ollama installé sur la même machine se joint à {adresse}.", { adresse: local })
          : t("Ollama installé sur la même machine que Pécule : {adresse}.", { adresse: local });

  const typed = models.find((m) => m.id === model.trim());
  // Une liste courte (les modèles installés dans un Ollama) se montre en entier ; un catalogue se parcourt à la saisie.
  const pickable = models.length > 0 && models.length <= 30;

  return (
    <form
      className="space-y-3 px-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && contextOk && !busy) void put("save", changes, t("Enregistré"));
      }}
    >
      {/* Prêt, la rangée affiche le modèle et l'hôte : la fiche rappelle alors de quel service il s'agit. */}
      {c.ready && <p className="text-xs text-muted">{info.hint}.</p>}
      {info.url && (
        <label htmlFor={`${id}-url`} className="block text-[13px] font-medium">
          {info.url.label}
          <input id={`${id}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={local || info.url.placeholder} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="url" className={INPUT} />
          <span className="mt-1 block text-xs font-normal text-muted">
            {info.url.hint}
            {localHint && ` ${localHint}`}
            {c.urlSource === "hebergement" && ` ${t("Valeur actuelle posée par l'hébergement.")}`}
          </span>
        </label>
      )}
      <label htmlFor={`${id}-key`} className="block text-[13px] font-medium">
        {spec.keyOptional ? t("Clé d'accès (facultative)") : t("Clé d'accès##fournisseur d'IA")}
        <input
          id={`${id}-key`}
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={c.keySet ? "••••••••••••" : info.keyPlaceholder}
          autoComplete="off"
          className={INPUT}
        />
        <span className={cn("mt-1 block text-xs font-normal", c.keyUnreadable ? "text-warn" : "text-muted")}>{keyHint}</span>
      </label>
      <div>
        <label htmlFor={`${id}-model`} className="block text-[13px] font-medium">
          {info.modelLabel}
          <input
            id={`${id}-model`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list={`${id}-models`}
            placeholder={spec.models[0] ?? (spec.lists ? t("Choisis-le dans la liste, ou écris son nom") : "")}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={INPUT}
          />
          <datalist id={`${id}-models`}>
            {(models.length ? models.map((m) => m.id) : spec.models).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        {/* Dans une liste courte, chaque ligne dit déjà ce que sait faire son modèle. */}
        {typed && !pickable && traitsOf(typed).length > 0 && <p className="mt-1 text-xs text-muted">{traitsOf(typed).join(" · ")}</p>}
        {spec.lists && (
          <div className="mt-2">
            {pickable && (
              <ul className="mb-2 divide-y divide-line overflow-hidden rounded-md ring-1 ring-line" aria-label={t("Modèles proposés par le service")}>
                {models.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => setModel(m.id)} aria-pressed={m.id === model.trim()} className={cn("press flex w-full flex-wrap items-baseline gap-x-2 px-3 py-2 text-left text-[13.5px]", m.id === model.trim() && "bg-accent-soft")}>
                      <span className="font-mono font-medium">{m.id}</span>
                      <span className="text-xs text-muted">{traitsOf(m).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <button type="button" onClick={() => void list()} disabled={!!busy || (spec.address !== "fixe" && !url.trim())} className="press text-[13px] font-medium text-accent disabled:opacity-50">
                {busy === "list" ? t("Lecture…") : models.length ? t("Relire la liste des modèles") : t("Voir les modèles du service")}
              </button>
              {models.length > 30 && <span>{tn("{n} modèle proposé : écris quelques lettres pour le trouver.", "{n} modèles proposés : écris quelques lettres pour trouver le tien.", models.length)}</span>}
            </div>
          </div>
        )}
      </div>
      {spec.context && (
        <label htmlFor={`${id}-context`} className="block text-[13px] font-medium">
          {t("Fenêtre de contexte (jetons)")}
          <input
            id={`${id}-context`}
            value={context}
            onChange={(e) => setContext(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={String(OLLAMA_CONTEXT.default)}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={!contextOk}
            className={cn(INPUT, !contextOk && "ring-neg")}
          />
          <span className={cn("mt-1 block text-xs font-normal", contextOk ? "text-muted" : "text-neg")}>
            {contextOk
              ? t("Ce que le modèle lit d'un coup. Les consignes et les outils de l'assistant en prennent à eux seuls près de {n} : en dessous, il ne peut pas répondre. Une fenêtre plus grande demande plus de mémoire à la machine. Laissé à lui-même, Ollama n'en donnerait que 4 096 sur une machine modeste.", {
                  n: OLLAMA_CONTEXT.assistant.toLocaleString(locale()),
                })
              : t("Entre {min} et {max} jetons.", { min: OLLAMA_CONTEXT.min.toLocaleString(locale()), max: OLLAMA_CONTEXT.max.toLocaleString(locale()) })}
          </span>
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      {notes.map((n) => (
        <p key={n} role="status" className="text-sm text-warn">
          {n}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!dirty || !contextOk || !!busy} className="press rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy === "save" ? (c.active ? t("Essai puis enregistrement…") : t("Enregistrement…")) : t("Enregistrer")}
        </button>
        <button type="button" onClick={() => void test()} disabled={!!busy} className="press rounded-xl bg-bg px-4 py-2.5 text-sm font-semibold text-accent disabled:opacity-50">
          {busy === "test" ? t("Essai…") : t("Tester")}
        </button>
        {!c.active && (
          <button type="button" onClick={use} disabled={!!busy} className="press rounded-xl bg-bg px-4 py-2.5 text-sm font-semibold text-accent disabled:opacity-50">
            {busy === "use" ? t("Essai…") : t("Utiliser ce fournisseur")}
          </button>
        )}
        {c.keySource === "reglages" || c.keyUnreadable ? (
          <button type="button" onClick={forget} disabled={!!busy} className="press rounded-xl px-3 py-2.5 text-sm font-medium text-neg disabled:opacity-50">
            {t("Retirer la clé")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
