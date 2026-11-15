import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { ExternalLink, X } from "lucide-react";
import type { Projections, Retirement, Taxes, TaxReturn } from "../api-situation.ts";
import { Card, PageHeader } from "../components/ui.tsx";
import { DocList, FactsCard, Stat, StatGrid } from "../components/blocks.tsx";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { AxisTick, StackedBars } from "../components/StackedBars.tsx";
import { HypothesisCard } from "../components/Hypotheses.tsx";
import { dateFr, money } from "../format.ts";
import { cn } from "../cn.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

/*
 * Situation sur ordinateur : Impôts, Retraite, Projections en pleine largeur. Graphique à gauche,
 * détail de l'élément choisi à droite (clic sur une barre, un point ou une ligne du tableau),
 * tableaux triables, documents en colonne.
 */

const pct = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${Number(v).toLocaleString(locale(), { maximumFractionDigits: d })} %`);
const n = (v: number | null | undefined) => (v == null ? null : Number(v));
const cleanName = (s: string) => s.replace(/^\p{Extended_Pictographic}\s*/u, "");

function Panel({ title, right, children, className }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {right && <div className="text-[12px] text-muted">{right}</div>}
      </div>
      {children}
    </Card>
  );
}

function Line2({ label, value, strong, tone }: { label: string; value: React.ReactNode; strong?: boolean; tone?: "pos" | "neg" }) {
  return (
    <div className={cn("flex justify-between gap-4 border-b border-line py-1.5 text-[13px] last:border-0", strong && "font-semibold")}>
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className={cn("tnum text-right", tone === "pos" && "text-pos", tone === "neg" && "text-neg")}>{value}</span>
    </div>
  );
}

/** Élément choisi (année, âge, poche), dans la teinte de la barre et de la ligne choisies : on voit d'un coup d'œil ce que le panneau détaille. */
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="tnum rounded-md bg-accent-soft px-1.5 py-0.5">{children}</span>;
}

/** Sélection qui pilote un détail. `touched` reste faux tant que rien n'a été choisi : le détail ne signale un changement qu'après un choix, pas à l'ouverture de l'écran. */
function usePick<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const pick = (v: T) => {
    setValue(v);
    setTouched(true);
  };
  return [value, pick, touched] as const;
}

/* ---------- Impôts ---------- */

export function TaxesDesktop({ d }: { d: Taxes }) {
  const navigate = useNavigate();
  const last = d.returns[0];
  const prev = d.returns[1];
  const [year, pickYear, picked] = usePick<number | null>(last?.income_year ?? null);
  const sel = d.returns.find((r) => r.income_year === year) ?? last;
  const [taxYear, pickTaxYear, taxPicked] = usePick<number | null>(null);
  const propertyIds = [...new Map(d.propertyTaxes.map((p) => [p.property_id, cleanName(p.property_name ?? p.property_id)])).entries()];
  const taxYears = [...new Set(d.propertyTaxes.map((p) => p.year))].sort();
  const latestTaxYear = taxYear ?? taxYears.at(-1) ?? null;

  const irColumns: Column<TaxReturn>[] = [
    { key: "year", header: t("Revenus"), sort: (r) => r.income_year, cell: (r) => <span className="font-medium">{r.income_year}</span>, width: "90px" },
    { key: "sit", header: t("Situation##foyer"), sort: (r) => r.situation ?? "", cell: (r) => <span className="text-muted">{r.situation ?? "—"}</span>, hideBelow: "2xl" },
    { key: "parts", header: t("Parts##fiscales"), align: "right", sort: (r) => n(r.parts), cell: (r) => r.parts ?? "—", hideBelow: "xl" },
    { key: "taxable", header: t("Imposable"), align: "right", sort: (r) => n(r.taxable_income), cell: (r) => money(r.taxable_income, true) },
    { key: "rfr", header: t("RFR"), align: "right", sort: (r) => n(r.rfr), cell: (r) => money(r.rfr, true), hideBelow: "lg" },
    { key: "net", header: t("Impôt net"), align: "right", sort: (r) => n(r.net_tax), cell: (r) => money(r.net_tax, true) },
    { key: "ps", header: t("PS"), align: "right", sort: (r) => n(r.social_levies), cell: (r) => (r.social_levies ? money(r.social_levies, true) : <span className="text-muted">—</span>), hideBelow: "lg" },
    { key: "total", header: t("Total"), align: "right", sort: (r) => n(r.total), cell: (r) => <span className="font-semibold">{money(r.total, true)}</span> },
    { key: "tmi", header: t("TMI"), align: "right", sort: (r) => n(r.tmi), cell: (r) => pct(r.tmi, 0), hideBelow: "xl" },
    { key: "avg", header: t("Taux moyen"), align: "right", sort: (r) => n(r.avg_rate), cell: (r) => pct(r.avg_rate) },
    {
      key: "doc",
      header: t("Avis##impot"),
      align: "right",
      width: "60px",
      cell: (r) =>
        r.document_id ? (
          <Link to={`/documents?id=${r.document_id}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
            PDF
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  type PT = Taxes["propertyTaxes"][number];
  const ptColumns: Column<PT>[] = [
    { key: "year", header: t("Année"), sort: (p) => p.year, cell: (p) => <span className="font-medium">{p.year}</span>, width: "80px" },
    { key: "bien", header: t("Bien"), sort: (p) => p.property_name ?? "", cell: (p) => cleanName(p.property_name ?? p.property_id) },
    { key: "base", header: t("Base##fiscale"), align: "right", sort: (p) => n(p.base), cell: (p) => money(p.base), hideBelow: "xl" },
    { key: "contrib", header: t("Cotisations"), align: "right", sort: (p) => n(p.contributions), cell: (p) => money(p.contributions) },
    { key: "teom", header: t("dont TEOM"), align: "right", sort: (p) => n(p.teom), cell: (p) => money(p.teom), hideBelow: "lg" },
    { key: "fees", header: t("Frais"), align: "right", sort: (p) => n(p.fees), cell: (p) => money(p.fees), hideBelow: "xl" },
    { key: "total", header: t("Total"), align: "right", sort: (p) => n(p.total), cell: (p) => <span className="font-semibold">{money(p.total)}</span> },
    {
      key: "doc",
      header: t("Avis##impot"),
      align: "right",
      width: "60px",
      cell: (p) =>
        p.document_id ? (
          <Link to={`/documents?id=${p.document_id}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
            PDF
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader title={t("Impôts")} subtitle={t("Impôt sur le revenu et taxes foncières du foyer · clique sur une année pour son détail")} />
      {last && (
        <StatGrid>
          <Stat
            label={t("IR + PS sur les revenus {annee}", { annee: last.income_year })}
            value={money(last.total, true)}
            hint={prev?.total != null && last.total != null ? t("{ecart} vs {annee}", { ecart: `${last.total - prev.total >= 0 ? "+" : ""}${money(last.total - prev.total, true)}`, annee: prev.income_year }) : undefined}
          />
          <Stat label={t("Revenu imposable")} value={money(last.taxable_income, true)} hint={last.rfr != null ? t("RFR {montant}", { montant: money(last.rfr, true) }) : undefined} />
          <Stat label={t("Tranche marginale")} value={pct(last.tmi, 0)} hint={t("taux moyen {taux}", { taux: pct(last.avg_rate) })} />
          <Stat label={t("Taxes foncières")} value={money(d.propertyTaxes.filter((p) => p.year === taxYears.at(-1)).reduce((s, p) => s + (n(p.total) ?? 0), 0), true)} hint={taxYears.length ? `${taxYears.at(-1)}, ${tn("{n} bien", "{n} biens", propertyIds.length)}` : undefined} />
        </StatGrid>
      )}

      <div className="grid grid-cols-12 gap-4">
        <Panel title={t("Impôt du foyer par année de revenus")} right={t("Clic : détail de l'année")} className="col-span-12 xl:col-span-8">
          <StackedBars
            data={[...d.returns].reverse().map((r) => ({ year: String(r.income_year), net: n(r.net_tax) ?? 0, ps: n(r.social_levies) ?? 0, rate: r.avg_rate }))}
            xKey="year"
            height={260}
            series={[
              { key: "net", label: t("Impôt sur le revenu"), color: "var(--series-1)" },
              { key: "ps", label: t("Prélèvements sociaux"), color: "var(--series-2)" },
            ]}
            labelFormatter={(r) => t("Revenus {annee}", { annee: r.year })}
            extra={(r) => (r.rate != null ? t("taux moyen {taux}", { taux: pct(r.rate) }) : null)}
            selected={sel ? String(sel.income_year) : null}
            onBarClick={(r) => pickYear(Number(r.year))}
          />
        </Panel>

        <Panel
          key={sel?.income_year ?? "detail"}
          title={sel ? <>{t("Revenus")} <Chip>{sel.income_year}</Chip></> : t("Détail")}
          right={sel?.notice_year ? t("avis {annee}", { annee: sel.notice_year }) : undefined}
          className={cn("col-span-12 xl:col-span-4", picked && "sel-swap")}
        >
          {sel && (
            <>
              <Line2 label={t("Situation##foyer")} value={`${sel.situation ?? "—"}${sel.parts ? ` · ${tn("{n} part", "{n} parts", Number(sel.parts), { n: sel.parts })}` : ""}`} />
              {sel.salaries.map((s) => (
                <Line2 key={s.user_id} label={t("Salaires {nom}", { nom: s.name })} value={money(s.amount, true)} />
              ))}
              {sel.other_income != null && <Line2 label={t("Autres revenus")} value={money(sel.other_income, true)} />}
              <Line2 label={t("Revenu imposable")} value={money(sel.taxable_income, true)} />
              <Line2 label={t("Revenu fiscal de référence")} value={money(sel.rfr, true)} />
              <Line2 label={t("Impôt net")} value={money(sel.net_tax, true)} />
              {!!sel.decote && <Line2 label={t("Décote")} value={money(-Math.abs(sel.decote), true)} />}
              {!!sel.credits && <Line2 label={t("Réductions et crédits")} value={money(-Math.abs(sel.credits), true)} />}
              {!!sel.social_levies && <Line2 label={t("Prélèvements sociaux")} value={money(sel.social_levies, true)} />}
              <Line2 label={t("Total")} value={money(sel.total, true)} strong />
              <Line2 label={t("TMI · taux moyen")} value={`${pct(sel.tmi, 0)} · ${pct(sel.avg_rate)}`} />
              {sel.balance != null && <Line2 label={t("Solde de l'avis")} value={money(sel.balance, true)} tone={sel.balance > 0 ? "neg" : "pos"} />}
              {sel.credits_detail && <p className="mt-2 text-[12px] leading-relaxed text-muted">{sel.credits_detail}</p>}
              {sel.notes && <p className="mt-2 text-[12px] leading-relaxed text-muted">{sel.notes}</p>}
              {sel.document_id && (
                <button
                  type="button"
                  onClick={() => navigate(`/documents?id=${sel.document_id}`, { viewTransition: true })}
                  className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
                >
                  <ExternalLink size={13} /> {t("Ouvrir l'avis")}
                </button>
              )}
            </>
          )}
        </Panel>

        <div className="col-span-12">
          <h2 className="mb-2 font-semibold">{t("Impôt sur le revenu")}</h2>
          <DataTable rows={d.returns} columns={irColumns} rowKey={(r) => String(r.income_year)} selectedKey={sel ? String(sel.income_year) : null} onRowClick={(r) => pickYear(r.income_year)} initialSort={{ key: "year", dir: "desc" }} />
        </div>

        {d.propertyTaxes.length > 0 && (
          <>
            <Panel title={t("Taxes foncières par année")} right={t("Clic : détail de l'année")} className="col-span-12 xl:col-span-8">
              <StackedBars
                data={taxYears.map((y) => ({ year: String(y), ...Object.fromEntries(propertyIds.map(([id]) => [id, n(d.propertyTaxes.find((p) => p.year === y && p.property_id === id)?.total) ?? 0])) }))}
                xKey="year"
                height={220}
                series={propertyIds.map(([id, name], i) => ({ key: id, label: name, color: `var(--series-${(i % 8) + 1})` }))}
                selected={latestTaxYear != null ? String(latestTaxYear) : null}
                onBarClick={(r) => pickTaxYear(Number(r.year))}
              />
            </Panel>
            <Panel
              key={latestTaxYear ?? "detail"}
              title={latestTaxYear != null ? <>{t("Taxes foncières")} <Chip>{latestTaxYear}</Chip></> : t("Taxes foncières")}
              right={
                taxYear ? (
                  <button type="button" onClick={() => pickTaxYear(null)} className="flex items-center gap-1 text-accent">
                    {t("dernière année")} <X size={11} />
                  </button>
                ) : undefined
              }
              className={cn("col-span-12 xl:col-span-4", taxPicked && "sel-swap")}
            >
              <div className="space-y-3">
                {d.propertyTaxes
                  .filter((p) => p.year === latestTaxYear)
                  .map((p) => {
                    const before = d.propertyTaxes.find((x) => x.property_id === p.property_id && x.year === p.year - 1);
                    const delta = before?.total ? (n(p.total)! - n(before.total)!) / n(before.total)! : null;
                    return (
                      <div key={p.property_id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <Link to={`/immobilier/${p.property_id}`} className="font-medium hover:text-accent">
                            {cleanName(p.property_name ?? p.property_id)}
                          </Link>
                          <span className="tnum font-semibold">
                            {money(p.total)}
                            {delta != null && <span className="ml-1.5 text-[11px] font-normal text-muted">{delta >= 0 ? "+" : ""}{pct(delta * 100, 1)}</span>}
                          </span>
                        </div>
                        {p.notes && <p className="mt-1 text-[12px] leading-relaxed text-muted">{p.notes}</p>}
                      </div>
                    );
                  })}
              </div>
            </Panel>
            <div className="col-span-12">
              <DataTable rows={d.propertyTaxes} columns={ptColumns} rowKey={(p) => `${p.year}|${p.property_id}`} onRowClick={(p) => pickTaxYear(p.year)} rowClassName={(p) => (p.year === latestTaxYear ? "bg-accent-soft" : "")} initialSort={{ key: "year", dir: "desc" }} />
            </div>
          </>
        )}

        <div className="col-span-12">
          <h2 className="mb-2 font-semibold">{t("Documents et analyses")}</h2>
          <DocGrid docs={d.documents} empty={t("Aucun document fiscal.")} />
          <p className="mt-3 text-[12px] text-muted">{t("Échéances fiscales (déclaration, solde, taxe foncière) : voir l'échéancier.")}</p>
        </div>
      </div>
    </>
  );
}

/** Documents en grille de trois colonnes (ordinateur). */
function DocGrid({ docs, empty }: { docs: { id: number; title: string; kind: string; doc_date: string | null }[]; empty?: string }) {
  if (!docs.length) return <div className="text-sm text-muted">{empty}</div>;
  const cols = [0, 1, 2].map((c) => docs.filter((_, i) => i % 3 === c));
  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {cols.filter((c) => c.length).map((c, i) => (
        <DocList key={i} docs={c} />
      ))}
    </div>
  );
}

/* ---------- Retraite ---------- */

type Sim = Retirement["simulations"][number];
type Career = Retirement["career"][number];

/** Trois familles de simulations : officielle, carrière complète, arrêt anticipé (FIRE). */
const SIM_SERIES = [
  { key: "officielle", label: t("Officielle (info-retraite)"), short: t("Officielle"), color: "var(--series-1)", match: (s: Sim) => s.source === "info-retraite" },
  { key: "complete", label: t("Carrière complète"), short: t("Carrière complète"), color: "var(--series-3)", match: (s: Sim) => s.source !== "info-retraite" && /complète/i.test(s.label) },
  { key: "fire", label: t("Arrêt à 55 ans (FIRE)"), short: t("Arrêt à 55 ans (FIRE)"), color: "var(--series-2)", match: (s: Sim) => s.source !== "info-retraite" && /fire|arrêt/i.test(s.label) },
] as const;

export function RetirementDesktop({ d }: { d: Retirement }) {
  const fact = (re: RegExp) => d.facts.find((f) => re.test(f.label))?.value ?? null;
  const quarters = Number(fact(/^Trimestres enregistrés/i) ?? 0);
  const required = Number(fact(/^Trimestres requis/i) ?? 0);
  const legalAge = fact(/^Âge légal/i);
  const fullAge = fact(/^Âge du taux plein/i);
  const earliest = fact(/départ au plus tôt/i);
  const official = d.simulations.filter((s) => s.source === "info-retraite");
  const atLegal = official.find((s) => String(s.age) === legalAge) ?? official[0];
  const atFull = official.find((s) => String(s.age) === fullAge);
  const [picked, setPicked, pickedTouched] = usePick<Sim | null>(null);
  const [period, setPeriod] = useState<Career | null>(null);
  const pickedSeries = picked ? SIM_SERIES.find((f) => f.match(picked)) : undefined;

  // Une ligne par âge, une colonne par famille (pension brute : renseignée pour toutes les simulations).
  const ages = [...new Set(d.simulations.map((s) => s.age).filter((a): a is number => a != null))].sort((a, b) => a - b);
  const chart = ages.map((age) => ({
    age,
    ...Object.fromEntries(SIM_SERIES.map((f) => [f.key, n(d.simulations.find((s) => s.age === age && f.match(s))?.gross_monthly)])),
  }));
  const present = SIM_SERIES.filter((f) => chart.some((r) => (r as Record<string, unknown>)[f.key] != null));

  const careerData = useMemo(
    () => [...d.career].sort((a, b) => (a.start_year ?? 0) - (b.start_year ?? 0)).map((c) => ({ period: c.period, income: n(c.income) ?? 0, quarters: c.quarters, row: c })),
    [d.career],
  );

  const simColumns: Column<Sim>[] = [
    {
      key: "kind",
      header: t("Type"),
      width: "140px",
      sort: (s) => SIM_SERIES.findIndex((f) => f.match(s)),
      cell: (s) => {
        const f = SIM_SERIES.find((x) => x.match(s));
        return (
          <span className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className="size-2 rounded-sm" style={{ background: f?.color ?? "#9aa5b4" }} />
            {f?.short ?? t("Scénario")}
          </span>
        );
      },
    },
    { key: "age", header: t("Âge"), align: "right", width: "76px", sort: (s) => s.age, cell: (s) => <span className="whitespace-nowrap">{s.age != null ? t("{age} ans", { age: s.age }) : "—"}</span> },
    { key: "label", header: t("Simulation"), sort: (s) => s.label, cell: (s) => <span className="block max-w-[520px] truncate" title={s.label}>{s.label}</span>, hideBelow: "lg" },
    { key: "q", header: t("Trimestres"), align: "right", sort: (s) => s.quarters, cell: (s) => s.quarters ?? "—", hideBelow: "xl" },
    { key: "gross", header: t("Brut / mois"), align: "right", sort: (s) => n(s.gross_monthly), cell: (s) => money(s.gross_monthly, true) },
    { key: "net", header: t("Net / mois"), align: "right", sort: (s) => n(s.net_monthly), cell: (s) => (s.net_monthly ? <span className="font-semibold">{money(s.net_monthly, true)}</span> : <span className="text-muted">—</span>) },
    { key: "adj", header: t("Décote / surcote"), sort: (s) => s.adjustment ?? "", cell: (s) => <span className="text-[12px] text-muted">{s.adjustment ?? "—"}</span>, hideBelow: "xl" },
  ];
  const careerColumns: Column<Career>[] = [
    { key: "period", header: t("Période"), width: "90px", sort: (c) => c.start_year, cell: (c) => <span className="font-medium">{c.period}</span> },
    { key: "employer", header: t("Employeur"), sort: (c) => c.employer ?? "", cell: (c) => c.employer ?? <span className="text-muted">—</span> },
    { key: "notes", header: t("Remarque"), cell: (c) => <span className="block max-w-[420px] truncate text-[12px] text-muted" title={c.notes ?? undefined}>{c.notes ?? ""}</span>, hideBelow: "xl" },
    { key: "income", header: t("Revenus"), align: "right", sort: (c) => n(c.income), cell: (c) => money(c.income, true) },
    { key: "q", header: t("Trimestres"), align: "right", sort: (c) => c.quarters, cell: (c) => c.quarters ?? "—" },
    { key: "points", header: t("Points"), align: "right", sort: (c) => n(c.points), cell: (c) => (c.points != null ? Number(c.points).toLocaleString(locale(), { maximumFractionDigits: 2 }) : "—"), hideBelow: "lg" },
  ];

  return (
    <>
      <PageHeader title={t("Retraite")} subtitle={d.simulations[0] ? t("Données officielles du {date} · privé", { date: dateFr(d.simulations[0].simulated_on) }) : t("Privé")} />
      <StatGrid>
        <Stat label={t("Trimestres validés")} value={required ? `${quarters} / ${required}` : quarters || "—"} hint={required ? <ProgressHint value={quarters / required} /> : undefined} />
        <Stat label={t("Départ au plus tôt")} value={legalAge ? t("{age} ans", { age: legalAge }) : "—"} hint={earliest ? t("le {date}", { date: dateFr(earliest) }) : undefined} />
        <Stat label={t("Pension à {age} ans", { age: atLegal?.age ?? "?" })} value={money(atLegal?.net_monthly ?? atLegal?.gross_monthly, true)} hint={`${atLegal?.net_monthly ? t("net par mois") : t("brut par mois")} · ${atLegal?.adjustment ?? ""}`} />
        <Stat label={t("Taux plein à {age} ans", { age: fullAge ?? "?" })} value={money(atFull?.net_monthly ?? atFull?.gross_monthly, true)} hint={atFull?.net_monthly ? t("net par mois") : t("brut par mois")} />
      </StatGrid>

      <div className="grid grid-cols-12 gap-4">
        <Panel title={t("Pension brute mensuelle selon l'âge de départ")} right={t("Clic sur un point : détail")} className="col-span-12 xl:col-span-8">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart
                data={chart}
                margin={{ left: 4, right: 22, top: 8, bottom: 0 }}
                onClick={(s) => {
                  const row = chart[Number(s?.activeIndex)];
                  if (!row) return;
                  setPicked(d.simulations.find((x) => x.age === row.age && x.source === "info-retraite") ?? d.simulations.find((x) => x.age === row.age) ?? null);
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="age" tickLine={false} axisLine={false} tick={<AxisTick selected={picked?.age != null ? String(picked.age) : null} format={(a) => t("{age} ans", { age: a })} />} tickFormatter={(a) => t("{age} ans", { age: a })} />
                <YAxis width={60} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickFormatter={(v: number) => money(v, true)} domain={["auto", "auto"]} />
                <Tooltip content={<SimTip />} cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }} />
                {legalAge && <ReferenceLine x={Number(legalAge)} stroke="var(--color-muted)" strokeDasharray="3 3" label={{ value: t("âge légal"), position: "insideTopLeft", fill: "var(--color-muted)", fontSize: 11 }} />}
                {/* Simulation choisie : trait plein à son âge et point plein sur sa courbe. */}
                {picked?.age != null && <ReferenceLine x={picked.age} stroke="var(--color-ink)" strokeWidth={1.5} />}
                {present.map((f) => (
                  <Line key={f.key} type="monotone" dataKey={f.key} name={f.label} stroke={f.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--color-card)" }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
                ))}
                {picked?.age != null && picked.gross_monthly != null && (
                  <ReferenceDot x={picked.age} y={Number(picked.gross_monthly)} r={6.5} fill={pickedSeries?.color ?? "var(--color-ink)"} stroke="var(--color-card)" strokeWidth={2} zIndex={900} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 text-[12px]">
            {present.map((f) => (
              <span key={f.key} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded" style={{ background: f.color }} />
                {f.label}
              </span>
            ))}
          </div>
        </Panel>

        <div className="col-span-12 space-y-4 xl:col-span-4">
          {picked ? (
            <Panel
              key={picked.id}
              className="sel-swap"
              title={picked.age != null ? <>{t("Départ à")} <Chip>{t("{age} ans##depart", { age: picked.age })}</Chip></> : t("Simulation")}
              right={
                <button type="button" onClick={() => setPicked(null)} className="flex items-center gap-1 text-accent">
                  {t("fermer")} <X size={11} />
                </button>
              }
            >
              <p className="mb-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
                {pickedSeries && <span className="mt-[7px] h-0.5 w-3 shrink-0 rounded" style={{ background: pickedSeries.color }} />}
                {picked.label}
              </p>
              <Line2 label={t("Trimestres")} value={picked.quarters ?? "—"} />
              {picked.base_pension != null && <Line2 label={t("Retraite de base")} value={money(picked.base_pension, true)} />}
              {picked.complementary != null && <Line2 label={t("Complémentaire")} value={money(picked.complementary, true)} />}
              <Line2 label={t("Brut par mois")} value={money(picked.gross_monthly, true)} />
              <Line2 label={t("Net par mois")} value={picked.net_monthly ? money(picked.net_monthly, true) : "—"} strong />
              <Line2 label={t("Décote / surcote")} value={picked.adjustment ?? "—"} />
              {picked.notes && <p className="mt-2 text-[12px] leading-relaxed text-muted">{picked.notes}</p>}
            </Panel>
          ) : (
            <Panel key="facts" title={t("Situation officielle")} className={cn(pickedTouched && "sel-swap")}>
              <FactsCard facts={d.facts} />
            </Panel>
          )}
        </div>

        <Panel title={t("Carrière : revenus soumis à cotisation")} right={t("Clic : détail de la période")} className="col-span-12">
          <StackedBars
            data={careerData}
            xKey="period"
            height={200}
            series={[{ key: "income", label: t("Revenus"), color: "var(--series-1)" }]}
            extra={(r) => `${tn("{n} trimestre", "{n} trimestres", r.quarters ?? 0)}${r.row.employer ? ` · ${r.row.employer}` : ""}`}
            selected={period?.period ?? null}
            onBarClick={(r) => setPeriod(period?.id === r.row.id ? null : r.row)}
          />
          {period && (
            <div key={period.id} className="sel-in mt-3 flex items-start justify-between gap-3 rounded-md bg-accent-soft px-3 py-2 text-[13px]">
              <div>
                <span className="font-semibold">{period.period}</span> · {period.employer ?? t("aucun employeur")} · {money(period.income, true)} · {tn("{n} trimestre", "{n} trimestres", period.quarters ?? 0)}
                {period.notes && <div className="mt-0.5 text-[12px] text-muted">{period.notes}</div>}
              </div>
              <button type="button" onClick={() => setPeriod(null)} aria-label={t("Fermer")} className="text-muted hover:text-ink">
                <X size={14} />
              </button>
            </div>
          )}
        </Panel>

        <div className="col-span-12">
          <h2 className="mb-2 font-semibold">{t("Simulations")}</h2>
          <DataTable rows={d.simulations} columns={simColumns} rowKey={(s) => String(s.id)} selectedKey={picked ? String(picked.id) : null} onRowClick={setPicked} initialSort={{ key: "age", dir: "asc" }} />
        </div>
        <div className="col-span-12 xl:col-span-8">
          <h2 className="mb-2 font-semibold">{t("Carrière enregistrée")}</h2>
          <DataTable rows={d.career} columns={careerColumns} rowKey={(c) => String(c.id)} selectedKey={period ? String(period.id) : null} onRowClick={(c) => setPeriod(period?.id === c.id ? null : c)} initialSort={{ key: "period", dir: "desc" }} />
        </div>
        <div className="col-span-12 xl:col-span-4">
          <h2 className="mb-2 font-semibold">{t("Documents et analyses")}</h2>
          <DocList docs={d.documents} empty={t("Aucun document.")} />
          {picked && (
            <div className="mt-4">
              <h2 className="mb-2 font-semibold">{t("Situation officielle")}</h2>
              <FactsCard facts={d.facts} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ProgressHint({ value }: { value: number }) {
  return (
    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-accent-soft">
      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </span>
  );
}

function SimTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-48 chart-tip">
      <div className="mb-1 font-medium text-muted">{t("Départ à {age} ans", { age: label ?? "" })}</div>
      {payload
        .filter((p) => p.value != null)
        .map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="tnum">{money(Number(p.value), true)}</span>
          </div>
        ))}
      <div className="mt-1 text-muted">{t("brut par mois")}</div>
    </div>
  );
}

/* ---------- Projections ---------- */

const SCENARIOS = [
  { key: "prudent", label: t("Prudent"), title: t("Scénario prudent") },
  { key: "central", label: t("Central"), title: t("Scénario central") },
  { key: "favorable", label: t("Favorable"), title: t("Scénario favorable") },
];

export function ProjectionsDesktop({ d, today, home = false }: { d: Projections; today: number | null; home?: boolean }) {
  const pockets = [...new Set(d.rows.map((r) => r.poche))];
  const horizon = d.rows[0]?.horizon_year;
  const [poche, pickPoche, pocheTouched] = usePick<string | null>(null);
  // Un second clic sur la poche choisie revient à toutes les poches.
  const setPoche = (p: string | null) => pickPoche(p === poche ? null : p);
  const value = (p: string, s: string) => n(d.rows.find((r) => r.poche === p && r.scenario === s)?.value);
  type Row = { poche: string } & Record<string, number | null | string>;
  const rows: Row[] = pockets.map((p) => ({ poche: p, ...Object.fromEntries(SCENARIOS.map((s) => [s.key, value(p, s.key)])) }));
  const color = (i: number) => (i < 8 ? `var(--series-${i + 1})` : "#9aa5b4");
  const columns: Column<Row>[] = [
    {
      key: "poche",
      header: t("Poche"),
      sort: (r) => r.poche,
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium">
          <span className="size-2.5 rounded-sm" style={{ background: color(pockets.indexOf(r.poche)) }} />
          {r.poche}
        </span>
      ),
    },
    ...SCENARIOS.map((s) => ({
      key: s.key,
      header: s.label,
      align: "right" as const,
      sort: (r: Row) => r[s.key] as number | null,
      cell: (r: Row) => money(r[s.key] as number | null, true),
    })),
  ];
  return (
    <>
      <PageHeader title={t("Projections")} subtitle={horizon ? (home ? t("Patrimoine avec la résidence principale à l'horizon {annee} · clique sur une poche pour ses hypothèses", { annee: horizon }) : t("Patrimoine hors résidence principale à l'horizon {annee} · clique sur une poche pour ses hypothèses", { annee: horizon })) : undefined} />
      <StatGrid>
        {SCENARIOS.map((s) => (
          <Stat key={s.key} label={s.title} value={money(d.totals[s.key], true)} hint={today ? t("×{ratio} par rapport à aujourd'hui", { ratio: (d.totals[s.key] / today).toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : horizon ? t("en {annee}", { annee: horizon }) : undefined} />
        ))}
        <Stat label={t("Aujourd'hui (indicatif)")} value={money(today, true)} hint={home ? t("patrimoine net, dette de la résidence pour ta part") : t("patrimoine net hors part de la RP")} />
      </StatGrid>
      <div className="grid grid-cols-12 gap-4">
        <Panel title={t("Patrimoine projeté en {annee} par scénario", { annee: horizon ?? "" })} right={t("Clic : hypothèses de la poche")} className="col-span-12 xl:col-span-7">
          <StackedBars
            data={SCENARIOS.map((s) => ({ scenario: s.label, ...Object.fromEntries(pockets.map((p) => [p, value(p, s.key) ?? 0])) }))}
            xKey="scenario"
            height={300}
            series={pockets.map((p, i) => ({ key: p, label: p, color: color(i) }))}
            totalLabel={t("Total projeté")}
            selectedSeries={poche}
            onBarClick={(_r, key) => setPoche(key)}
          />
        </Panel>
        <div className="col-span-12 xl:col-span-5">
          <DataTable rows={rows} columns={columns} rowKey={(r) => r.poche} selectedKey={poche} onRowClick={(r) => setPoche(r.poche)} />
        </div>
        <div className="col-span-12">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="font-semibold">{t("Hypothèses")}{poche && <> · <Chip>{poche}</Chip></>}</h2>
            <span className="text-[12px] text-muted">{t("Pour chaque poche : ce qui change d'un scénario à l'autre, puis ce qui vaut pour tous · écart par rapport au point de départ")}</span>
          </div>
          <div key={poche ?? "toutes"} className={cn("grid items-start gap-3 lg:grid-cols-2", pocheTouched && "sel-in")}>
            {pockets
              .filter((p) => !poche || p === poche)
              .filter((p) => d.rows.some((r) => r.poche === p && r.hypothesis))
              .map((p) => (
                <HypothesisCard key={p} poche={p} color={color(pockets.indexOf(p))} rows={d.rows} scenarios={SCENARIOS} className={cn(poche === p && "lg:col-span-2")} />
              ))}
          </div>
          {poche && (
            <button type="button" onClick={() => setPoche(null)} className="mt-2 text-[12px] text-accent hover:underline">
              {t("Toutes les poches")}
            </button>
          )}
        </div>
        {d.documents.length > 0 && (
          <div className="col-span-12">
            <h2 className="mb-2 font-semibold">{t("Analyse")}</h2>
            <DocList docs={d.documents.map((x) => ({ ...x, kind: "fiche", doc_date: null }))} />
          </div>
        )}
      </div>
      <p className="mt-4 text-[12px] text-muted">{home ? t("Hypothèses à revoir chaque semestre.") : t("Hypothèses reprises de Notion ; à revoir chaque semestre (une tâche dans l'échéancier le rappelle).")}</p>
    </>
  );
}
