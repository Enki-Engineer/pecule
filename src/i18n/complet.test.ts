import { describe, expect, it } from "vitest";
import { collectKeys, manualOnlyKeys, placeholders } from "./collect.ts";
import { de } from "./de.ts";
import { en } from "./en.ts";
import { es } from "./es.ts";
import { it as italien } from "./it.ts";
import { de as manualDe } from "./manual/de.ts";
import { en as manualEn } from "./manual/en.ts";
import { es as manualEs } from "./manual/es.ts";
import { it as manualIt } from "./manual/it.ts";
import type { Dict } from "../lib/i18n.ts";

/** Par langue : le dictionnaire de l'appli (chargé au démarrage) et celui du manuel (chargé avec le manuel). */
const PARTS: Record<string, { app: Dict; manual: Dict }> = { en: { app: en, manual: manualEn }, de: { app: de, manual: manualDe }, it: { app: italien, manual: manualIt }, es: { app: es, manual: manualEs } };
const DICTS: Record<string, Dict> = Object.fromEntries(Object.entries(PARTS).map(([lang, p]) => [lang, { ...p.app, ...p.manual }]));
const keys = collectKeys();
const manualOnly = manualOnlyKeys();

describe.each(Object.entries(PARTS))("rangement du dictionnaire %s", (_lang, { app, manual }) => {
  it("garde dans le dictionnaire de l'appli tout texte employé hors du manuel", () => {
    // Un texte rangé avec le manuel n'est pas connu au démarrage : il resterait en français sur les autres écrans.
    expect(Object.keys(manual).filter((k) => !manualOnly.has(k))).toEqual([]);
  });
  it("range avec le manuel les textes qui ne servent qu'à lui", () => {
    expect(Object.keys(app).filter((k) => manualOnly.has(k))).toEqual([]);
  });
});

describe.each(Object.entries(DICTS))("dictionnaire %s", (_lang, dict) => {
  it("traduit tous les textes passés à t, tk et tn", () => {
    const missing = [...keys.texts, ...keys.plurals.keys()].filter((k) => !(k in dict));
    expect(missing).toEqual([]);
  });
  it("ne garde aucun texte qui n'est plus dans le code", () => {
    const known = new Set([...keys.texts, ...keys.plurals.keys()]);
    expect(Object.keys(dict).filter((k) => !known.has(k))).toEqual([]);
  });
  it("donne une chaîne pour un texte simple, [singulier, pluriel] pour un pluriel, avec les mêmes variables", () => {
    const wrong: string[] = [];
    for (const k of keys.texts) {
      const v = dict[k];
      if (v === undefined) continue;
      if (typeof v !== "string" || placeholders(v).join() !== placeholders(k).join()) wrong.push(k);
      // Un texte qui finit (ou commence) par une espace la garde : il est collé à ce qui suit.
      else if (/^\s/.test(k) !== /^\s/.test(v) || /\s$/.test(k) !== /\s$/.test(v)) wrong.push(k);
    }
    for (const [one, other] of keys.plurals) {
      const v = dict[one];
      if (v === undefined) continue;
      if (!Array.isArray(v) || placeholders(v[0]).join() !== placeholders(one).join() || placeholders(v[1]).join() !== placeholders(other).join()) wrong.push(one);
    }
    expect(wrong).toEqual([]);
  });
});
