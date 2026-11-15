import { useMemo } from "react";
import { Link } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, ChevronRight, Landmark } from "lucide-react";
import { api, type Loan } from "../api.ts";
import { Card, PageHeader } from "../components/ui.tsx";
import { DocList, Progress, Stat, factValue } from "../components/blocks.tsx";
import { dateFr, kMoney, money } from "../format.ts";
import { cn } from "../cn.ts";
import { COMMITMENT_STATUS, PROPERTY_KINDS, type Property, type PropertyDetail } from "../api-situation.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

/*
 * Immobilier sur ordinateur : pleine largeur, comme les autres écrans de la version « outil pro ».
 * Liste : chiffres du parc puis une carte par bien. Fiche : tuiles, dette et valeur dans le temps,
 * puis trois colonnes (le bien, ses documents, ses frais et tâches). L'iPhone garde sa colonne.
 */

const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString(locale(), { maximumFractionDigits: 1 })} %`);
const cleanName = (s: string) => s.replace(/^\p{Extended_Pictographic}\s*/u, "");

function Panel({ title, right, children, className, flush }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <Card className={cn(!flush && "p-5", className)}>
      <div className={cn("flex flex-wrap items-baseline justify-between gap-2", flush ? "px-4 pb-1.5 pt-3.5" : "mb-3")}>
        <h2 className={cn("font-semibold", flush && "text-[13px]")}>{title}</h2>
        {right && <div className="text-[12px] text-muted">{right}</div>}
      </div>
      {children}
    </Card>
  );
}

function Line({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line px-4 py-2 text-[13px]">
      <span className="max-w-[58%] shrink-0 text-muted">{label}</span>
      <span className="tnum min-w-0 text-right font-medium">{value}</span>
    </div>
  );
}

/** Valeur d'un bien : part qui t'appartient (équité) et part encore due à la banque. */
export function EquityBar({ value, debt, className }: { value: number | null; debt: number | null; className?: string }) {
  if (!value) return null;
  const owed = Math.min(value, Math.max(0, debt ?? 0));
  return (
    <div className={cn("flex h-2.5 w-full gap-0.5 overflow-hidden rounded", className)} title={t("Équité {equite} · dû {du}", { equite: money(value - owed, true), du: money(owed, true) })}>
      <span className="h-full bg-[var(--series-1)]" style={{ width: `${((value - owed) / value) * 100}%` }} />
      {owed > 0 && <span className="h-full flex-1 bg-line" />}
    </div>
  );
}

/* ---------- Liste des biens ---------- */

export function PropertiesDesktop({ rows }: { rows: Property[] }) {
  const sum = (f: (p: Property) => number | null | undefined) => rows.reduce((s, p) => s + (f(p) ?? 0), 0);
  const value = sum((p) => p.figures.value);
  const debt = sum((p) => p.figures.debt);
  const mine = sum((p) => (p.figures.equity == null ? 0 : p.figures.equity * p.figures.share));
  const rents = sum((p) => p.rent_monthly);
  const loans = sum((p) => p.figures.monthlyLoans);
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t("Valeur des biens")} value={money(value, true)} hint={tn("{n} bien", "{n} biens", rows.length)} />
        <Stat label={t("Capital restant dû")} value={money(debt, true)} hint={value ? t("{part} de la valeur", { part: pct((debt / value) * 100) }) : undefined} />
        <Stat label={t("Équité")} value={money(value - debt, true)} hint={t("ta part : {montant}", { montant: money(mine, true) })} />
        <Stat label={t("Crédits")} value={t("{montant}/mois", { montant: money(loans, true) })} hint={t("mensualités en cours")} />
        <Stat label={t("Loyers")} value={rents ? t("{montant}/mois", { montant: money(rents, true) }) : "—"} hint={rents ? t("{montant} par an", { montant: money(rents * 12, true) }) : t("aucun bien loué")} />
      </div>
      <div className={cn("grid gap-4 lg:grid-cols-2", rows.length > 2 && "2xl:grid-cols-3")}>
        {rows.map((p) => {
          const f = p.figures;
          const cells: [string, string][] = [
            [t("Valeur"), money(f.value, true)],
            [t("Restant dû"), f.debt ? money(f.debt, true) : "—"],
            [t("Équité"), money(f.equity, true)],
            [t("Crédits"), f.monthlyLoans ? t("{montant}/mois", { montant: money(f.monthlyLoans, true) }) : "—"],
            p.rent_monthly ? [t("Loyer"), t("{montant}/mois", { montant: money(p.rent_monthly, true) })] : [t("Coût d'acquisition"), money(f.acquisitionTotal, true)],
            p.rent_monthly ? [t("Cash-flow"), f.monthlyCashflow == null ? "—" : t("{montant}/mois", { montant: money(f.monthlyCashflow, true) })] : [t("Ta part"), pct(f.share * 100)],
          ];
          return (
            <Link key={p.id} to={`/immobilier/${p.id}`} className="group">
              <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-semibold">{p.name}</div>
                    <div className="text-[13px] text-muted">{[PROPERTY_KINDS[p.kind] ?? p.kind, p.city, p.surface && `${p.surface} m²`].filter(Boolean).join(" · ")}</div>
                  </div>
                  <ChevronRight size={17} className="mt-0.5 shrink-0 text-muted group-hover:text-accent" />
                </div>
                <EquityBar value={f.value} debt={f.debt} className="mt-4" />
                <div className="mt-1.5 flex justify-between text-[12px] text-muted">
                  <span>{t("équité {part}", { part: f.value ? pct(((f.equity ?? 0) / f.value) * 100) : "—" })}</span>
                  {p.rent_monthly ? <span>{t("rendement brut {taux}", { taux: pct(f.grossYield) })}</span> : f.valueDate ? <span>{t("valeur du {date}", { date: dateFr(f.valueDate) })}</span> : null}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 border-t border-line pt-4">
                  {cells.map(([label, v]) => (
                    <div key={label}>
                      <div className="text-[12px] text-muted">{label}</div>
                      <div className="tnum text-[14px] font-semibold">{v}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Fiche d'un bien ---------- */

/** Capital restant dû de tous les crédits du bien, mois par mois (0 avant le début et après la fin). */
function debtSeries(loans: Loan[]): { date: string; dette: number }[] {
  const byLoan = loans.map((l) => {
    const m = new Map<string, number>();
    for (const r of l.schedule ?? []) m.set(r.date.slice(0, 7), Number(r.remaining));
    const keys = [...m.keys()].sort();
    return { m, first: keys[0] ?? "9999", last: keys.at(-1) ?? "0000" };
  });
  const months = [...new Set(byLoan.flatMap((l) => [...l.m.keys()]))].sort();
  // Un crédit sans échéance un mois donné (différé, échéances trimestrielles) garde son dernier capital connu.
  const lastKnown = byLoan.map(() => 0);
  return months.map((date) => ({
    date,
    dette: Math.round(
      byLoan.reduce((s, l, i) => {
        if (date < l.first || date > l.last) return s;
        lastKnown[i] = l.m.get(date) ?? lastKnown[i];
        return s + lastKnown[i];
      }, 0),
    ),
  }));
}

export function PropertyDesktop({ d }: { d: PropertyDetail }) {
  const p = d.property;
  const f = d.figures;
  const rental = p.kind === "locatif" || p.rent_monthly != null;
  const loans = useQueries({ queries: f.loans.map((l) => ({ queryKey: ["loan", l.id], queryFn: () => api<Loan>(`/loans/${l.id}`), staleTime: 3600_000 })) });
  const loaded = loans.every((q) => q.data);
  // Recalculé quand un tableau d'amortissement arrive (clé = dates de mise à jour des requêtes).
  const stamp = loans.map((q) => q.dataUpdatedAt).join();
  const { series, yearTicks } = useMemo(() => {
    const series = loaded ? debtSeries(loans.map((q) => q.data!)) : [];
    const years = [...new Set(series.map((r) => r.date.slice(0, 4)))];
    const step = years.length > 15 ? 5 : years.length > 6 ? 2 : 1;
    return { series, yearTicks: years.filter((y) => Number(y) % step === 0).map((y) => series.find((r) => r.date.startsWith(y))!.date) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, stamp]);
  const today = new Date().toLocaleDateString("sv-SE").slice(0, 7);
  const gain = f.value != null && p.acquisition_price != null ? f.value - p.acquisition_price : null;
  const lease = [
    p.lease_kind && { label: t("Bail"), value: p.lease_kind },
    p.lease_start && { label: t("Début du bail"), value: dateFr(p.lease_start) },
    p.rent_monthly != null && { label: t("Loyer"), value: t("{montant} / mois", { montant: money(p.rent_monthly) }) },
    p.charges_monthly != null && { label: t("Charges"), value: t("{montant} / mois", { montant: money(p.charges_monthly) }) },
    p.deposit != null && { label: t("Dépôt de garantie"), value: money(p.deposit) },
    p.next_rent_revision && { label: t("Prochaine révision du loyer (IRL)"), value: dateFr(p.next_rent_revision) },
    p.tax_regime && { label: t("Régime fiscal"), value: p.tax_regime },
  ].filter((x): x is { label: string; value: string } => !!x);
  const taxMax = Math.max(...d.taxes.map((x) => Number(x.total) || 0), 1);
  return (
    <>
      <PageHeader
        title={cleanName(p.name)}
        subtitle={[PROPERTY_KINDS[p.kind] ?? p.kind, p.city, p.surface && `${p.surface} m²`, p.rooms && tn("{n} pièce", "{n} pièces", p.rooms), p.acquisition_date && t("acquis le {date}", { date: dateFr(p.acquisition_date) })].filter(Boolean).join(" · ")}
        right={
          <Link to="/immobilier" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted hover:bg-card hover:text-ink">
            <ArrowLeft size={14} /> {t("Tous les biens")}
          </Link>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t("Valeur estimée")} value={money(f.value, true)} hint={f.valueDate ? t("relevée le {date}", { date: dateFr(f.valueDate) }) : undefined} />
        <Stat label={t("Capital restant dû")} value={money(f.debt, true)} hint={f.value ? t("{part} de la valeur", { part: pct((f.debt / f.value) * 100) }) : undefined} />
        <Stat label={t("Équité")} value={money(f.equity, true)} hint={f.share < 1 ? t("ta part {part} % : {montant}", { part: Math.round(f.share * 100), montant: money(f.equity == null ? null : f.equity * f.share, true) }) : t("valeur − crédits")} />
        {rental ? (
          <>
            <Stat label={t("Cash-flow mensuel")} value={money(f.monthlyCashflow)} tone={(f.monthlyCashflow ?? 0) >= 0 ? "pos" : "neg"} hint={p.charges_monthly ? t("loyer − crédit − charges") : t("loyer − crédit")} />
            <Stat label={t("Rendement brut")} value={pct(f.grossYield)} hint={p.rent_monthly != null ? t("{montant} de loyers par an", { montant: money(p.rent_monthly * 12, true) }) : undefined} />
          </>
        ) : (
          <>
            <Stat label={t("Crédits")} value={f.monthlyLoans ? t("{montant}/mois", { montant: money(f.monthlyLoans) }) : "—"} hint={f.loans.length ? tn("{n} crédit en cours", "{n} crédits en cours", f.loans.length) : t("aucun crédit")} />
            <Stat label={t("Coût d'acquisition")} value={money(f.acquisitionTotal, true)} hint={gain != null ? t("valeur {ecart} depuis l'achat", { ecart: `${gain >= 0 ? "+" : ""}${money(gain, true)}` }) : p.acquisition_costs ? t("dont frais {montant}", { montant: money(p.acquisition_costs, true) }) : undefined} />
          </>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Dette et valeur dans le temps */}
        {f.loans.length > 0 && (
          <Panel title={t("Dette et valeur du bien")} right={t("capital restant dû jusqu'à la fin des crédits")} className="col-span-12 flex flex-col xl:col-span-8">
            <div className="min-h-64 flex-1">
              {series.length > 0 && (
                <ResponsiveContainer>
                  <AreaChart data={series} margin={{ left: 4, right: 12, top: 14, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pgd" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} ticks={yearTicks} interval={0} tickFormatter={(x: string) => x.slice(0, 4)} tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                    <YAxis
                      width={56}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, Math.ceil((Math.max(f.value ?? 0, ...series.map((r) => r.dette)) * 1.15) / 50_000) * 50_000]}
                      tickFormatter={(v: number) => kMoney(v)}
                      tick={{ fontSize: 11, fill: "var(--color-muted)" }}
                    />
                    <Tooltip
                      formatter={(v) => [money(Number(v), true), t("Capital restant dû")]}
                      labelFormatter={(x) => String(x).split("-").reverse().join("/")}
                    />
                    {f.value != null && (
                      <ReferenceLine y={f.value} stroke="var(--series-1)" strokeWidth={2} strokeDasharray="6 4" label={{ value: t("valeur estimée {montant}", { montant: money(f.value, true) }), position: "insideBottomRight", fill: "var(--color-muted)", fontSize: 11 }} />
                    )}
                    <ReferenceLine x={today} stroke="var(--color-ink)" strokeDasharray="3 3" label={{ value: t("aujourd'hui"), position: "insideTopLeft", fill: "var(--color-muted)", fontSize: 11 }} />
                    <Area type="stepAfter" dataKey="dette" stroke="var(--series-2)" fill="url(#pgd)" strokeWidth={2} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 text-[12px]">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-[var(--series-2)]" /> {t("Capital restant dû")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-[var(--series-1)]" /> {t("Valeur estimée (constante)")}
              </span>
              <span className="ml-auto text-muted">{t("L'écart entre les deux est ton équité.")}</span>
            </div>
          </Panel>
        )}

        <div className={cn("col-span-12 space-y-4", f.loans.length > 0 ? "xl:col-span-4" : "xl:col-span-12")}>
          {f.value != null && f.value > 0 && (
            <Panel title={t("Ce que vaut le bien")} right={t("valeur {montant}", { montant: money(f.value, true) })}>
              <EquityBar value={f.value} debt={f.debt} />
              <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                <div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <span className="size-2.5 rounded-sm bg-[var(--series-1)]" /> {t("Équité")}
                  </div>
                  <div className="tnum text-[15px] font-semibold">{money(f.equity, true)}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <span className="size-2.5 rounded-sm bg-line" /> {t("Dû à la banque")}
                  </div>
                  <div className="tnum text-[15px] font-semibold">{money(f.debt ?? 0, true)}</div>
                </div>
              </div>
            </Panel>
          )}
          {f.loans.length > 0 && (
            <Panel title={t("Crédits")} flush>
              {f.loans.map((l) => (
                <Link key={l.id} to={`/credits/${l.id}`} className="block border-t border-line px-4 py-3 hover:bg-bg">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-[14px] font-medium">
                      <Landmark size={14} className="shrink-0 text-accent" /> <span className="truncate">{l.name}</span>
                    </span>
                    <span className="tnum shrink-0 text-[13px] font-semibold">{money(l.remaining, true)}</span>
                  </div>
                  <Progress value={l.progress} className="mt-2" />
                  <div className="mt-1 flex justify-between text-[12px] text-muted">
                    <span>
                      {l.monthly ? t("{montant}/mois", { montant: money(l.monthly) }) : "—"}
                      {l.rate != null && ` · ${pct(Number(l.rate))}`}
                    </span>
                    <span>{t("fin {date}", { date: dateFr(l.endDate) })}</span>
                  </div>
                </Link>
              ))}
            </Panel>
          )}
        </div>

        {/* Le bien */}
        <div className="col-span-12 space-y-4 lg:col-span-6 xl:col-span-4">
          {lease.length > 0 && (
            <Panel title={rental ? t("Location") : t("Charges")} flush>
              {lease.map((x) => (
                <Line key={x.label} label={x.label} value={x.value} />
              ))}
            </Panel>
          )}
          {d.facts.length > 0 && (
            <Panel title={t("Faits clés")} flush>
              {d.facts.map((x) => (
                <Line key={x.fact_key} label={x.label} value={factValue(x.value, x.unit)} />
              ))}
            </Panel>
          )}
        </div>

        {/* Ses documents */}
        <div className="col-span-12 lg:col-span-6 xl:col-span-4">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h2 className="text-[13px] font-semibold">{t("Documents")}</h2>
            <Link to="/documents" className="text-[12px] text-accent hover:underline">
              {t("Coffre →")}
            </Link>
          </div>
          <DocList docs={d.documents} empty={t("Aucun document rattaché à ce bien.")} />
        </div>

        {/* Ses frais, sa taxe, ses tâches */}
        <div className="col-span-12 space-y-4 xl:col-span-4">
          {d.commitments.length > 0 && (
            <Panel title={t("Frais du bien")} right={<Link to="/budget" className="text-accent hover:underline">{t("Budget →")}</Link>} flush>
              {d.commitments.map((c) => (
                <Line
                  key={c.id}
                  label={<span className={c.status === "resilie" ? "line-through" : "text-ink"}>{c.label}</span>}
                  value={c.monthly != null ? t("{montant}/mois", { montant: money(c.monthly) }) : c.annual != null ? t("{montant}/an", { montant: money(c.annual) }) : COMMITMENT_STATUS[c.status]}
                />
              ))}
            </Panel>
          )}
          {d.taxes.length > 0 && (
            <Panel title={t("Taxe foncière")} right={<Link to="/impots" className="text-accent hover:underline">{t("Impôts →")}</Link>} flush>
              {d.taxes.map((tax, i) => {
                const prev = d.taxes.find((x) => Number(x.year) === Number(tax.year) - 1);
                return (
                  <div key={tax.year} className="border-t border-line px-4 py-2 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-muted">{tax.year}</span>
                      <span className="tnum font-medium">
                        {money(tax.total)}
                        {prev?.total ? (
                          <span className="ml-1.5 text-[11px] font-normal text-muted">
                            {Number(tax.total) >= Number(prev.total) ? "+" : ""}
                            {pct(((Number(tax.total) - Number(prev.total)) / Number(prev.total)) * 100)}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg">
                      <div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${((Number(tax.total) || 0) / taxMax) * 100}%`, opacity: i === 0 ? 1 : 0.6 }} />
                    </div>
                  </div>
                );
              })}
            </Panel>
          )}
          {d.tasks.length > 0 && (
            <Panel title={t("À faire")} right={<Link to="/echeancier" className="text-accent hover:underline">{t("Échéancier →")}</Link>} flush>
              {d.tasks.map((task) => (
                <Line key={task.id} label={<span className={task.status === "fait" ? "line-through" : "text-ink"}>{task.title}</span>} value={task.due_date ? dateFr(task.due_date) : ""} />
              ))}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
