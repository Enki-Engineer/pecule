import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, Circle, Flag, Landmark, Plus, Receipt, Repeat, ShieldCheck, FileText, Trash2, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api, useAgenda, type AgendaEntry } from "../api.ts";
import { Amount, Card, Empty, ErrorBox, Field, PageHeader, Segmented, Sheet, Spinner } from "../components/ui.tsx";
import { dateFr } from "../format.ts";
import { DOMAIN_LABELS, RECURRENCE_LABELS } from "../../lib/documents.ts";
import { useMedia } from "../useMedia.ts";
import { money } from "../format.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

/*
 * Échéancier : tâches à faire (en retard en tête), jalons, et échéances calculées (crédits,
 * garanties, documents, contrats, impôts) sur 3 mois, 1 an ou 5 ans.
 */

const HORIZONS = [
  { value: "90", label: t("3 mois") },
  { value: "365", label: t("1 an") },
  { value: "1825", label: t("5 ans") },
] as const;

const ICONS: Record<AgendaEntry["source"], typeof Flag> = {
  saisie: Flag,
  pret: Landmark,
  garantie: ShieldCheck,
  document: FileText,
  impots: Receipt,
  contrat: Repeat,
};

const monthTitle = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { month: "long", year: "numeric" });

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

export function Agenda() {
  const qc = useQueryClient();
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]["value"]>("365");
  const [adding, setAdding] = useState(false);
  const desktop = useMedia("(min-width: 1024px)");
  const [view, setView] = useState<"calendrier" | "liste">("calendrier");
  const agenda = useAgenda(Number(horizon));
  const entries = agenda.data?.entries ?? [];

  const { overdue, undated, byMonth } = useMemo(() => {
    const overdue = entries.filter((e) => e.overdue);
    const undated = entries.filter((e) => !e.date && !e.overdue);
    const map = new Map<string, AgendaEntry[]>();
    for (const e of entries.filter((e) => e.date && !e.overdue)) {
      const k = e.date!.slice(0, 7);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return { overdue, undated, byMonth: [...map.entries()] };
  }, [entries]);

  async function toggle(e: AgendaEntry) {
    if (!e.id) return;
    try {
      const r = await api<{ next?: number }>(`/agenda/${e.id}`, { method: "PATCH", json: { done: e.status !== "fait" } });
      toast.success(e.status !== "fait" ? (r.next ? t("Fait — prochaine occurrence ajoutée") : t("Fait")) : t("Remise à faire"));
      await Promise.all(["agenda", "dashboard"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Enregistrement impossible"));
    }
  }

  async function remove(e: AgendaEntry) {
    if (!e.id || !confirm(t("Supprimer « {titre} » ?", { titre: e.title }))) return;
    await api(`/agenda/${e.id}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["agenda"] });
  }

  const row = (e: AgendaEntry) => <AgendaRow key={e.key} e={e} onToggle={() => toggle(e)} onRemove={() => remove(e)} />;

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
      {desktop && view === "calendrier" && agenda.data ? (
        <AgendaCalendar entries={entries} onToggle={toggle} />
      ) : agenda.isLoading ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <Empty>{t("Rien à l'horizon.")}</Empty>
      ) : (
        <div className="space-y-5">
          {overdue.length > 0 && (
            <section>
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
          <p className="px-1 text-xs text-muted">
            {t("Calculé à la volée : mensualités et fins de crédits, fins de garantie des factures, échéances des documents, renouvellements des contrats, calendrier fiscal (dates indicatives).")}
          </p>
        </div>
      )}
      {adding && <AddTask onClose={() => setAdding(false)} />}
    </>
  );
}

function AgendaRow({ e, onToggle, onRemove }: { e: AgendaEntry; onToggle: () => void; onRemove: () => void }) {
  const Icon = ICONS[e.source] ?? CalendarClock;
  const done = e.status === "fait";
  const body = (
    <div className="min-w-0 flex-1">
      <div className={clsx("truncate text-[15px] font-medium", done && "text-muted line-through")}>{e.title}</div>
      <div className="flex items-center gap-1 truncate text-xs text-muted">
        {e.date && <span className={clsx(e.overdue && "font-medium text-neg")}>{dateFr(e.date)}</span>}
        <span>{e.date ? "· " : ""}{DOMAIN_LABELS[e.domain] ?? e.domain}</span>
        {e.recurrence && <span>· {RECURRENCE_LABELS[e.recurrence] ?? e.recurrence}</span>}
        {e.notes && <span className="truncate">· {e.notes}</span>}
      </div>
    </div>
  );
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {e.kind === "tache" ? (
        <button type="button" onClick={onToggle} aria-label={done ? t("Remettre à faire") : t("Marquer comme fait")} className={clsx("press grid size-8 shrink-0 place-items-center rounded-full", done ? "bg-pos text-white" : "text-muted")}>
          {done ? <Check size={16} /> : <Circle size={22} />}
        </button>
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <Icon size={15} />
        </span>
      )}
      {e.link ? (
        <Link to={e.link} className="press flex min-w-0 flex-1 items-center gap-3">
          {body}
        </Link>
      ) : (
        body
      )}
      {e.amount != null && <Amount value={e.amount} className="shrink-0 text-sm font-semibold" />}
      {e.id && (
        <button type="button" onClick={onRemove} aria-label={t("Supprimer")} className="press shrink-0 p-1 text-muted hover:text-neg">
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

function AddTask({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"tache" | "jalon">("tache");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [domain, setDomain] = useState("autre");
  const [notes, setNotes] = useState("");
  const [priv, setPriv] = useState(false);
  const select = "card block w-full px-4 py-3 text-[16px] outline-none";
  return (
    <Sheet open onClose={onClose} title={t("Ajouter à l'échéancier")}>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          try {
            await api("/agenda", {
              method: "POST",
              json: { kind, title: title.trim(), dueDate: date || null, recurrence: recurrence || null, domain, notes: notes || null, private: priv },
            });
            await qc.invalidateQueries({ queryKey: ["agenda"] });
            toast.success(t("Ajouté"));
            onClose();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t("Enregistrement impossible"));
          }
        }}
      >
        <Segmented
          value={kind}
          options={[
            { value: "tache", label: t("Tâche à faire") },
            { value: "jalon", label: t("Date à retenir") },
          ]}
          onChange={setKind}
        />
        <Field label={t("Intitulé")} value={title} onChange={setTitle} text />
        <div className="grid grid-cols-2 gap-2">
          <label className="card block px-4 py-3">
            <span className="block text-xs text-muted">{t("Date")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-transparent text-[16px] outline-none" />
          </label>
          <label className="block">
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={clsx(select, "h-full")} disabled={kind === "jalon"} aria-label={t("Récurrence")}>
              <option value="">{t("Une fois")}</option>
              <option value="mensuel">{t("Chaque mois")}</option>
              <option value="trimestriel">{t("Chaque trimestre")}</option>
              <option value="annuel">{t("Chaque année")}</option>
            </select>
          </label>
        </div>
        <select value={domain} onChange={(e) => setDomain(e.target.value)} className={select} aria-label={t("Domaine")}>
          {Object.entries(DOMAIN_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <label className="card block px-4 py-3">
          <span className="block text-xs text-muted">{t("Notes")}</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none bg-transparent text-[15px] outline-none" />
        </label>
        <label className="card flex items-center justify-between px-4 py-3 text-[15px]">
          {t("Visible par moi seul")}
          <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="size-5 accent-[var(--color-accent)]" />
        </label>
        <button type="submit" className="press w-full rounded-xl bg-accent py-3 font-semibold text-white">
          {t("Ajouter")}
        </button>
      </form>
    </Sheet>
  );
}

const SOURCE_COLOR: Record<AgendaEntry["source"], string> = {
  saisie: "var(--series-7)",
  pret: "var(--series-1)",
  garantie: "var(--series-3)",
  document: "var(--series-2)",
  impots: "var(--series-8)",
  contrat: "var(--series-4)",
};

/** Calendrier mensuel (ordinateur) : chaque jour liste ses échéances ; les tâches se cochent sur place. */
function AgendaCalendar({ entries, onToggle }: { entries: AgendaEntry[]; onToggle: (e: AgendaEntry) => void }) {
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
                  {list.slice(0, 3).map((e) =>
                    e.kind === "tache" ? (
                      <button key={e.key} type="button" onClick={() => onToggle(e)} title={e.title} className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left hover:bg-bg">
                        <span className={clsx("size-2.5 shrink-0 rounded-sm border", e.status === "fait" ? "border-pos bg-pos" : "border-muted")} />
                        <span className={clsx("truncate", e.status === "fait" && "text-muted line-through")}>{e.title}</span>
                      </button>
                    ) : (
                      <Link key={e.key} to={e.link ?? "#"} title={`${e.title}${e.amount != null ? ` · ${money(e.amount)}` : ""}`} className="flex items-center gap-1 truncate rounded px-1 py-0.5 hover:bg-bg">
                        <span className="h-2.5 w-1 shrink-0 rounded-sm" style={{ background: SOURCE_COLOR[e.source] }} />
                        <span className="truncate">{shortTitle(e)}</span>
                      </Link>
                    ),
                  )}
                  {list.length > 3 && <div className="px-1 text-[11px] text-muted">{tn("+ {n} autre", "+ {n} autres", list.length - 3)}</div>}
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
              <button key={e.key} type="button" onClick={() => onToggle(e)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[13px] hover:bg-bg">
                <Circle size={14} className="shrink-0 text-muted" />
                <span className="truncate">{e.title}</span>
              </button>
            ))}
          </Card>
        )}
        <Card className="p-4">
          <div className="mb-2 text-[13px] font-semibold">{t("À faire, sans date ({n})", { n: undated.length })}</div>
          <div className="max-h-[520px] overflow-y-auto">
            {undated.map((e) => (
              <button key={e.key} type="button" onClick={() => onToggle(e)} className="flex w-full items-start gap-2 rounded px-1 py-1 text-left text-[13px] hover:bg-bg">
                {e.status === "fait" ? <Check size={14} className="mt-0.5 shrink-0 text-pos" /> : <Circle size={14} className="mt-0.5 shrink-0 text-muted" />}
                <span className={clsx(e.status === "fait" && "text-muted line-through")}>{e.title}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
