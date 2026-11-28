import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { unreadableKeyText, useDesktop } from "../desktop.ts";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { api, useMe } from "../api.ts";
import { cn } from "../cn.ts";
import { Card } from "./ui.tsx";
import { Section } from "./SettingsSection.tsx";
import { AI_MODELS, AI_PROVIDER_INFO, type AiConnectorStatus, type AiProvider, type AiStatus } from "../../lib/ai-providers.ts";
import { locale, t } from "../../lib/i18n.ts";

type Status = AiStatus & { voice: boolean };
type Test = { ok: boolean; error?: string; ms: number };
const QUERY = ["ai-config"];

/**
 * Fournisseur d'IA (toute la famille) : qui sert Claude à Pécule, avec son adresse, son modèle et sa clé.
 * Un seul répond à la fois ; les autres peuvent être préparés et essayés en réserve.
 */
export function AiSettings() {
  const status = useQuery({ queryKey: QUERY, queryFn: () => api<Status>("/ai/config") });
  const [open, setOpen] = useState<AiProvider | null>(null);
  // Le fournisseur d'IA reçoit les documents de tout le foyer : seul l'administrateur le règle.
  const admin = useMe().data?.user?.admin === true;
  return (
    <Section id="fournisseur" title={t("Fournisseur d'IA")}>
      <Card className="divide-y divide-line">
        {status.data?.connectors.map((c) => (
          <ConnectorRow key={c.id} c={c} open={admin && open === c.id} onToggle={() => admin && setOpen(open === c.id ? null : c.id)} />
        ))}
        {status.error && <div className="px-4 py-3 text-sm text-neg">{status.error instanceof Error ? status.error.message : t("Réglage indisponible")}</div>}
      </Card>
      {!admin && status.data && <p className="mt-2 px-1 text-xs text-muted">{t("Seul l'administrateur du foyer peut changer ces réglages.")}</p>}
      <p className="mt-2 px-1 text-xs text-muted">
        {t("Réglage commun à toute la famille. Le fournisseur choisi reçoit tout ce que Pécule confie à l'IA : questions à l'assistant, factures, documents et bulletins de paie. Les clés sont chiffrées et ne sont plus jamais affichées. Un fournisseur est essayé avant d'être choisi ou modifié : si l'essai échoue, rien ne change.")}{" "}
        {status.data && (status.data.voice ? t("Le mode vocal passe toujours par la ressource Microsoft Foundry.") : t("Le mode vocal a besoin d'une ressource Microsoft Foundry (son nom et sa clé)."))}
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

function ConnectorRow({ c, open, onToggle }: { c: AiConnectorStatus; open: boolean; onToggle: () => void }) {
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
      {open && <ConnectorForm key={[c.url, c.model, c.keySource, c.active].join("|")} c={c} />}
    </div>
  );
}

const INPUT = "mt-1 w-full rounded-md bg-bg px-3 py-2 text-[16px] ring-1 ring-line outline-none placeholder:text-muted/70 max-md:focus:ring-2 max-md:focus:ring-accent md:text-[14px]";

function ConnectorForm({ c }: { c: AiConnectorStatus }) {
  const desktop = useDesktop();
  const info = AI_PROVIDER_INFO[c.id];
  const qc = useQueryClient();
  const id = useId();
  const [url, setUrl] = useState(c.url ?? "");
  const [model, setModel] = useState(c.model);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "use" | "forget" | null>(null);
  const [error, setError] = useState("");

  // Seul ce qui a changé part : une valeur posée par l'hébergement n'est pas recopiée dans les réglages.
  const changes = {
    ...(info.url && url.trim() !== (c.url ?? "") ? { url: url.trim() } : {}),
    ...(model.trim() !== c.model ? { model: model.trim() } : {}),
    ...(key.trim() ? { key: key.trim() } : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  async function put(what: "save" | "use" | "forget", body: Record<string, unknown>, done: string) {
    setBusy(what);
    setError("");
    try {
      qc.setQueryData(QUERY, await api<Status>("/ai/config", { method: "PUT", json: { provider: c.id, ...body } }));
      // Le mode vocal dépend de la ressource Foundry : sa disponibilité est relue.
      void qc.invalidateQueries({ queryKey: ["voice-status"] });
      void qc.invalidateQueries({ queryKey: ["assistant-status"] });
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
    try {
      const r = await api<Test>("/ai/test", { method: "POST", json: { provider: c.id, ...changes } });
      if (r.ok) toast.success(t("{nom} répond ({duree} s)", { nom: info.label, duree: (r.ms / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) }));
      else setError(r.error ?? t("L'essai a échoué"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Essai impossible"));
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
        : t("Aucune clé pour l'instant.");

  return (
    <form
      className="space-y-3 px-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !busy) void put("save", changes, t("Enregistré"));
      }}
    >
      {/* Prêt, la rangée affiche le modèle et l'hôte : la fiche rappelle alors de quel service il s'agit. */}
      {c.ready && <p className="text-xs text-muted">{info.hint}.</p>}
      {info.url && (
        <label htmlFor={`${id}-url`} className="block text-[13px] font-medium">
          {info.url.label}
          <input id={`${id}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={info.url.placeholder} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="url" className={INPUT} />
          <span className="mt-1 block text-xs font-normal text-muted">
            {info.url.hint}
            {c.urlSource === "hebergement" && ` ${t("Valeur actuelle posée par l'hébergement.")}`}
          </span>
        </label>
      )}
      <label htmlFor={`${id}-key`} className="block text-[13px] font-medium">
        {t("Clé d'accès##fournisseur d'IA")}
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
      <label htmlFor={`${id}-model`} className="block text-[13px] font-medium">
        {info.modelLabel}
        <input id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} list={`${id}-models`} placeholder={AI_MODELS[0]} autoComplete="off" autoCapitalize="none" spellCheck={false} className={INPUT} />
        <datalist id={`${id}-models`}>
          {AI_MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!dirty || !!busy} className="press rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
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
