/*
 * Nature d'une opération (le moyen, pas le poste) : achat carte, prélèvement, virement, retrait
 * d'espèces, frais, mouvement interne, remboursement, entrée d'argent. Finta ne la fournit pas :
 * elle se lit dans le libellé bancaire (BoursoBank). Une seule liste de règles, appliquée en
 * TypeScript (tests, écrans) et traduite en SQL (statistiques), pour que les deux disent pareil.
 */

import { labels, tk } from "./i18n.ts";

export type Nature = "carte" | "prelevement" | "virement" | "retrait" | "frais" | "interne" | "remboursement" | "entree";

/** Ordre d'affichage (et des couleurs) des natures de dépense. */
export const SPEND_NATURES = ["carte", "prelevement", "virement", "retrait", "frais"] as const;

export const NATURE_LABELS: Record<Nature, string> = labels({
  carte: tk("Achats carte"),
  prelevement: tk("Prélèvements"),
  virement: tk("Virements"),
  retrait: tk("Espèces"),
  frais: tk("Frais bancaires"),
  interne: tk("Mouvements internes"),
  remboursement: tk("Remboursements"),
  entree: tk("Entrées"),
});

/** Règles des débits, dans l'ordre (la première qui correspond gagne). Motifs compatibles JS et MariaDB. */
const DEBIT_RULES: [string, Nature][] = [
  ["^relev[eé] diff[eé]r[eé] carte", "interne"],
  ["^carte ", "carte"],
  // Achat en devise : « 59 99 Pln 1 Euro 4 … », « 200 00 Usd 1 Euro 1 … ».
  ["^[0-9]+ [0-9]+ [a-z]{3} [0-9]+ euro", "carte"],
  ["^(retrait|ret dab|retrait dab)", "retrait"],
  ["^(vir |vir$|virement|réf sct|ref sct)", "virement"],
  // Libellé qui commence par une civilité suivie d'un nom : virement à une personne (ou depuis le compte joint).
  ["^(m|mme|mlle|mr|m et mme|m ou mme) [a-z]", "virement"],
  ["^p[0-9]{6} ", "virement"],
  ["^(frais|cotisation|cotis |commission|agios|interets debiteurs)", "frais"],
  ["^prlv", "prelevement"],
];

/** Règles des crédits. */
const CREDIT_RULES: [string, Nature][] = [
  ["^relev[eé] diff[eé]r[eé] carte", "interne"],
  ["^avoir ", "remboursement"],
];

export function natureOf(label: string, amount: number): Nature {
  const l = label.trim().toLowerCase();
  const rules = amount < 0 ? DEBIT_RULES : CREDIT_RULES;
  for (const [re, n] of rules) if (new RegExp(re).test(l)) return n;
  // Un débit sans préfixe reconnu est un prélèvement SEPA (libellé fait d'un code de créancier).
  return amount < 0 ? "prelevement" : "entree";
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Même règle en SQL (alias t : libellé t.label, montant t.amount). MariaDB : REGEXP insensible à la casse. */
export function natureSql(alias = "t"): string {
  const l = `LOWER(TRIM(${alias}.label))`;
  const debit = DEBIT_RULES.map(([re, n]) => `WHEN ${l} REGEXP ${sqlStr(re)} THEN ${sqlStr(n)}`).join(" ");
  const credit = CREDIT_RULES.map(([re, n]) => `WHEN ${l} REGEXP ${sqlStr(re)} THEN ${sqlStr(n)}`).join(" ");
  return `(CASE WHEN ${alias}.amount < 0 THEN (CASE ${debit} ELSE 'prelevement' END) ELSE (CASE ${credit} ELSE 'entree' END) END)`;
}

/**
 * Forme d'un libellé de prélèvement : les mots restent, les codes courts (≤ 6 chiffres, souvent le
 * code du créancier : « 030181 » la crèche, « 737005 » Free) restent tels quels, les numéros longs
 * deviennent « #longueur », les chiffres mêlés de lettres « 9 ». Deux prélèvements d'un même
 * créancier ont la même forme ; deux créanciers différents, presque jamais.
 *   « 2615685 Od0000027 Cdr20260612 » → « #7 od9 cdr9 »  ·  « 030181 2610009464… » → « 030181 #26 »
 */
export function labelShape(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/^[0-9]+$/.test(w) ? (w.length <= 6 ? w : `#${w.length}`) : w.replace(/[0-9]+/g, "9")))
    .join(" ");
}

/** Expression régulière qui reconnaît les libellés d'une forme (pour MariaDB et JS, sur le libellé en minuscules). */
export function shapeRegex(shape: string): string {
  const parts = shape.split(" ").map((w) => {
    if (/^#[0-9]+$/.test(w)) return `[0-9]{${w.slice(1)}}`;
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return /^[0-9]+$/.test(w) ? esc : esc.replace(/9/g, "[0-9]+");
  });
  return `^${parts.join(" +")}$`;
}

/**
 * Nom d'un marchand pour les regroupements (achats carte) : le nom Finta s'il existe, sinon le
 * libellé sans « Carte JJ MM AA », sans « Cb 1234 » ni numéros de magasin.
 */
export function merchantName(label: string, merchant?: string | null): string {
  if (merchant && merchant.trim().length >= 2) return merchant.trim();
  const cleaned = label
    .replace(/^(carte|avoir)\s+\d{2}\s\d{2}\s\d{2,4}\s*/i, "")
    .replace(/\bcb\s*\d+\b/gi, "")
    .replace(/\b\d{3,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : label.trim();
}
