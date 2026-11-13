import { describe, expect, it } from "vitest";
import { collectKeys, placeholders } from "./collect.ts";
import { de } from "./de.ts";
import { en } from "./en.ts";
import { es } from "./es.ts";
import { it as italien } from "./it.ts";
import type { Dict } from "../lib/i18n.ts";

const DICTS: Record<string, Dict> = { en, de, it: italien, es };
const keys = collectKeys();

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
