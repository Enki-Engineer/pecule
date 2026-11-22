import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { placeBubble, spotlight, tourSteps, TOUR_GROUPS, type TourContext } from "./tour.ts";

const all: TourContext = { desktop: true, groups: { quotidien: "/operations", patrimoine: "/patrimoine", situation: "/revenus", documents: "/documents" }, scopeChoice: true };
const ids = (ctx: TourContext) => tourSteps(ctx).map((s) => s.id);

describe("étapes de la visite guidée", () => {
  it("fait le tour du menu puis de la barre du haut, sur ordinateur", () => {
    expect(ids(all)).toEqual(["depart", "tableau", "quotidien", "patrimoine", "situation", "documents", "recherche", "perimetre", "discret", "aide", "assistant", "fin"]);
  });

  it("saute une famille que le foyer a vidée de ses écrans, et Foyer / Moi quand il n'y a pas de choix", () => {
    expect(ids({ desktop: true, groups: { quotidien: "/operations", patrimoine: "/patrimoine", documents: "/documents" }, scopeChoice: false })).toEqual([
      "depart",
      "tableau",
      "quotidien",
      "patrimoine",
      "documents",
      "recherche",
      "discret",
      "aide",
      "assistant",
      "fin",
    ]);
  });

  it("ouvre le premier écran de chaque famille, celui que le foyer a gardé", () => {
    const steps = tourSteps({ ...all, groups: { ...all.groups, situation: "/impots" } });
    expect(steps.find((s) => s.id === "situation")?.to).toBe("/impots");
    expect(steps.find((s) => s.id === "quotidien")?.to).toBe("/operations");
    // La barre du haut se lit sur le tableau de bord.
    expect(steps.find((s) => s.id === "recherche")?.to).toBe("/");
  });

  it("montre les onglets puis les boutons du haut, sur téléphone", () => {
    expect(ids({ ...all, desktop: false })).toEqual(["depart", "onglet-accueil", "onglet-operations", "onglet-mois", "onglet-patrimoine", "onglet-assistant", "outils", "fin"]);
  });

  it("commence par une bulle sans repère et finit là où est l'entrée qui relance la visite", () => {
    for (const desktop of [true, false]) {
      const steps = tourSteps({ ...all, desktop });
      expect(steps[0].target).toBeUndefined();
      expect(steps.slice(1).every((s) => !!s.target && s.sides.length > 0)).toBe(true);
      expect(steps.at(-1)?.target).toBe(desktop ? "pied" : "tout");
    }
  });

  it("ne montre que des repères que la coquille porte", () => {
    const shell = ["src/client/components/Layout.tsx", "src/client/components/MobileShell.tsx", "src/client/components/HelpLink.tsx", "src/client/nav.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    const marks = new Set([...shell.matchAll(/(?:data-tour|tour)=["{]"?([\w-]+)/g)].map((m) => m[1]));
    // Les familles du menu portent leur identifiant (nav.ts) ; les onglets du téléphone, le leur.
    for (const m of shell.matchAll(/\b(?:id|tour): "([\w-]+)"/g)) marks.add(m[1]);
    const targets = [true, false].flatMap((desktop) => tourSteps({ ...all, desktop }).flatMap((s) => (s.target ? [s.target] : [])));
    expect(targets.filter((t) => !marks.has(t))).toEqual([]);
    expect(TOUR_GROUPS.filter((g) => !marks.has(g))).toEqual([]);
  });
});

describe("place de la bulle", () => {
  const view = { width: 1440, height: 900 };
  const bubble = { width: 340, height: 180 };

  it("se met au centre sans repère", () => {
    expect(placeBubble(null, bubble, view, [])).toEqual({ x: 550, y: 360, side: null, arrow: 0 });
  });

  it("se pose du côté préféré quand elle y tient, centrée sur le repère", () => {
    // Une famille du menu latéral : la bulle à droite, sa pointe en face du milieu de la famille.
    const p = placeBubble({ x: 12, y: 300, width: 204, height: 200 }, bubble, view, ["droite", "bas"]);
    expect(p).toEqual({ x: 230, y: 310, side: "droite", arrow: 90 });
  });

  it("passe au côté suivant quand la place manque", () => {
    // Un bouton à droite de la barre du haut : pas de place à droite, la bulle descend dessous.
    const p = placeBubble({ x: 1380, y: 10, width: 32, height: 32 }, bubble, view, ["droite", "bas"]);
    expect(p.side).toBe("bas");
    expect(p.y).toBe(56);
    // Elle reste dans la fenêtre, et sa pointe vise toujours le bouton.
    expect(p.x).toBe(1440 - 340 - 12);
    expect(p.x + p.arrow).toBe(1396);
  });

  it("reste dans la fenêtre près d'un bord, la pointe loin des coins", () => {
    // Bas du menu : la bulle remonte pour tenir, la pointe descend vers le repère sans toucher le coin.
    const p = placeBubble({ x: 12, y: 850, width: 204, height: 36 }, bubble, view, ["droite"]);
    expect(p.y).toBe(900 - 180 - 12);
    expect(p.arrow).toBe(180 - 22);
  });

  it("se pose au-dessus d'un onglet du téléphone", () => {
    const phone = { width: 390, height: 844 };
    const p = placeBubble({ x: 0, y: 780, width: 78, height: 50 }, { width: 366, height: 170 }, phone, ["haut", "bas"]);
    expect(p).toEqual({ x: 12, y: 780 - 14 - 170, side: "haut", arrow: 27 });
  });

  it("prend le côté le moins étroit quand elle ne tient nulle part", () => {
    const p = placeBubble({ x: 100, y: 100, width: 200, height: 200 }, { width: 300, height: 300 }, { width: 400, height: 520 }, ["droite", "gauche"]);
    expect(p.side).toBe("bas");
    expect(p.y).toBeLessThanOrEqual(520 - 300 - 12);
  });
});

describe("zone éclairée", () => {
  it("entoure le repère d'une marge, sans sortir de la fenêtre", () => {
    expect(spotlight({ x: 100, y: 50, width: 40, height: 30 }, { width: 400, height: 300 })).toEqual({ x: 94, y: 44, width: 52, height: 42 });
    expect(spotlight({ x: 0, y: 270, width: 400, height: 30 }, { width: 400, height: 300 })).toEqual({ x: 0, y: 264, width: 400, height: 36 });
  });
});
