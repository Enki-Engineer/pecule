/*
 * Masquage des identifiants sensibles dans le texte indexé (documents, fiches reprises d'un autre outil) :
 * n° de Sécurité sociale, IBAN, numéros longs (comptes, contrats, n° fiscaux, SIRET), adresses
 * de portefeuilles crypto. Le fichier d'origine, lui, reste intact dans le coffre.
 */

export const MASK = "[masqué]";

const PATTERNS: RegExp[] = [
  // IBAN (FR76 1234 5678 …), avec ou sans espaces.
  /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g,
  // N° de Sécurité sociale : 1 85 07 75 123 456 (78), espaces ou points facultatifs.
  /\b[12][ .]?\d{2}[ .]?(?:0[1-9]|1[0-2]|[2-9]\d)[ .]?(?:\d{2}|2[AB])[ .]?\d{3}[ .]?\d{3}(?:[ .]?\d{2})?\b/gi,
  // N° fiscal (SPI) écrit par groupes : 12 34 567 890 123.
  /\b\d{2} \d{2} \d{3} \d{3} \d{3}\b/g,
  // Adresses crypto : EVM (0x + 40 hex ou plus), Bitcoin bech32, MultiversX, Cosmos/Cronos.
  /\b0x[a-fA-F0-9]{40,}\b/g,
  /\bbc1[a-z0-9]{25,62}\b/g,
  /\berd1[a-z0-9]{50,}\b/g,
  /\b(?:cro|cosmos)1[a-z0-9]{38,}\b/g,
  // Numéros longs collés (comptes, contrats, SIRET, n° fiscaux) : 11 chiffres ou plus.
  /\b\d{11,}\b/g,
];

export function redact(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, MASK);
  return out;
}

export const redactOrNull = (text: string | null | undefined) => (text == null ? null : redact(text));
