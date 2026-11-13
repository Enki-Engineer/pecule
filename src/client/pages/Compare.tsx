import { useState } from "react";
import { useCompare } from "../api-analysis.ts";
import { Card, PageHeader, Spinner } from "../components/ui.tsx";
import { Stat, StatGrid } from "../components/blocks.tsx";
import { openDrill } from "../components/DrillDrawer.tsx";
import { currentMonth, money, periodLabel } from "../format.ts";
import { useMonth } from "../api.ts";
import { isYearPeriod } from "../../lib/periods.ts";
import { Equivalence } from "../components/Equivalence.tsx";
import { cn } from "../cn.ts";
import { usePeriod } from "../shell.ts";
import { useMedia } from "../useMedia.ts";
import { currentLang, t, td, tk } from "../../lib/i18n.ts";

/*
 * Comparer deux périodes : un mois (ou des dates libres) face au mois précédent, au même mois l'an
 * dernier, à la moyenne des 3, 6 ou 12 mois précédents, ou à une autre période. Dépenses par poste
 * (barres côte à côte, écart), revenus et épargne. Un poste ouvre ses opérations.
 */

const BASES = [
  { value: "prev", label: t("Mois précédent") },
  { value: "year", label: t("L'an dernier") },
  { value: "avg3", label: t("Moyenne 3 mois") },
  { value: "avg6", label: t("Moyenne 6 mois") },
  { value: "avg12", label: t("Moyenne 12 mois") },
  { value: "custom", label: t("Autre période") },
] as const;

const lastDay = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
};
const fr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** Premier et dernier jour d'une période (un mois ou une année entière). */
const spanOf = (p: string) => (isYearPeriod(p) ? { from: `${p}-01-01`, to: `${p}-12-31` } : { from: `${p}-01`, to: lastDay(p) });

export function ComparePage() {
  return (
    <>
      <PageHeader title={t("Comparer")} subtitle={t("Une période face à une autre, poste par poste")} />
      <CompareView />
    </>
  );
}

