import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { asSeasonMode, birthdaysAt, decorDue, DEFAULT_SEASON_MODE, easterSunday, feteAt, parseBirthdays, saisonAt, seasonAt, seasonWindow, SEASONS, upcomingSeasons } from "./seasons.ts";
import { DEFAULT_FOND } from "./logo.ts";

const d = (s: string) => new Date(`${s}T12:00:00`);
const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

describe("easterSunday", () => {
  it("donne les dates connues", () => {
    expect(ymd(easterSunday(2026))).toBe("2026-04-05");
    expect(ymd(easterSunday(2027))).toBe("2027-03-28");
    expect(ymd(easterSunday(2025))).toBe("2025-04-20");
  });
});

describe("feteAt", () => {
  it("couvre les fêtes et rien d'autre", () => {
    expect(feteAt(d("2026-10-23"))).toBeNull();
    expect(feteAt(d("2026-10-24"))).toBe("halloween");
    expect(feteAt(d("2026-10-31"))).toBe("halloween");
    expect(feteAt(d("2026-11-10"))).toBeNull();
    expect(feteAt(d("2026-12-01"))).toBe("noel");
    expect(feteAt(d("2026-12-26"))).toBe("noel");
    expect(feteAt(d("2026-12-27"))).toBe("nouvel-an");
    expect(feteAt(d("2027-01-03"))).toBe("nouvel-an");
    expect(feteAt(d("2027-01-04"))).toBe("epiphanie");
    expect(feteAt(d("2027-01-10"))).toBe("epiphanie");
    expect(feteAt(d("2027-01-11"))).toBeNull();
    expect(feteAt(d("2027-01-31"))).toBe("chandeleur");
    expect(feteAt(d("2027-02-02"))).toBe("chandeleur");
    expect(feteAt(d("2027-02-03"))).toBeNull();
    expect(feteAt(d("2027-02-07"))).toBeNull();
    expect(feteAt(d("2027-02-08"))).toBe("saint-valentin");
    expect(feteAt(d("2027-02-14"))).toBe("saint-valentin");
    expect(feteAt(d("2027-02-15"))).toBeNull();
    expect(feteAt(d("2027-03-13"))).toBeNull();
    expect(feteAt(d("2027-03-14"))).toBe("saint-patrick");
    expect(feteAt(d("2027-03-17"))).toBe("saint-patrick");
    expect(feteAt(d("2027-03-18"))).toBeNull();
    expect(feteAt(d("2027-03-21"))).toBe("paques"); // Rameaux 2027
    expect(feteAt(d("2027-03-29"))).toBe("paques"); // lundi de Pâques
    expect(feteAt(d("2027-03-30"))).toBeNull();
    expect(feteAt(d("2027-07-11"))).toBeNull();
    expect(feteAt(d("2027-07-14"))).toBe("14-juillet");
    expect(feteAt(d("2027-07-15"))).toBeNull();
    expect(feteAt(d("2026-12-04"))).toBe("noel");
    expect(feteAt(d("2026-12-05"))).toBe("fete-lumieres"); // prioritaire sur Noël
    expect(feteAt(d("2026-12-08"))).toBe("fete-lumieres");
    expect(feteAt(d("2026-12-09"))).toBe("noel");
    expect(feteAt(d("2027-08-24"))).toBeNull();
    expect(feteAt(d("2027-08-25"))).toBe("rentree");
    expect(feteAt(d("2027-09-07"))).toBe("rentree");
    expect(feteAt(d("2027-09-08"))).toBeNull();
  });
});

