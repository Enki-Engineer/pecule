import { useEffect, useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, PauseCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { openThread } from "../assistantBus.ts";
import { cn } from "../cn.ts";
import { aiCost, monthLabel, monthShort, pct } from "../format.ts";
import { Card, InfoTip, ProgressBar, Segmented, Spinner } from "./ui.tsx";
import { Section } from "./SettingsSection.tsx";
import { BUDGET_ALERT, REFERENCE_MODEL, USAGE_GROUPS, daysInMonth, type UsageGroup, type UsageKind, type UsageReport } from "../../lib/ai-usage.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

/*
 * Réglages → Coût de l'IA : ce que l'IA a coûté au foyer. Le mois en cours et sa projection, douze mois par
 * usage, le détail d'un mois (par usage, par membre, par modèle), l'effet du cache, les conversations et imports
 * les plus coûteux du membre, le plafond du mois et le tarif des modèles (ces deux-là : l'administrateur).
 * Tout est en euros, quelle que soit la devise du foyer : c'est la facture du fournisseur.
 */

type Report = UsageReport & { admin: boolean };

const useUsage = (month: string | null) =>
  useQuery({ queryKey: ["ai-usage", month], queryFn: () => api<Report>(`/assistant/usage${month ? `?mois=${month}` : ""}`), placeholderData: keepPreviousData });

const KIND_LABELS: Record<UsageKind, string> = {
  assistant: t("Assistant"),
  import: t("Import de dossier"),
  facture: t("Lecture de factures"),
  classement: t("Classement d'articles"),
  operations: t("Classement d'opérations"),
  document: t("Rangement de documents"),
  bulletin: t("Lecture de bulletins"),
  voix: t("Mode vocal"),
  traduction: t("Traduction des noms"),
  test: t("Essai d'un fournisseur"),
  demo: t("Sessions de démo"),
  autre: t("Autre usage"),
};
const GROUP_LABELS: Record<UsageGroup, string> = {
  assistant: t("Assistant"),
  import: t("Import de dossier"),
  factures: t("Factures"),
  documents: t("Documents et bulletins"),
  voix: t("Mode vocal"),
  autres: t("Autres usages"),
  demo: t("Sessions de démo"),
};
const groupColor = (g: UsageGroup) => `var(--series-${USAGE_GROUPS.indexOf(g) + 1})`;

/** Coût moyen d'une unité d'un usage (« 0,04 € par facture lue »). */
function unitText(kind: UsageKind, cost: number): string | null {
  const montant = aiCost(cost);
  if (kind === "assistant") return t("{montant} par conversation", { montant });
  if (kind === "facture") return t("{montant} par facture lue", { montant });
  if (kind === "classement") return t("{montant} par facture classée", { montant });
  if (kind === "operations") return t("{montant} par lot de libellés", { montant });
  if (kind === "document") return t("{montant} par document", { montant });
  if (kind === "bulletin") return t("{montant} par bulletin", { montant });
  if (kind === "import") return t("{montant} par lecture", { montant });
  if (kind === "traduction") return t("{montant} par lot de noms", { montant });
  return null;
}

/** Total d'une ligne : au centime, pour que les montants d'une colonne se comparent d'un coup d'œil. */
const cents = (n: number) => (n > 0 && n < 0.01 ? aiCost(n) : new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(n));
const compact = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
const usd = (n: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(n);
const share = (part: number, total: number) => (total > 0 ? pct((part / total) * 100, 0) : "");

/* ---------- Mois en cours ---------- */

function CurrentMonth({ r }: { r: Report }) {
  const c = r.current;
  const b = r.budget;
  const lastDay = Number(r.today.slice(8, 10)) >= daysInMonth(c.month);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <div className="text-[14px] text-muted">{monthLabel(c.month)}</div>
          <div className="figure mt-1 text-[30px]">{aiCost(c.total)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          {c.total > 0 && !lastDay && (
            <span className="chip chip-dashed" data-tip={t("La dépense du mois entier si elle continue au rythme constaté depuis le 1er.")} tabIndex={0}>
              {t("≈ {montant} à la fin du mois", { montant: aiCost(c.projection) })}
            </span>
          )}
          {c.previous > 0 && <span className="chip">{t("{montant} le mois dernier", { montant: aiCost(c.previous) })}</span>}
        </div>
      </div>
      <div className="mt-2 text-[13px] text-muted">
        {tn("{n} appel à l'IA", "{n} appels à l'IA", c.calls)}
        {c.previous > 0 && ` · ${t("à la même date le mois dernier : {montant}", { montant: aiCost(c.previousToDate) })}`}
        {c.demo > 0 && ` · ${t("dont {montant} pour des sessions de démo", { montant: aiCost(c.demo) })}`}
      </div>
      {b.monthly != null && (
        <div className="mt-4">
          <ProgressBar value={Math.min(1, b.spent / b.monthly)} />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
            <span>{t("{depense} sur un plafond de {plafond}", { depense: aiCost(b.spent), plafond: aiCost(b.monthly) })}</span>
            {b.state === "depasse" ? (
              <span className="chip chip-warn">
                {b.paused ? <PauseCircle size={13} /> : <AlertTriangle size={13} />}
                {b.paused ? t("Plafond atteint : lectures de fond en pause") : t("Plafond atteint")}
              </span>
            ) : b.state === "alerte" ? (
              <span className="chip chip-warn">
                <AlertTriangle size={13} /> {t("{pct} % du plafond", { pct: Math.round((b.spent / b.monthly) * 100) })}
              </span>
            ) : c.total > 0 && !lastDay && c.projection > b.monthly ? (
              <span className="chip chip-dashed">{t("Plafond dépassé à ce rythme")}</span>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------- Douze mois ---------- */

/** Barres empilées des douze mois, par série ; un clic choisit le mois détaillé dessous. */
function MonthBars({ r, onPick }: { r: Report; onPick: (month: string) => void }) {
  const max = Math.max(...r.months.map((m) => m.total), 0.0001);
  const used = USAGE_GROUPS.filter((g) => r.months.some((m) => (m.groups[g] ?? 0) > 0));
  const narrow = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "narrow", timeZone: "UTC" });
  return (
    <Card className="p-4">
      <div className="flex h-40 items-stretch gap-1 md:gap-2">
        {r.months.map((m) => {
          const picked = m.month === r.selected.month;
          const parts = used.filter((g) => (m.groups[g] ?? 0) > 0);
          const tip = `${monthLabel(m.month)} · ${aiCost(m.total)}${parts.length > 1 ? ` — ${parts.map((g) => `${GROUP_LABELS[g]} ${aiCost(m.groups[g]!)}`).join(" · ")}` : ""}`;
          return (
            <button
              key={m.month}
              type="button"
              onClick={() => onPick(m.month)}
              title={tip}
              aria-pressed={picked}
              className={cn("flex min-w-0 flex-1 flex-col justify-end rounded-lg px-0.5 pt-1 md:px-1.5", picked ? "bg-accent-soft" : "hover:bg-bg")}
            >
              <span className="tnum mb-1 hidden truncate text-center text-[10.5px] text-muted md:block">{m.total > 0 ? aiCost(m.total) : ""}</span>
              <span className="flex w-full flex-col-reverse overflow-hidden rounded-t-[5px]" style={{ height: `${Math.max(m.total > 0 ? 2 : 0, (m.total / max) * 78)}%` }}>
                {parts.map((g) => (
                  <span key={g} style={{ flexGrow: m.groups[g], flexBasis: 0, background: groupColor(g) }} />
                ))}
              </span>
              <span className={cn("mt-1 h-4 truncate text-center text-[11px]", picked ? "font-semibold text-ink" : "text-muted")}>
                <span className="md:hidden">{narrow(m.month)}</span>
                <span className="hidden md:inline">{monthShort(m.month)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {used.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
          {used.map((g) => (
            <span key={g} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: groupColor(g) }} /> {GROUP_LABELS[g]}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------- Détail d'un mois ---------- */

type Line = { key: string; label: string; mono?: boolean; color: string; total: number; sub: string; badge?: string };

function Lines({ lines, total }: { lines: Line[]; total: number }) {
  return (
    <>
      {lines.map((l) => (
        <div key={l.key} className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-3 text-[15px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 self-center rounded-full" style={{ background: l.color }} />
              <span className={cn("truncate font-medium", l.mono && "font-mono text-[13.5px]")}>{l.label}</span>
              {l.badge && <span className="chip chip-warn shrink-0 text-[11.5px]">{l.badge}</span>}
            </span>
            <span className="tnum shrink-0 font-medium">{cents(l.total)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/70">
            <div className="h-full rounded-full" style={{ width: `${total > 0 && l.total > 0 ? Math.max(1, (l.total / total) * 100) : 0}%`, background: l.color }} />
          </div>
          <div className="mt-1.5 flex justify-between gap-3 text-[12.5px] text-muted">
            <span className="min-w-0 truncate">{l.sub}</span>
            <span className="tnum shrink-0">{share(l.total, total)}</span>
          </div>
        </div>
      ))}
    </>
  );
}

type View = "usage" | "membre" | "modele";

function MonthDetail({ r, view, setView }: { r: Report; view: View; setView: (v: View) => void }) {
  const s = r.selected;
  const calls = (n: number) => tn("{n} appel", "{n} appels", n);
  const voices = s.models.filter((m) => m.voice);
  const lines: Line[] =
    view === "usage"
      ? s.kinds.map((k) => ({
          key: k.kind,
          label: KIND_LABELS[k.kind],
          color: groupColor(k.group),
          total: k.total,
          // Des appels sans coût : la voix n'était pas chiffrée avant la version 1.17.
          sub: [calls(k.calls), k.total === 0 ? t("coût non compté à l'époque") : k.unitCost != null ? unitText(k.kind, k.unitCost) : null].filter(Boolean).join(" · "),
        }))
      : view === "membre"
        ? s.members.map((m) => ({
            key: m.demo ? "demo" : String(m.id),
            label: m.demo ? t("Sessions de démo") : m.id == null ? t("Tâches de fond") : (m.name ?? t("Ancien membre")),
            color: m.demo ? groupColor("demo") : "var(--color-accent)",
            total: m.total,
            sub: calls(m.calls),
          }))
        : [
            ...s.models
              .filter((m) => !m.voice)
              .map((m) => ({
                key: m.model,
                label: m.model,
                mono: true,
                color: "var(--color-accent)",
                total: m.total,
                badge: m.source === "estime" ? t("tarif estimé") : undefined,
                sub: m.inputTokens ? `${calls(m.calls)} · ${t("{entree} jetons lus, {sortie} écrits", { entree: compact(m.inputTokens), sortie: compact(m.outputTokens) })}` : calls(m.calls),
              })),
            // Les voix et la transcription sont d'autres services que le modèle : une seule ligne pour elles.
            ...(voices.length ? [{ key: "voix", label: KIND_LABELS.voix, color: groupColor("voix"), total: voices.reduce((sum, m) => sum + m.total, 0), sub: calls(voices.reduce((sum, m) => sum + m.calls, 0)) }] : []),
          ].sort((a, b) => b.total - a.total);
  return (
    <>
      <div className="mb-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "usage", label: t("Par usage") },
            { value: "membre", label: t("Par membre") },
            { value: "modele", label: t("Par modèle") },
          ]}
        />
      </div>
      <Card className="divide-y divide-line">
        <Lines lines={lines} total={s.total} />
        {!lines.length && <div className="px-4 py-3 text-sm text-muted">{t("Aucun appel à l'IA ce mois-là.")}</div>}
        {s.cache.input > 0 && s.cache.read + s.cache.write > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-4 py-3 text-[14px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span>{t("Cache : {pct} de l'entrée relue à prix réduit", { pct: pct(s.cache.share * 100, 0) })}</span>
              <InfoTip
                text={t(
                  "Pécule fait garder en cache ses consignes et le début de chaque conversation : le fournisseur les relit pour un dixième du prix. L'économie compare à ce que ces jetons auraient coûté au tarif normal, moins le surcoût de leur mise en cache.",
                )}
              />
            </span>
            <span className="tnum shrink-0 text-muted">{s.cache.saved >= 0 ? t("≈ {montant} économisés", { montant: aiCost(s.cache.saved) }) : t("≈ {montant} de surcoût", { montant: aiCost(-s.cache.saved) })}</span>
          </div>
        )}
      </Card>
      {view === "modele" && s.models.some((m) => m.source === "estime") && (
        <p className="mt-1.5 px-1 text-xs text-muted">{t("Tarif estimé : Pécule ne connaît pas le prix de ce modèle et le compte à celui de {modele}. Donne son tarif plus bas pour un coût juste.", { modele: REFERENCE_MODEL })}</p>
      )}
    </>
  );
}

/* ---------- Les plus coûteux ---------- */

function Top({ r }: { r: Report }) {
  const { threads, batches } = r.selected;
  if (!threads.length && !batches.length) return null;
  return (
    <Section id="plus-couteux" title={t("Tes conversations et imports les plus coûteux")}>
      <Card className="divide-y divide-line">
        {threads.map((th) => (
          <button key={th.id} type="button" onClick={() => openThread(th.id)} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]">{th.title}</span>
              <span className="block text-[12.5px] text-muted">
                {t("Conversation")} · {tn("{n} appel", "{n} appels", th.calls)}
              </span>
            </span>
            <span className="tnum shrink-0 text-[15px] font-medium">{cents(th.total)}</span>
            <ChevronRight size={16} className="shrink-0 text-muted" />
          </button>
        ))}
        {batches.map((b) => (
          <Link key={b.id} to={`/documents?lot=${b.id}`} className="press flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]">{b.name}</span>
              <span className="block text-[12.5px] text-muted">
                {t("Import de dossier")} · {tn("{n} fichier", "{n} fichiers", b.files, { n: b.files })}
              </span>
            </span>
            <span className="tnum shrink-0 text-[15px] font-medium">{cents(b.total)}</span>
            <ChevronRight size={16} className="shrink-0 text-muted" />
          </Link>
        ))}
      </Card>
    </Section>
  );
}

/* ---------- Plafond du mois ---------- */

const field = "tnum w-24 rounded-lg bg-bg px-2.5 py-1.5 text-right text-[14px] ring-1 ring-line disabled:opacity-60";

/** Champ de nombre qui n'enregistre qu'en quittant le champ (ou sur Entrée), et seulement si la valeur a changé. */
function NumberField({ value, onCommit, label, unit, disabled, placeholder }: { value: number | null; onCommit: (v: number | null) => void; label: string; unit: string; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);
  const commit = () => {
    const trimmed = text.trim().replace(",", ".");
    const next = trimmed === "" ? null : Number(trimmed);
    if (next != null && (!Number.isFinite(next) || next < 0)) return setText(value == null ? "" : String(value));
    if (next !== value) onCommit(next);
  };
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[14px] text-muted">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={field}
      />
      {unit}
    </span>
  );
}

function Budget({ r }: { r: Report }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (json: { monthly?: number | null; pauseBackground?: boolean; pauseAll?: boolean }) => api("/ai/budget", { method: "PUT", json }),
    // La case et le champ suivent le geste sans attendre le serveur ; sa réponse (état du plafond, pause) les remplace ensuite.
    onMutate: (json) => qc.setQueriesData<Report>({ queryKey: ["ai-usage"] }, (old) => (old ? { ...old, budget: { ...old.budget, ...json } } : old)),
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Enregistrement impossible")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ai-usage"] }),
  });
  const b = r.budget;
  return (
    <Section id="plafond" title={t("Plafond du mois")}>
      <Card className="divide-y divide-line">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span>
            <span className="block text-[15px] font-medium">{t("Dépense à ne pas dépasser")}</span>
            <span className="block text-[13px] text-muted">
              {t("L'administrateur reçoit une notification à {pct} % du plafond, puis quand il est atteint. Vide : aucun plafond.", { pct: Math.round(BUDGET_ALERT * 100) })}
            </span>
          </span>
          <NumberField value={b.monthly} label={t("Plafond du mois")} unit="€" disabled={!r.admin} placeholder="—" onCommit={(v) => save.mutate({ monthly: v || null })} />
        </div>
        <label className={cn("flex items-center justify-between gap-3 px-4 py-3", b.monthly == null && "opacity-50")}>
          <span>
            <span className="block text-[15px] font-medium">{t("Au plafond, mettre en pause les lectures de fond")}</span>
            <span className="block text-[13px] text-muted">
              {t("Les imports de dossier et la traduction des noms attendent le mois suivant, ou un plafond relevé. L'assistant et les fichiers déposés un à un répondent toujours.")}
            </span>
          </span>
          <input
            type="checkbox"
            checked={b.pauseBackground}
            disabled={!r.admin || b.monthly == null}
            onChange={(e) => save.mutate(e.target.checked ? { pauseBackground: true } : { pauseBackground: false, pauseAll: false })}
            className="size-5 shrink-0 accent-[var(--color-accent)]"
          />
        </label>
        {/* Le plafond qui arrête vraiment la dépense : il emporte les lectures de fond. */}
        <label className={cn("flex items-center justify-between gap-3 px-4 py-3", b.monthly == null && "opacity-50")}>
          <span>
            <span className="block text-[15px] font-medium">{t("Au plafond, tout mettre en pause, l'assistant compris")}</span>
            <span className="block text-[13px] text-muted">
              {t("L'assistant, le mode vocal, le classement par l'IA et la lecture des fichiers déposés attendent aussi le mois suivant, ou un plafond relevé. Un fichier déposé est gardé, sans être lu. En mode démo, l'assistant s'arrête toujours au plafond.")}
            </span>
          </span>
          <input
            type="checkbox"
            checked={b.pauseAll}
            disabled={!r.admin || b.monthly == null}
            onChange={(e) => save.mutate(e.target.checked ? { pauseBackground: true, pauseAll: true } : { pauseAll: false })}
            className="size-5 shrink-0 accent-[var(--color-accent)]"
          />
        </label>
        {b.blocked && <p className="px-4 py-3 text-[13px] font-medium text-warn">{t("Plafond atteint : l'IA est en pause jusqu'au mois prochain. Relève le plafond pour la remettre en marche.")}</p>}
      </Card>
      {!r.admin && <p className="mt-1.5 px-1 text-xs text-muted">{t("Le plafond et les tarifs se règlent par l'administrateur du foyer.")}</p>}
    </Section>
  );
}

/* ---------- Tarifs ---------- */

function PriceRow({ p, admin }: { p: Report["prices"][number]; admin: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState<number | null>(p.input);
  const [output, setOutput] = useState<number | null>(p.output);
  const save = useMutation({
    mutationFn: (price: { input: number; output: number } | null) => api<{ recomputed: number }>("/ai/prices", { method: "PUT", json: { model: p.model, price } }),
    onSuccess: (out) => {
      setEditing(false);
      if (out.recomputed > 0) toast.success(tn("Tarif enregistré : {n} appel passé recalculé", "Tarif enregistré : {n} appels passés recalculés", out.recomputed));
      return qc.invalidateQueries({ queryKey: ["ai-usage"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Enregistrement impossible")),
  });
  // Ollama (rien n'est facturé à l'appel) et OpenRouter (il rend le coût de chaque appel) n'ont pas de tarif à saisir.
  const free = p.source === "local" || p.source === "fournisseur";
  const source =
    p.source === "saisi" ? t("tarif saisi") : p.source === "public" ? t("tarif public") : p.source === "local" ? t("sans coût à l'appel") : p.source === "fournisseur" ? t("coût rendu par le fournisseur") : t("tarif estimé");
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[13.5px] font-medium">{p.model}</span>
          {p.active && <span className="chip shrink-0 text-[11.5px]">{t("en service")}</span>}
        </span>
        <span className="flex items-center gap-2 text-[13px]">
          <span className={cn("chip text-[11.5px]", p.source === "estime" && "chip-warn")}>{source}</span>
          {admin && !editing && !free && (
            <button type="button" onClick={() => setEditing(true)} className="press font-medium text-accent">
              {t("Modifier")}
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            {t("Entrée")}
            <NumberField value={input} label={t("Tarif de l'entrée de {modele}", { modele: p.model })} unit="$" onCommit={setInput} />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            {t("Sortie")}
            <NumberField value={output} label={t("Tarif de la sortie de {modele}", { modele: p.model })} unit="$" onCommit={setOutput} />
          </label>
          <span className="flex items-center gap-3 text-[13px] font-medium">
            <button type="button" disabled={input == null || output == null || save.isPending} onClick={() => save.mutate({ input: input!, output: output! })} className="press rounded-lg bg-accent px-3 py-1.5 text-white disabled:opacity-50">
              {t("Enregistrer")}
            </button>
            {p.source === "saisi" && (
              <button type="button" disabled={save.isPending} onClick={() => save.mutate(null)} className="press text-accent">
                {t("Revenir au tarif d'origine")}
              </button>
            )}
            <button type="button" onClick={() => setEditing(false)} className="press text-muted">
              {t("Annuler")}
            </button>
          </span>
        </div>
      ) : free ? (
        <div className="mt-1 text-[13px] text-muted">
          {p.source === "local" ? t("Servi par Ollama : rien n'est facturé à l'appel.") : t("OpenRouter rend le coût exact de chaque appel : Pécule le compte tel quel.")}
        </div>
      ) : (
        <div className="tnum mt-1 text-[13px] text-muted">{t("{entree} l'entrée · {sortie} la sortie, par million de jetons", { entree: usd(p.input), sortie: usd(p.output) })}</div>
      )}
    </div>
  );
}

function Prices({ r }: { r: Report }) {
  if (!r.prices.length) return null;
  return (
    <Section id="tarifs" title={t("Tarifs des modèles")}>
      <Card className="divide-y divide-line">
        {r.prices.map((p) => (
          <PriceRow key={p.model} p={p} admin={r.admin} />
        ))}
      </Card>
      <p className="mt-1.5 px-1 text-xs leading-relaxed text-muted">
        {t(
          "Tarifs en dollars, ceux que publie le fournisseur. Un modèle ou un déploiement que Pécule ne reconnaît pas est compté au tarif de {modele} tant que le sien n'est pas saisi ; ses appels déjà comptés sont alors recalculés.",
          { modele: REFERENCE_MODEL },
        )}
      </p>
    </Section>
  );
}

/* ---------- Écran ---------- */

export function AiCostScreen() {
  const [month, setMonth] = useState<string | null>(null);
  const [view, setView] = useState<View>("usage");
  const usage = useUsage(month);
  const r = usage.data;
  if (!r) return <Spinner />;
  const empty = r.months.every((m) => m.calls === 0);
  return (
    <>
      <Section id="mois" title={t("Ce mois-ci")}>
        <CurrentMonth r={r} />
      </Section>
      {empty ? (
        <Card className="px-4 py-3 text-sm text-muted">{t("Aucun appel à l'IA enregistré pour l'instant.")}</Card>
      ) : (
        <>
          <Section id="historique" title={t("Douze mois")}>
            <MonthBars r={r} onPick={(m) => setMonth(m === r.current.month ? null : m)} />
          </Section>
          <Section id="detail" title={t("Détail : {mois}", { mois: monthLabel(r.selected.month) })}>
            <MonthDetail r={r} view={view} setView={setView} />
          </Section>
          <Top r={r} />
        </>
      )}
      <Budget r={r} />
      <Prices r={r} />
      <p className="px-1 text-[12.5px] leading-relaxed text-muted">
        {t(
          "Comment c'est compté : chaque appel à l'IA est noté avec ce que le fournisseur a compté (jetons lus et écrits, caractères lus à voix haute, audio transcrit), multiplié par son tarif public et converti en euros au cours du jour. C'est une estimation : ta facture fait foi. Interroger Pécule depuis l'appli Claude ne coûte rien ici, c'est ton abonnement Claude qui le porte.",
        )}{" "}
        <Link to="/reglages/connexions?c=ia" className="font-medium text-accent">
          {t("Changer de fournisseur ou de modèle")}
        </Link>
      </p>
    </>
  );
}

/** Résumé posé dans Réglages → Assistant : le mois en cours, et le chemin vers le détail. */
export function AiCostSummary() {
  const usage = useUsage(null);
  const r = usage.data;
  return (
    <Section id="ia" title={t("Coût de l'IA")}>
      <Link to="/reglages/cout-ia" viewTransition className="press card flex items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block text-[15px] font-medium">{r ? t("{montant} ce mois-ci", { montant: aiCost(r.current.total) }) : t("Ce mois-ci")}</span>
          <span className="block truncate text-[13px] text-muted">
            {r && r.budget.monthly != null
              ? t("{depense} sur un plafond de {plafond}", { depense: aiCost(r.budget.spent), plafond: aiCost(r.budget.monthly) })
              : r && r.current.previous > 0
                ? t("{montant} le mois dernier", { montant: aiCost(r.current.previous) })
                : t("Dépense par usage, par membre et par modèle, plafond du mois")}
          </span>
        </span>
        <ChevronRight size={17} className="shrink-0 text-muted" />
      </Link>
    </Section>
  );
}