export function CompareView() {
  const desktop = useMedia("(min-width: 768px)");
  // La période de la barre du haut : un mois, ou une année entière (comparée alors à l'année d'avant, ou à une autre période).
  const [month, setMonth] = usePeriod();
  const year = isYearPeriod(month);
  const [free, setFree] = useState(false);
  const [from, setFrom] = useState(spanOf(month).from);
  const [to, setTo] = useState(spanOf(month).to);
  const [chosen, setBase] = useState<(typeof BASES)[number]["value"]>("prev");
  // Une année se compare à la précédente ou à une période choisie : les moyennes de mois n'ont pas de sens pour elle.
  const base = year && !free && chosen !== "custom" ? "prev" : chosen;
  const bases = year && !free ? BASES.filter((b) => b.value === "prev" || b.value === "custom") : BASES;
  const baseLabel = (b: (typeof BASES)[number]) => (year && !free && b.value === "prev" ? t("Année précédente") : b.label);
  const [bfrom, setBfrom] = useState("");
  const [bto, setBto] = useState("");
  const a = free ? { from, to } : spanOf(month);
  const q = useCompare({ ...a, base, bfrom, bto });
  // Premier mois qui porte des opérations : une référence qui remonte plus loin est incomplète.
  const first = useMonth(currentMonth()).data?.months.at(-1);
  const d = q.data;
  const max = Math.max(1, ...(d?.postes ?? []).flatMap((p) => [p.a, p.b]));
  const diffTone = (v: number, lowerIsBetter = true) => (Math.abs(v) < 1 ? "text-muted" : (v < 0) === lowerIsBetter ? "text-pos" : "text-neg");

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="text-muted">{t("Période :")}</span>
          {free ? (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md bg-bg px-2 py-1 ring-1 ring-line" />
              <span className="text-muted">→</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md bg-bg px-2 py-1 ring-1 ring-line" />
            </>
          ) : year ? (
            <span className="font-medium">{t("Année {annee}", { annee: month })}</span>
          ) : (
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-md bg-bg px-2 py-1 ring-1 ring-line" />
          )}
          <button type="button" onClick={() => setFree((f) => !f)} className="text-[13px] text-accent hover:underline">
            {free ? (year ? t("Une année") : t("Un mois")) : t("Dates libres")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="text-muted">{t("Comparée à :")}</span>
          {desktop ? (
            <div className="flex flex-wrap gap-1.5">
              {bases.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => setBase(b.value)}
                  className={cn("rounded-md border px-2.5 py-1 text-[13px]", base === b.value ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-muted hover:text-ink")}
                >
                  {baseLabel(b)}
                </button>
              ))}
            </div>
          ) : (
            <select value={base} onChange={(e) => setBase(e.target.value as typeof base)} aria-label={t("Période de référence")} className="rounded-md bg-bg px-2 py-1.5 ring-1 ring-line">
              {bases.map((b) => (
                <option key={b.value} value={b.value}>
                  {baseLabel(b)}
                </option>
              ))}
            </select>
          )}
          {base === "custom" && (
            <>
              <input type="date" value={bfrom} onChange={(e) => setBfrom(e.target.value)} className="rounded-md bg-bg px-2 py-1 ring-1 ring-line" />
              <span className="text-muted">→</span>
              <input type="date" value={bto} onChange={(e) => setBto(e.target.value)} className="rounded-md bg-bg px-2 py-1 ring-1 ring-line" />
            </>
          )}
        </div>
        {d && (
          <p className="text-[12px] text-muted">
            {free ? t("Du {debut} au {fin}", { debut: fr(d.a.from), fin: fr(d.a.to) }) : year ? t("Année {annee}", { annee: month }) : periodLabel(month)}{" "}
            {/* En allemand, un nom garde sa majuscule au milieu d'une phrase. */}
            {t("face à : {reference} (du {debut} au {fin})", { reference: currentLang() === "de" ? d.label : d.label.toLowerCase(), debut: fr(d.b.from), fin: fr(d.b.to) })}
            {first && d.b.from.slice(0, 7) < first && " · " + t("les opérations commencent en {mois} : la référence peut être incomplète", { mois: currentLang() === "de" ? periodLabel(first) : periodLabel(first).toLowerCase() })}
          </p>
        )}
      </Card>

      {q.isLoading || !d ? (
        base === "custom" && !(bfrom && bto) ? <p className="px-1 text-sm text-muted">{t("Choisis la période de référence.")}</p> : <Spinner />
      ) : (
        <>
          <StatGrid>
            <Stat label={t("Dépenses")} value={money(d.a.depenses, true)} hint={<span className={diffTone(d.a.depenses - d.b.depenses)}>{t("{ecart} vs {reference}", { ecart: (d.a.depenses - d.b.depenses >= 0 ? "+" : "") + money(d.a.depenses - d.b.depenses, true), reference: money(d.b.depenses, true) })}</span>} />
            <Stat label={t("Revenus")} value={money(d.a.revenus, true)} hint={<span className={diffTone(d.a.revenus - d.b.revenus, false)}>{t("{ecart} vs {reference}", { ecart: (d.a.revenus - d.b.revenus >= 0 ? "+" : "") + money(d.a.revenus - d.b.revenus, true), reference: money(d.b.revenus, true) })}</span>} />
            <Stat label={t("Épargne")} value={money(d.a.epargne, true)} hint={<span className={diffTone(d.a.epargne - d.b.epargne, false)}>{t("{ecart} vs {reference}", { ecart: (d.a.epargne - d.b.epargne >= 0 ? "+" : "") + money(d.a.epargne - d.b.epargne, true), reference: money(d.b.epargne, true) })}</span>} />
            <Stat label={t("Solde")} value={money(d.a.revenus - d.a.depenses - d.a.epargne, true)} hint={t("référence {montant}", { montant: money(d.b.revenus - d.b.depenses - d.b.epargne, true) })} />
          </StatGrid>
          {Math.abs(d.a.depenses - d.b.depenses) >= 1 && (
            <Equivalence amount={d.a.depenses - d.b.depenses} prefix={d.a.depenses > d.b.depenses ? t("Dépensé en plus") : t("Dépensé en moins")} className="px-1" />
          )}
          <Card className="p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{t("Dépenses par poste")}</h2>
              <span className="flex items-center gap-3 text-[12px] text-muted">
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-accent" /> {t("Période")}
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-muted/40" /> {t("Référence")}
                </span>
              </span>
            </div>
            <div className="space-y-2.5 xl:grid xl:grid-cols-2 xl:gap-x-12 xl:gap-y-2.5 xl:space-y-0">
              {d.postes.map((p) => (
                <button
                  key={p.poste}
                  type="button"
                  disabled={free}
                  onClick={() => openDrill(td(p.poste), p.poste === tk("À classer") ? { month, debits: true, uncategorized: true } : { month, poste: p.poste, debits: true }, periodLabel(month))}
                  className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left hover:bg-bg disabled:hover:bg-transparent"
                >
                  <div className="flex items-baseline justify-between gap-3 text-[14px]">
                    <span className="truncate font-medium">{td(p.poste)}</span>
                    <span className="tnum shrink-0">
                      {money(p.a, true)}
                      <span className={cn("ml-2 text-[12px]", diffTone(p.diff))}>
                        {p.diff >= 0 ? "+" : ""}
                        {money(p.diff, true)}
                        {p.pct != null && Math.abs(p.pct) < 1000 ? ` (${p.pct >= 0 ? "+" : ""}${Math.round(p.pct)} %)` : ""}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-bg">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(Math.max(0, p.a) / max) * 100}%` }} />
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-bg">
                      <div className="h-full rounded-full bg-muted/40" style={{ width: `${(Math.max(0, p.b) / max) * 100}%` }} />
                    </div>
                  </div>
                </button>
              ))}
              {!d.postes.length && <p className="text-sm text-muted">{t("Aucune dépense sur ces périodes.")}</p>}
            </div>
            <p className="mt-3 text-[12px] text-muted">{t("En vert : moins dépensé que la référence. Dépenses nettes des remboursements, mouvements internes exclus.")}</p>
          </Card>
        </>
      )}
    </div>
  );
}
