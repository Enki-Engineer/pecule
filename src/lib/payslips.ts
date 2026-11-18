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

/* ---------- Totaux : un bulletin compte de la même façon dans la vue d'un membre et dans celle du foyer ---------- */

/** Montants d'un bulletin, et le membre qui l'a reçu. */
export type PayslipLine = { user_id: number; period: string; employer: string; gross: number | null; net_taxable: number | null; income_tax: number | null; net_paid: number | null; bonus: number | null; document_id?: number | null };
export type PayslipSums = { months: number; gross: number; netTaxable: number; incomeTax: number; netPaid: number; bonus: number };
export type PayslipYear = PayslipSums & { year: string; employers: string[]; /** Part de chaque membre, dans l'ordre de leur première ligne. */ members: (PayslipSums & { user_id: number })[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const zero = (): PayslipSums => ({ months: 0, gross: 0, netTaxable: 0, incomeTax: 0, netPaid: 0, bonus: 0 });
function add(t: PayslipSums, r: PayslipLine) {
  t.months++;
  t.gross += Number(r.gross ?? 0);
  t.netTaxable += Number(r.net_taxable ?? 0);
  t.incomeTax += Number(r.income_tax ?? 0);
  t.netPaid += Number(r.net_paid ?? 0);
  t.bonus += Number(r.bonus ?? 0);
}
const rounded = <T extends PayslipSums>(t: T): T => ({ ...t, gross: r2(t.gross), netTaxable: r2(t.netTaxable), incomeTax: r2(t.incomeTax), netPaid: r2(t.netPaid), bonus: r2(t.bonus) });

/** Totaux par année, la plus récente d'abord ; `months` compte les bulletins (deux employeurs le même mois = deux). */
export function payslipYears(rows: readonly PayslipLine[]): PayslipYear[] {
  const years = new Map<string, { total: PayslipSums; employers: Set<string>; members: Map<number, PayslipSums> }>();
  for (const r of rows) {
    const y = r.period.slice(0, 4);
    const t = years.get(y) ?? { total: zero(), employers: new Set<string>(), members: new Map<number, PayslipSums>() };
    add(t.total, r);
    t.employers.add(r.employer);
    const m = t.members.get(r.user_id) ?? zero();
    add(m, r);
    t.members.set(r.user_id, m);
    years.set(y, t);
  }
  return [...years.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, t]) => ({ year, ...rounded(t.total), employers: [...t.employers], members: [...t.members.entries()].map(([user_id, m]) => ({ user_id, ...rounded(m) })) }));
}

export type PayslipMonth = {
  period: string;
  /** Net payé et impôt prélevé du mois, tous bulletins confondus. */
  net: number;
  tax: number;
  gross: number;
  bonus: number;
  employers: string[];
  /** Net payé par membre (clé : identifiant du membre). */
  byMember: Record<number, number>;
  /** Bulletin à ouvrir : le premier du mois qui en porte un. */
  doc: number | null;
};

/** Salaire mois par mois, du plus ancien au plus récent (les `last` derniers mois qui ont un bulletin). */
export function payslipMonths(rows: readonly PayslipLine[], last = 36): PayslipMonth[] {
  const map = new Map<string, PayslipMonth>();
  for (const r of rows) {
    const m = map.get(r.period) ?? { period: r.period, net: 0, tax: 0, gross: 0, bonus: 0, employers: [], byMember: {}, doc: null };
    m.net += Number(r.net_paid ?? 0);
    m.tax += Number(r.income_tax ?? 0);
    m.gross += Number(r.gross ?? 0);
    m.bonus += Number(r.bonus ?? 0);
    if (!m.employers.includes(r.employer)) m.employers.push(r.employer);
    m.byMember[r.user_id] = (m.byMember[r.user_id] ?? 0) + Number(r.net_paid ?? 0);
    m.doc ??= r.document_id ?? null;
    map.set(r.period, m);
  }
  return [...map.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-last)
    .map((m) => ({ ...m, net: r2(m.net), tax: r2(m.tax), gross: r2(m.gross), bonus: r2(m.bonus), byMember: Object.fromEntries(Object.entries(m.byMember).map(([k, v]) => [k, r2(v)])) }));
}
