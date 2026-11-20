import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, useMe } from "../api.ts";
import { Card, Field } from "./ui.tsx";
import { CurrencySelect, currencyName } from "./CurrencySelect.tsx";
import { DateBasisSwitch } from "./DateBasisSwitch.tsx";
import { FRENCH_MODULES, MODULES, MODULE_INFO, type ModuleId } from "../../lib/modules.ts";
import { COUNTRIES, isFrance, regionOf, type Region } from "../../lib/countries.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

type Household = { members: { id: number; name: string }[]; people: string[]; proInstitutions: string[]; modulesOff: ModuleId[] } & Region;
type CurrencyPreview = { from: string; to: string; transactions: number; accounts: number; since: string | null };

/** Nom d'un pays dans la langue de l'appli. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([locale()], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Fuseaux horaires connus du navigateur (à défaut, ceux des pays proposés). */
export const timeZones = (): string[] => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [...new Set(Object.values(COUNTRIES).map(([, zone]) => zone))].sort();
  }
};

const split = (text: string) => [...new Set(text.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean))];
const title = "mb-2 px-1 text-[15px] font-semibold text-ink";

/**
 * Réglages → Foyer : les écrans facultatifs que le foyer garde, les personnes qui ne se connectent pas (un enfant)
 * et les banques dont les comptes sont professionnels. Tout le foyer lit ces réglages ; seul l'administrateur les change.
 */
