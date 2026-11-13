import { describe, expect, it } from "vitest";
import { cleanRegion, COUNTRIES, dayIn, DEFAULT_REGION, guessRegion, isCountry, isFrance, isTimeZone, regionOf } from "./countries.ts";
import { isCurrency } from "./currencies.ts";

describe("pays du foyer", () => {
  it("ne propose que des devises et des fuseaux connus", () => {
    for (const [code, [currency, timeZone]] of Object.entries(COUNTRIES)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(isCurrency(currency), `${code} : ${currency}`).toBe(true);
      expect(isTimeZone(timeZone), `${code} : ${timeZone}`).toBe(true);
    }
  });

  it("valide un réglage enregistré", () => {
    expect(cleanRegion(null)).toEqual(DEFAULT_REGION);
    expect(cleanRegion({})).toEqual({ country: "FR", currency: "EUR", timeZone: "Europe/Paris" });
    expect(cleanRegion({ country: "CH", currency: "CHF", timeZone: "Europe/Zurich" })).toEqual({ country: "CH", currency: "CHF", timeZone: "Europe/Zurich" });
    expect(cleanRegion({ country: "ZZ", currency: "XXX", timeZone: "Lune/Mer" })).toEqual(DEFAULT_REGION);
    expect(isCountry("toString")).toBe(false);
  });

  it("propose la devise et le fuseau d'un pays", () => {
    expect(regionOf("CH")).toEqual({ country: "CH", currency: "CHF", timeZone: "Europe/Zurich" });
    expect(regionOf("ZZ")).toEqual(DEFAULT_REGION);
    expect(isFrance("FR")).toBe(true);
    expect(isFrance("BE")).toBe(false);
  });

  it("devine le pays d'après le navigateur", () => {
    expect(guessRegion("Europe/Zurich", ["fr-CH"])).toEqual({ country: "CH", currency: "CHF", timeZone: "Europe/Zurich" });
    expect(guessRegion("America/Los_Angeles", ["en-US"])).toEqual({ country: "US", currency: "USD", timeZone: "America/Los_Angeles" });
    expect(guessRegion("Europe/Paris", ["en-US"])).toEqual(DEFAULT_REGION);
    expect(guessRegion(undefined, ["de"])).toEqual(DEFAULT_REGION);
    expect(guessRegion(undefined, ["fr", "en-GB"])).toEqual({ country: "GB", currency: "GBP", timeZone: "Europe/London" });
  });

  it("donne la date du jour dans un fuseau", () => {
    const at = new Date("2026-01-01T02:30:00Z");
    expect(dayIn("Europe/Paris", at)).toBe("2026-01-01");
    expect(dayIn("America/New_York", at)).toBe("2025-12-31");
  });
});
