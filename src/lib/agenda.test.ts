import { describe, expect, it } from "vitest";
import { calendarDates, nextOccurrence } from "./agenda.ts";

describe("nextOccurrence", () => {
  it("avance d'un mois, d'un trimestre, d'un an", () => {
    expect(nextOccurrence("2026-11-05", "mensuel")).toBe("2026-12-05");
    expect(nextOccurrence("2026-11-05", "trimestriel")).toBe("2027-02-05");
    expect(nextOccurrence("2026-02-28", "annuel")).toBe("2027-02-28");
  });
  it("ramène le 31 au dernier jour du mois", () => {
    expect(nextOccurrence("2026-01-31", "mensuel")).toBe("2026-02-28");
    expect(nextOccurrence("2027-12-31", "mensuel")).toBe("2028-01-31");
  });
});

describe("calendarDates", () => {
  it("donne les dates fiscales de la période", () => {
    const d = calendarDates("2026-11-09", "2027-11-09").map((c) => c.date);
    expect(d).toEqual(["2027-04-10", "2027-06-05", "2027-09-25", "2027-10-15"]);
  });
  it("n'en donne aucune hors de France", () => {
    expect(calendarDates("2026-11-09", "2027-11-09", "CH")).toEqual([]);
  });
});
