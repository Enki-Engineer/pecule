import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { Card, Empty, ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { StackedBars } from "../components/StackedBars.tsx";
import { HypothesisCard } from "../components/Hypotheses.tsx";
import { DocList, FactsCard, SectionTitle, Stat, StatGrid, Table } from "../components/blocks.tsx";
import { dateFr, money } from "../format.ts";
import { usePayslips, useProjections, useRetirement, useTaxes, type Payslip } from "../api-situation.ts";
import { useWealth } from "../api.ts";
import { DataTable } from "../components/DataTable.tsx";
import { useMedia } from "../useMedia.ts";
import { includesHome, netWithHomeDebtShare } from "../../lib/projections.ts";
import { ProjectionsDesktop, RetirementDesktop, TaxesDesktop } from "./SituationDesktop.tsx";
import { ScopeSwitch, SharingNote } from "../components/ScopeSwitch.tsx";
import { TaxOwner, ownerLabel } from "../components/TaxOwner.tsx";
import { payslipMonths } from "../../lib/payslips.ts";
import { taxYears } from "../../lib/taxes.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

/* Situation : impôts, retraite, projections (repris de Notion, chiffres recalculés). */

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toLocaleString(locale(), { maximumFractionDigits: 2 })} %`);
const docLink = (id: number | null, label: string) => (id ? <Link to={`/documents?id=${id}`} className="text-accent">{label}</Link> : "—");

export function Taxes() {
  const q = useTaxes();
  const navigate = useNavigate();
  const d = q.data;
  // Une année de revenus peut compter plusieurs déclarations (imposition séparée) : les chiffres clés et le graphique lisent l'année.
  const years = useMemo(() => taxYears(d?.returns ?? []), [d]);
  const last = years[0];
  const prev = years[1];
  const desktop = useMedia("(min-width: 768px)");
  if (desktop && d && (d.returns.length || d.propertyTaxes.length)) return <TaxesDesktop d={d} />;
  const mine = d?.scope === "moi";
  return (
    <>
      <PageHeader
        title={t("Impôts")}
        subtitle={mine ? t("Tes déclarations, la commune et les taxes foncières") : t("Impôt sur le revenu et taxes foncières du foyer")}
        right={d?.several ? <ScopeSwitch /> : undefined}
      />
      {q.error && <ErrorBox error={q.error} />}
      {!d ? (
        <Spinner />
      ) : !d.returns.length && !d.propertyTaxes.length ? (
        <>
          <SharingNote what="impots" several={d.several} sharing={d.sharing} withheld={d.withheld} scope={d.scope} />
          <Empty>{t("Aucune donnée fiscale pour l'instant.")}</Empty>
        </>
      ) : (
        <>
          <SharingNote what="impots" several={d.several} sharing={d.sharing} withheld={d.withheld} scope={d.scope} />
          {last && (
            <StatGrid>
              <Stat
                label={t("IR + PS sur les revenus {annee}", { annee: last.income_year })}
                value={money(last.total, true)}
                hint={prev?.total != null && last.total != null ? t("{ecart} vs {annee}", { ecart: `${last.total - prev.total >= 0 ? "+" : ""}${money(last.total - prev.total, true)}`, annee: prev.income_year }) : undefined}
              />
              <Stat label={t("Revenu imposable")} value={money(last.taxable_income, true)} hint={last.rfr != null ? t("RFR {montant}", { montant: money(last.rfr, true) }) : undefined} />
              <Stat label={t("Tranche marginale")} value={pct(last.tmi)} hint={t("taux moyen {taux}", { taux: pct(last.avg_rate) })} />
              {last.returns.length === 1 ? (
                <Stat label={t("Parts##fiscales")} value={last.returns[0].parts ?? "—"} hint={last.returns[0].situation ?? undefined} />
              ) : (
                <Stat label={t("Déclarations##impot")} value={last.returns.length} hint={last.returns.map(ownerLabel).join(" + ")} />
              )}
            </StatGrid>
          )}

          {years.length > 1 && (
            <ChartCard title={mine ? t("Ton impôt par année de revenus") : t("Impôt du foyer par année de revenus")} hint={t("Clique sur une barre pour ouvrir l'avis")}>
              <StackedBars
                data={[...years].reverse().map((y) => ({ year: String(y.income_year), net: Number(y.net_tax) || 0, ps: Number(y.social_levies) || 0, doc: y.returns.find((r) => r.document_id)?.document_id ?? null, rate: y.avg_rate }))}
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
              // Le titre de la ligne porte l'année et, dans un foyer de plusieurs membres, de qui est la déclaration :
              // un choix pour la commune ou la sienne, le prénom pour celle d'un autre membre.
              d.several ? (
                <span key="y" className="flex items-center justify-between gap-3">
                  <span>{r.editable ? r.income_year : `${r.income_year} · ${ownerLabel(r)}`}</span>
                  {r.editable && (
                    <span className="font-normal">
                      <TaxOwner r={r} />
                    </span>
                  )}
                </span>
              ) : (
                r.income_year
              ),
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
          {d.several && <p className="mt-2 px-1 text-xs text-muted">{t("Une déclaration est commune (l'imposition du foyer) ou personnelle (la tienne seule, avant la vie commune par exemple) : choisis-le sur sa ligne.")}</p>}

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

/**
 * Revenus salariaux : bulletins de paie lus par l'IA, totaux par année. Vue « Moi » : les bulletins du membre. Vue
 * « Foyer » : les siens et ceux des membres qui partagent leurs revenus, mois par mois et membre par membre.
 */
export function Income() {
  const p = usePayslips();
  const navigate = useNavigate();
  const d = p.data;
  const months = useMemo(() => payslipMonths(d?.payslips ?? []), [d]);
  // Plusieurs membres comptés : l'écran montre le foyer, et la part de chacun.
  const household = (d?.members.length ?? 0) > 1;
  const name = new Map(d?.members.map((m) => [m.id, m.name]));
  const lastPeriod = d?.payslips[0]?.period;
  const lastRows = d?.payslips.filter((b) => b.period === lastPeriod) ?? [];
  const sum = (f: (b: Payslip) => number | null) => lastRows.reduce((s, b) => s + (Number(f(b)) || 0), 0);
  const year = d?.years[0];
  const rate = lastRows.length === 1 ? lastRows[0].tax_rate : null;
  return (
    <>
      <PageHeader
        title={t("Revenus")}
        subtitle={household ? t("D'après les bulletins de paie du foyer") : d?.several && d.sharing ? t("D'après tes bulletins de paie · partagés avec le foyer") : t("D'après tes bulletins de paie · privé")}
        right={d?.several ? <ScopeSwitch /> : undefined}
      />
      {p.error && <ErrorBox error={p.error} />}
      {!d ? (
        <Spinner />
      ) : !d.payslips.length ? (
        <>
          <SharingNote what="revenus" several={d.several} sharing={d.sharing} withheld={d.withheld} scope={d.scope} />
          <Empty>{t("Aucun bulletin de paie lu pour l'instant.")}</Empty>
        </>
      ) : (
        <>
          <SharingNote what="revenus" several={d.several} sharing={d.sharing} withheld={d.withheld} scope={d.scope} />
          <StatGrid>
            <Stat
              label={t("Net payé · {mois}", { mois: lastPeriod ? monthName(lastPeriod) : "" })}
              value={money(sum((b) => b.net_paid), true)}
              // Le dernier mois du foyer peut ne compter qu'un membre (bulletin de l'autre pas encore déposé) : on dit lesquels.
              hint={household ? [...new Set(lastRows.map((b) => name.get(b.user_id)))].join(" + ") : [...new Set(lastRows.map((b) => b.employer))].join(", ")}
            />
            <Stat label={t("Brut du mois")} value={money(sum((b) => b.gross), true)} hint={rate != null ? t("prélèvement à la source {taux}", { taux: pct(rate) }) : household ? tn("{n} bulletin", "{n} bulletins", lastRows.length) : undefined} />
            <Stat label={t("Net imposable {annee}", { annee: year?.year ?? "" })} value={money(year?.netTaxable, true)} hint={year ? tn("{n} bulletin", "{n} bulletins", year.months) : undefined} />
            <Stat label={t("Impôt prélevé {annee}", { annee: year?.year ?? "" })} value={money(year?.incomeTax, true)} />
          </StatGrid>
          {household ? (
            <ChartCard title={t("Salaires du foyer sur 36 mois")} hint={t("Net payé par membre")}>
              <StackedBars
                data={months.map((m) => ({ period: m.period, tax: m.tax, ...Object.fromEntries(d.members.map((u) => [`m${u.id}`, m.byMember[u.id] ?? 0])) }))}
                xKey="period"
                height={220}
                series={d.members.map((u, i) => ({ key: `m${u.id}`, label: u.name, color: `var(--series-${(i % 8) + 1})` }))}
                xFormatter={(v) => new Date(`${v}-15T12:00:00`).toLocaleDateString(locale(), { month: "short", year: "2-digit" })}
                labelFormatter={(r) => monthName(r.period)}
                totalLabel={t("Net payé du foyer")}
                extra={(r) => (r.tax ? t("impôt prélevé {montant}", { montant: money(r.tax, true) }) : null)}
              />
            </ChartCard>
          ) : (
            <ChartCard title={t("Salaire des 36 derniers mois")} hint={t("Net payé + impôt prélevé à la source · clic : bulletin")}>
              <StackedBars
                data={months.map((m) => ({ period: m.period, net: m.net, tax: m.tax, bonus: m.bonus, doc: m.doc, employers: m.employers.join(", ") }))}
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
          )}
          <SectionTitle right={household ? <span className="text-[12.5px] text-muted">{t("Net payé de chacun, puis totaux du foyer")}</span> : undefined}>{t("Par année")}</SectionTitle>
          {household ? (
            <Table
              head={[t("Année"), ...d.members.map((u) => u.name), t("Net payé"), t("Brut"), t("Net imposable"), t("Impôt prélevé"), t("Primes")]}
              align={["left", ...d.members.map(() => "right" as const), "right", "right", "right", "right", "right"]}
              rows={d.years.map((y) => [
                y.year,
                ...d.members.map((u) => {
                  const part = y.members.find((m) => m.user_id === u.id);
                  return part ? money(part.netPaid, true) : "—";
                }),
                <strong key="n">{money(y.netPaid, true)}</strong>,
                money(y.gross, true),
                money(y.netTaxable, true),
                money(y.incomeTax, true),
                y.bonus ? money(y.bonus, true) : "—",
              ])}
            />
          ) : (
            <Table
              head={[t("Année"), t("Employeur(s)"), t("Bulletins"), t("Brut"), t("Net imposable"), t("Impôt prélevé"), t("Net payé"), t("Primes")]}
              align={["left", "left", "right", "right", "right", "right", "right", "right"]}
              rows={d.years.map((y) => [y.year, y.employers.join(", "), y.months, money(y.gross, true), money(y.netTaxable, true), money(y.incomeTax, true), <strong key="n">{money(y.netPaid, true)}</strong>, y.bonus ? money(y.bonus, true) : "—"])}
            />
          )}
          <SectionTitle>{t("Bulletins")}</SectionTitle>
          <DataTable
            rows={d.payslips}
            rowKey={(b) => `${b.user_id}|${b.period}|${b.employer}`}
            initialSort={{ key: "period", dir: "desc" }}
            columns={[
              { key: "period", header: t("Mois"), width: "150px", sort: (b) => b.period, cell: (b) => <span className="whitespace-nowrap capitalize">{monthName(b.period)}</span> },
              ...(household ? [{ key: "member", header: t("Membre"), width: "120px", sort: (b: Payslip) => name.get(b.user_id) ?? "", cell: (b: Payslip) => <span className="whitespace-nowrap">{name.get(b.user_id)}</span> }] : []),
              // Vue du foyer sur un petit écran : le membre prend la place de l'employeur, les montants restent à portée.
              { key: "employer", header: t("Employeur"), width: "170px", hideBelow: household ? ("lg" as const) : undefined, sort: (b) => b.employer, cell: (b) => <span className="whitespace-nowrap">{b.employer}</span> },
              { key: "notes", header: t("Remarque"), hideBelow: "xl", className: "max-w-0 w-full", cell: (b) => <span className="block truncate text-muted">{b.notes ?? ""}</span> },
              { key: "gross", header: t("Brut"), width: "100px", align: "right", sort: (b) => b.gross, cell: (b) => money(b.gross) },
              { key: "net_taxable", header: t("Net imposable"), width: "120px", align: "right", sort: (b) => b.net_taxable, cell: (b) => money(b.net_taxable) },
              { key: "tax", header: t("Impôt"), width: "90px", align: "right", sort: (b) => b.income_tax, cell: (b) => money(b.income_tax) },
              { key: "net_paid", header: t("Net payé"), width: "110px", align: "right", sort: (b) => b.net_paid, cell: (b) => <strong>{money(b.net_paid)}</strong> },
              // Le bulletin lui-même reste à son propriétaire : seuls les siens s'ouvrent.
              { key: "pdf", header: "", width: "50px", align: "right", cell: (b) => (b.document_id ? docLink(b.document_id, "PDF") : "") },
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
