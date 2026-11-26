import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { de } from "../i18n/de.ts";
import { en } from "../i18n/en.ts";
import { es } from "../i18n/es.ts";
import { it as italian } from "../i18n/it.ts";
import { LANG_IDS, registerDict } from "./i18n.ts";
import { SHELL_TEXTS, shellTexts, shellTextsFile } from "./desktop-texts.ts";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

beforeAll(() => {
  registerDict("en", en);
  registerDict("de", de);
  registerDict("it", italian);
  registerDict("es", es);
});

describe("mots de la coque de l'appli de bureau", () => {
  it("le fichier embarqué par la coque est à jour (pnpm exec tsx scripts/bureau-textes.ts)", () => {
    expect(read("bureau/src-tauri/textes.json")).toBe(shellTextsFile());
  });

  it("chaque texte est traduit dans chaque langue, sans marque d'homonyme", () => {
    for (const lang of LANG_IDS) {
      const texts = shellTexts(lang);
      for (const [id, text] of Object.entries(texts)) {
        expect(text, `${lang} ${id}`).not.toContain("##");
        if (lang !== "fr" && id !== "zoomReset") expect(text.length, `${lang} ${id}`).toBeGreaterThan(0);
      }
    }
    // Une langue étrangère ne rend pas le français : la traduction existe.
    expect(shellTexts("en").quit).not.toBe(shellTexts("fr").quit);
  });

  it("la coque ne lit que des textes qui existent", () => {
    const shell = read("bureau/src-tauri/src/main.rs");
    for (const id of [...shell.matchAll(/\btexte\("(\w+)"\)/g)].map((m) => m[1])) expect(Object.keys(SHELL_TEXTS), id).toContain(id);
  });
});