describe("saisonAt / seasonAt", () => {
  it("donne la saison hors fêtes", () => {
    expect(saisonAt(d("2027-01-12"))).toBe("hiver");
    expect(saisonAt(d("2027-03-19"))).toBe("hiver");
    expect(saisonAt(d("2027-03-20"))).toBe("printemps");
    expect(saisonAt(d("2027-06-21"))).toBe("ete");
    expect(saisonAt(d("2027-09-23"))).toBe("automne");
    expect(saisonAt(d("2027-11-30"))).toBe("automne");
  });
  it("n'applique aucun thème tant que le membre n'en a pas activé", () => {
    expect(DEFAULT_SEASON_MODE).toBe("aucun");
    expect(seasonAt(d("2026-11-10"))).toBeNull();
    expect(seasonAt(d("2026-12-24"))).toBeNull();
    expect(asSeasonMode(null)).toBe("aucun");
    expect(asSeasonMode("")).toBe("aucun");
    expect(asSeasonMode("inconnu")).toBe("aucun");
    expect(asSeasonMode("tout")).toBe("tout");
    expect(asSeasonMode("fetes")).toBe("fetes");
    // Valeurs gardées par d'anciennes versions.
    expect(asSeasonMode("on")).toBe("tout");
    expect(asSeasonMode("off")).toBe("aucun");
  });
  it("fait primer la fête, et suit le réglage", () => {
    expect(seasonAt(d("2026-11-10"), "tout")).toBe("automne");
    expect(seasonAt(d("2026-10-30"), "tout")).toBe("halloween");
    expect(seasonAt(d("2027-03-21"), "tout")).toBe("paques");
    expect(seasonAt(d("2026-11-10"), "fetes")).toBeNull();
    expect(seasonAt(d("2026-10-30"), "fetes")).toBe("halloween");
    expect(seasonAt(d("2026-10-30"), "aucun")).toBeNull();
  });
});

describe("upcomingSeasons", () => {
  it("liste les prochaines fêtes dans l'ordre", () => {
    const s = upcomingSeasons(d("2026-11-10"), 5).map((x) => `${x.season} ${ymd(x.start)}`);
    expect(s).toEqual(["noel 2026-12-01", "fete-lumieres 2026-12-05", "nouvel-an 2026-12-27", "epiphanie 2027-01-04", "chandeleur 2027-01-31"]);
  });
  it("ne compte le Jour de l'an qu'une fois", () => {
    const s = upcomingSeasons(d("2026-12-30"), 12).map((x) => x.season);
    expect(s.filter((x) => x === "nouvel-an")).toHaveLength(2); // celui en cours, puis celui de fin 2027
    expect(s[0]).toBe("nouvel-an");
  });
});

describe("anniversaires", () => {
  const list = [
    { name: "Camille", month: 3, day: 16 },
    { name: "Léo", month: 2, day: 29 },
  ];
  it("priment sur la fête et la saison, le jour J seulement", () => {
    expect(seasonAt(d("2027-03-16"), "tout", list)).toBe("anniversaire"); // en pleine Saint-Patrick
    expect(seasonAt(d("2027-03-15"), "tout", list)).toBe("saint-patrick");
    expect(seasonAt(d("2027-03-16"), "fetes", list)).toBe("anniversaire");
    expect(seasonAt(d("2027-03-16"), "aucun", list)).toBeNull();
    expect(seasonAt(d("2027-03-16"), "tout")).toBe("saint-patrick");
  });
  it("fêtent un 29 février le 28 les années ordinaires", () => {
    expect(birthdaysAt(d("2027-02-28"), list).map((b) => b.name)).toEqual(["Léo"]);
    expect(birthdaysAt(d("2028-02-28"), list)).toEqual([]);
    expect(birthdaysAt(d("2028-02-29"), list).map((b) => b.name)).toEqual(["Léo"]);
  });
  it("ne gardent que des dates valides", () => {
    expect(parseBirthdays([{ name: " Camille ", month: 3, day: 16 }, { name: "x", month: 2, day: 30 }, { name: "", month: 1, day: 1 }, { name: "y", month: 13, day: 1 }, null, "z"])).toEqual([{ name: "Camille", month: 3, day: 16 }]);
    expect(parseBirthdays("n'importe quoi")).toEqual([]);
    expect(parseBirthdays(Array.from({ length: 20 }, (_, i) => ({ name: `p${i}`, month: 1, day: 1 })))).toHaveLength(12);
  });
  it("gardent l'année de naissance quand elle est plausible", () => {
    expect(parseBirthdays([{ name: "Alex", month: 6, day: 20, year: 1988 }])).toEqual([{ name: "Alex", month: 6, day: 20, year: 1988 }]);
    expect(parseBirthdays([{ name: "a", month: 6, day: 20, year: 12 }, { name: "b", month: 2, day: 29, year: 1991 }])).toEqual([{ name: "a", month: 6, day: 20 }, { name: "b", month: 2, day: 29 }]);
  });
  it("ont pour période le jour même", () => {
    const w = seasonWindow("anniversaire", d("2027-03-16"), -1);
    expect(`${ymd(w.start)} → ${ymd(w.end)}`).toBe("2026-03-16 → 2026-03-16");
  });
});

