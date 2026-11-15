import { Link, useParams } from "react-router";
import { ChevronRight, Home, Landmark } from "lucide-react";
import { Card, Empty, ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { DocList, FactsCard, Progress, SectionTitle, Stat, StatGrid } from "../components/blocks.tsx";
import { dateFr, money } from "../format.ts";
import { COMMITMENT_STATUS, PROPERTY_KINDS, useProperties, useProperty } from "../api-situation.ts";
import { useAssistantEntity } from "../assistantContext.ts";
import { useCrumb } from "../shell.ts";
import { useMedia } from "../useMedia.ts";
import { EquityBar, PropertiesDesktop, PropertyDesktop } from "./PropertyDesktop.tsx";
import { locale, t } from "../../lib/i18n.ts";

/*
 * Immobilier : un bien = valeur (placement lié), crédits, équité, bail et rendement (location),
 * faits clés, documents, taxes foncières, engagements et tâches. Tout est recalculé.
 */

const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString(locale(), { maximumFractionDigits: 1 })} %`);

export function Properties() {
  const list = useProperties();
  const rows = list.data?.properties ?? [];
  const desktop = useMedia("(min-width: 1024px)");
  if (desktop && rows.length)
    return (
      <>
        <PageHeader title={t("Immobilier")} subtitle={t("Valeur, crédits, loyers et documents de chaque bien")} />
        <PropertiesDesktop rows={rows} />
      </>
    );
  return (
    <>
      <PageHeader title={t("Immobilier")} subtitle={t("Valeur, crédits, loyers et documents de chaque bien")} />
      {list.error && <ErrorBox error={list.error} />}
      {list.isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty>{t("Aucun bien enregistré.")}</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((p) => (
            <Link key={p.id} to={`/immobilier/${p.id}`}>
              <Card className="press p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[17px] font-semibold">{p.name}</div>
                    <div className="text-sm text-muted">
                      {PROPERTY_KINDS[p.kind] ?? p.kind}
                      {p.city && ` · ${p.city}`}
                      {p.surface && ` · ${p.surface} m²`}
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-muted" />
                </div>
                <EquityBar value={p.figures.value} debt={p.figures.debt} className="mt-4" />
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-muted">{t("Valeur")}</div>
                    <div className="tnum font-semibold">{money(p.figures.value, true)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">{t("Restant dû")}</div>
                    <div className="tnum font-semibold">{p.figures.debt ? money(p.figures.debt, true) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">{p.rent_monthly ? t("Loyer") : t("Équité")}</div>
                    <div className="tnum font-semibold">{p.rent_monthly ? t("{montant}/mois", { montant: money(p.rent_monthly, true) }) : money(p.figures.equity, true)}</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function PropertyDetail() {
  const { id = "" } = useParams();
  const q = useProperty(id);
  const d = q.data;
  useAssistantEntity(d ? { type: "bien", id, label: `${t("Bien")} · ${d.property.name}` } : null);
  useCrumb(d?.property.name.replace(/^\p{Extended_Pictographic}\s*/u, ""));
  const desktop = useMedia("(min-width: 1024px)");
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return <Spinner />;
  if (desktop) return <PropertyDesktop d={d} />;
  const p = d.property;
  const f = d.figures;
  const rental = p.kind === "locatif";
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={[PROPERTY_KINDS[p.kind] ?? p.kind, p.city, p.surface && `${p.surface} m²`, p.acquisition_date && t("acquis le {date}", { date: dateFr(p.acquisition_date) })].filter(Boolean).join(" · ")}
      />
      <StatGrid>
        <Stat label={t("Valeur estimée")} value={money(f.value, true)} hint={f.valueDate ? t("relevé le {date}", { date: dateFr(f.valueDate) }) : undefined} />
        <Stat label={t("Capital restant dû")} value={money(f.debt, true)} hint={f.monthlyLoans ? t("{montant}/mois de crédits", { montant: money(f.monthlyLoans) }) : undefined} />
        <Stat label={t("Équité")} info={t("Valeur estimée moins capital restant dû sur les crédits du bien.")} value={money(f.equity, true)} hint={f.share < 1 ? t("ta part {part} % : {montant}", { part: Math.round(f.share * 100), montant: money(f.equity == null ? null : f.equity * f.share, true) }) : undefined} />
        {rental ? (
          <Stat
            label={t("Cash-flow mensuel")}
            value={money(f.monthlyCashflow)}
            tone={(f.monthlyCashflow ?? 0) >= 0 ? "pos" : "neg"}
            hint={`${p.charges_monthly ? t("loyer − crédit − charges") : t("loyer − crédit")} · ${t("rendement brut {taux}", { taux: pct(f.grossYield) })}`}
          />
        ) : (
          <Stat label={t("Coût d'acquisition")} value={money(f.acquisitionTotal, true)} hint={p.acquisition_costs ? t("dont frais {montant}", { montant: money(p.acquisition_costs, true) }) : t("frais compris")} />
        )}
      </StatGrid>
      {f.value != null && f.value > 0 && (
        <Card className="mb-5 hidden p-4 md:block">
          <div className="mb-2 flex items-baseline justify-between text-[13px]">
            <span className="font-semibold">{t("Ce que vaut le bien")}</span>
            <span className="text-muted">{t("valeur {montant}", { montant: money(f.value, true) })}</span>
          </div>
          <EquityBar value={f.value} debt={f.debt} />
          <div className="mt-2 flex flex-wrap gap-x-5 text-[12px]">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[var(--series-1)]" /> {t("Équité")} <b className="tnum font-semibold">{money(f.equity, true)}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-line" /> {t("Dû à la banque")} <b className="tnum font-semibold">{money(f.debt ?? 0, true)}</b>
            </span>
          </div>
        </Card>
      )}

      <div className="lg:grid lg:grid-cols-12 lg:gap-x-6">
      <div className="lg:col-span-7 2xl:col-span-8">
      {f.loans.length > 0 && (
        <>
          <SectionTitle>{t("Crédits")}</SectionTitle>
          <Card className="divide-y divide-line">
            {f.loans.map((l) => (
              <Link key={l.id} to={`/credits/${l.id}`} className="press block px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[15px] font-medium">
                    <Landmark size={15} className="text-accent" /> {l.name}
                  </span>
                  <span className="tnum text-sm font-semibold">{money(l.remaining, true)}</span>
                </div>
                <Progress value={l.progress} className="mt-2" />
                <div className="mt-1 flex justify-between text-xs text-muted">
                  <span>{l.monthly ? t("{montant}/mois", { montant: money(l.monthly) }) : "—"}</span>
                  <span>{t("fin {date}", { date: dateFr(l.endDate) })}</span>
                </div>
              </Link>
            ))}
          </Card>
        </>
      )}

      {(p.rent_monthly != null || p.lease_kind) && (
        <>
          <SectionTitle>{t("Location")}</SectionTitle>
          <FactsCard
            facts={[
              p.lease_kind && { label: t("Bail"), value: p.lease_kind },
              p.lease_start && { label: t("Début du bail"), value: dateFr(p.lease_start) },
              p.rent_monthly != null && { label: t("Loyer"), value: t("{montant} / mois", { montant: money(p.rent_monthly) }) },
              p.charges_monthly != null && { label: t("Charges"), value: t("{montant} / mois", { montant: money(p.charges_monthly) }) },
              p.deposit != null && { label: t("Dépôt de garantie"), value: money(p.deposit) },
              p.next_rent_revision && { label: t("Prochaine révision du loyer (IRL)"), value: dateFr(p.next_rent_revision) },
              p.tax_regime && { label: t("Régime fiscal"), value: p.tax_regime },
            ].filter((x): x is { label: string; value: string } => !!x)}
          />
        </>
      )}

      {d.facts.length > 0 && (
        <>
          <SectionTitle>{t("Faits clés")}</SectionTitle>
          <FactsCard facts={d.facts} />
        </>
      )}

      <SectionTitle right={<Link to={`/documents`} className="text-sm text-accent">{t("Coffre →")}</Link>}>{t("Documents")}</SectionTitle>
      <DocList docs={d.documents} empty={t("Aucun document rattaché à ce bien.")} />
      </div>
      <div className="lg:col-span-5 2xl:col-span-4">
      {d.taxes.length > 0 && (
        <>
          <SectionTitle right={<Link to="/impots" className="text-sm text-accent">{t("Impôts →")}</Link>}>{t("Taxe foncière")}</SectionTitle>
          <Card className="divide-y divide-line">
            {d.taxes.map((tax, i) => {
              const prev = d.taxes.find((x) => Number(x.year) === Number(tax.year) - 1);
              const max = Math.max(...d.taxes.map((x) => Number(x.total) || 0), 1);
              return (
                <div key={tax.year} className="px-4 py-2 text-sm">
                  <div className="flex justify-between">
                    <span>{tax.year}</span>
                    <span className="tnum font-medium">
                      {money(tax.total)}
                      {prev && prev.total ? (
                        <span className="ml-1.5 text-[11px] font-normal text-muted">
                          {Number(tax.total) >= Number(prev.total) ? "+" : ""}
                          {pct(((Number(tax.total) - Number(prev.total)) / Number(prev.total)) * 100)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-1 hidden h-1 overflow-hidden rounded-full bg-bg md:block">
                    <div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${((Number(tax.total) || 0) / max) * 100}%`, opacity: i === 0 ? 1 : 0.6 }} />
                  </div>
                </div>
              );
            })}
          </Card>
        </>
      )}

      {d.commitments.length > 0 && (
        <>
          <SectionTitle right={<Link to="/budget" className="text-sm text-accent">{t("Budget →")}</Link>}>{t("Frais du bien")}</SectionTitle>
          <Card className="divide-y divide-line">
            {d.commitments.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className={c.status === "resilie" ? "text-muted line-through" : ""}>{c.label}</span>
                <span className="tnum shrink-0 font-medium">
                  {c.monthly != null ? t("{montant}/mois", { montant: money(c.monthly) }) : c.annual != null ? t("{montant}/an", { montant: money(c.annual) }) : COMMITMENT_STATUS[c.status]}
                </span>
              </div>
            ))}
          </Card>
        </>
      )}

      {d.tasks.length > 0 && (
        <>
          <SectionTitle right={<Link to="/echeancier" className="text-sm text-accent">{t("Échéancier →")}</Link>}>{t("À faire")}</SectionTitle>
          <Card className="divide-y divide-line">
            {d.tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className={task.status === "fait" ? "text-muted line-through" : ""}>{task.title}</span>
                {task.due_date && <span className="shrink-0 text-xs text-muted">{dateFr(task.due_date)}</span>}
              </div>
            ))}
          </Card>
        </>
      )}

      </div>
      </div>

      <Link to="/immobilier" className="mt-6 flex items-center justify-center gap-1.5 py-2 text-sm text-accent">
        <Home size={15} /> {t("Tous les biens")}
      </Link>
    </>
  );
}
