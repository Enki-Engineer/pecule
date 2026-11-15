import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { AlertTriangle, Settings2, ShieldCheck } from "lucide-react";
import { Card, Empty, ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { useBalanceAlert, type AccountForecast } from "../api-balance.ts";
import { dateLong, kMoney, money } from "../format.ts";
import { cn } from "../cn.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

/*
 * Soldes à venir : ce que la prévision dit de chaque compte (src/server/balance.ts). Pour chacun : le solde du
 * jour, la courbe du solde prévu avec la ligne de son seuil, ce qu'il manquerait pour rester au-dessus, et les
 * mouvements attendus un par un, avec le solde après chacun. Les comptes signalés viennent en premier ; `?compte=`
 * amène sur un compte (bandeau d'alerte, notification). Le réglage de l'alerte est à un bouton, en haut.
 */

const signed = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
const k = (n: number) => (Math.abs(n) >= 10_000 ? kMoney(n, 0) : Math.abs(n) >= 1000 ? kMoney(n, 1) : money(n, true));
const shortDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" });
const weekDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "long" });

/** Rang d'un compte dans la page : signalé, puis surveillé, puis écarté. */
const rank = (a: AccountForecast) => (a.watched && a.low ? 0 : a.watched ? 1 : 2);

export function Balances() {
  const q = useBalanceAlert();
  const [params] = useSearchParams();
  const wanted = params.get("compte");
  const accounts = useMemo(() => [...(q.data?.accounts ?? [])].sort((a, b) => rank(a) - rank(b)), [q.data]);
  const flagged = accounts.filter((a) => rank(a) === 0).length;
  const settings = (
    <Link to="/reglages/notifications" viewTransition className="press flex shrink-0 items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold text-ink shadow-[0_1px_2px_rgb(20_20_19/0.1)]">
      <Settings2 size={16} /> {t("Régler l'alerte")}
    </Link>
  );
  return (
    <>
      <PageHeader title={t("Soldes à venir")} subtitle={q.data ? tn("Ce qui est attendu sur tes comptes, {n} jour à l'avance", "Ce qui est attendu sur tes comptes, {n} jours à l'avance", q.data.horizon) : undefined} right={settings} />
      {q.error && <ErrorBox error={q.error} />}
      {!q.data ? (
        <Spinner />
      ) : !accounts.length ? (
        <Empty>{t("Aucun compte à suivre pour l'instant.")}</Empty>
      ) : (
        <div className="space-y-4">
          <Card className={cn("flex items-start gap-3 p-4 text-[14.5px]", flagged ? "text-warn" : "text-pos")}>
            {flagged ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : <ShieldCheck size={18} className="mt-0.5 shrink-0" />}
            <span className="font-medium">
              {!q.data.rule.enabled
                ? t("La surveillance des soldes est coupée : aucun compte n'est signalé.")
                : flagged
                  ? tn("{n} compte est sous son seuil, ou y passerait dans les {jours} jours.", "{n} comptes sont sous leur seuil, ou y passeraient dans les {jours} jours.", flagged, { jours: q.data.rule.days })
                  : t("Aucun compte surveillé ne passe sous son seuil dans les {jours} jours.", { jours: q.data.rule.days })}
            </span>
          </Card>
          {accounts.map((a) => (
            <AccountCard key={a.id} a={a} today={q.data.today} focus={a.id === wanted} />
          ))}
          <p className="px-1 text-[12.5px] leading-relaxed text-muted">
            {t(
              "Comment c'est calculé : le solde du jour, puis ce qui est attendu sur ce compte, en entrées comme en sorties — ce qui y revient chaque mois (prélèvements, virements, salaire) et le relevé d'une carte à débit différé. Un prélèvement dont le jour habituel est passé depuis peu est compté dès aujourd'hui. Les achats du quotidien ne sont pas devinés : c'est une estimation, à lire comme « au mieux ».",
            )}
          </p>
        </div>
      )}
    </>
  );
}

