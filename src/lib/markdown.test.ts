import { describe, expect, it } from "vitest";
import { hideOpenMarks, inlineText, numericCell, parseInline, parseMarkdown, plainMarkdown, totalRow } from "./markdown.ts";

describe("parseMarkdown", () => {
  it("reconnaît titres, listes imbriquées et numérotées", () => {
    const b = parseMarkdown("### Bilan\n- Amazon : **294,58 €**\n  - 202,67 € le 03/08\n1. premier\n2. second");
    expect(b[0]).toEqual({ kind: "h", level: 3, text: "Bilan" });
    expect(b[1]).toMatchObject({ kind: "list", ordered: false, items: [{ depth: 0 }, { depth: 1 }] });
    expect(b[2]).toMatchObject({ kind: "list", ordered: true, items: [{ n: 1 }, { n: 2 }] });
  });

  it("lit un tableau avec alignement", () => {
    const b = parseMarkdown("| Mois | Dépenses |\n|---|---:|\n| 2026-08 | 3 120 € |\n| 2026-09 | 2 450 € |\n\nFin.");
    expect(b[0]).toEqual({ kind: "table", head: ["Mois", "Dépenses"], align: ["left", "right"], rows: [["2026-08", "3 120 €"], ["2026-09", "2 450 €"]] });
    expect(b[1]).toEqual({ kind: "p", text: "Fin." });
  });

  it("tolère un tableau en cours d'écriture (sans séparateur) comme un paragraphe", () => {
    expect(parseMarkdown("| Mois | Dépenses")[0].kind).toBe("p");
  });

  it("réunit les lignes d'une citation en un seul bloc", () => {
    expect(parseMarkdown("> Première ligne\n> suite\n\nAprès.")).toEqual([
      { kind: "quote", blocks: [{ kind: "p", text: "Première ligne\nsuite" }] },
      { kind: "p", text: "Après." },
    ]);
  });

  it("lit un encadré, son mot-clé sur sa ligne ou devant le texte, en anglais ou en français", () => {
    expect(parseMarkdown("> [!WARNING]\n> Le compte commun passe sous **200 €** le 28.")).toEqual([
      { kind: "callout", type: "warning", blocks: [{ kind: "p", text: "Le compte commun passe sous **200 €** le 28." }] },
    ]);
    expect(parseMarkdown("> [!TIP] Résilie l'abonnement en double.")[0]).toEqual({ kind: "callout", type: "tip", blocks: [{ kind: "p", text: "Résilie l'abonnement en double." }] });
    expect(parseMarkdown("> [!À retenir]\n> - un\n> - deux")[0]).toMatchObject({ kind: "callout", type: "important", blocks: [{ kind: "list" }] });
    expect(parseMarkdown("> [!NOTE]")[0]).toEqual({ kind: "callout", type: "note", blocks: [] });
  });

  it("garde en citation un mot-clé inconnu", () => {
    expect(parseMarkdown("> [!BIDULE] texte")[0].kind).toBe("quote");
  });

  it("lit un bloc de code, fermé ou encore en cours d'écriture", () => {
    expect(parseMarkdown("```\na | b\n```\nFin.")).toEqual([
      { kind: "code", text: "a | b" },
      { kind: "p", text: "Fin." },
    ]);
    expect(parseMarkdown("```sql\nSELECT 1")).toEqual([{ kind: "code", text: "SELECT 1" }]);
  });
});

describe("parseInline", () => {
  it("lit gras, surlignage et couleurs, imbriqués", () => {
    expect(parseInline("Tu as dépensé **1 240 €**, soit {-+ 182 €-} : ==à surveiller==.")).toEqual([
      { t: "text", v: "Tu as dépensé " },
      { t: "strong", c: [{ t: "text", v: "1 240 €" }] },
      { t: "text", v: ", soit " },
      { t: "neg", c: [{ t: "text", v: "+ 182 €" }] },
      { t: "text", v: " : " },
      { t: "mark", c: [{ t: "text", v: "à surveiller" }] },
      { t: "text", v: "." },
    ]);
    expect(parseInline("**{+−12 %+}**")).toEqual([{ t: "strong", c: [{ t: "pos", c: [{ t: "text", v: "−12 %" }] }] }]);
    expect(parseInline("{--45 €-} et {+-12 %+}")).toEqual([
      { t: "neg", c: [{ t: "text", v: "-45 €" }] },
      { t: "text", v: " et " },
      { t: "pos", c: [{ t: "text", v: "-12 %" }] },
    ]);
  });

  it("laisse tel quel ce qui n'est pas une marque", () => {
    expect(parseInline("a == b et {x}")).toEqual([{ t: "text", v: "a == b et {x}" }]);
  });

  it("lit un lien et son intitulé", () => {
    expect(parseInline("voir [les **opérations**](/operations?q=loyer)")).toEqual([
      { t: "text", v: "voir " },
      { t: "link", href: "/operations?q=loyer", c: [{ t: "text", v: "les " }, { t: "strong", c: [{ t: "text", v: "opérations" }] }] },
    ]);
  });
});

describe("texte brut", () => {
  it("retire les marques d'une ligne", () => {
    expect(inlineText("**{+−12 %+}** sur ==les courses== ([détail](/mois))")).toBe("−12 % sur les courses (détail)");
  });

  it("cache une marque ouverte en fin de réponse en cours d'écriture", () => {
    expect(hideOpenMarks("Total : {+12")).toBe("Total : 12");
    expect(hideOpenMarks("Total : {+12 €+} puis ==impor")).toBe("Total : {+12 €+} puis impor");
    expect(hideOpenMarks("Total : {+12 €+}.")).toBe("Total : {+12 €+}.");
  });

  it("donne le texte à copier : intitulé de l'encadré, liens complets, sans marques", () => {
    const md = "### Bilan\n\nTu as dépensé **1 240 €** ({-+ 182 €-}), voir [le mois](/mois/2026-10).\n\n> [!TIP]\n> Résilie ==l'abonnement== en double.";
    expect(plainMarkdown(md, { label: () => "Conseil", origin: "https://pecule.example" })).toBe(
      "Bilan\n\nTu as dépensé 1 240 € (+ 182 €), voir le mois (https://pecule.example/mois/2026-10).\n\nConseil :\nRésilie l'abonnement en double.",
    );
    expect(plainMarkdown("> [!WARNING] Découvert le 28.\n\n[détail](/mois)")).toBe("Découvert le 28.\n\ndétail");
  });
});

describe("tableaux", () => {
  it("reconnaît une cellule chiffrée, même colorée ou en gras", () => {
    for (const c of ["3 120 €", "**3 120,50 €**", "{-+ 182 €-}", "{+−12 %+}", "12", "CHF 1'200.50", "1,2 k€"]) expect(numericCell(c), c).toBe(true);
    for (const c of ["2026-08", "Courses", "3 120 € par mois", ""]) expect(numericCell(c), c).toBe(false);
  });

  it("reconnaît une ligne de total", () => {
    expect(totalRow(["**Total**", "3 120 €"])).toBe(true);
    expect(totalRow(["Total général", "1"])).toBe(true);
    expect(totalRow(["Totalement autre chose", "1"])).toBe(false);
    expect(totalRow(["Courses", "1"])).toBe(false);
  });
});
