import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changelogSection, cleanVersion, compareVersions, parseVersion, unwrapMarkdown, updateState } from "./version.ts";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string; pecule?: { depuis?: string } };
const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");

describe("versions", () => {
  it("lit une version, avec ou sans « v »", () => {
    expect(parseVersion("1.22.0")).toEqual({ major: 1, minor: 22, patch: 0, pre: null });
    expect(parseVersion(" v2.0.0-rc.1 ")).toEqual({ major: 2, minor: 0, patch: 0, pre: "rc.1" });
    expect(parseVersion("1.22")).toBeNull();
    expect(parseVersion("dernière")).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(cleanVersion("v1.22.0+build.4")).toBe("1.22.0");
  });

  it("compare champ par champ, en nombres", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("1.22.0", "v1.22.0")).toBe(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("2.0.0-rc.1", "2.0.0")).toBe(-1);
    expect(compareVersions("2.0.0-rc.2", "2.0.0-rc.10")).toBe(-1);
    expect(compareVersions("2.0.0-beta", "2.0.0-rc")).toBe(-1);
    expect(compareVersions("illisible", "1.0.0")).toBe(-1);
  });
});

describe("état d'une installation", () => {
  it("à jour quand rien de plus récent n'est publié", () => {
    expect(updateState("1.22.0", "v1.22.0")).toEqual({ kind: "a-jour" });
    expect(updateState("1.22.0", "1.21.3")).toEqual({ kind: "a-jour" });
    expect(updateState("1.22.0", null)).toEqual({ kind: "a-jour" });
    expect(updateState("1.22.0", "prochaine")).toEqual({ kind: "a-jour" });
  });

  it("ne propose pas une préversion", () => {
    expect(updateState("1.22.0", "2.0.0-rc.1")).toEqual({ kind: "a-jour" });
  });

  it("propose la version plus récente", () => {
    expect(updateState("1.22.0", "v1.23.0", "1.0.0")).toEqual({ kind: "disponible", version: "1.23.0" });
    expect(updateState("1.22.0", "v1.23.0")).toEqual({ kind: "disponible", version: "1.23.0" });
  });

  it("annonce le palier quand la base est trop ancienne pour la dernière version", () => {
    expect(updateState("1.22.0", "3.1.0", "2.4.0")).toEqual({ kind: "palier", version: "3.1.0", palier: "2.4.0" });
    expect(updateState("2.4.0", "3.1.0", "2.4.0")).toEqual({ kind: "disponible", version: "3.1.0" });
  });
});

describe("journal des versions", () => {
  it("rend la section d'une version, sans son titre ni la suivante", () => {
    const text = "# Journal\n\nIntro.\n\n## 1.2.0\n\n- Nouveau.\n- Corrigé.\n\n## 1.1.0\n\n- Avant.\n";
    expect(changelogSection(text, "v1.2.0")).toBe("- Nouveau.\n- Corrigé.");
    expect(changelogSection(text, "1.1.0")).toBe("- Avant.");
    expect(changelogSection(text, "1.3.0")).toBeNull();
  });

  it("recolle les lignes coupées à la marge, sans toucher aux listes, aux titres ni au code", () => {
    const text = ["- **Un titre.** Le début", "  d'une phrase", "  et sa fin.", "- Un autre.", "", "Un paragraphe", "sur deux lignes.", "", "### Titre", "Texte.", "```sh", "node a", "node b", "```", "| a | b |", "| - | - |"].join("\n");
    expect(unwrapMarkdown(text)).toBe(
      ["- **Un titre.** Le début d'une phrase et sa fin.", "- Un autre.", "", "Un paragraphe sur deux lignes.", "", "### Titre", "Texte.", "```sh", "node a", "node b", "```", "| a | b |", "| - | - |"].join("\n"),
    );
  });

  it("la version du paquet a sa section dans CHANGELOG.md : sans elle, la publication s'arrête", () => {
    expect(changelogSection(changelog, pkg.version)).toBeTruthy();
  });

  it("le paquet dit depuis quelle version il se met à jour directement", () => {
    expect(parseVersion(pkg.pecule?.depuis)).not.toBeNull();
    expect(compareVersions(pkg.pecule!.depuis, pkg.version)).toBeLessThanOrEqual(0);
  });
});
