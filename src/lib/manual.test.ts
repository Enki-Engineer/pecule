import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectKeys } from "../i18n/collect.ts";
import { de } from "../i18n/de.ts";
import { en } from "../i18n/en.ts";
import { es } from "../i18n/es.ts";
import { it as italien } from "../i18n/it.ts";
import { registerDict, type Dict } from "./i18n.ts";
import { MANUAL, articleBody, articleMarkdown, blockTexts, findArticle, linkLabel, manualEntries, manualNames, manualOutline, manualTargets, manualText, searchManual, searchWords } from "./manual.ts";
import { MODULES } from "./modules.ts";

const DICTS: Record<string, Dict> = { en, de, it: italien, es };
const keys = collectKeys();
const known = (k: string) => keys.texts.has(k) || keys.plurals.has(k);
const read = (file: string) => readFileSync(file, "utf8");
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : /\.tsx$/.test(e.name) ? [path.join(dir, e.name)] : []));

/** Tous les textes d'un article : titre, résumé, corps, mots de recherche. */
const texts = (a: (typeof MANUAL)[number]["articles"][number]) => [a.title, a.summary, ...a.body.flatMap(blockTexts), ...(a.words ? [a.words] : [])];
const allTexts = [...MANUAL.flatMap((th) => [th.title, th.hint]), ...manualEntries().flatMap((e) => texts(e.article))];