function AccountCard({ a, today, focus }: { a: AccountForecast; today: string; focus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Arrivée depuis un bandeau ou une notification : le compte demandé vient sous les yeux.
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focus]);
  const under = a.balance < a.threshold;
  const flagged = a.watched && !!a.low;
  const shortfall = a.min && a.min.balance < a.threshold ? a.threshold - a.min.balance : 0;
  // Solde après chaque mouvement : ce qui est en retard est compté dès aujourd'hui, comme dans la courbe.
  const rows = useMemo(() => {
    let acc = a.balance;
    return [...a.movements]
      .sort((x, y) => (x.date < today ? today : x.date).localeCompare(y.date < today ? today : y.date))
      .map((m) => {
        acc = Math.round((acc + m.amount) * 100) / 100;
        return { ...m, after: acc };
      });
  }, [a, today]);
  return (
    <div ref={ref} className="scroll-mt-20">
      <Card className={cn("p-5", focus && "sel-swap")}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h2 className="truncate text-[19px] font-semibold tracking-[-0.01em]">{a.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
              {!a.watched ? (
                <span className="chip">{t("non surveillé")}</span>
              ) : (
                <>
                  <span className="chip tnum">{t("seuil à {montant}", { montant: money(a.threshold, true) })}</span>
                  {flagged ? (
                    <span className="chip chip-warn">
                      <AlertTriangle size={12} />
                      {under ? t("sous le seuil") : t("{montant} le {date}", { montant: money(a.low!.balance, true), date: dateLong(a.low!.date) })}
                    </span>
                  ) : (
                    <span className="chip chip-pos">{t("au-dessus du seuil")}</span>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[13px] text-muted">{t("Aujourd'hui")}</div>
            <div className={cn("figure text-[28px]", a.balance < 0 && "text-neg")}>{money(a.balance)}</div>
          </div>
        </div>

        {a.watched && shortfall > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[13.5px] font-medium text-warn">
            <AlertTriangle size={16} className="mt-px shrink-0" />
            <span>
              {a.low?.cause && !under ? t("Passerait à {montant} le {date}, après {cause}.", { montant: money(a.low.balance, true), date: dateLong(a.low.date), cause: a.low.cause.name }) + " " : ""}
              {t("Pour rester au-dessus du seuil, il manquerait {montant} au plus bas, le {date}.", { montant: money(shortfall, true), date: dateLong(a.min!.date) })}
            </span>
          </div>
        )}

        <div className="mt-4 h-44">
          <ResponsiveContainer>
            <AreaChart data={a.points} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={`solde-${a.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} interval={6} tickFormatter={shortDay} />
              <YAxis tickLine={false} axisLine={false} width={58} tickFormatter={k} domain={[(min: number) => Math.min(min, a.watched ? a.threshold : min), "auto"]} />
              <Tooltip content={<CurveTip />} cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }} />
              {a.watched && <ReferenceLine y={a.threshold} stroke="var(--color-warn)" strokeDasharray="5 4" strokeWidth={1.5} />}
              <Area type="stepAfter" dataKey="balance" stroke="var(--color-accent)" strokeWidth={2.25} fill={`url(#solde-${a.id})`} isAnimationActive={false} />
              {a.min && a.min.balance < a.balance && <ReferenceDot x={a.min.date} y={a.min.balance} r={5} fill={flagged ? "var(--color-warn)" : "var(--color-accent)"} stroke="var(--color-card)" strokeWidth={2} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {a.watched && <div className="mt-1 text-[12px] text-muted">{t("En pointillé : le seuil. Le point : le plus bas des jours à venir.")}</div>}

        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-1 flex items-baseline justify-between text-[13px] text-muted">
            <span>{t("Mouvements attendus")}</span>
            <span>{t("Solde après")}</span>
          </div>
          {rows.length ? (
            <div className="divide-y divide-line">
              {rows.map((m, i) => (
                <div key={i} className={cn("flex items-center gap-3 py-2 text-[14px]", a.watched && m.after < a.threshold && "-mx-2 rounded-lg bg-warn/10 px-2")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.name}</span>
                    <span className="block truncate text-[12.5px] text-muted first-letter:uppercase">{m.late ? t("en retard, attendu d'un jour à l'autre") : weekDay(m.date)}</span>
                  </span>
                  <span className={cn("chip tnum shrink-0 text-[13px]", m.amount > 0 ? "chip-pos" : "chip-neg")}>{signed(m.amount)}</span>
                  <span className={cn("tnum w-20 shrink-0 text-right font-medium sm:w-24", a.watched && m.after < a.threshold && "text-warn")}>{money(m.after, true)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-3 text-[14px] text-muted">{t("Rien d'attendu sur ce compte d'ici là.")}</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function CurveTip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const p = payload?.[0]?.payload as { date: string; balance: number } | undefined;
  if (!active || !p) return null;
  return (
    <div className="chart-tip">
      <div className="text-muted first-letter:uppercase">{weekDay(p.date)}</div>
      <div className="tnum mt-0.5 text-[14px] font-semibold">{money(p.balance)}</div>
    </div>
  );
}
