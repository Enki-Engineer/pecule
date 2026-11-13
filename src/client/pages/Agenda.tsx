import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CalendarClock, Check, ChevronDown, FileText, Flag, Landmark, Lock, Pencil, Plus, Receipt, Repeat, RotateCcw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api, useAgenda, type AgendaEntry } from "../api.ts";
import { Amount, Card, Empty, ErrorBox, Field, PageHeader, Row, Segmented, Sheet, Spinner } from "../components/ui.tsx";
import { dateFr, money } from "../format.ts";
import { DOMAIN_LABELS, RECURRENCE_LABELS } from "../../lib/documents.ts";
import { askAssistant } from "../assistantBus.ts";
import { cn } from "../cn.ts";
import { useMedia } from "../useMedia.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

/*
 * Échéancier : tâches à faire (en retard en tête), jalons, et échéances calculées (crédits,
 * garanties, documents, contrats, impôts) sur 3 mois, 1 an ou 5 ans.
 * Une ligne se lit avant de se cocher : un clic ouvre sa fiche (ce qu'elle veut dire, d'où elle vient, ses notes en
 * entier) ; seule la pastille ronde coche une tâche, et une coche s'annule (message, puis « Fait récemment »).
 */

const HORIZONS = [
  { value: "90", label: t("3 mois") },
  { value: "365", label: t("1 an") },
  { value: "1825", label: t("5 ans") },
] as const;

/** Durée pendant laquelle une tâche cochée reste sous « Fait récemment », en jours. */
const RECENT_DAYS = 30;

const ICONS: Record<AgendaEntry["source"], typeof Flag> = {
  saisie: Flag,
  pret: Landmark,
  garantie: ShieldCheck,
  document: FileText,
  impots: Receipt,
  contrat: Repeat,
};

const monthTitle = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { month: "long", year: "numeric" });
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Jours de la semaine, du lundi au dimanche, dans la langue de l'écran (« Lun », « Mon », « Mo »…). */
const weekdays = () =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1 + i, 12).toLocaleDateString(locale(), { weekday: "short" }).replace(/\.$/, "");
    return d.charAt(0).toUpperCase() + d.slice(1);
  });

/*
 * Titre d'une échéance dans une case du calendrier, sans son préfixe (« Mensualité · », « Fin de garantie · »…).
 * Les échéances calculées arrivent du serveur dans la langue du membre : on retire ce qui précède le premier « · ».
 */
const shortTitle = (e: AgendaEntry) =>
  e.kind === "echeance" && e.source !== "saisie" && e.source !== "impots" ? e.title.replace(/^[^·]+ · /, "") : e.title.replace(/^(Mensualité|Fin de garantie|Échéance|Renouvellement) · /, "");

/** Nature d'une ligne, telle que sa fiche la nomme. */
const kindLabel = (e: AgendaEntry) => (e.kind === "tache" ? t("Tâche à faire") : e.kind === "jalon" ? t("Date à retenir") : t("Échéance calculée"));

/**
 * D'où vient une ligne que Pécule calcule (rien pour une ligne saisie). L'accord donné à la banque arrive avec les
 * contrats : sa clé (« banque:… ») le distingue.
 */
function originOf(e: AgendaEntry): { label: string; hint: string } | null {
  if (e.source === "saisie") return null;
  if (e.key.startsWith("banque:")) return { label: t("Accord bancaire"), hint: t("L'accord de lecture donné à ta banque vaut 180 jours : sans renouvellement, tes comptes ne sont plus lus.") };
  if (e.source === "pret") return { label: t("Crédit"), hint: t("Calculé d'après l'échéancier de ton crédit.") };
  if (e.source === "garantie") return { label: t("Garantie"), hint: t("Calculé d'après la garantie notée sur la facture.") };
  if (e.source === "document") return { label: t("Document"), hint: t("Calculé d'après l'échéance du document rangé au coffre.") };
  if (e.source === "contrat") return { label: t("Contrat"), hint: t("Calculé d'après la date de renouvellement de l'engagement, dans le Budget.") };
  return { label: t("Impôts"), hint: t("Calendrier fiscal : date indicative, à vérifier auprès de l'administration.") };
}

