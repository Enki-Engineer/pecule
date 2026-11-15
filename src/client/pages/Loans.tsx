import { useMemo, useState } from "react";
import { useCrumb } from "../shell.ts";
import { useParams } from "react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { useLoan, type Loan } from "../api.ts";
import { BankBadge, Card, ErrorBox, PageHeader, ProgressBar, Row, Segmented, Spinner } from "../components/ui.tsx";
import { Stat, StatGrid } from "../components/blocks.tsx";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { dateFr, kMoney, money, pct } from "../format.ts";
import { cn } from "../cn.ts";
import { AxisTick, DIM, SELECTED_BAND } from "../components/StackedBars.tsx";
import { useMedia } from "../useMedia.ts";
import { formatDuration, type ScheduleRow } from "../../lib/loans.ts";
import { t, tn } from "../../lib/i18n.ts";

export function LoanDetail() {
  const { id = "" } = useParams();
  const { data: l, isLoading, error } = useLoan(id);
  useCrumb(l?.name);
  const [tab, setTab] = useState<"suivi" | "details">("suivi");
  const today = new Date().toLocaleDateString("sv-SE");

  const chart = useMemo(
    () =>
      (l?.schedule ?? [])
        .filter((r, i, all) => i === 0 || r.date.slice(0, 7) !== all[i - 1].date.slice(0, 7))
        .map((r) => ({ date: r.date.slice(0, 7), restant: r.remaining })),
    [l],
  );
  // Graduations régulières : chaque année, tous les 2 ou 5 ans selon la durée affichée.
  const yearTicks = useMemo(() => {
    const years = [...new Set(chart.map((r) => r.date.slice(0, 4)))];
    const step = years.length > 15 ? 5 : years.length > 6 ? 2 : 1;
    return years
      .filter((y) => Number(y) % step === 0)
      .map((y) => chart.find((r) => r.date.startsWith(y))?.date)
      .filter((d): d is string => !!d);
  }, [chart]);

  const desktop = useMedia("(min-width: 768px)");
  if (desktop && l) return <LoanDesktop l={l} chart={chart} yearTicks={yearTicks} today={today} />;

  return (
    <>
      <PageHeader title={l?.name ?? t("Crédit")} subtitle={l ? `${l.bank} · ${l.property}` : undefined} right={l ? <BankBadge bank={l.bank} /> : undefined} />
      {error && <ErrorBox error={error} />}
      {isLoading || !l ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="text-sm text-muted">{t("Capital restant dû")}</div>
            <div className="tnum mt-1 text-[30px] font-bold tracking-tight">{money(l.summary.remaining)}</div>
            <div className="mt-0.5 text-sm text-muted">
              {t("sur {montant} empruntés · fin le {date}", { montant: money(l.principal, true), date: dateFr(l.end_date) })}
            </div>
          </Card>

          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "suivi", label: t("Suivi") },
              { value: "details", label: t("Détails") },
            ]}
          />

          {tab === "suivi" ? (
            <>
              <Card className="p-5">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-sm text-muted">{t("Déjà remboursé")}</div>
                    <div className="tnum text-xl font-bold">{money(l.summary.repaidPrincipal)}</div>
                  </div>
                  <div className="text-right text-sm text-muted">{pct(l.summary.progress * 100, 1)}</div>
                </div>
                <ProgressBar value={l.summary.progress} className="mt-3" />
                <div className="mt-5 h-52">
                  <ResponsiveContainer>
                    <AreaChart data={chart} margin={{ left: -6, right: 6, top: 6, bottom: 0 }}>
                      <defs>
                        <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--color-line)" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} ticks={yearTicks} interval={0} tickFormatter={(d: string) => d.slice(0, 4)} />
                      <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${Math.round(v / 1000)} k`} />
                      <Tooltip
                        formatter={(v) => [money(Number(v)), t("Capital restant dû")]}
                        labelFormatter={(d) => String(d).split("-").reverse().join("/")}
                      />
                      <ReferenceLine x={today.slice(0, 7)} stroke="var(--color-accent)" strokeDasharray="3 3" label={{ value: t("aujourd'hui"), position: "insideTopLeft", fill: "var(--color-muted)", fontSize: 11, dy: -2 }} />
                      <Area type="stepAfter" dataKey="restant" stroke="var(--color-accent)" fill="url(#lg)" strokeWidth={2.5} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {l.summary.nextPayment && (
                <Card>
                  <div className="px-5 pt-4 text-sm font-semibold text-muted">{t("Prochaine échéance · {date}", { date: dateFr(l.summary.nextPayment.date) })}</div>
                  <Row label={t("Montant prélevé")} value={money(l.summary.nextPayment.payment)} />
                  <Row label={t("Capital")} value={money(l.summary.nextPayment.principal)} />
                  <Row label={t("Intérêts")} value={money(l.summary.nextPayment.interest)} />
                  {l.summary.nextPayment.insurance > 0 && <Row label={t("Assurance")} value={money(l.summary.nextPayment.insurance)} />}
                  <Row label={t("Échéances restantes")} value={l.summary.remainingPayments} />
                </Card>
              )}
            </>
          ) : (
            <Card>
              <Row label={t("Montant emprunté")} value={money(l.principal)} />
              {l.disbursed != null && l.disbursed !== l.principal && <Row label={t("Montant débloqué")} value={money(l.disbursed)} />}
              <Row label={t("Durée")} value={formatDuration(l.duration_months)} />
              <Row label={t("Taux d'intérêt")} value={pct(Number(l.rate))} />
              <Row label={t("Intérêts (total)")} value={money(l.summary.totalInterest)} />
              {l.summary.totalInsurance > 0 && <Row label={t("Assurance et frais (total)")} value={money(l.summary.totalInsurance)} />}
              <Row label={t("Date de début")} value={dateFr(l.start_date)} />
              <Row label={t("Date de fin")} value={dateFr(l.end_date)} />
              {l.reference && <Row label={t("Référence")} value={l.reference} />}
            </Card>
          )}
          {tab === "details" && l.notes && <p className="px-1 text-xs leading-relaxed text-muted">{l.notes}</p>}
        </div>
      )}
    </>
  );
}

/* ---------- Ordinateur ---------- */

type YearRow = { year: string; principal: number; interest: number; insurance: number; past: boolean };

const SCHEDULE_COLUMNS: Column<ScheduleRow>[] = [
  { key: "rang", header: t("N°"), align: "right", width: "56px", cell: (r) => <span className="text-muted">{r.rang}</span> },
  { key: "date", header: t("Date"), cell: (r) => dateFr(r.date) },
  { key: "payment", header: t("Échéance##crédit"), align: "right", cell: (r) => <span className="font-medium">{money(r.payment)}</span> },
  { key: "principal", header: t("Capital"), align: "right", cell: (r) => money(r.principal) },
  { key: "interest", header: t("Intérêts"), align: "right", cell: (r) => money(r.interest) },
  { key: "insurance", header: t("Assurance"), align: "right", cell: (r) => (r.insurance ? money(r.insurance) : <span className="text-muted">—</span>), hideBelow: "lg" },
  { key: "remaining", header: t("Restant dû"), align: "right", cell: (r) => money(r.remaining) },
];

function LoanDesktop({ l, chart, yearTicks, today }: { l: Loan; chart: { date: string; restant: number }[]; yearTicks: string[]; today: string }) {
  const schedule = l.schedule ?? [];
  const thisYear = today.slice(0, 4);
  const [year, setYear] = useState<string | null>(thisYear);
  // Les barres ne s'estompent qu'après un choix d'année (le tableau montre l'année en cours par défaut).
  const [chosen, setChosen] = useState(false);
  const years = useMemo<YearRow[]>(() => {
    const map = new Map<string, YearRow>();
    for (const r of schedule) {
      const y = r.date.slice(0, 4);
      const row = map.get(y) ?? { year: y, principal: 0, interest: 0, insurance: 0, past: y < thisYear };
      row.principal += Number(r.principal);
      row.interest += Number(r.interest);
      row.insurance += Number(r.insurance);
      map.set(y, row);
    }
    return [...map.values()];
  }, [schedule, thisYear]);
  const rows = year ? schedule.filter((r) => r.date.startsWith(year)) : schedule;
  const next = l.summary.nextPayment;
  const paidInsurance = schedule.filter((r) => r.date <= today).reduce((s, r) => s + Number(r.insurance), 0);
  return (
    <>
      <PageHeader title={l.name} subtitle={`${l.bank} · ${l.property}${l.reference ? ` · ${t("réf. {reference}", { reference: l.reference })}` : ""}`} right={<BankBadge bank={l.bank} />} />
      <StatGrid>
        <Stat label={t("Capital restant dû")} value={money(l.summary.remaining, true)} hint={t("sur {montant} empruntés", { montant: money(l.principal, true) })} />
        <Stat label={t("Déjà remboursé")} value={pct(l.summary.progress * 100, 1)} hint={<ProgressBar value={l.summary.progress} className="mt-1.5 h-1.5" />} />
        <Stat label={t("Mensualité")} value={l.summary.currentMonthly ? money(l.summary.currentMonthly) : "—"} hint={next ? t("prochaine le {date}", { date: dateFr(next.date) }) : t("remboursé")} />
        <Stat label={t("Fin")} value={dateFr(l.end_date)} hint={tn("{n} échéance restante", "{n} échéances restantes", l.summary.remainingPayments)} />
      </StatGrid>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 p-5 xl:col-span-7">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">{t("Ce que coûte chaque année")}</h2>
            <span className="text-[12px] text-muted">{t("Clique sur une année pour ses échéances")}</span>
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={years} margin={{ left: 4, right: 4, top: 4, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="year" tickLine={false} axisLine={false} tick={<AxisTick selected={year} selectedIndex={years.findIndex((y) => y.year === year)} every={Math.max(1, Math.ceil(years.length / 13))} />} interval={0} />
                <YAxis width={52} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickFormatter={(v: number) => kMoney(v)} />
                <Tooltip content={<YearTip />} cursor={{ fill: "var(--color-bg)" }} />
                {/* Année du tableau d'amortissement : bande d'accent et étiquette en gras. */}
                {year && years.some((y) => y.year === year) && <ReferenceArea x1={year} x2={year} {...SELECTED_BAND} />}
                {(["principal", "interest", "insurance"] as const).map((k, i) => (
                  <Bar
                    key={k}
                    dataKey={k}
                    stackId="y"
                    fill={`var(--series-${i + 1})`}
                    stroke="var(--color-card)"
                    strokeWidth={1}
                    radius={k === "insurance" ? [3, 3, 0, 0] : 0}
                    isAnimationActive={false}
                    cursor="pointer"
                    onClick={(d: { payload?: YearRow }) => {
                      if (!d.payload) return;
                      const y = d.payload.year;
                      setChosen(true);
                      setYear((cur) => (cur === y && chosen ? null : y));
                    }}
                    fillOpacity={1}
                    shape={(p: unknown) => {
                      const q = p as { x: number; y: number; width: number; height: number; fill: string; payload: YearRow };
                      const dim = chosen && year && q.payload.year !== year;
                      return <rect x={q.x} y={q.y} width={q.width} height={Math.max(0, q.height)} fill={q.fill} stroke="var(--color-card)" strokeWidth={1} opacity={dim ? DIM : q.payload.past ? 0.7 : 1} style={{ transition: "opacity 200ms ease-out" }} />;
                    }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 text-[12px]">
            {[
              [t("Capital"), 1],
              [t("Intérêts"), 2],
              [t("Assurance"), 3],
            ].map(([label, i]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: `var(--series-${i})` }} />
                {label}
              </span>
            ))}
            <span className="ml-auto text-muted">{t("Années passées en plus clair")}</span>
          </div>
        </Card>

        <Card className="col-span-12 p-5 xl:col-span-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">{t("Capital restant dû")}</h2>
            <span className="text-[12px] text-muted">{t("{montant} aujourd'hui", { montant: money(l.summary.remaining, true) })}</span>
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={chart} margin={{ left: 4, right: 8, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="lgd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} ticks={yearTicks} interval={0} tickFormatter={(d: string) => d.slice(0, 4)} tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => kMoney(v)} tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                <Tooltip
                  formatter={(v) => [money(Number(v)), t("Capital restant dû")]}
                  labelFormatter={(d) => String(d).split("-").reverse().join("/")}
                />
                <ReferenceLine x={today.slice(0, 7)} stroke="var(--color-ink)" strokeDasharray="3 3" label={{ value: t("aujourd'hui"), position: "insideTopLeft", fill: "var(--color-muted)", fontSize: 11, dy: -2 }} />
                <Area type="stepAfter" dataKey="restant" stroke="var(--color-accent)" fill="url(#lgd)" strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {t("Déjà remboursé : {rembourse} sur {total} ({part}).", { rembourse: money(l.principal - l.summary.remaining, true), total: money(l.principal, true), part: pct(l.summary.progress * 100, 1) })}
          </p>
        </Card>

        <div className="col-span-12 space-y-4 xl:sticky xl:top-[68px] xl:order-last xl:col-span-4 xl:self-start 2xl:col-span-3">
          {next && (
            <Card>
              <div className="px-4 pb-1 pt-3 text-[13px] font-semibold">{t("Prochaine échéance · {date}", { date: dateFr(next.date) })}</div>
              <Row label={t("Montant prélevé")} value={money(next.payment)} />
              <Row label={t("Capital")} value={money(next.principal)} />
              <Row label={t("Intérêts")} value={money(next.interest)} />
              {next.insurance > 0 && <Row label={t("Assurance")} value={money(next.insurance)} />}
            </Card>
          )}
          <Card>
            <div className="px-4 pb-1 pt-3 text-[13px] font-semibold">{t("Conditions")}</div>
            <Row label={t("Montant emprunté")} value={money(l.principal)} />
            {l.disbursed != null && l.disbursed !== l.principal && <Row label={t("Montant débloqué")} value={money(l.disbursed)} />}
            <Row label={t("Taux")} value={pct(Number(l.rate))} />
            <Row label={t("Durée")} value={formatDuration(l.duration_months)} />
            <Row label={t("Du … au")} value={`${dateFr(l.start_date)} → ${dateFr(l.end_date)}`} />
            <Row label={t("Intérêts (total)")} value={t("{total} · payés {paye}", { total: money(l.summary.totalInterest, true), paye: money(l.summary.paidInterest, true) })} />
            {l.summary.totalInsurance > 0 && <Row label={t("Assurance (total)")} value={t("{total} · payée {paye}", { total: money(l.summary.totalInsurance, true), paye: money(paidInsurance, true) })} />}
            <Row label={t("Coût total du crédit")} value={money(l.summary.totalCost, true)} />
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-8 2xl:col-span-9">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <h2 className="mr-2 font-semibold">{t("Tableau d'amortissement")}</h2>
            <select
              value={year ?? ""}
              onChange={(e) => {
                setYear(e.target.value || null);
                setChosen(true);
              }} className="rounded-md border border-line bg-card px-2 py-1 text-[13px]">
              <option value="">{tn("Toutes les années ({n} échéance)", "Toutes les années ({n} échéances)", schedule.length)}</option>
              {years.map((y) => (
                <option key={y.year} value={y.year}>
                  {y.year}
                </option>
              ))}
            </select>
            {year && (
              <span key={year} className={cn("text-[12px] text-muted", chosen && "sel-in")}>
                <span className="tnum rounded-md bg-accent-soft px-1.5 py-0.5 font-semibold text-ink">{year}</span>{" "}
                {t("capital {capital} · intérêts {interets}", { capital: money(years.find((y) => y.year === year)?.principal ?? 0, true), interets: money(years.find((y) => y.year === year)?.interest ?? 0, true) })}
              </span>
            )}
          </div>
          <DataTable
            rows={rows}
            columns={SCHEDULE_COLUMNS}
            rowKey={(r) => String(r.rang)}
            rowClassName={(r) => cn(next && r.rang === next.rang && "bg-accent-soft font-medium", r.date <= today && "text-muted")}
          />
          {l.notes && <p className="mt-3 text-[12px] leading-relaxed text-muted">{l.notes}</p>}
        </div>
      </div>
    </>
  );
}

function YearTip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const y = payload[0].payload as YearRow;
  const total = y.principal + y.interest + y.insurance;
  return (
    <div className="min-w-44 chart-tip">
      <div className="mb-1 font-medium text-muted">{y.year}</div>
      {[
        [t("Capital"), y.principal, 1],
        [t("Intérêts"), y.interest, 2],
        [t("Assurance"), y.insurance, 3],
      ].map(([label, v, i]) => (
        <div key={String(label)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: `var(--series-${i})` }} />
            {label}
          </span>
          <span className="tnum">{money(Number(v), true)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
        <span>{t("Payé dans l'année")}</span>
        <span className="tnum">{money(total, true)}</span>
      </div>
    </div>
  );
}
