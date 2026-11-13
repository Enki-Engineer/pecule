import { describe, expect, it } from "vitest";
import { MASK, redact } from "./redact.ts";

describe("redact", () => {
  it("masque IBAN, Sécurité sociale, n° fiscal, numéros longs et adresses crypto", () => {
    expect(redact("IBAN FR76 3000 4000 0312 3456 7890 143 ici")).toBe(`IBAN ${MASK} ici`);
    expect(redact("NIR 1 85 07 75 123 456 78.")).toBe(`NIR ${MASK}.`);
    expect(redact("n° fiscal 12 34 567 890 123")).toBe(`n° fiscal ${MASK}`);
    expect(redact("compte 30000000001 SCI")).toBe(`compte ${MASK} SCI`);
    expect(redact("Ledger 0x52908400098527886E0F7030069857D2E4169EE7")).toBe(`Ledger ${MASK}`);
    expect(redact("erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax")).toBe(MASK);
  });

  it("laisse intacts montants, dates, téléphones et années", () => {
    const t = "Loyer 750 € depuis le 18/06/2024, tél. 06 12 34 56 78, TF 2025 = 1 138 €, 330 000 €, années 2024-2025";
    expect(redact(t)).toBe(t);
  });
});
