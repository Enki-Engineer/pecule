import { describe, expect, it } from "vitest";
import { cleanCurrency, convert, crossRate, currencyDigits, currencySymbol, CURRENCIES, formatMoney, isCurrency, parseEcbRates, roundMoney, toHousehold, withUnit } from "./currencies.ts";

const rates = { USD: 1.25, CHF: 0.9, JPY: 160 };

describe("devises", () => {
  it("reconnaît les devises prises en charge", () => {
    expect(isCurrency("EUR")).toBe(true);
    expect(isCurrency("CHF")).toBe(true);
    expect(isCurrency("XXX")).toBe(false);
    expect(cleanCurrency(" chf ")).toBe("CHF");
    expect(cleanCurrency("XXX")).toBe("EUR");
    expect(cleanCurrency(undefined, "USD")).toBe("USD");
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length);
  });

  it("met en forme comme avant pour l'euro", () => {
    expect(formatMoney(1234.5, "EUR", "fr-FR")).toBe(new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(1234.5));
    expect(formatMoney(1234.5, "EUR", "fr-FR", true)).toBe(new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(1234.5));
    expect(formatMoney(1234, "JPY", "fr-FR")).toMatch(/1\s234/);
    expect(formatMoney(1234, "JPY", "fr-FR")).not.toMatch(/,/);
  });

  it("donne le signe et l'unité courte", () => {
    expect(currencySymbol("EUR", "fr-FR")).toBe("€");
    expect(currencySymbol("CHF", "fr-FR")).toBe("CHF");
    expect(withUnit("12", "k", "€")).toBe("12 k€");
    expect(withUnit("12", "k", "CHF")).toBe("12 k CHF");
    expect(withUnit("12", "", "€")).toBe("12 €");
  });

  it("arrondit à l'unité de la devise", () => {
    expect(currencyDigits("EUR")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(roundMoney(10.005, "EUR")).toBe(10.01);
    expect(roundMoney(-10.005, "EUR")).toBe(-10.01);
    expect(roundMoney(1234.5, "JPY")).toBe(1235);
    expect(Object.is(roundMoney(-0.001, "EUR"), 0)).toBe(true);
  });

  it("convertit par l'euro", () => {
    expect(crossRate("EUR", "EUR", {})).toBe(1);
    expect(crossRate("EUR", "USD", rates)).toBe(1.25);
    expect(crossRate("USD", "EUR", rates)).toBe(0.8);
    expect(convert(100, "USD", "EUR", rates)).toBe(80);
    expect(convert(100, "EUR", "CHF", rates)).toBe(90);
    expect(convert(100, "USD", "CHF", rates)).toBe(72);
    expect(convert(100, "USD", "JPY", rates)).toBe(12800);
    expect(convert(100, "GBP", "EUR", rates)).toBeNull();
    expect(convert(-45.5, "CHF", "CHF", {})).toBe(-45.5);
  });

  it("garde l'original d'un montant converti", () => {
    expect(toHousehold(-50, "EUR", "EUR", {})).toEqual({ amount: -50, originalAmount: null, originalCurrency: null });
    expect(toHousehold(-50, "USD", "EUR", rates)).toEqual({ amount: -40, originalAmount: -50, originalCurrency: "USD" });
    expect(toHousehold(-50, "EUR", "CHF", rates)).toEqual({ amount: -45, originalAmount: -50, originalCurrency: "EUR" });
    expect(toHousehold(-50, "GBP", "EUR", rates)).toBeNull();
  });

  it("lit les fichiers de cours de la BCE, quel que soit le guillemet", () => {
    const xml = `<Cube><Cube time='2026-01-05'><Cube currency='USD' rate='1.1000'/><Cube currency='CHF' rate='0.9300'/></Cube>
      <Cube time="2026-01-02"><Cube currency="USD" rate="1.0900"/></Cube></Cube>`;
    expect(parseEcbRates(xml)).toEqual([
      { date: "2026-01-05", rates: { USD: 1.1, CHF: 0.93 } },
      { date: "2026-01-02", rates: { USD: 1.09 } },
    ]);
    expect(parseEcbRates("<html>indisponible</html>")).toEqual([]);
  });
});
