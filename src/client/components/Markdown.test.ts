import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./Markdown.tsx";

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
});
