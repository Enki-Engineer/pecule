/**
 * Clé de libellé : forme normalisée d'un libellé bancaire, stable d'un mois à l'autre
 * (« Carte 11 10 26 Mcdonald S Cb 3361 » → « mcdonald s »). Sert à reconnaître une
 * opération déjà vue pour lui reprendre sa catégorie.
 */
import { labels, t, td, tk } from "./i18n.ts";

export function labelKey(label: string, merchant?: string | null): string {
  const base = (merchant && merchant.trim().length >= 3 ? merchant : label) ?? "";
  // Borné d'emblée : un libellé démesuré (fichier hostile) ne doit pas coûter du calcul.
  return base
    .slice(0, 400)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(carte|prlv sepa|prlv|vir sepa|vir inst|vir|avoir|retrait dab)\b/g, " ")
    .replace(/\b\d{2}\s\d{2}\s\d{2,4}\b/g, " ") // dates « 11 10 26 »
    .replace(/\bcb\s*\d+\b/g, " ") // « Cb 3361 »
    .replace(/(?<![a-z])[a-z]*\d[a-z\d]*/g, " ") // références contenant des chiffres
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Titulaire d'un compte : « joint » (compte commun), « pro », « autre », ou le prénom d'une personne du foyer en minuscules. */
export type Owner = string;
export type AccountKind = "courant" | "carte" | "epargne" | "autre";

/** Code de titulaire d'une personne du foyer : son prénom en minuscules. */
export const ownerKey = (name: string) => name.trim().toLowerCase().slice(0, 16);

/**
 * Ce qu'il faut savoir du foyer pour attribuer un compte : prénoms des membres (ceux qui se connectent),
 * des autres personnes (un enfant) et banques dont les comptes sont professionnels.
 */
export type Household = { members: string[]; others?: string[]; proInstitutions?: string[] };

const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const names = (list: string[] | undefined, text: string) =>
  (list ?? []).filter((p) => p.trim() && new RegExp(`(^|[^A-Z])${plain(p.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z]|$)`).test(text));

/**
 * Déduit le titulaire et la nature d'un compte à partir de son intitulé bancaire : banque professionnelle,
 * sinon le compte d'une personne sans connexion nommée dans l'intitulé, sinon un compte joint (« M X OU MME Y »,
 * ou plusieurs membres nommés), sinon le seul membre nommé, sinon « autre ».
 */
export function classifyAccount(name: string, institution?: string | null, household: Household = { members: [] }): { owner: Owner; kind: AccountKind } {
  const n = plain(name);
  const kind: AccountKind = n.startsWith("CARTE") ? "carte" : /LIVRET|LDD|PEL|CEL|EPARGNE/.test(n) ? "epargne" : "courant";
  if (institution && (household.proInstitutions ?? []).some((p) => p.trim() && plain(institution).includes(plain(p.trim())))) return { owner: "pro", kind };
  const other = names(household.others, n);
  if (other.length) return { owner: ownerKey(other[0]), kind };
  const members = names(household.members, n);
  if (/ (OU|ET) /.test(n) || members.length > 1) return { owner: "joint", kind };
  if (members.length === 1) return { owner: ownerKey(members[0]), kind };
  return { owner: "autre", kind };
}

/** Libellé d'un titulaire : les codes réservés ont le leur, un prénom est affiché avec ses majuscules (« jean-luc » → « Jean-Luc »). */
export const ownerLabel = (o: string) => OWNER_LABELS[o] || o.replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());

/** Comptes regroupés par titulaire : ordre habituel, puis les autres titulaires (par ordre alphabétique). */
export function groupByOwner<T extends { owner: string }>(list: T[], order: readonly string[]): { owner: string; list: T[] }[] {
  const extra = [...new Set(list.map((a) => a.owner))].filter((o) => !order.includes(o)).sort();
  return [...order.slice(0, -2), ...extra, ...order.slice(-2)].map((o) => ({ owner: o, list: list.filter((a) => a.owner === o) })).filter((g) => g.list.length);
}

// Codes réservés (traduits à la lecture) ; tout autre code est le prénom d'une personne du foyer.
export const OWNER_LABELS: Record<string, string> = labels({
  joint: tk("Compte commun"),
  pro: tk("Professionnel"),
  autre: tk("Autres"),
});
/** Ordre des groupes de comptes : le compte commun, les personnes (ordre alphabétique), puis « autres » et « professionnel ». */
export const OWNER_ORDER: readonly string[] = ["joint", "autre", "pro"];

/** Libellé affiché : sans la date de carte (« Carte 11 10 26 »), le n° de carte ni les préfixes SEPA. */
export function displayLabel(label: string): string {
  const s = label
    .replace(/^(Carte|Avoir)\s+\d{2}\s\d{2}\s\d{2,4}\s+/i, "")
    .replace(/^Prlv Sepa\s+/i, "")
    .replace(/^Vir(\s+Inst|\s+Sepa)?\s+/i, "Virement ")
    .replace(/\s+Cb\s*\d{4}$/i, "")
    .trim();
  return s || label;
}

/** Libellé fait surtout de chiffres (prélèvements de prêts « 04170 N22… », « 03640 … ») : illisible tel quel. */
export function isCodeLabel(label: string): boolean {
  const s = displayLabel(label).replace(/\s+/g, "");
  const digits = (s.match(/\d/g) ?? []).length;
  return s.length > 0 && (/^\d{4,}/.test(s) || digits / s.length > 0.6);
}

/** Libellé de la banque (export BoursoBank, en capitales) tel qu'on l'affiche : sans préfixe SEPA ni date de carte. */
export function displayBankLabel(label: string): string {
  const s = label
    .replace(/^(CARTE|AVOIR)\s+\d{2}\/\d{2}\/\d{2,4}\s+/i, "")
    .replace(/^PRLV SEPA\s+/i, "")
    .replace(/^VIR(\s+INST|\s+SEPA)?\s+/i, "Virement ")
    .trim();
  const cased = s === s.toUpperCase() || /^Virement [^a-z]+$/.test(s) ? s.toLowerCase().replace(/(^|[\s\-'.(/])\p{L}/gu, (c) => c.toUpperCase()) : s;
  return cased || label;
}

/** Titre d'une opération : marchand, sinon libellé nettoyé ; pour un libellé codé, le libellé de la banque, sinon la catégorie ou le code. */
export function txTitle(tx: { merchant: string | null; label: string; bank_label?: string | null; category_name?: string | null }): string {
  if (tx.merchant) return tx.merchant;
  if (!isCodeLabel(tx.label)) return displayLabel(tx.label);
  if (tx.bank_label) return displayBankLabel(tx.bank_label);
  const code = displayLabel(tx.label).split(/\s+/)[0];
  return tx.category_name ? `${td(tx.category_name)} · ${code}` : /^\d+$/.test(code) ? t("Opération n° {code}", { code }) : t("Opération {code}", { code });
}