/** Libellé du lien d'une fiche vers l'écran d'où vient la ligne. */
const linkLabel = (link: string) =>
  link.startsWith("/credits")
    ? t("Voir le crédit")
    : link.startsWith("/factures")
      ? t("Voir la facture")
      : link.startsWith("/documents")
        ? t("Voir le document")
        : link.startsWith("/budget")
          ? t("Voir le budget")
          : link.startsWith("/impots")
            ? t("Voir les impôts")
            : link.startsWith("/reglages")
              ? t("Voir les connexions")
              : link.startsWith("/immobilier")
                ? t("Voir le bien")
                : link.startsWith("/patrimoine")
                  ? t("Voir le patrimoine")
                  : t("Voir dans Pécule");

export function Agenda() {
  const qc = useQueryClient();
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]["value"]>("365");
  const [adding, setAdding] = useState(false);
  const desktop = useMedia("(min-width: 1024px)");
  // « ?retard=1 » (compteur du menu) : la liste, déroulée jusqu'à ce qui est en retard.
  const [params] = useSearchParams();
  const late = params.get("retard") === "1";
  const [view, setView] = useState<"calendrier" | "liste">(late ? "liste" : "calendrier");
  // Fiche ouverte : sa ligne est relue dans les données à chaque rafraîchissement (cochée, modifiée…).
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Tâches dont la coche est en route vers le serveur : la pastille montre déjà l'état demandé.
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const agenda = useAgenda(Number(horizon), false, RECENT_DAYS);
  const data = agenda.data;
  const overdueRef = useRef<HTMLElement>(null);
  const ready = !!data;
  useEffect(() => {
    if (!late || !ready) return;
    setView("liste");
    requestAnimationFrame(() => overdueRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [late, ready]);

  const { entries, recent, overdue, undated, byMonth } = useMemo(() => {
    const all = data?.entries ?? [];
    // Cochées depuis peu : rangées à part (« Fait récemment »), les dernières d'abord.
    const recent = all.filter((e) => e.recent).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "") || (b.id ?? 0) - (a.id ?? 0));
    const entries = all.filter((e) => !e.recent);
    const overdue = entries.filter((e) => e.overdue);
    const undated = entries.filter((e) => !e.date && !e.overdue);
    const map = new Map<string, AgendaEntry[]>();
    for (const e of entries.filter((e) => e.date && !e.overdue)) {
      const k = e.date!.slice(0, 7);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return { entries, recent, overdue, undated, byMonth: [...map.entries()] };
  }, [data]);

  const opened = openKey ? (data?.entries.find((e) => e.key === openKey) ?? null) : null;
  // La ligne ouverte n'existe plus (supprimée, sortie de la période affichée) : sa fiche se ferme.
  useEffect(() => {
    if (openKey && data && !data.entries.some((e) => e.key === openKey)) setOpenKey(null);
  }, [openKey, data]);

  const refresh = () => Promise.all(["agenda", "dashboard", "nav-counts"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const isDone = (e: AgendaEntry) => (e.id != null && e.id in pending ? pending[e.id] : e.status === "fait");

  /** Coche ou décoche une tâche. Une coche s'annule depuis le message : une tâche cochée par mégarde ne disparaît plus sans retour. */
  async function setDone(e: AgendaEntry, done: boolean) {
    if (e.id == null) return;
    const id = e.id;
    setPending((p) => ({ ...p, [id]: done }));
    try {
      const r = await api<{ next?: number }>(`/agenda/${id}`, { method: "PATCH", json: { done } });
      await refresh();
      if (done)
        toast.success(r.next ? t("Fait — prochaine occurrence ajoutée") : t("Fait"), {
          duration: 8000,
          action: { label: t("Annuler##retour en arrière"), onClick: () => void setDone(e, false) },
        });
      else toast.success(t("Remise à faire"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Enregistrement impossible"));
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  }

  async function remove(e: AgendaEntry) {
    if (e.id == null || !confirm(t("Supprimer « {titre} » ?", { titre: e.title }))) return;
    try {
      await api(`/agenda/${e.id}`, { method: "DELETE" });
      if (openKey === e.key) setOpenKey(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Enregistrement impossible"));
    }
  }

  const open = (e: AgendaEntry) => setOpenKey(e.key);
  const toggle = (e: AgendaEntry) => void setDone(e, !isDone(e));
  const row = (e: AgendaEntry) => <AgendaRow key={e.key} e={e} done={isDone(e)} onOpen={() => open(e)} onToggle={() => toggle(e)} onRemove={() => remove(e)} />;

  return (
    <>
      <PageHeader
        title={t("Échéancier")}
        subtitle={t("À faire, jalons et échéances")}
        right={
          <button type="button" onClick={() => setAdding(true)} className="press flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[14px] font-semibold text-white shadow-[0_1px_2px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] md:h-auto md:rounded-md md:py-1.5 md:text-[13px] md:font-medium">
            <Plus size={16} /> {t("Ajouter")}
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1 md:max-w-xs">
          <Segmented value={horizon} options={[...HORIZONS]} onChange={setHorizon} />
        </div>
        {desktop && (
          <div className="w-56">
            <Segmented
              value={view}
              options={[
                { value: "calendrier", label: t("Calendrier") },
                { value: "liste", label: t("Liste") },
              ]}
              onChange={setView}
            />
          </div>
        )}
      </div>
      {agenda.error && <ErrorBox error={agenda.error} />}
      {desktop && view === "calendrier" && data ? (
        <AgendaCalendar entries={entries} recent={recent} isDone={isDone} onOpen={open} onToggle={toggle} onMore={() => setView("liste")} />
      ) : agenda.isLoading ? (
        <Spinner />
      ) : entries.length === 0 && recent.length === 0 ? (
        <Empty>{t("Rien à l'horizon.")}</Empty>
      ) : (
        <div className="space-y-5">
          {entries.length === 0 && <Empty>{t("Rien à l'horizon.")}</Empty>}
          {overdue.length > 0 && (
            <section ref={overdueRef} className="scroll-mt-20">
              <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-sm font-semibold text-neg">
                <AlertTriangle size={15} /> {t("En retard")}
              </h2>
              <Card className="divide-y divide-line">{overdue.map(row)}</Card>
            </section>
          )}
          {undated.length > 0 && (
            <section>
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">{t("À faire, sans date")}</h2>
              <Card className="divide-y divide-line">{undated.map(row)}</Card>
            </section>
          )}
          {byMonth.map(([m, list]) => (
            <section key={m}>
              <h2 className="mb-1.5 px-1 text-sm font-semibold capitalize text-muted">{monthTitle(`${m}-15`)}</h2>
              <Card className="divide-y divide-line">{list.map(row)}</Card>
            </section>
          ))}
          <DoneList items={recent} onOpen={open} onRestore={(e) => void setDone(e, false)} />
          <p className="px-1 text-xs text-muted">
            {t("Calculé à la volée : mensualités et fins de crédits, fins de garantie des factures, échéances des documents, renouvellements des contrats, calendrier fiscal (dates indicatives).")}
          </p>
        </div>
      )}
      {adding && <AddTask onClose={() => setAdding(false)} onAdded={refresh} />}
      {opened && <AgendaSheet key={opened.key} e={opened} done={isDone(opened)} onClose={() => setOpenKey(null)} onToggle={() => toggle(opened)} onRemove={() => remove(opened)} onSaved={refresh} />}
    </>
  );
}

/**
 * Pastille à cocher d'une tâche : la seule façon de la cocher (le reste de la ligne ouvre sa fiche). La coche se
 * dessine au survol et au focus, avant le clic ; le libellé lu par un lecteur d'écran nomme la tâche.
 */
function CheckDot({ done, title, onToggle, size = "lg" }: { done: boolean; title: string; onToggle: () => void; size?: "lg" | "md" | "sm" }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={done}
      aria-label={done ? t("Remettre à faire : {titre}", { titre: title }) : t("Marquer comme fait : {titre}", { titre: title })}
      title={done ? t("Remettre à faire") : t("Marquer comme fait")}
      className={clsx("group/check grid shrink-0 place-items-center rounded-full", size === "lg" ? "press -m-1 size-10" : size === "md" ? "size-7" : "size-5")}
    >
      <span
        className={clsx(
          "grid place-items-center rounded-full transition-colors",
          size === "lg" ? "size-[22px] border-2" : size === "md" ? "size-[18px] border-2" : "size-[13px] border-[1.5px]",
          done ? "border-pos bg-pos text-white" : "border-muted/70 text-transparent group-hover/check:border-pos group-hover/check:text-pos group-focus-visible/check:border-pos group-focus-visible/check:text-pos",
        )}
      >
        <Check size={size === "lg" ? 13 : size === "md" ? 11 : 8} strokeWidth={3.2} />
      </span>
    </button>
  );
}

/** Ligne de la liste : la pastille coche, le reste ouvre la fiche. */
function AgendaRow({ e, done, onOpen, onToggle, onRemove }: { e: AgendaEntry; done: boolean; onOpen: () => void; onToggle: () => void; onRemove: () => void }) {
  const Icon = ICONS[e.source] ?? CalendarClock;
  return (
    <div className="flex items-center gap-3 px-4 md:hover:bg-bg/50">
      {e.kind === "tache" && e.id != null && <CheckDot done={done} title={e.title} onToggle={onToggle} />}
      <button type="button" onClick={onOpen} className="press flex min-w-0 flex-1 items-center gap-3 py-3 text-left">
        {!(e.kind === "tache" && e.id != null) && (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            <Icon size={15} />
          </span>
        )}
        <span className="block min-w-0 flex-1">
          <span className={clsx("block truncate text-[15px] font-medium", done && "text-muted line-through")}>{e.title}</span>
          <span className="flex items-center gap-1 truncate text-xs text-muted">
            {e.date && <span className={clsx(e.overdue && "font-medium text-neg")}>{dateFr(e.date)}</span>}
            <span>
              {e.date ? "· " : ""}
              {DOMAIN_LABELS[e.domain] ?? e.domain}
            </span>
            {e.recurrence && <span>· {RECURRENCE_LABELS[e.recurrence] ?? e.recurrence}</span>}
            {/* Le début des notes se voit, mais ne fait pas partie du nom du bouton : un lecteur d'écran les lit dans la fiche. */}
            {e.notes && (
              <span className="truncate" aria-hidden>
                · {e.notes}
              </span>
            )}
          </span>
        </span>
        {e.amount != null && <Amount value={e.amount} className="shrink-0 text-sm font-semibold" />}
      </button>
      {e.id != null && (
        <button type="button" onClick={onRemove} aria-label={t("Supprimer")} className="press shrink-0 p-1 text-muted hover:text-neg">
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

/**
 * « Fait récemment » : les tâches cochées depuis moins de trente jours, repliées par défaut ; chacune se remet à
 * faire d'un geste. `compact` : dans la colonne du calendrier.
 */
function DoneList({ items, onOpen, onRestore, compact = false }: { items: AgendaEntry[]; onOpen: (e: AgendaEntry) => void; onRestore: (e: AgendaEntry) => void; compact?: boolean }) {
  const [shown, setShown] = useState(false);
  if (!items.length) return null;
  const header = (
    <button type="button" onClick={() => setShown((v) => !v)} aria-expanded={shown} className={clsx("flex items-center gap-1 font-semibold", compact ? "w-full text-[13px]" : "mb-1.5 px-1 text-sm text-muted")}>
      <ChevronDown size={compact ? 14 : 15} className={clsx("shrink-0 transition-transform", !shown && "-rotate-90")} />
      {t("Fait récemment ({n})", { n: items.length })}
    </button>
  );
  const rows = items.map((e) => (
    <div key={e.key} className={clsx("flex items-center gap-2", compact ? "py-0.5" : "px-4")}>
      <Check size={compact ? 14 : 16} className="shrink-0 text-pos" aria-hidden />
      <button type="button" onClick={() => onOpen(e)} className={clsx("min-w-0 flex-1 text-left", compact ? "rounded px-1 py-1 text-[13px] hover:bg-bg" : "press py-3")}>
        <span className={clsx("block truncate text-muted line-through", !compact && "text-[15px] font-medium")}>{e.title}</span>
        {e.doneAt && <span className="block text-xs text-muted">{t("Fait le {date}", { date: dateFr(e.doneAt) })}</span>}
      </button>
      <button
        type="button"
        onClick={() => onRestore(e)}
        aria-label={t("Remettre à faire : {titre}", { titre: e.title })}
        title={t("Remettre à faire")}
        className={clsx("flex shrink-0 items-center gap-1 rounded-md font-medium text-accent hover:bg-accent-soft", compact ? "p-1.5" : "press px-2 py-1.5 text-[13px]")}
      >
        <RotateCcw size={14} />
        {!compact && <span className="hidden sm:inline">{t("Remettre à faire")}</span>}
      </button>
    </div>
  ));
  const note = <p className={clsx("text-xs text-muted", compact ? "mt-2" : "mt-1.5 px-1")}>{t("Une tâche cochée reste ici {n} jours.", { n: RECENT_DAYS })}</p>;
  if (compact)
    return (
      <Card className="p-4">
        {header}
        {shown && (
          <>
            <div className="mt-2 max-h-72 overflow-y-auto">{rows}</div>
            {note}
          </>
        )}
      </Card>
    );
  return (
    <section>
      {header}
      {shown && (
        <>
          <Card className="divide-y divide-line">{rows}</Card>
          {note}
        </>
      )}
    </section>
  );
}

/* ---------- Fiche d'une ligne ---------- */

/**
 * Fiche : ce que la ligne veut dire (nature, origine, date, domaine, récurrence, montant, notes en entier) et ce
 * qu'on peut en faire. Une ligne saisie se coche, se modifie, se supprime ; une ligne calculée renvoie à l'écran
 * d'où elle vient.
 */
function AgendaSheet({ e, done, onClose, onToggle, onRemove, onSaved }: { e: AgendaEntry; done: boolean; onClose: () => void; onToggle: () => void; onRemove: () => void; onSaved: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const origin = originOf(e);
  const Icon = ICONS[e.source] ?? CalendarClock;
  const mine = e.id != null;
  const task = mine && e.kind === "tache";
  const primary = "press flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-accent py-3 font-semibold text-white";
  const secondary = "press flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-card py-3 font-semibold ring-1 ring-line";

  if (editing && mine)
    return (
      <Sheet open onClose={onClose} title={t("Modifier")}>
        <TaskForm
          initial={{ kind: e.kind === "jalon" ? "jalon" : "tache", title: e.title, date: e.date ?? "", recurrence: e.recurrence ?? "", domain: e.domain, notes: e.notes ?? "", priv: !!e.private }}
          submitLabel={t("Enregistrer")}
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await api(`/agenda/${e.id}`, { method: "PATCH", json: taskBody(v) });
            await onSaved();
            toast.success(t("Enregistré"));
            setEditing(false);
          }}
        />
      </Sheet>
    );

  return (
    <Sheet open onClose={onClose} title={kindLabel(e)}>
      <Card className="mb-3 p-4">
        <div className="flex items-start gap-3">
          {task ? (
            <CheckDot size="md" done={done} title={e.title} onToggle={onToggle} />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon size={15} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className={clsx("text-[16px] font-semibold leading-snug", done && "text-muted line-through")}>{e.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
              <span>{[origin?.label, DOMAIN_LABELS[e.domain] ?? e.domain].filter(Boolean).join(" · ")}</span>
              {e.private && (
                <span className="inline-flex items-center gap-1">
                  · <Lock size={12} /> {t("Privé")}
                </span>
              )}
            </div>
          </div>
        </div>
        {done ? (
          <div className="mt-3 flex items-center gap-1.5 text-sm text-pos">
            <Check size={15} /> {e.doneAt ? t("Fait le {date}", { date: dateFr(e.doneAt) }) : t("Fait")}
          </div>
        ) : e.overdue && e.date ? (
          <div className="mt-3 flex items-center gap-1.5 text-sm font-medium text-neg">
            <AlertTriangle size={15} /> {t("En retard depuis le {date}", { date: dateFr(e.date) })}
          </div>
        ) : (
          <div className={clsx("mt-3 flex items-center gap-1.5 text-sm", e.date ? "text-accent" : "text-muted")}>
            <CalendarClock size={15} /> <span className="first-letter:uppercase">{e.date ? longDate(e.date) : t("Sans date")}</span>
          </div>
        )}
      </Card>

      {(e.recurrence || e.amount != null || (done && e.date)) && (
        <Card className="mb-3">
          {done && e.date && <Row label={t("Échéance")} value={dateFr(e.date)} />}
          {e.recurrence && <Row label={t("Récurrence")} value={cap(RECURRENCE_LABELS[e.recurrence] ?? e.recurrence)} />}
          {e.amount != null && <Row label={t("Montant")} value={<Amount value={e.amount} />} />}
        </Card>
      )}

      {e.notes && (
        <Card className="mb-3 p-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("Notes")}</div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{e.notes}</p>
        </Card>
      )}

      {origin && <p className="mb-3 px-1 text-xs leading-relaxed text-muted">{origin.hint}</p>}

      {/* Ligne saisie : la cocher ou la modifier d'abord, le lien vers son écran ensuite. Ligne calculée : son écran est tout ce qu'on peut en faire. */}
      {mine && (
        <div className="mb-3 flex gap-2">
          {task && (
            // Le libellé le plus long de la rangée : il prend la place qu'il lui faut sur un téléphone.
            <button type="button" onClick={onToggle} className={cn(done ? secondary : primary, "flex-[1.7]")}>
              {done ? <RotateCcw size={16} /> : <Check size={17} />} {done ? t("Remettre à faire") : t("Marquer comme fait")}
            </button>
          )}
          <button type="button" onClick={() => setEditing(true)} className={secondary}>
            <Pencil size={15} /> {t("Modifier")}
          </button>
        </div>
      )}
      {e.link && (
        <Link to={e.link} className={clsx("mb-3", mine ? secondary : primary)}>
          {linkLabel(e.link)} <ArrowRight size={17} />
        </Link>
      )}
      <button
        type="button"
        onClick={() =>
          askAssistant(
            e.date
              ? t("Explique-moi cette ligne de mon échéancier : « {titre} », au {date}. À quoi correspond-elle et que dois-je faire ?", { titre: e.title, date: dateFr(e.date) })
              : t("Explique-moi cette ligne de mon échéancier : « {titre} ». À quoi correspond-elle et que dois-je faire ?", { titre: e.title }),
          )
        }
        className="press mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-soft py-2.5 text-sm font-semibold text-accent"
      >
        <Sparkles size={16} /> {t("Demander à l'assistant")}
      </button>
      {mine && (
        <button type="button" onClick={onRemove} className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-sm text-neg">
          <Trash2 size={15} /> {t("Supprimer")}
        </button>
      )}
    </Sheet>
  );
}

/* ---------- Ajout et modification d'une ligne saisie ---------- */

type TaskValues = { kind: "tache" | "jalon"; title: string; date: string; recurrence: string; domain: string; notes: string; priv: boolean };
const NEW_TASK: TaskValues = { kind: "tache", title: "", date: "", recurrence: "", domain: "autre", notes: "", priv: false };

/** Ce que le serveur attend d'une ligne saisie (une date à retenir ne se répète pas). */
const taskBody = (v: TaskValues) => ({
  kind: v.kind,
  title: v.title.trim(),
  dueDate: v.date || null,
  recurrence: v.kind === "tache" ? v.recurrence || null : null,
  domain: v.domain,
  notes: v.notes.trim() || null,
  private: v.priv,
});

/** Hauteur de la zone de notes : assez de lignes pour lire une note déjà longue sans la faire défiler (3 au moins, 12 au plus). */
const noteRows = (notes: string) => Math.min(12, Math.max(3, notes.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 55)), 0) + 1));

/** Champs d'une ligne saisie, les mêmes à l'ajout et à la modification. */
function TaskForm({ initial, submitLabel, onSubmit, onCancel }: { initial: TaskValues; submitLabel: string; onSubmit: (v: TaskValues) => Promise<void>; onCancel?: () => void }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TaskValues>(k: K, value: TaskValues[K]) => setV((p) => ({ ...p, [k]: value }));
  const select = "card block w-full px-4 py-3 text-[16px] outline-none";
  return (
    <form
      className="space-y-2"
      onSubmit={async (ev) => {
        ev.preventDefault();
        if (!v.title.trim() || busy) return;
        setBusy(true);
        try {
          await onSubmit(v);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("Enregistrement impossible"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Segmented
        value={v.kind}
        options={[
          { value: "tache", label: t("Tâche à faire") },
          { value: "jalon", label: t("Date à retenir") },
        ]}
        onChange={(k) => set("kind", k)}
      />
      <Field label={t("Intitulé")} value={v.title} onChange={(x) => set("title", x)} text />
      <div className="grid grid-cols-2 gap-2">
        <label className="card block px-4 py-3">
          <span className="block text-xs text-muted">{t("Date")}</span>
          <input type="date" value={v.date} onChange={(ev) => set("date", ev.target.value)} className="w-full bg-transparent text-[16px] outline-none" />
        </label>
        <label className="block">
          <select value={v.kind === "jalon" ? "" : v.recurrence} onChange={(ev) => set("recurrence", ev.target.value)} className={clsx(select, "h-full")} disabled={v.kind === "jalon"} aria-label={t("Récurrence")}>
            <option value="">{t("Une fois")}</option>
            <option value="mensuel">{t("Chaque mois")}</option>
            <option value="trimestriel">{t("Chaque trimestre")}</option>
            <option value="annuel">{t("Chaque année")}</option>
          </select>
        </label>
      </div>
      <select value={v.domain} onChange={(ev) => set("domain", ev.target.value)} className={select} aria-label={t("Domaine")}>
        {Object.entries(DOMAIN_LABELS).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <label className="card block px-4 py-3">
        <span className="block text-xs text-muted">{t("Notes")}</span>
        <textarea value={v.notes} onChange={(ev) => set("notes", ev.target.value)} rows={noteRows(v.notes)} className="w-full resize-none bg-transparent text-[15px] outline-none" />
      </label>
      <label className="card flex items-center justify-between px-4 py-3 text-[15px]">
        {t("Visible par moi seul")}
        <input type="checkbox" checked={v.priv} onChange={(ev) => set("priv", ev.target.checked)} className="size-5 accent-[var(--color-accent)]" />
      </label>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={busy} className="press flex-1 rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="press flex-1 rounded-xl bg-card py-3 font-semibold text-muted ring-1 ring-line">
            {t("Annuler")}
          </button>
        )}
      </div>
    </form>
  );
}

function AddTask({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<unknown> }) {
  return (
    <Sheet open onClose={onClose} title={t("Ajouter à l'échéancier")}>
      <TaskForm
        initial={NEW_TASK}
        submitLabel={t("Ajouter")}
        onSubmit={async (v) => {
          await api("/agenda", { method: "POST", json: taskBody(v) });
          await onAdded();
          toast.success(t("Ajouté"));
          onClose();
        }}
      />
    </Sheet>
  );
}

/* ---------- Calendrier (ordinateur) ---------- */

const SOURCE_COLOR: Record<AgendaEntry["source"], string> = {
  saisie: "var(--series-7)",
  pret: "var(--series-1)",
  garantie: "var(--series-3)",
  document: "var(--series-2)",
  impots: "var(--series-8)",
  contrat: "var(--series-4)",
};

/**
 * Calendrier mensuel (ordinateur) : chaque jour liste ses échéances, et la colonne de droite ce qui est en retard,
 * ce qui est à faire sans date et ce qui a été fait récemment. Partout, la pastille coche et l'intitulé ouvre la fiche.
 */
function AgendaCalendar({
  entries,
  recent,
  isDone,
  onOpen,
  onToggle,
  onMore,
}: {
  entries: AgendaEntry[];
  recent: AgendaEntry[];
  isDone: (e: AgendaEntry) => boolean;
  onOpen: (e: AgendaEntry) => void;
  onToggle: (e: AgendaEntry) => void;
  /** « + n autres » d'une case : passe à la vue Liste. */
  onMore: () => void;
}) {
  const today = new Date().toLocaleDateString("sv-SE");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaEntry[]>();
    for (const e of entries) if (e.date?.startsWith(month)) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [entries, month]);
  const shift = (d: number) => {
    const x = new Date(y, m - 1 + d, 15);
    setMonth(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
  };
  const overdue = entries.filter((e) => e.overdue);
  const undated = entries.filter((e) => !e.date && !e.overdue);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" onClick={() => shift(-1)} className="rounded-md px-2 py-1 text-muted hover:bg-bg hover:text-ink" aria-label={t("Mois précédent")}>
            ‹
          </button>
          <div className="text-[14px] font-semibold capitalize">{new Date(y, m - 1, 15).toLocaleDateString(locale(), { month: "long", year: "numeric" })}</div>
          <button type="button" onClick={() => shift(1)} className="rounded-md px-2 py-1 text-muted hover:bg-bg hover:text-ink" aria-label={t("Mois suivant")}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md bg-line text-[11.5px]">
          {weekdays().map((d) => (
            <div key={d} className="bg-bg px-2 py-1 font-medium text-muted">
              {d}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`l${i}`} className="min-h-24 bg-bg/60" />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, "0")}`;
            const list = byDay.get(date) ?? [];
            return (
              <div key={date} className={clsx("min-h-24 bg-card p-1.5", date === today && "ring-2 ring-inset ring-accent")}>
                <div className={clsx("mb-1 text-[11px]", date === today ? "font-semibold text-accent" : "text-muted")}>{i + 1}</div>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((e) => {
                    const task = e.kind === "tache" && e.id != null;
                    const done = isDone(e);
                    return (
                      <div key={e.key} className="flex items-center">
                        {task ? (
                          <CheckDot size="sm" done={done} title={e.title} onToggle={() => onToggle(e)} />
                        ) : (
                          // Même largeur que la pastille : les intitulés d'une case restent alignés.
                          <span className="grid size-5 shrink-0 place-items-center">
                            <span className="h-2.5 w-1 rounded-sm" style={{ background: SOURCE_COLOR[e.source] }} />
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpen(e)}
                          title={`${e.title}${e.amount != null ? ` · ${money(e.amount)}` : ""}`}
                          className={clsx("min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left hover:bg-bg", done && "text-muted line-through")}
                        >
                          {task ? e.title : shortTitle(e)}
                        </button>
                      </div>
                    );
                  })}
                  {/* Les lignes qui ne tiennent pas dans la case se lisent dans la liste. */}
                  {list.length > 3 && (
                    <button type="button" onClick={onMore} title={t("Tout voir dans la liste")} className="rounded px-1 text-[11px] text-muted hover:bg-bg hover:text-ink">
                      {tn("+ {n} autre", "+ {n} autres", list.length - 3)}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11.5px] text-muted">
          {(
            [
              ["pret", t("Crédits")],
              ["garantie", t("Garanties")],
              ["document", t("Documents")],
              ["impots", t("Impôts")],
              ["contrat", t("Contrats")],
              ["saisie", t("Jalons")],
            ] as const
          ).map(([k, l]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="h-2.5 w-1 rounded-sm" style={{ background: SOURCE_COLOR[k] }} /> {l}
            </span>
          ))}
        </div>
      </Card>
      <div className="space-y-5">
        {overdue.length > 0 && (
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-neg">
              <AlertTriangle size={14} /> {t("En retard")}
            </div>
            {overdue.map((e) => (
              <SideRow key={e.key} e={e} done={isDone(e)} onOpen={() => onOpen(e)} onToggle={() => onToggle(e)} />
            ))}
          </Card>
        )}
        <Card className="p-4">
          <div className="mb-2 text-[13px] font-semibold">{t("À faire, sans date ({n})", { n: undated.length })}</div>
          <div className="max-h-[580px] overflow-y-auto">
            {undated.map((e) => (
              <SideRow key={e.key} e={e} done={isDone(e)} onOpen={() => onOpen(e)} onToggle={() => onToggle(e)} />
            ))}
          </div>
        </Card>
        <DoneList compact items={recent} onOpen={onOpen} onRestore={onToggle} />
      </div>
    </div>
  );
}

/** Ligne des colonnes du calendrier : pastille, intitulé, puis sa date (si elle en a une) et le début de ses notes. */
function SideRow({ e, done, onOpen, onToggle }: { e: AgendaEntry; done: boolean; onOpen: () => void; onToggle: () => void }) {
  return (
    <div className="flex items-start">
      {e.kind === "tache" && e.id != null ? <CheckDot size="md" done={done} title={e.title} onToggle={onToggle} /> : <span className="size-7 shrink-0" />}
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 rounded px-1 py-1 text-left text-[13px] hover:bg-bg">
        <span className={clsx("block", done && "text-muted line-through")}>{e.title}</span>
        {(e.date || e.notes) && (
          <span className="block truncate text-[12px] text-muted">
            {e.date && <span className={clsx(e.overdue && "font-medium text-neg")}>{dateFr(e.date)}</span>}
            {e.notes && <span aria-hidden>{`${e.date ? " · " : ""}${e.notes}`}</span>}
          </span>
        )}
      </button>
    </div>
  );
}
