/* Bulletins de paie : règles pures. */

/** Mots d'un nom d'employeur : sans accents, sans casse, sans forme juridique. */
const LEGAL_FORMS = new Set(["sas", "sasu", "sa", "sarl", "eurl", "snc", "scop", "se", "gmbh", "ag", "ltd", "limited", "inc", "llc", "srl", "spa", "sl", "bv", "nv"]);
const employerWords = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !LEGAL_FORMS.has(w));
const startsWith = (long: string[], short: string[]) => short.length > 0 && short.length <= long.length && short.every((w, i) => long[i] === w);

/**
 * Un même employeur écrit de plusieurs façons (« acme france », « ACME - France », « Acme France SAS »,
 * « Acme France Nantes ») → le nom déjà connu du membre. `known` : ses employeurs déjà enregistrés.
 * Un employeur nouveau garde son écriture.
 */
export function canonicalEmployer(name: string, known: readonly string[] = []): string {
  const n = name.trim().replace(/\s+/g, " ");
  const w = employerWords(n);
  const candidates = known.map((k) => ({ k, kw: employerWords(k) })).filter(({ kw }) => startsWith(w, kw) || startsWith(kw, w));
  // Le nom connu le plus proche : d'abord celui qui partage le plus de mots, puis le plus court.
  candidates.sort((a, b) => Math.min(b.kw.length, w.length) - Math.min(a.kw.length, w.length) || a.kw.length - b.kw.length);
  return (candidates[0]?.k ?? n).slice(0, 120);
}