describe("contenu du manuel", () => {
  it("donne à chaque thème et à chaque article un identifiant d'adresse, unique", () => {
    const ids = [...MANUAL.map((th) => th.id), ...manualEntries().map((e) => e.article.id)];
    expect(ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toEqual([]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("ne nomme que des boutons, des menus et des écrans que l'appli affiche", () => {
    const unknown = new Set<string>();
    for (const text of allTexts) for (const name of manualNames(text)) if (!known(name)) unknown.add(name);
    for (const e of manualEntries()) for (const l of e.article.links ?? []) for (const name of l.label) if (!known(name)) unknown.add(name);
    expect([...unknown]).toEqual([]);
  });

  it("n'écrit un nom d'élément ni avec une variable, ni dans un titre, un résumé ou des mots de recherche", () => {
    expect(allTexts.flatMap(manualNames).filter((n) => /\{\w+\}/.test(n))).toEqual([]);
    const plain = [...MANUAL.flatMap((th) => [th.title, th.hint]), ...manualEntries().flatMap((e) => [e.article.title, e.article.summary, e.article.words ?? ""])];
    expect(plain.filter((p) => manualNames(p).length || manualTargets(p).length)).toEqual([]);
  });

  it("ne renvoie qu'à des adresses qui existent", () => {
    const routes = new Set(["", ...[...read("src/client/app.tsx").matchAll(/path="\/?([^"/:*]+)/g)].map((m) => m[1])]);
    const settings = read("src/client/pages/Settings.tsx");
    const groups = new Set([...settings.matchAll(/\{ id: "(\w+)", label:/g)].map((m) => m[1]));
    const blocks = new Set([...read("src/client/components/ConnectionsSettings.tsx").matchAll(/block\("(\w+)"\)/g)].map((m) => m[1]));
    const anchors = new Set(sources("src/client").flatMap((f) => [...read(f).matchAll(/<(?:Section|section|div) id="([\w-]+)"/g)].map((m) => m[1])));
    const tabs = new Set([...read("src/client/pages/Analysis.tsx").matchAll(/"(calendrier|repartition|flux|frise|marchands|comparer)"/g)].map((m) => m[1]));
    const bad: string[] = [];
    const targets = [...allTexts.flatMap(manualTargets), ...manualEntries().flatMap((e) => (e.article.links ?? []).map((l) => l.to))];
    for (const to of targets) {
      const url = new URL(to, "https://pecule.invalid");
      const [, first = "", second] = url.pathname.split("/");
      if (first === "manuel") {
        if (second && !findArticle(second) && !MANUAL.some((th) => th.id === second)) bad.push(to);
        continue;
      }
      if (!routes.has(first)) bad.push(to);
      if (first === "reglages" && second && !groups.has(second)) bad.push(to);
      if (url.hash && !anchors.has(url.hash.slice(1))) bad.push(to);
      const block = url.searchParams.get("c");
      if (block && !blocks.has(block)) bad.push(to);
      const tab = url.searchParams.get("onglet");
      if (tab && !tabs.has(tab)) bad.push(to);
    }
    expect(bad).toEqual([]);
    expect(groups.size).toBeGreaterThan(5);
    expect(anchors.size).toBeGreaterThan(10);
  });

  it("ne rattache un article qu'à un écran facultatif connu", () => {
    expect(manualEntries().filter((e) => e.article.module && !MODULES.includes(e.article.module))).toEqual([]);
  });

  it.each(Object.entries(DICTS))("garde en %s les noms d'éléments et les adresses de chaque texte", (_lang, dict) => {
    const wrong: string[] = [];
    for (const text of allTexts) {
      const tr = dict[text];
      if (typeof tr !== "string") continue; // texte manquant : signalé par le test des dictionnaires
      if (manualNames(tr).sort().join("|") !== manualNames(text).sort().join("|") || manualTargets(tr).sort().join("|") !== manualTargets(text).sort().join("|")) wrong.push(text);
    }
    expect(wrong).toEqual([]);
  });
});

describe("texte d'un article", () => {
  registerDict("en", en);
  const entry = findArticle("apparence")!;

  it("remplace un nom d'élément par ce que l'écran affiche, dans la langue demandée", () => {
    expect(manualText("Ouvre [[Réglages]] → [[Apparence]].", "fr")).toBe("Ouvre **Réglages** → **Apparence**.");
    expect(manualText("[[Réglages]]", "en")).toBe(`**${en["Réglages"] as string}**`);
    expect(manualText("[[Mois##pas]]", "fr", false)).toBe("Mois");
    expect(manualText("[[[Réglages]] → [[Apparence]]](/reglages/apparence)", "fr")).toBe("[**Réglages** → **Apparence**](/reglages/apparence)");
  });

  it("rend le corps en Markdown : étapes numérotées, listes, encadrés", () => {
    const md = articleBody({ id: "x", title: "T", summary: "S", body: ["Un.", { steps: ["A", "B"] }, { list: ["C"] }, { tip: "D" }, { note: "E" }, { warning: "F" }] }, "fr");
    expect(md).toBe("Un.\n\n1. A\n2. B\n\n- C\n\n> [!TIP]\n> D\n\n> [!NOTE]\n> E\n\n> [!WARNING]\n> F");
  });

  it("donne à l'assistant l'article entier, avec ses écrans", () => {
    const md = articleMarkdown(entry.article, "fr");
    expect(md.startsWith(`## ${entry.article.title}\n`)).toBe(true);
    expect(md).toContain("](/reglages/apparence");
    expect(linkLabel({ to: "/reglages/apparence", label: ["Réglages", "Apparence"] }, "fr")).toBe("Réglages → Apparence");
  });

  it("liste tous les articles dans le sommaire des consignes", () => {
    const outline = manualOutline();
    for (const e of manualEntries()) expect(outline).toContain(`- ${e.article.id} — `);
  });
});

describe("recherche dans le manuel", () => {
  const first = (q: string) => searchManual(q, { langs: ["fr"] })[0]?.article.id;

  it("retire les mots courts, les accents et le pluriel simple", () => {
    expect(searchWords("Les règles de classement")).toEqual(["les", "regle", "classement"]);
    expect(searchWords("à de")).toEqual([]);
  });

  it("trouve un article par son sujet, mots-clés ou question entière", () => {
    expect(first("mode sombre")).toBe("apparence");
    expect(first("comment relier ma banque ?")).toBe("relier-une-banque");
    expect(first("changer la langue")).toBe("langue");
    expect(first("sauvegarde")).toBe("sauvegarde");
    expect(first("je veux masquer les montants")).toBe("mode-discret");
    expect(first("découvert")).toMatch(/^(alerte-solde-bas|soldes-a-venir)$/);
    expect(first("ajouter un crédit immobilier")).toMatch(/^(credits|documents-vers-ecrans)$/);
    expect(first("notifications iphone")).toBe("notifications");
  });

  it("ne rend rien pour une recherche vide ou sans rapport", () => {
    expect(searchManual("  ")).toEqual([]);
    expect(searchManual("xyzzy plugh")).toEqual([]);
  });

  it("cherche dans plusieurs langues à la fois", () => {
    expect(searchManual("dark mode", { langs: ["en", "fr"] })[0]?.article.id).toBe("apparence");
  });
});
