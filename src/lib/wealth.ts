/*
 * Calculs du patrimoine sans base de données (testés dans lib.test.ts) : valeur d'un placement,
 * quote-part d'un compte, valorisation et variation 24 h de la crypto.
 */

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Placement coté (quantité × cours + espèces) si le cours est connu, sinon la valeur saisie. */
export function assetValue(a: { valuation: string; price: number | null; quantity: number | null; cash: number | null; value: number | null }): { value: number; quoted: boolean } {
  const quoted = a.valuation === "cotation" && a.price != null && a.quantity != null;
  return { quoted, value: r2(quoted ? Number(a.quantity) * Number(a.price) + Number(a.cash ?? 0) : Number(a.value ?? 0)) };
}

/** Quote-part d'un compte dans le patrimoine d'un membre : commun pour moitié, le sien en entier, sinon rien. */
export function accountShare(owner: string, memberKey: string): number {
  return owner === "joint" ? 0.5 : owner === memberKey ? 1 : 0;
}

type CryptoInput = { quantity: number | string; manual_value: number | string | null; price: number | string | null; change_24h: number | string | null; price_at: string | null };

/** Valorise les positions (valeur manuelle prioritaire), les trie, et pondère la variation 24 h par la valeur. */
export function valueCrypto<T extends CryptoInput>(rows: T[]) {
  const positions = rows
    .map((r) => {
      const value = r.manual_value != null ? Number(r.manual_value) : r.price != null ? Number(r.quantity) * Number(r.price) : null;
      return { ...r, quantity: Number(r.quantity), value: value == null ? null : r2(value) };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const total = r2(positions.reduce((s, p) => s + (p.value ?? 0), 0));
  const priced = positions.filter((p) => p.change_24h != null && p.value);
  const pricedTotal = priced.reduce((s, p) => s + (p.value ?? 0), 0);
  const change24h = pricedTotal ? priced.reduce((s, p) => s + (p.value ?? 0) * Number(p.change_24h), 0) / pricedTotal : null;
  const pricesAt = positions.map((p) => p.price_at).filter(Boolean).sort().at(-1) ?? null;
  return { positions, total, change24h, pricesAt };
}
