import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTALL_END, INSTALL_START, installBlock, MAC_FILES, RELEASE_FILES, releaseChanges, releaseNotes } from "./release-notes.ts";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

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
    expect(rows.length).toBe(6);
    // Une barre échappée (« \| », dans une commande) n'est pas une séparation de colonnes.
    const columns = (row: string) => row.split(/(?<!\\)\|/).length;
    for (const row of rows) expect(columns(row), row).toBe(columns(rows[0]));
    // L'appli de bureau s'installe par le script de la version, et ses empreintes sont annoncées.
    expect(block).toContain(`curl -fsSL https://github.com/Enki-Engineer/pecule/releases/download/v1.33.0/${MAC_FILES.installer} \\| sh`);
    expect(block).toContain(`releases/download/v1.33.0/${MAC_FILES.sums}`);
  });

  it("l'appli de bureau est jointe à la version sous les noms que l'appli, son script et les notes attendent", () => {
    const publication = read(".github/workflows/publication.yml");
    const bureau = read(".github/workflows/bureau.yml");
    const fabriquer = read("bureau/fabriquer.mjs");
    const installer = read("bureau/pecule-mac.sh");
    for (const name of Object.values(MAC_FILES)) {
      expect(publication, `${name} : à joindre à la version`).toContain(`dist/bureau/${name}`);
      // Ce qui annonce la mise à jour est écrit à la signature, dans le flux de publication lui-même.
      if (name !== MAC_FILES.manifest) expect(bureau, `${name} : à transmettre au flux de publication`).toContain(`dist/bureau/${name}`);
      expect(fabriquer, `${name} : à fabriquer`).toContain(`"${name}"`);
    }
    // Le script d'installation prend l'appli et ses empreintes sous ces noms ; l'appli cherche ses mises à jour sous celui-ci.
    for (const name of [MAC_FILES.app, MAC_FILES.sums]) expect(installer).toContain(name);
    expect(read("bureau/src-tauri/tauri.conf.json")).toContain(`/releases/latest/download/${MAC_FILES.manifest}`);
    // La version n'est créée qu'une fois l'appli fabriquée : une version publiée ne reçoit plus de pièce jointe.
    expect(publication).toMatch(/publication:\n\s+needs: signature\n/);
    expect(publication).toMatch(/signature:\n\s+needs: bureau\n/);
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
