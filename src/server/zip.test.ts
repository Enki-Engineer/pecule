import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bufferSource, fileSource, readZip, ZipError, ZipWriter } from "./zip.ts";

const FILES: [name: string, data: Buffer, store?: boolean][] = [
  ["LISEZ-MOI.txt", Buffer.from("Sauvegarde de Pécule — données de la famille.\n".repeat(200))],
  ["fichiers/factures/2026/000012 - Été à Angers — reçu n°4.pdf", randomBytes(70_000), true],
  ["base/donnees/vide.sql", Buffer.alloc(0)],
  ["fichiers/logos/d_amazon.fr.png", randomBytes(3_000)],
];

async function build(opts?: { zip64?: boolean }): Promise<Buffer> {
  const zip = new ZipWriter({ date: new Date(2026, 10, 12, 15, 30, 10), ...opts });
  const out: Buffer[] = [];
  for (const [name, data, store] of FILES) out.push(...(await zip.file(name, data, { store })));
  out.push(zip.end());
  const buf = Buffer.concat(out);
  expect(zip.bytes).toBe(buf.length);
  return buf;
}

describe("archive zip", () => {
  it("écrit puis relit les mêmes fichiers", async () => {
    const zip = await readZip(bufferSource(await build()));
    expect(zip.entries.map((e) => e.name)).toEqual(FILES.map((f) => f[0]));
    for (const [i, e] of zip.entries.entries()) expect((await zip.extract(e)).equals(FILES[i][1])).toBe(true);
  });

  it("compresse le texte, garde tel quel ce qui est demandé ou ne gagne rien", async () => {
    const { entries } = await readZip(bufferSource(await build()));
    expect(entries[0].method).toBe(8);
    expect(entries[0].compressedSize).toBeLessThan(entries[0].size / 10);
    expect(entries[1].method).toBe(0);
    // Octets aléatoires : la compression ne gagne rien, le fichier est gardé tel quel.
    expect(entries[3].method).toBe(0);
    expect(entries[2]).toMatchObject({ size: 0, method: 0 });
  });

  it("relit une archive Zip64", async () => {
    const buf = await build({ zip64: true });
    const zip = await readZip(bufferSource(buf));
    expect(zip.entries).toHaveLength(FILES.length);
    for (const [i, e] of zip.entries.entries()) expect((await zip.extract(e)).equals(FILES[i][1])).toBe(true);
  });

  it("refuse une archive tronquée ou abîmée", async () => {
    const buf = await build();
    await expect(readZip(bufferSource(buf.subarray(0, buf.length - 40)))).rejects.toThrow(ZipError);
    const { entries } = await readZip(bufferSource(buf));
    const broken = Buffer.from(buf);
    broken[entries[1].offset + 200] ^= 0xff;
    const zip = await readZip(bufferSource(broken));
    await expect(zip.extract(zip.entries[1])).rejects.toThrow(/abîmé/);
  });

  it("refuse un nom vide", async () => {
    await expect(new ZipWriter().file("", Buffer.from("x"))).rejects.toThrow(/Nom/);
  });

  // Les outils du système lisent l'archive (ordinaire et Zip64) : unzip partout, ditto sur un Mac.
  it.skipIf(!existsSync("/usr/bin/unzip"))("est lue par unzip et par l'utilitaire du Mac", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pecule-zip-"));
    try {
      for (const zip64 of [false, true]) {
        const file = path.join(dir, zip64 ? "grand.zip" : "petit.zip");
        writeFileSync(file, await build({ zip64 }));
        expect(execFileSync("/usr/bin/unzip", ["-t", file], { encoding: "utf8" })).toMatch(/No errors detected/);
        const viaFile = await fileSource(file);
        expect((await readZip(viaFile)).entries).toHaveLength(FILES.length);
        await viaFile.close?.();
        if (existsSync("/usr/bin/ditto")) {
          const out = path.join(dir, zip64 ? "grand" : "petit");
          execFileSync("/usr/bin/ditto", ["-x", "-k", file, out]);
          expect(readFileSync(path.join(out, FILES[1][0])).equals(FILES[1][1])).toBe(true);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
