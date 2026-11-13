import { Link, useNavigate } from "react-router";
import { Card, Empty, ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { StackedBars } from "../components/StackedBars.tsx";
import { HypothesisCard } from "../components/Hypotheses.tsx";
import { DocList, FactsCard, SectionTitle, Stat, StatGrid, Table } from "../components/blocks.tsx";
import { dateFr, money } from "../format.ts";
import { usePayslips, useProjections, useRetirement, useTaxes } from "../api-situation.ts";
import { useWealth } from "../api.ts";
import { DataTable } from "../components/DataTable.tsx";
import { useMedia } from "../useMedia.ts";
import { includesHome, netWithHomeDebtShare } from "../../lib/projections.ts";
import { ProjectionsDesktop, RetirementDesktop, TaxesDesktop } from "./SituationDesktop.tsx";
import { locale, t, tn } from "../../lib/i18n.ts";

/* Situation : impôts, retraite, projections (repris de Notion, chiffres recalculés). */

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toLocaleString(locale(), { maximumFractionDigits: 2 })} %`);
const docLink = (id: number | null, label: string) => (id ? <Link to={`/documents?id=${id}`} className="text-accent">{label}</Link> : "—");

export function Taxes() {
  const q = useTaxes();
  const navigate = useNavigate();
  const d = q.data;
  const last = d?.returns[0];
  const prev = d?.returns[1];
  const desktop = useMedia("(min-width: 768px)");
  if (desktop && d && (d.returns.length || d.propertyTaxes.length)) return <TaxesDesktop d={d} />;
  return (
    <>
      <PageHeader title={t("Impôts")} subtitle={t("Impôt sur le revenu et taxes foncières du foyer")} />
      {q.error && <ErrorBox error={q.error} />}
      {!d ? (
        <Spinner />
      ) : !d.returns.length && !d.propertyTaxes.length ? (
        <Empty>{t("Aucune donnée fiscale pour l'instant.")}</Empty>
      ) : (
        <>
          {last && (
            <StatGrid>
              <Stat
                label={t("IR + PS sur les revenus {annee}", { annee: last.income_year })}
                value={money(last.total, true)}
                hint={prev?.total != null && last.total != null ? t("{ecart} vs {annee}", { ecart: `${last.total - prev.total >= 0 ? "+" : ""}${money(last.total - prev.total, true)}`, annee: prev.income_year }) : undefined}
              />
              <Stat label={t("Revenu imposable")} value={money(last.taxable_income, true)} hint={last.rfr != null ? t("RFR {montant}", { montant: money(last.rfr, true) }) : undefined} />
              <Stat label={t("Tranche marginale")} value={pct(last.tmi)} hint={t("taux moyen {taux}", { taux: pct(last.avg_rate) })} />
              <Stat label={t("Parts##fiscales")} value={last.parts ?? "—"} hint={last.situation ?? undefined} />
            </StatGrid>
          )}

          {d.returns.length > 1 && (
            <ChartCard title={t("Impôt du foyer par année de revenus")} hint={t("Clique sur une barre pour ouvrir l'avis")}>
              <StackedBars
                data={[...d.returns].reverse().map((r) => ({ year: String(r.income_year), net: Number(r.net_tax) || 0, ps: Number(r.social_levies) || 0, doc: r.document_id, rate: r.avg_rate }))}
                xKey="year"
                series={[
                  { key: "net", label: t("Impôt sur le revenu"), color: "var(--series-1)" },
                  { key: "ps", label: t("Prélèvements sociaux"), color: "var(--series-2)" },
                ]}
                labelFormatter={(r) => t("Revenus {annee}", { annee: r.year })}
                extra={(r) => (r.rate != null ? t("taux moyen {taux}", { taux: pct(r.rate) }) : null)}
                onBarClick={(r) => r.doc && navigate(`/documents?id=${r.doc}`, { viewTransition: true })}
              />
            </ChartCard>
          )}

          <SectionTitle>{t("Impôt sur le revenu")}</SectionTitle>
          <Table
            head={[t("Revenus"), t("Imposable"), t("RFR"), t("Impôt net"), t("PS"), t("Total"), t("TMI"), t("Taux moyen"), t("Avis##impot")]}
            rows={d.returns.map((r) => [
              r.income_year,
              money(r.taxable_income, true),
              money(r.rfr, true),
              money(r.net_tax, true),
              money(r.social_levies, true),
              <strong key="t">{money(r.total, true)}</strong>,
              pct(r.tmi),
              pct(r.avg_rate),
              docLink(r.document_id, "PDF"),
            ])}
          />

          {d.propertyTaxes.length > 0 && (
            <>
              <SectionTitle>{t("Taxes foncières")}</SectionTitle>
              <PropertyTaxChart rows={d.propertyTaxes} />
              <Table
                head={[t("Année"), t("Bien"), t("Cotisations"), t("dont TEOM"), t("Total"), t("Avis##impot")]}
                align={["left", "left", "right", "right", "right", "right"]}
                rows={d.propertyTaxes.map((p) => [
                  p.year,
                  <Link key="b" to={`/immobilier/${p.property_id}`} className="text-accent">
                    {p.property_name ?? p.property_id}
                  </Link>,
                  money(p.contributions),
                  money(p.teom),
                  <strong key="t">{money(p.total)}</strong>,
                  docLink(p.document_id, "PDF"),
                ])}
              />
            </>
          )}

          <SectionTitle>{t("Documents et analyses")}</SectionTitle>
          <DocList docs={d.documents} empty={t("Aucun document fiscal.")} />
          <p className="mt-3 px-1 text-xs text-muted">{t("Échéances fiscales (déclaration, solde, taxe foncière) : voir l'échéancier.")}</p>
        </>
      )}
    </>
  );
}

export function Retirement() {
  const r = useRetirement();
  const d = r.data;
  const official = d?.simulations.filter((s) => s.source === "info-retraite") ?? [];
  const scenarios = d?.simulations.filter((s) => s.source !== "info-retraite") ?? [];
  const desktop = useMedia("(min-width: 768px)");
  const simRows = (list: NonNullable<typeof d>["simulations"]) =>
    list.map((s) => [s.label, s.age ?? "—", s.quarters ?? "—", money(s.gross_monthly, true), <strong key="n">{money(s.net_monthly, true)}</strong>, s.adjustment ?? "—"]);
  if (desktop && d && (d.simulations.length || d.career.length)) return <RetirementDesktop d={d} />;
  return (
    <>
      <PageHeader title={t("Retraite")} subtitle={d?.simulations[0] ? t("Données officielles du {date} · privé", { date: dateFr(d.simulations[0].simulated_on) }) : t("Privé")} />
      {r.error && <ErrorBox error={r.error} />}
      {!d ? (
        <Spinner />
      ) : !d.simulations.length && !d.career.length ? (
        <Empty>{t("Aucune donnée de retraite.")}</Empty>
      ) : (
        <>
          {d.facts.length > 0 && (
            <>
              <SectionTitle>{t("Situation officielle")}</SectionTitle>
              <FactsCard facts={d.facts} />
            </>
          )}
          {official.length > 1 && (
            <ChartCard title={t("Pension nette mensuelle selon l'âge de départ")} hint={t("Simulations officielles info-retraite")}>
              <StackedBars
                data={official.filter((x) => x.net_monthly != null).map((x) => ({ age: x.age != null ? t("{age} ans", { age: x.age }) : x.label, net: Number(x.net_monthly), label: x.label, quarters: x.quarters }))}
                xKey="age"
                height={200}
                series={[{ key: "net", label: t("Net par mois"), color: "var(--series-1)" }]}
                labelFormatter={(r) => r.label}
                extra={(r) => (r.quarters != null ? tn("{n} trimestre", "{n} trimestres", r.quarters) : null)}
              />
            </ChartCard>
          )}
          {official.length > 0 && (
            <>
              <SectionTitle>{t("Simulations officielles par âge de départ")}</SectionTitle>
              <Table head={[t("Départ##retraite"), t("Âge"), t("Trimestres"), t("Brut / mois"), t("Net / mois"), t("Décote / surcote")]} rows={simRows(official)} />
            </>
          )}
          {scenarios.length > 0 && (
            <>
              <SectionTitle>{t("Scénarios")}</SectionTitle>
              <Table head={[t("Scénario"), t("Âge"), t("Trimestres"), t("Brut / mois"), t("Net / mois"), t("Remarque")]} rows={simRows(scenarios)} />
            </>
          )}
          {d.career.length > 0 && (
            <>
              <SectionTitle>{t("Carrière enregistrée")}</SectionTitle>
              <Table
                head={[t("Période"), t("Employeur"), t("Revenus"), t("Trimestres"), t("Points")]}
                align={["left", "left", "right", "right", "right"]}
                rows={d.career.map((c) => [c.period, c.employer ?? "—", money(c.income, true), c.quarters ?? "—", c.points ?? "—"])}
              />
            </>
          )}
          <SectionTitle>{t("Documents et analyses")}</SectionTitle>
          <DocList docs={d.documents} empty={t("Aucun document.")} />
        </>
      )}
    </>
  );
}

const SCENARIOS = [
  { key: "prudent", label: t("Prudent"), title: t("Scénario prudent") },
  { key: "central", label: t("Central"), title: t("Scénario central") },
  { key: "favorable", label: t("Favorable"), title: t("Scénario favorable") },
];

export function ProjectionsPage() {
  const p = useProjections();
  const w = useWealth();
  const d = p.data;
  const pockets = [...new Set(d?.rows.map((r) => r.poche) ?? [])];
  const horizon = d?.rows[0]?.horizon_year;
  // Patrimoine actuel hors résidence principale, pour situer les scénarios.
  // Projection qui compte la résidence principale (poche commune depuis le 11/11/2026) : le repère est le patrimoine net du jour,
  // dette du bien comptée pour la part détenue comme dans la poche. Sinon : patrimoine hors résidence principale.
  const home = includesHome(pockets);
  const today = !w.data ? null : home ? netWithHomeDebtShare(w.data.net, w.data.assets, w.data.loans) : w.data.net - (w.data.assets.find((a) => /résidence principale/i.test(a.name))?.value ?? 0) * 0.5;
  const desktop = useMedia("(min-width: 768px)");
  if (desktop && d && d.rows.length) return <ProjectionsDesktop d={d} today={today} home={home} />;
  return (
    <>
      <PageHeader title={t("Projections")} subtitle={horizon ? (home ? t("Patrimoine avec la résidence principale à l'horizon {annee}", { annee: horizon }) : t("Patrimoine hors résidence principale à l'horizon {annee}", { annee: horizon })) : undefined} />
      {p.error && <ErrorBox error={p.error} />}
      {!d ? (
        <Spinner />
      ) : !d.rows.length ? (
        <Empty>{t("Aucune projection.")}</Empty>
      ) : (
        <>
          <StatGrid>
            {SCENARIOS.map((s) => (
              <Stat key={s.key} label={s.title} value={money(d.totals[s.key], true)} hint={horizon ? t("en {annee}", { annee: horizon }) : undefined} />
            ))}
            <Stat label={t("Aujourd'hui (indicatif)")} value={money(today, true)} hint={home ? t("patrimoine net, dette de la résidence pour ta part") : t("patrimoine net hors part de la RP")} />
          </StatGrid>
          <ChartCard title={t("Patrimoine projeté en {annee} par scénario", { annee: horizon ?? "" })} hint={home ? t("Résidence principale comprise") : t("Hors résidence principale")}>
            <StackedBars
              data={SCENARIOS.map((s) => ({ scenario: s.label, ...Object.fromEntries(pockets.map((poche) => [poche, Number(d.rows.find((r) => r.poche === poche && r.scenario === s.key)?.value) || 0])) }))}
              xKey="scenario"
              height={240}
              series={pockets.map((poche, i) => ({ key: poche, label: poche, color: i < 8 ? `var(--series-${i + 1})` : "#9aa5b4" }))}
              totalLabel={t("Total projeté")}
            />
          </ChartCard>
          <Table
            head={[t("Poche"), ...SCENARIOS.map((s) => s.label)]}
            rows={pockets.map((poche) => [poche, ...SCENARIOS.map((s) => money(d.rows.find((r) => r.poche === poche && r.scenario === s.key)?.value, true))])}
          />
          <SectionTitle>{t("Hypothèses")}</SectionTitle>
          <p className="-mt-0.5 mb-2 px-1 text-xs text-muted">{t("Ce qui change d'un scénario à l'autre, puis ce qui vaut pour tous. L'écart se lit par rapport au point de départ.")}</p>
          <div className="space-y-3">
            {pockets
              .filter((poche) => d.rows.some((r) => r.poche === poche && r.hypothesis))
              .map((poche) => (
                <HypothesisCard key={poche} poche={poche} color={pockets.indexOf(poche) < 8 ? `var(--series-${pockets.indexOf(poche) + 1})` : "#9aa5b4"} rows={d.rows} scenarios={SCENARIOS} />
              ))}
          </div>
          {d.documents.length > 0 && (
            <>
              <SectionTitle>{t("Analyse")}</SectionTitle>
              <DocList docs={d.documents.map((x) => ({ ...x, kind: "fiche", doc_date: null }))} />
            </>
          )}
          <p className="mt-3 px-1 text-xs text-muted">{home ? t("Hypothèses à revoir chaque semestre.") : t("Hypothèses reprises de Notion ; à revoir chaque semestre (une tâche dans l'échéancier le rappelle).")}</p>
        </>
      )}
    </>
  );
}

const monthName = (p: string) => new Date(`${p}-15T12:00:00`).toLocaleDateString(locale(), { month: "long", year: "numeric" });

/** Revenus salariaux (privé) : bulletins de paie lus par Claude, totaux par année. */
export function Income() {
  const p = usePayslips();
  const navigate = useNavigate();
  const d = p.data;
  const last = d?.payslips[0];
  const year = d?.years[0];
  return (
    <>
      <PageHeader title={t("Revenus")} subtitle={t("D'après tes bulletins de paie · privé")} />
      {p.error && <ErrorBox error={p.error} />}
      {!d ? (
        <Spinner />
      ) : !d.payslips.length ? (
        <Empty>{t("Aucun bulletin de paie lu pour l'instant.")}</Empty>
      ) : (
        <>
          <StatGrid>
            <Stat label={t("Net payé · {mois}", { mois: last ? monthName(last.period) : "" })} value={money(last?.net_paid, true)} hint={last?.employer} />
            <Stat label={t("Brut du mois")} value={money(last?.gross, true)} hint={last?.tax_rate != null ? t("prélèvement à la source {taux}", { taux: pct(last.tax_rate) }) : undefined} />
            <Stat label={t("Net imposable {annee}", { annee: year?.year ?? "" })} value={money(year?.netTaxable, true)} hint={year ? tn("{n} bulletin", "{n} bulletins", year.months) : undefined} />
            <Stat label={t("Impôt prélevé {annee}", { annee: year?.year ?? "" })} value={money(year?.incomeTax, true)} />
          </StatGrid>
          <ChartCard title={t("Salaire des 36 derniers mois")} hint={t("Net payé + impôt prélevé à la source · clic : bulletin")}>
            <StackedBars
              data={monthlyPay(d.payslips)}
              xKey="period"
              height={220}
              series={[
                { key: "net", label: t("Net payé"), color: "var(--series-1)" },
                { key: "tax", label: t("Impôt prélevé"), color: "var(--series-2)" },
              ]}
              xFormatter={(v) => new Date(`${v}-15T12:00:00`).toLocaleDateString(locale(), { month: "short", year: "2-digit" })}
              labelFormatter={(r) => monthName(r.period)}
              totalLabel={t("Net avant impôt")}
              extra={(r) => (r.bonus ? t("dont primes {montant}", { montant: money(r.bonus, true) }) : r.employers)}
              onBarClick={(r) => r.doc && navigate(`/documents?id=${r.doc}`, { viewTransition: true })}
            />
          </ChartCard>
          <SectionTitle>{t("Par année")}</SectionTitle>
          <Table
            head={[t("Année"), t("Employeur(s)"), t("Bulletins"), t("Brut"), t("Net imposable"), t("Impôt prélevé"), t("Net payé"), t("Primes")]}
            align={["left", "left", "right", "right", "right", "right", "right", "right"]}
            rows={d.years.map((y) => [y.year, y.employers.join(", "), y.months, money(y.gross, true), money(y.netTaxable, true), money(y.incomeTax, true), <strong key="n">{money(y.netPaid, true)}</strong>, y.bonus ? money(y.bonus, true) : "—"])}
          />
          <SectionTitle>{t("Bulletins")}</SectionTitle>
          <DataTable
            rows={d.payslips}
            rowKey={(b) => `${b.period}|${b.employer}`}
            initialSort={{ key: "period", dir: "desc" }}
            columns={[
              { key: "period", header: t("Mois"), width: "150px", sort: (b) => b.period, cell: (b) => <span className="whitespace-nowrap capitalize">{monthName(b.period)}</span> },
              { key: "employer", header: t("Employeur"), width: "170px", sort: (b) => b.employer, cell: (b) => <span className="whitespace-nowrap">{b.employer}</span> },
              { key: "notes", header: t("Remarque"), hideBelow: "xl", className: "max-w-0 w-full", cell: (b) => <span className="block truncate text-muted">{b.notes ?? ""}</span> },
              { key: "gross", header: t("Brut"), width: "100px", align: "right", sort: (b) => b.gross, cell: (b) => money(b.gross) },
              { key: "net_taxable", header: t("Net imposable"), width: "120px", align: "right", sort: (b) => b.net_taxable, cell: (b) => money(b.net_taxable) },
              { key: "tax", header: t("Impôt"), width: "90px", align: "right", sort: (b) => b.income_tax, cell: (b) => money(b.income_tax) },
              { key: "net_paid", header: t("Net payé"), width: "110px", align: "right", sort: (b) => b.net_paid, cell: (b) => <strong>{money(b.net_paid)}</strong> },
              { key: "pdf", header: "", width: "50px", align: "right", cell: (b) => docLink(b.document_id, "PDF") },
            ]}
          />
        </>
      )}
    </>
  );
}

/** Carte de graphique (ordinateur seulement : l'iPhone garde ses tableaux). */
function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="mb-2 mt-5 hidden p-5 md:block">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {hint && <span className="text-[12px] text-muted">{hint}</span>}
      </div>
      {children}
    </Card>
  );
}

/** Taxes foncières par année, empilées par bien ; un clic ouvre la fiche du bien. */
function PropertyTaxChart({ rows }: { rows: { year: number; property_id: string; property_name: string | null; total: number | null }[] }) {
  const navigate = useNavigate();
  const props = [...new Map(rows.map((r) => [r.property_id, r.property_name ?? r.property_id])).entries()];
  const years = [...new Set(rows.map((r) => r.year))].sort();
  if (years.length < 2) return null;
  const data = years.map((y) => ({ year: String(y), ...Object.fromEntries(props.map(([id]) => [id, Number(rows.find((r) => r.year === y && r.property_id === id)?.total) || 0])) }));
  return (
    <ChartCard title={t("Taxes foncières par année")} hint={t("Clique sur un bien pour sa fiche")}>
      <StackedBars
        data={data}
        xKey="year"
        height={200}
        series={props.map(([id, name], i) => ({ key: id, label: name.replace(/^\p{Extended_Pictographic}\s*/u, ""), color: `var(--series-${(i % 8) + 1})` }))}
        onBarClick={(_r, key) => navigate(`/immobilier/${key}`, { viewTransition: true })}
      />
    </ChartCard>
  );
}

/** Salaire mois par mois (plusieurs bulletins le même mois : additionnés), 36 derniers mois. */
function monthlyPay(list: { period: string; employer: string; net_paid: number | null; income_tax: number | null; bonus: number | null; document_id: number | null }[]) {
  const map = new Map<string, { period: string; net: number; tax: number; bonus: number; doc: number | null; employers: string }>();
  for (const b of list) {
    const m = map.get(b.period) ?? { period: b.period, net: 0, tax: 0, bonus: 0, doc: b.document_id, employers: b.employer };
    m.net += Number(b.net_paid) || 0;
    m.tax += Number(b.income_tax) || 0;
    m.bonus += Number(b.bonus) || 0;
    if (!m.employers.includes(b.employer)) m.employers += `, ${b.employer}`;
    map.set(b.period, m);
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period)).slice(-36);
}