describe("seasonWindow", () => {
  const w = (season: Parameters<typeof seasonWindow>[0], day: string, off = 0) => {
    const x = seasonWindow(season, d(day), off);
    return `${ymd(x.start)} → ${ymd(x.end)}`;
  };
  it("donne la fête en cours, ou la dernière passée", () => {
    expect(w("noel", "2026-12-10")).toBe("2026-12-01 → 2026-12-26");
    expect(w("noel", "2026-11-11")).toBe("2025-12-01 → 2025-12-26");
    expect(w("nouvel-an", "2027-01-02")).toBe("2026-12-27 → 2027-01-03");
    expect(w("paques", "2027-03-25")).toBe("2027-03-21 → 2027-03-29");
  });
  it("donne la même fête un an plus tôt", () => {
    expect(w("noel", "2026-12-10", -1)).toBe("2025-12-01 → 2025-12-26");
    expect(w("paques", "2027-03-25", -1)).toBe("2026-03-29 → 2026-04-06");
    expect(w("nouvel-an", "2027-01-02", -1)).toBe("2025-12-27 → 2026-01-03");
  });
  it("donne la saison de l'année", () => {
    expect(w("automne", "2026-11-11")).toBe("2026-09-23 → 2026-11-30");
    expect(w("ete", "2026-07-01", -1)).toBe("2025-06-21 → 2025-09-22");
  });
});

describe("decorDue", () => {
  const H = 3_600_000;
  const now = d("2026-11-11").getTime() + 18 * H;
  it("joue le décor la première fois et quand le thème change", () => {
    expect(decorDue("automne", null, now)).toBe(true);
    expect(decorDue("noel", { season: "automne", at: now - 60_000 }, now)).toBe(true);
  });
  it("laisse trois heures entre deux décors d'une fête", () => {
    expect(decorDue("noel", { season: "noel", at: now - 2 * H }, now)).toBe(false);
    expect(decorDue("noel", { season: "noel", at: now - 3 * H }, now)).toBe(true);
  });
  it("laisse huit heures entre deux décors d'une saison", () => {
    expect(decorDue("automne", { season: "automne", at: now - 7 * H }, now)).toBe(false);
    expect(decorDue("automne", { season: "automne", at: now - 8 * H }, now)).toBe(true);
  });
  it("ne reste pas bloqué sur une date à venir ou illisible", () => {
    expect(decorDue("automne", { season: "automne", at: now + 24 * H }, now)).toBe(true);
    expect(decorDue("automne", { season: "automne", at: Number.NaN }, now)).toBe(true);
  });
});

describe("thèmes selon le pays", () => {
  it("garde les fêtes françaises pour la France", () => {
    expect(seasonAt(d("2027-07-14"), "tout", [], "FR")).toBe("14-juillet");
    expect(seasonAt(d("2027-07-14"), "tout", [], "CH")).toBe("ete");
    expect(seasonAt(d("2027-12-06"), "tout", [], "BE")).toBe("noel");
    expect(seasonAt(d("2027-01-06"), "fetes", [], "DE")).toBeNull();
    expect(seasonAt(d("2027-10-30"), "tout", [], "US")).toBe("halloween");
  });
  it("n'applique aucune saison dans l'hémisphère sud", () => {
    expect(seasonAt(d("2027-07-20"), "tout", [], "AU")).toBeNull();
    expect(seasonAt(d("2027-12-20"), "tout", [], "AU")).toBe("noel");
  });
});

