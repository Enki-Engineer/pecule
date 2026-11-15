import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api } from "../api.ts";
import { Card, Empty, ErrorBox, Field, PageHeader, Segmented, Sheet, Spinner } from "../components/ui.tsx";
import { SectionTitle, Stat, StatGrid } from "../components/blocks.tsx";
import { dateFr, money, moneySymbol } from "../format.ts";
import { COMMITMENT_STATUS, COMMITMENT_TYPES, useBudget, type Commitment } from "../api-situation.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { useMedia } from "../useMedia.ts";
import { BrandLogo, commitmentIcon } from "../components/Logo.tsx";
import { EnvelopesSection } from "../components/Planning.tsx";
import { t, td, tk, tn } from "../../lib/i18n.ts";

/*
 * Budget du foyer : engagements récurrents (frais fixes, contrats, abonnements, taxes, garde,
 * budgets courants) et revenus ; reste à vivre recalculé, comparé aux dépenses réelles.
 */

const COUNTED = new Set(["actif", "a_verifier", "a_completer"]);

const COMMITMENT_COLUMNS: Column<Commitment>[] = [
  {
    key: "label",
    header: t("Engagement"),
    sort: (c) => c.label,
    className: "max-w-0 w-full",
    cell: (c) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <BrandLogo texts={[c.provider, c.label]} icon={commitmentIcon(c.type)} size="sm" tone="neutral" />
        <span className={clsx("truncate font-medium", !COUNTED.has(c.status) && "text-muted line-through")}>{c.label}</span>
      </span>
    ),
  },
  { key: "group", header: t("Groupe"), width: "180px", sort: (c) => `${c.group_name ?? "~"}|${String(1e6 - c.monthly_equiv).padStart(10, "0")}`, cell: (c) => <span className="block max-w-[170px] truncate whitespace-nowrap text-muted" title={c.group_name ?? undefined}>{c.group_name ?? "—"}</span> },
  { key: "type", header: t("Type"), width: "150px", hideBelow: "xl", sort: (c) => COMMITMENT_TYPES[c.type] ?? c.type, cell: (c) => <span className="whitespace-nowrap text-muted">{COMMITMENT_TYPES[c.type] ?? c.type}</span> },
  {
    key: "status",
    header: t("Statut"),
    width: "110px",
    sort: (c) => c.status,
    cell: (c) => <span className={clsx("rounded px-1.5 py-0.5 text-[11.5px]", c.status === "actif" ? "bg-pos/10 text-pos" : c.status.startsWith("a_") ? "bg-warn/10 text-warn" : "bg-bg text-muted")}>{COMMITMENT_STATUS[c.status] ?? c.status}</span>,
  },
  { key: "monthly", header: t("Par mois"), width: "100px", align: "right", sort: (c) => c.monthly_equiv, cell: (c) => <span className="font-semibold">{money(c.monthly_equiv)}</span> },
  {
    key: "seen",
    header: t("Dernier prélèvement"),
    width: "160px",
    hideBelow: "lg",
    sort: (c) => c.last_seen?.date ?? null,
    cell: (c) =>
      c.last_seen ? (
        <span className="text-pos">
          {dateFr(c.last_seen.date)} · {money(-c.last_seen.amount)}
        </span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  { key: "end", header: t("Fin"), width: "100px", hideBelow: "xl", sort: (c) => c.end_date, cell: (c) => <span className="tnum text-muted">{c.end_date ? dateFr(c.end_date) : "—"}</span> },
  {
    key: "recognized",
    header: "",
    width: "28px",
    cell: (c) => (c.label_regex ? <span title={t("Prélèvement reconnu automatiquement dans les opérations")} className="text-accent">●</span> : null),
  },
];

export function Budget() {
  const desktop = useMedia("(min-width: 1024px)");
  const b = useBudget();
  const [show, setShow] = useState<"actifs" | "tous">("actifs");
  const [editing, setEditing] = useState<Commitment | "new" | null>(null);
  const d = b.data;

  const groups = useMemo(() => {
    const list = (d?.commitments ?? []).filter((c) => show === "tous" || COUNTED.has(c.status));
    const map = new Map<string, Commitment[]>();
    for (const c of list) map.set(c.group_name ?? tk("Autres"), [...(map.get(c.group_name ?? tk("Autres")) ?? []), c]);
    return [...map.entries()].map(([name, items]) => ({ name, items, total: items.filter((c) => COUNTED.has(c.status)).reduce((s, c) => s + c.monthly_equiv, 0) })).sort((a, b) => b.total - a.total);
  }, [d, show]);

  return (
    <>
      <PageHeader
        title={t("Budget")}
        subtitle={t("Charges fixes, revenus et reste à vivre")}
        right={
          <button type="button" onClick={() => setEditing("new")} className="press flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[14px] font-semibold text-white shadow-[0_1px_2px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] md:h-auto md:rounded-md md:py-1.5 md:text-[13px] md:font-medium">
            <Plus size={16} /> {t("Ajouter")}
          </button>
        }
      />
      {b.error && <ErrorBox error={b.error} />}
      {!d ? (
        <Spinner />
      ) : (
        <>
          <StatGrid>
            <Stat label={t("Revenus du foyer")} info={t("Somme des revenus mensuels nets que tu as renseignés (salaires, loyers…).")} value={money(d.totals.incomeMonthly, true)} hint={t("par mois, nets")} />
            <Stat label={t("Charges fixes")} info={t("Somme, ramenée au mois, de tes engagements en cours : la liste plus bas.")} value={money(d.totals.fixedMonthly, true)} hint={tn("{n} engagement", "{n} engagements", d.commitments.filter((c) => COUNTED.has(c.status)).length)} />
            <Stat label={t("Reste après charges fixes")} info={t("Revenus du foyer moins charges fixes : ce qu'il reste chaque mois pour tout le reste.")} value={money(d.totals.remainingAfterFixed, true)} tone={d.totals.remainingAfterFixed >= 0 ? "pos" : "neg"} />
            <Stat
              label={t("Reste réel")}
              info={t("Revenus du foyer moins ce que tu dépenses vraiment par mois, en moyenne sur les trois derniers mois complets.")}
              value={money(d.totals.remainingAfterActual, true)}
              tone={d.totals.remainingAfterActual >= 0 ? "pos" : "neg"}
              hint={t("dépenses réelles {montant}/mois (moy. 3 mois)", { montant: money(d.totals.actualMonthly, true) })}
            />
          </StatGrid>

          <EnvelopesSection />

          <div className="mb-2 flex items-center justify-between">
            <SectionTitle>{t("Engagements")}</SectionTitle>
            <div className="w-48">
              <Segmented
                value={show}
                options={[
                  { value: "actifs", label: t("En cours") },
                  { value: "tous", label: t("Tous##engagements") },
                ]}
                onChange={setShow}
              />
            </div>
          </div>
          {!groups.length && <Empty>{t("Aucun engagement.")}</Empty>}
          {desktop ? (
            <DataTable
              rows={groups.flatMap((g) => g.items)}
              columns={COMMITMENT_COLUMNS}
              rowKey={(c) => String(c.id)}
              onRowClick={(c) => setEditing(c)}
              initialSort={{ key: "group", dir: "asc" }}
              footer={
                <>
                  <td className="px-3 py-2 text-[12px] text-muted" colSpan={4}>
                    {tn("{n} engagement", "{n} engagements", groups.reduce((n, g) => n + g.items.length, 0))}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-[13px]">{money(groups.reduce((s, g) => s + g.total, 0))}</td>
                  <td colSpan={3} />
                </>
              }
            />
          ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.name}>
                <div className="mb-1 flex justify-between px-1 text-sm">
                  <span className="font-semibold text-muted">{g.name === tk("Autres") ? t("Autres") : g.name}</span>
                  <span className="tnum text-muted">{t("{montant}/mois", { montant: money(g.total) })}</span>
                </div>
                <Card className="divide-y divide-line">
                  {g.items.map((c) => (
                    <button key={c.id} type="button" onClick={() => setEditing(c)} className="press flex w-full items-center gap-3 px-4 py-2.5 text-left">
                      <BrandLogo texts={[c.provider, c.label]} icon={commitmentIcon(c.type)} size="md" tone="neutral" />
                      <div className="min-w-0 flex-1">
                        <div className={clsx("truncate text-[15px] font-medium", !COUNTED.has(c.status) && "text-muted line-through")}>{c.label}</div>
                        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                          <span>{COMMITMENT_TYPES[c.type] ?? c.type}</span>
                          {c.status !== "actif" && <span className={clsx(c.status.startsWith("a_") && "font-medium text-warn")}>· {COMMITMENT_STATUS[c.status] ?? c.status}</span>}
                          {c.last_seen ? (
                            <span className="flex items-center gap-0.5 text-pos">
                              · <Check size={11} /> {t("vu le {date} ({montant})", { date: dateFr(c.last_seen.date).slice(0, 5), montant: money(c.last_seen.amount) })}
                            </span>
                          ) : null}
                          {c.end_date && <span>· {t("fin {date}", { date: dateFr(c.end_date) })}</span>}
                        </div>
                      </div>
                      <span className="tnum shrink-0 text-right text-sm font-semibold">
                        {c.monthly != null ? `${money(c.monthly)}` : c.annual != null ? t("{montant}/an", { montant: money(c.annual) }) : "—"}
                      </span>
                    </button>
                  ))}
                </Card>
              </section>
            ))}
          </div>
          )}

          <SectionTitle>{t("Revenus du foyer")}</SectionTitle>
          <Card className="divide-y divide-line">
            {d.income.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium">{i.label}</div>
                  <div className="text-xs text-muted">
                    {i.person}
                    {i.annual_gross != null && ` · ${t("{montant} brut/an", { montant: money(i.annual_gross, true) })}`}
                  </div>
                </div>
                <span className="tnum shrink-0 text-sm font-semibold text-pos">{i.monthly != null ? `${money(i.monthly)}` : "—"}</span>
              </div>
            ))}
            {!d.income.length && <div className="px-4 py-3 text-sm text-muted">{t("Aucun revenu enregistré.")}</div>}
          </Card>

          <SectionTitle>{t("Dépenses réelles par poste")}</SectionTitle>
          <Card className="divide-y divide-line">
            {d.actualByPoste.map((a) => (
              <div key={a.poste} className="flex justify-between px-4 py-2 text-sm">
                <span>{td(a.poste)}</span>
                <span className="tnum font-medium">{t("{montant}/mois", { montant: money(a.monthly) })}</span>
              </div>
            ))}
          </Card>
          <p className="mt-2 px-1 text-xs text-muted">{t("Moyenne des 3 derniers mois complets, même définition que l'écran Mois. « Vu le » : dernier prélèvement retrouvé grâce au motif de libellé de l'engagement.")}</p>
        </>
      )}
      {editing && <CommitmentSheet c={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CommitmentSheet({ c, onClose }: { c: Commitment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(c?.label ?? "");
  const [group, setGroup] = useState(c?.group_name ?? "");
  const [type, setType] = useState(c?.type ?? "abonnement");
  const [status, setStatus] = useState(c?.status ?? "actif");
  const [monthly, setMonthly] = useState(c?.monthly != null ? String(c.monthly) : "");
  const [annual, setAnnual] = useState(c?.annual != null ? String(c.annual) : "");
  const [pattern, setPattern] = useState(c?.match_pattern ?? "");
  const [regex, setRegex] = useState(c?.label_regex ?? "");
  const [endDate, setEndDate] = useState(c?.end_date ?? "");
  const [renewal, setRenewal] = useState(c?.renewal_date ?? "");
  const [notice, setNotice] = useState(c?.notice_days != null ? String(c.notice_days) : "");
  const [notes, setNotes] = useState(c?.notes ?? "");
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const select = "card block w-full px-4 py-3 text-[16px] outline-none";

  async function save() {
    const body = {
      label: label.trim(),
      groupName: group.trim() || null,
      type,
      status,
      monthly: num(monthly),
      annual: num(annual),
      matchPattern: pattern.trim().toLowerCase() || null,
      labelRegex: regex.trim() || null,
      endDate: endDate || null,
      renewalDate: renewal || null,
      noticeDays: notice ? Number(notice) : null,
      notes: notes.trim() || null,
    };
    try {
      await api(c ? `/commitments/${c.id}` : "/commitments", { method: c ? "PATCH" : "POST", json: body });
      await Promise.all(["budget", "agenda"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast.success(t("Enregistré"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    }
  }

  async function remove() {
    if (!c || !confirm(t("Supprimer « {nom} » ?", { nom: c.label }))) return;
    await api(`/commitments/${c.id}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["budget"] });
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={c ? t("Engagement") : t("Nouvel engagement")}>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) void save();
        }}
      >
        <Field label={t("Intitulé")} value={label} onChange={setLabel} text />
        <Field label={t("Groupe (Logement, Télécom…)")} value={group} onChange={setGroup} text />
        <div className="grid grid-cols-2 gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className={select} aria-label={t("Type")}>
            {Object.entries(COMMITMENT_TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={select} aria-label={t("Statut")}>
            {Object.entries(COMMITMENT_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Mensuel ({devise})", { devise: moneySymbol() })} value={monthly} onChange={setMonthly} />
          <Field label={t("Annuel ({devise})", { devise: moneySymbol() })} value={annual} onChange={setAnnual} />
        </div>
        <Field label={t("Motif du libellé bancaire (pour le retrouver)")} value={pattern} onChange={setPattern} text placeholder={t("ex. ornikar")} />
        <Field label={t("Forme du prélèvement SEPA (reconnue automatiquement)")} value={regex} onChange={setRegex} text placeholder={t("ex. ^[0-9]+ loansn$")} />
        <div className="grid grid-cols-3 gap-2">
          <label className="card block px-3 py-3">
            <span className="block text-xs text-muted">{t("Fin")}</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-transparent text-[15px] outline-none" />
          </label>
          <label className="card block px-3 py-3">
            <span className="block text-xs text-muted">{t("Renouvellement")}</span>
            <input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} className="w-full bg-transparent text-[15px] outline-none" />
          </label>
          <Field label={t("Préavis (j)")} value={notice} onChange={setNotice} />
        </div>
        <label className="card block px-4 py-3">
          <span className="block text-xs text-muted">{t("Notes")}</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="w-full resize-none bg-transparent text-[15px] outline-none" />
        </label>
        <button type="submit" className="press w-full rounded-xl bg-accent py-3 font-semibold text-white">
          {t("Enregistrer")}
        </button>
        {c && (
          <button type="button" onClick={remove} className="flex w-full items-center justify-center gap-1.5 py-2 text-sm text-neg">
            <Trash2 size={15} /> {t("Supprimer")}
          </button>
        )}
      </form>
    </Sheet>
  );
}
