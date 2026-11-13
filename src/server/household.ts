import { exec, one, q, withLock } from "./db.ts";
import { ActionError } from "./actions.ts";
import { t } from "../lib/i18n.ts";
import { listMembers } from "./members.ts";
import type { Household } from "../lib/labels.ts";
import { cleanModulesOff, MODULE_INFO, type ModuleId } from "../lib/modules.ts";
import { cleanRegion, DEFAULT_REGION, type Region } from "../lib/countries.ts";
import { setRegion, watchRegion } from "./region.ts";
import { isDemo, runReal } from "./demo-context.ts";
import { dateBasis } from "./stat-dates.ts";

/*
 * Réglages du foyer, gardés dans app_kv (« household ») : les personnes qui ne se connectent pas (un enfant)
 * et les banques dont les comptes sont professionnels. Avec les prénoms des membres, c'est ce qui permet
 * d'attribuer un nouveau compte à son titulaire d'après son intitulé (classifyAccount). S'y ajoutent les écrans
 * facultatifs que le foyer a retirés (`modulesOff`, voir src/lib/modules.ts), et son pays, sa devise et son fuseau
 * horaire (src/lib/countries.ts ; lus en mémoire par src/server/region.ts).
 */

export type HouseholdSettings = { people: string[]; proInstitutions: string[]; modulesOff: ModuleId[] } & Region;

// Pays, devise et fuseau : relus dans la vraie base (jamais celle de la démo) par le module qui les garde en mémoire.
watchRegion(async () => {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = 'household'"));
  try {
    return cleanRegion(row ? (JSON.parse(row.value) as Partial<Region>) : null);
  } catch {
    return cleanRegion(null);
  }
});

const clean = (list: unknown): string[] =>
  Array.isArray(list) ? [...new Set(list.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 80)).filter(Boolean))].slice(0, 20) : [];

export async function householdSettings(): Promise<HouseholdSettings> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = 'household'");
  try {
    const v = JSON.parse(row?.value ?? "{}") as Partial<HouseholdSettings>;
    return { people: clean(v.people), proInstitutions: clean(v.proInstitutions), modulesOff: cleanModulesOff(v.modulesOff), ...cleanRegion(v) };
  } catch {
    return { people: [], proInstitutions: [], modulesOff: [], ...cleanRegion(null) };
  }
}

/**
 * Enregistre les réglages du foyer. La devise n'en fait pas partie : la changer recalcule les montants
 * (`changeHouseholdCurrency`, src/server/currency-change.ts), et rien d'autre ne s'écrit pendant ce recalcul.
 */
export async function saveHouseholdSettings(v: Partial<Omit<HouseholdSettings, "currency">>): Promise<HouseholdSettings> {
  const saved = await withLock("pecule:devise", async () => {
    const next = {
      ...(await householdSettings()),
      ...(v.people ? { people: clean(v.people) } : {}),
      ...(v.proInstitutions ? { proInstitutions: clean(v.proInstitutions) } : {}),
      ...(v.modulesOff ? { modulesOff: cleanModulesOff(v.modulesOff) } : {}),
    };
    // La démo reste un foyer français en euros (aucun service de cours n'y est appelé).
    const region = isDemo() ? cleanRegion(null) : cleanRegion({ country: v.country ?? next.country, currency: next.currency, timeZone: v.timeZone ?? next.timeZone });
    const all = { ...next, ...region };
    await exec("INSERT INTO app_kv (`key`, value) VALUES ('household', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify(all)]);
    if (!isDemo()) setRegion(region);
    return all;
  });
  if (!saved) throw new ActionError(409, t("Une synchronisation est en cours : réessaie dans un instant."));
  return saved;
}

/** Le foyer vu par classifyAccount : membres, autres personnes, banques professionnelles. */
export async function accountHousehold(): Promise<Household> {
  const [members, settings] = await Promise.all([listMembers(), householdSettings()]);
  return { members: members.map((m) => m.name), others: settings.people, proInstitutions: settings.proInstitutions };
}

/**
 * Le foyer décrit en une ligne pour les consignes de l'IA (assistant, rangement des documents) : prénoms et biens
 * viennent de la base du contexte (celle de la démo en démo), jamais du code. Les biens privés d'un autre membre n'y sont pas.
 */
export async function householdSummary(userId?: number): Promise<string> {
  const [members, settings, basis, properties] = await Promise.all([
    listMembers(),
    householdSettings(),
    dateBasis().catch(() => "debit" as const),
    q<{ name: string; city: string | null }>(`SELECT name, city FROM properties WHERE owner_user_id IS NULL${userId ? " OR owner_user_id = ?" : ""} ORDER BY sort_order, id`, userId ? [userId] : []).catch(() => []),
  ]);
  const parts = [`membres : ${members.map((m) => m.name).join(", ") || "aucun"}`];
  // Un foyer français en euros est le cas par défaut : on ne le dit que s'il en va autrement.
  if (settings.currency !== DEFAULT_REGION.currency || settings.country !== DEFAULT_REGION.country)
    parts.push(`pays : ${settings.country} ; devise du foyer : ${settings.currency} (tous les montants rendus par les outils sont dans cette devise ; un compte tenu dans une autre garde aussi son montant d'origine)`);
  // Jour d'achat : à dire seulement quand le foyer l'a choisi (le jour d'écriture de la banque est le cas par défaut).
  if (basis === "achat") parts.push("les achats par carte sont comptés au jour de l'achat, pas au jour où la banque les prélève (les dates rendues par les outils sont des jours d'achat ; `debit_date` donne le jour du prélèvement quand il diffère)");
  if (settings.people.length) parts.push(`autres personnes (sans connexion) : ${settings.people.join(", ")}`);
  if (properties.length) parts.push(`biens immobiliers : ${properties.map((p) => (p.city && !p.name.includes(p.city) ? `${p.name} (${p.city})` : p.name)).join(" ; ")}`);
  if (settings.modulesOff.length) parts.push(`écrans retirés de l'appli par le foyer (ne pas y renvoyer) : ${settings.modulesOff.map((m) => MODULE_INFO[m].label).join(", ")}`);
  return `Foyer — ${parts.join(" · ")}.`;
}
