import { ActionError, userAccountsSql } from "./actions.ts";
import { exec, one, q } from "./db.ts";
import { isDemo } from "./demo-context.ts";
import { today } from "./region.ts";
import { STAT_DATE_JOIN, statDate } from "./stats.ts";
import { brandText, cleanDomain, customMatcher, customPattern, patternKey, type CustomBrand } from "../lib/brands.ts";
import { bankHeadline, txTitle } from "../lib/labels.ts";
import { merchantName } from "../lib/nature.ts";
import { t as tr } from "../lib/i18n.ts";

/*
 * Enseignes du foyer (table `custom_brands`) : un commerce de quartier, un artisan, une association que le
 * référentiel commun (src/lib/brands.ts) ne connaît pas. Chacune porte un nom, les mots qui la font reconnaître
 * dans un libellé, et, si elle en a un, le site d'où vient son logo. Donnée commune du foyer : tout membre la lit
 * et l'écrit. L'écran les charge une fois et les confie à `setCustomBrands` ; le serveur, lui, ne s'en sert que pour
 * savoir de quels sites il accepte de chercher le logo (`customDomains`).
 */

/** Au-delà, le foyer fait du ménage : chaque site donné ici peut faire chercher un logo par le serveur. */
const MAX_BRANDS = 200;

export type BrandInput = { name: string; pattern: string; domain?: string | null };

export const listBrands = () => q<CustomBrand>("SELECT id, name, pattern, domain FROM custom_brands ORDER BY name, id");

/** Ce qu'on garde d'une saisie : motif écrit comme les libellés, site réduit à son domaine. */
function checked(b: BrandInput): { name: string; pattern: string; domain: string | null } {
  const pattern = customPattern(b.pattern);
  if (!pattern) throw new ActionError(400, tr("Écris au moins un mot de trois lettres du libellé à reconnaître."));
  const site = b.domain?.trim() ? cleanDomain(b.domain) : null;
  if (b.domain?.trim() && !site) throw new ActionError(400, tr("Ce site n'a pas la forme d'une adresse (exemple.fr)."));
  return { name: b.name.trim(), pattern, domain: site };
}

const duplicate = (e: unknown) => (e as { code?: string } | null)?.code === "ER_DUP_ENTRY";
const taken = () => new ActionError(409, tr("Une enseigne reconnaît déjà ces mots."));

/** Refuse un motif fait des mêmes mots qu'une autre enseigne, même écrits dans un autre ordre (l'index de la base ne voit que le texte exact). */
async function ensureFree(pattern: string, exceptId?: number): Promise<void> {
  const others = await q<{ id: number; pattern: string }>("SELECT id, pattern FROM custom_brands");
  if (others.some((o) => o.id !== exceptId && patternKey(o.pattern) === patternKey(pattern))) throw taken();
}

export async function createBrand(b: BrandInput): Promise<CustomBrand> {
  const v = checked(b);
  const n = await one<{ n: number }>("SELECT COUNT(*) AS n FROM custom_brands");
  if (Number(n?.n ?? 0) >= MAX_BRANDS) throw new ActionError(400, tr("Le foyer a déjà {n} enseignes : retires-en une avant d'en ajouter.", { n: MAX_BRANDS }));
  await ensureFree(v.pattern);
  try {
    const r = await exec("INSERT INTO custom_brands (name, pattern, domain) VALUES (?, ?, ?)", [v.name, v.pattern, v.domain]);
    forgetCustomDomains();
    return { id: r.insertId, ...v };
  } catch (e) {
    if (duplicate(e)) throw taken();
    throw e;
  }
}

export async function updateBrand(id: number, patch: Partial<BrandInput>): Promise<CustomBrand> {
  const current = await one<CustomBrand>("SELECT id, name, pattern, domain FROM custom_brands WHERE id = ?", [id]);
  if (!current) throw new ActionError(404, tr("Enseigne introuvable"));
  const v = checked({ name: patch.name ?? current.name, pattern: patch.pattern ?? current.pattern, domain: patch.domain === undefined ? current.domain : patch.domain });
  await ensureFree(v.pattern, id);
  try {
    await exec("UPDATE custom_brands SET name = ?, pattern = ?, domain = ? WHERE id = ?", [v.name, v.pattern, v.domain, id]);
  } catch (e) {
    if (duplicate(e)) throw taken();
    throw e;
  }
  forgetCustomDomains();
  return { id, ...v };
}

export async function deleteBrand(id: number): Promise<void> {
  const r = await exec("DELETE FROM custom_brands WHERE id = ?", [id]);
  if (!r.affectedRows) throw new ActionError(404, tr("Enseigne introuvable"));
  forgetCustomDomains();
}

/**
 * Aperçu d'un motif avant de l'enregistrer : combien d'opérations des douze derniers mois il reconnaît, dans les
 * comptes du membre, et quelques noms pour vérifier que ce sont les bonnes.
 */
export async function brandMatches(userId: number, input: string): Promise<{ pattern: string | null; count: number; samples: string[] }> {
  const pattern = customPattern(input);
  const match = pattern ? customMatcher(pattern) : null;
  if (!pattern || !match) return { pattern: null, count: 0, samples: [] };
  // Les douze derniers mois, au jour retenu pour les statistiques (jour d'achat ou jour du débit, selon le réglage du foyer).
  const rows = await q<{ label: string; merchant: string | null; bank_label: string | null }>(
    `SELECT t.label, t.merchant, t.bank_label FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id ${STAT_DATE_JOIN}
     WHERE t.status IN ('posted', 'pending') AND ${statDate("t")} >= DATE_SUB(?, INTERVAL 12 MONTH)`,
    [today()],
  );
  const names = new Map<string, number>();
  let count = 0;
  for (const r of rows) {
    // Les mêmes textes que le logo d'une opération à l'écran (TxLogo) : marchand, libellé, nom tiré du libellé, intitulé de la banque.
    const texts = [r.merchant, r.label, merchantName(r.label, r.merchant), r.bank_label ? bankHeadline(r.bank_label) : null];
    if (!texts.some((x) => x && match.test(brandText(x)))) continue;
    count++;
    const name = txTitle(r);
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  return { pattern, count, samples: [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name) };
}

/* ---------- Sites dont le serveur accepte de chercher le logo ---------- */

const TTL = 60_000;
/** Une liste par base : la démo a ses propres enseignes. */
const domains = new Map<boolean, { at: number; set: Set<string> }>();

/** Sites des enseignes du foyer (gardés une minute en mémoire). */
export async function customDomains(): Promise<Set<string>> {
  const demo = isDemo();
  const cached = domains.get(demo);
  if (cached && Date.now() - cached.at < TTL) return cached.set;
  const rows = await q<{ domain: string }>("SELECT DISTINCT domain FROM custom_brands WHERE domain IS NOT NULL");
  const set = new Set(rows.map((r) => r.domain));
  domains.set(demo, { at: Date.now(), set });
  return set;
}

/** Après une écriture : la liste est relue à la prochaine demande de logo. */
export function forgetCustomDomains(): void {
  domains.delete(isDemo());
}