describe("public/theme-init.js", () => {
  it.each(["FR", "CH", "AU"])("applique le même thème que seasonAt, chaque jour de deux années (%s)", (country) => {
    const code = readFileSync("public/theme-init.js", "utf8");
    for (let t = new Date(2026, 0, 1); t < new Date(2028, 0, 1); t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
      const day = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12);
      const root = { dataset: {} as Record<string, string> };
      class FakeDate extends Date {
        constructor(...a: unknown[]) {
          if (a.length) super(...(a as [number]));
          else super(day.getTime());
        }
      }
      vm.runInNewContext(code, {
        document: { documentElement: root, querySelector: () => null },
        localStorage: { getItem: (k: string) => (k === "pecule.seasons" ? "tout" : k === "pecule.pays" && country !== "FR" ? country : null) },
        window: { matchMedia: () => ({ matches: false }) },
        Date: FakeDate,
      });
      expect(root.dataset.season ?? null, ymd(day)).toBe(seasonAt(day, "tout", [], country));
    }
  });
  it("applique le thème d'anniversaire le jour J, d'après la liste gardée sur l'appareil", () => {
    const code = readFileSync("public/theme-init.js", "utf8");
    const list = [{ name: "Camille", month: 3, day: 16 }, { name: "Léo", month: 2, day: 29 }];
    for (const iso of ["2027-03-15", "2027-03-16", "2027-02-28", "2028-02-28", "2028-02-29", "2027-07-14"]) {
      const day = d(iso);
      const root = { dataset: {} as Record<string, string> };
      class FakeDate extends Date {
        constructor(...a: unknown[]) {
          if (a.length) super(...(a as [number]));
          else super(day.getTime());
        }
      }
      vm.runInNewContext(code, {
        document: { documentElement: root, querySelector: () => null },
        localStorage: { getItem: (k: string) => (k === "pecule.seasons" ? "tout" : k === "pecule.anniversaires" ? JSON.stringify(list) : null) },
        window: { matchMedia: () => ({ matches: false }) },
        Date: FakeDate,
      });
      expect(root.dataset.season ?? null, iso).toBe(seasonAt(day, "tout", list));
    }
  });
  it("lit le réglage de l'appareil comme asSeasonMode : aucun thème sans choix, les anciens « on » et « off » compris", () => {
    const code = readFileSync("public/theme-init.js", "utf8");
    const list = [{ name: "Camille", month: 3, day: 16 }];
    // Un jour de fête, un jour de saison, un anniversaire : ce que chaque réglage en fait.
    for (const iso of ["2026-10-30", "2026-11-10", "2027-03-16"]) {
      const day = d(iso);
      class FakeDate extends Date {
        constructor(...a: unknown[]) {
          if (a.length) super(...(a as [number]));
          else super(day.getTime());
        }
      }
      for (const stored of [null, "", "aucun", "off", "fetes", "tout", "on", "inconnu"]) {
        const root = { dataset: {} as Record<string, string> };
        vm.runInNewContext(code, {
          document: { documentElement: root, querySelector: () => null },
          localStorage: { getItem: (k: string) => (k === "pecule.seasons" ? stored : k === "pecule.anniversaires" ? JSON.stringify(list) : null) },
          window: { matchMedia: () => ({ matches: false }) },
          Date: FakeDate,
        });
        expect(root.dataset.season ?? null, `${iso} ${stored}`).toBe(seasonAt(day, asSeasonMode(stored), list));
        // Sans thème, le logo est le coffre de tous les jours, sur le fond d'origine.
        if (asSeasonMode(stored) === "aucun") expect(root.dataset.logo, `${iso} ${stored}`).toBe(DEFAULT_FOND);
      }
    }
  });
  it("connaît tous les thèmes", () => {
    const code = readFileSync("public/theme-init.js", "utf8");
    for (const id of Object.keys(SEASONS)) expect(code, id).toContain(`"${id}"`);
  });
});
