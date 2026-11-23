import { describe, expect, it } from "vitest";
import { INSTALL_END, INSTALL_START, installBlock, RELEASE_FILES, releaseChanges, releaseNotes } from "./release-notes.ts";

const changes = "- **Docker en une commande.** Le fichier `compose.yaml` suffit.\n- Deuxième point.";

describe("notes d'une version", () => {
  it("commencent par les formats, avec l'adresse de chaque pièce jointe de la version", () => {
    const block = installBlock("1.33.0");
    for (const name of Object.values(RELEASE_FILES)) expect(block).toContain(`https://github.com/Enki-Engineer/pecule/releases/download/v1.33.0/${name}`);
    expect(block).toContain("ghcr.io/enki-engineer/pecule:1.33.0");
    expect(block).toContain("git clone -b v1.33.0 https://github.com/Enki-Engineer/pecule.git");
    expect(block).toContain("`npm create pecule`, ou ");
    // Les guides sont ceux de la version, pas ceux du travail en cours.
    expect(block).toContain("https://github.com/Enki-Engineer/pecule/blob/v1.33.0/docs/guide/installation.md");
    expect(block.startsWith(INSTALL_START)).toBe(true);
    expect(block.endsWith(INSTALL_END)).toBe(true);
    // Un tableau Markdown : chaque ligne a le même nombre de colonnes.
    const rows = block.split("\n").filter((l) => l.startsWith("|"));
    expect(rows.length).toBe(5);
    for (const row of rows) expect(row.split("|").length).toBe(rows[0].split("|").length);
  });

  it("une copie du projet annonce ses propres adresses", () => {
    const block = installBlock("2.0.0", "Alex/Mon-Pecule");
    expect(block).toContain("https://github.com/Alex/Mon-Pecule/releases/download/v2.0.0/compose.yaml");
    expect(block).toContain("ghcr.io/alex/mon-pecule:2.0.0");
    expect(block).not.toContain("Enki-Engineer");
    // L'installateur npm télécharge les versions du projet d'origine : une copie ne l'annonce pas.
    expect(block).not.toContain("npm create");
  });

  it("l'appli n'en garde que ce qui change", () => {
    const notes = releaseNotes("1.33.0", changes);
    expect(notes.startsWith(INSTALL_START)).toBe(true);
    expect(notes).toContain("## Ce qui change");
    expect(releaseChanges(notes)).toBe(changes);
    // Des notes écrites à la main, ou d'avant ce tableau, sont gardées telles quelles.
    expect(releaseChanges(`  ${changes}\n`)).toBe(changes);
    expect(releaseChanges("")).toBe("");
  });

  it("un repère de fin perdu ne vide pas les notes", () => {
    const broken = `${INSTALL_START}\ntableau\n\n${changes}`;
    expect(releaseChanges(broken)).toContain("Deuxième point.");
    expect(releaseChanges(broken)).not.toContain(INSTALL_START);
  });
});