export function HouseholdSettings() {
  const qc = useQueryClient();
  const me = useMe();
  const admin = me.data?.user?.admin === true;
  const household = useQuery({ queryKey: ["household"], queryFn: () => api<Household>("/household") });
  const [people, setPeople] = useState("");
  const [pro, setPro] = useState("");
  const data = household.data;
  useEffect(() => {
    if (!data) return;
    setPeople(data.people.join(", "));
    setPro(data.proInstitutions.join(", "));
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Partial<Pick<Household, "people" | "proInstitutions" | "modulesOff" | "country" | "timeZone">>) => api<Household>("/household", { method: "PUT", json: body }),
    onSuccess: (r) => {
      qc.setQueryData(["household"], r);
      // Le menu suit tout de suite : la liste des écrans retirés voyage avec l'identité.
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Réglage non enregistré")),
  });

  const off = data?.modulesOff ?? [];
  const select = "max-w-[60%] rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink disabled:opacity-60";
  const locked = !admin || !data || save.isPending;

  /** Changer de pays : son fuseau habituel suit ; hors de France, les écrans qui lisent des documents français sortent du menu. */
  function changeCountry(country: string) {
    if (!data || country === data.country) return;
    const leavingFrance = isFrance(data.country) && !isFrance(country);
    save.mutate(
      { country, timeZone: regionOf(country).timeZone, ...(leavingFrance ? { modulesOff: [...new Set([...off, ...FRENCH_MODULES])] } : {}) },
      { onSuccess: () => toast.success(leavingFrance ? t("Pays enregistré. Les écrans Impôts et Retraite, qui lisent des documents français, sont retirés : tu peux les remettre plus bas.") : t("Pays enregistré")) },
    );
  }

  /** Changer la devise du foyer : on dit d'abord ce qui sera recalculé, puis on le fait sur confirmation. */
  const [changing, setChanging] = useState(false);
  async function changeCurrency(currency: string) {
    if (!data || currency === data.currency) return;
    setChanging(true);
    try {
      const p = await api<CurrencyPreview>(`/household/currency/${currency}`);
      const what = p.transactions
        ? tn(
            "{n} opération et les soldes seront recalculés d'après la devise de chaque compte, au cours du jour de chaque opération.",
            "{n} opérations et les soldes seront recalculés d'après la devise de chaque compte, au cours du jour de chaque opération.",
            p.transactions,
          )
        : t("Aucune opération n'est encore enregistrée : seul l'affichage change.");
      const question = `${t("Passer la devise du foyer de {avant} à {apres} ?", { avant: currencyName(p.from), apres: currencyName(p.to) })}\n\n${what}\n\n${t("Les montants saisis à la main (budgets, objectifs, placements, biens, crédits, bulletins) gardent leur chiffre : à revoir ensuite.")}`;
      if (!confirm(question)) return;
      const r = await api<Household>("/household/currency", { method: "PUT", json: { currency } });
      qc.setQueryData(["household"], r);
      toast.success(t("Devise du foyer enregistrée"));
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Réglage non enregistré"));
    } finally {
      setChanging(false);
    }
  }
  const toggle = (m: ModuleId, shown: boolean) => save.mutate({ modulesOff: shown ? off.filter((x) => x !== m) : [...off, m] });
  const dirty = !!data && (split(people).join("|") !== data.people.join("|") || split(pro).join("|") !== data.proInstitutions.join("|"));

  return (
    <>
      <section id="pays" className="scroll-mt-20">
        <h2 className={title}>{t("Pays et devise")}</h2>
        <Card className="divide-y divide-line">
          <label className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[15px] font-medium">{t("Pays")}</span>
            <select value={data?.country ?? "FR"} disabled={locked} onChange={(e) => changeCountry(e.target.value)} className={select}>
              {Object.keys(COUNTRIES)
                .map((code) => ({ code, name: countryName(code) }))
                .sort((a, b) => a.name.localeCompare(b.name, locale()))
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="block text-[15px] font-medium">{t("Devise du foyer")}</span>
              <span className="block text-xs text-muted">{t("Celle de tous les totaux, des budgets et du patrimoine.")}</span>
            </span>
            {admin && data ? <CurrencySelect value={data.currency} onChange={changeCurrency} className={`${select} ${changing ? "opacity-60" : ""}`} label={t("Devise du foyer")} /> : <span className="text-sm text-muted">{data ? currencyName(data.currency) : "—"}</span>}
          </label>
          <label className="flex items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="block text-[15px] font-medium">{t("Fuseau horaire")}</span>
              <span className="block text-xs text-muted">{t("Il dit quel jour on est : échéances, notifications, résumé du lundi.")}</span>
            </span>
            <select value={data?.timeZone ?? "Europe/Paris"} disabled={locked} onChange={(e) => save.mutate({ timeZone: e.target.value }, { onSuccess: () => toast.success(t("Fuseau horaire enregistré")) })} className={select}>
              {timeZones().map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 basis-64">
              <span className="block text-[15px] font-medium">{t("Achats par carte")}</span>
              <span className="block text-xs text-muted">
                {t("Le jour où ils comptent, sur tous les écrans : le jour de l'achat, ou le jour où la banque les prélève (le mois suivant pour une carte à débit différé).")}
              </span>
            </span>
            <DateBasisSwitch />
          </div>
        </Card>
        <p className="mt-2 px-1 text-xs text-muted">
          {t("Un compte tenu dans une autre devise garde ses montants d'origine ; ils sont convertis au cours de référence de la Banque centrale européenne du jour de chaque opération. Le calendrier fiscal et certaines fêtes ne valent qu'en France.")}
        </p>
      </section>

      <section id="ecrans" className="scroll-mt-20">
        <h2 className={title}>{t("Écrans affichés")}</h2>
        <Card className="divide-y divide-line">
          {MODULES.map((m) => (
            <label key={m} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block text-[15px] font-medium">{t(MODULE_INFO[m].label)}</span>
                <span className="block text-xs text-muted">{t(MODULE_INFO[m].hint)}</span>
              </span>
              <input type="checkbox" checked={!off.includes(m)} disabled={!admin || !data || save.isPending} onChange={(e) => toggle(m, e.target.checked)} className="size-5 shrink-0 accent-[var(--color-accent)]" />
            </label>
          ))}
        </Card>
        <p className="mt-2 px-1 text-xs text-muted">
          {t("Un écran retiré sort du menu, de la recherche et des raccourcis pour tout le foyer. Ses données restent en place : le remettre les retrouve telles quelles.")}
          {!admin && ` ${t("Seul l'administrateur du foyer peut changer ces réglages.")}`}
        </p>
      </section>

      <section id="personnes" className="scroll-mt-20">
        <h2 className={title}>{t("Personnes et banques")}</h2>
        <div className="space-y-3">
          <div>
            <Field text label={t("Personnes sans connexion")} value={people} onChange={setPeople} placeholder="Léo" />
            <p className="mt-1 text-xs text-muted">{t("Un enfant, par exemple : ses comptes portent son prénom et lui sont attribués. Sépare les prénoms par une virgule.")}</p>
          </div>
          <div>
            <Field text label={t("Banques des comptes professionnels")} value={pro} onChange={setPro} placeholder={t("Nom de la banque")} />
            <p className="mt-1 text-xs text-muted">{t("Les comptes de ces banques sont rangés à part, masqués et hors statistiques dès leur arrivée.")}</p>
          </div>
          {admin && (
            <button
              type="button"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate({ people: split(people), proInstitutions: split(pro) }, { onSuccess: () => toast.success(t("Foyer enregistré")) })}
              className="press rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("Enregistrer")}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
