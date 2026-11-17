import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { AgeError, decryptStream, encryptStream, generateIdentity, isRecipient, looksEncrypted, recipientOf } from "./age.ts";

const through = (data: Buffer, t: NodeJS.ReadWriteStream) => buffer(Readable.from(data.length ? [data] : []).pipe(t));

/*
 * Vecteur écrit par l'implémentation de référence (paquet « age-encryption ») : une clé d'essai jetable, qui ne
 * protège rien, et un texte fictif chiffré pour elle. La clé est écrite en deux morceaux pour ne pas être prise pour
 * un vrai secret par les outils qui en cherchent dans le dépôt.
 */
const VECTOR = {
  identity: ["AGE-SECRET-KEY-", "1NJVGC4JCSE782XNRGWP56DCJVPZJ33MNXTXLTLP24MR0D3QSNTXSR5AQZ4"].join(""),
  recipient: "age1dg7x58d6sy55pzpf640x7kxucpjecadqm0020a4z87g07xu4ed8qtlrmjp",
  text: "Pécule — sauvegarde d'essai (famille de la démo : Alex, Camille, Léo).",
  sealed:
    "YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IFgyNTUxOSBFYyszN1ROM1hzNHN5UUJGbDMzODhCcjNxUHRENUI1elFTYlVyK1pNM2xrCjdPSHdDVHdOUTFaVnduNTR1dG9MRmE0RHJ5dENjWEZ0N2NrZ1lGUTIyQnMKLS0tIFVHOTE3ZEpRMFVJMUFSWU4zS1dldWw3SlZ0eDk4T3pURGZXQVIzSUw1ZHcKD8xUKFGlw6Nu3O+kDu9C7gDyHtAWuZguio03IzFLCHqAS0tti4eGI7BHrUkuDbvoIwwEjXRLOcZogETDYsAegYkZvSXa7y51PApm2szce7YPEo0oX1tfTsfUPq7q9jtFD7jY7LzsgiOa9K4=",
};

describe("clés age", () => {
  it("retrouve la clé publique d'une clé de récupération", () => {
    expect(recipientOf(VECTOR.identity)).toBe(VECTOR.recipient);
    const fresh = generateIdentity();
    expect(fresh.identity).toMatch(/^AGE-SECRET-KEY-1[A-Z0-9]{58}$/);
    expect(fresh.recipient).toMatch(/^age1[a-z0-9]{58}$/);
    expect(recipientOf(fresh.identity)).toBe(fresh.recipient);
  });

  it("refuse une clé publique mal recopiée", () => {
    expect(isRecipient(VECTOR.recipient)).toBe(true);
    expect(isRecipient(` ${VECTOR.recipient}\n`)).toBe(true);
    expect(isRecipient(VECTOR.recipient.replace("dg7x", "dg7y"))).toBe(false);
    expect(isRecipient(VECTOR.recipient.slice(0, -2))).toBe(false);
    expect(isRecipient(VECTOR.identity)).toBe(false);
    expect(isRecipient("")).toBe(false);
    expect(() => recipientOf(VECTOR.recipient)).toThrow(AgeError);
  });
});

describe("chiffrement age", () => {
  it("déchiffre ce que l'implémentation de référence a chiffré", async () => {
    const sealed = Buffer.from(VECTOR.sealed, "base64");
    expect(looksEncrypted(sealed)).toBe(true);
    expect((await through(sealed, decryptStream(VECTOR.identity))).toString("utf8")).toBe(VECTOR.text);
  });

  it("rend le contenu d'origine, quelle que soit sa taille", async () => {
    const { identity, recipient } = generateIdentity();
    for (const size of [0, 1, 65_535, 65_536, 65_537, 200_000]) {
      const plain = randomBytes(size);
      const sealed = await through(plain, encryptStream(recipient));
      expect(looksEncrypted(sealed)).toBe(true);
      expect((await through(sealed, decryptStream(identity))).equals(plain)).toBe(true);
    }
  });

  it("déchiffre un flux arrivé par petits bouts", async () => {
    const { identity, recipient } = generateIdentity();
    const plain = randomBytes(150_000);
    const sealed = await through(plain, encryptStream(recipient));
    const pieces: Buffer[] = [];
    for (let i = 0; i < sealed.length; i += 777) pieces.push(sealed.subarray(i, i + 777));
    expect((await buffer(Readable.from(pieces).pipe(decryptStream(identity)))).equals(plain)).toBe(true);
  });

  it("refuse une autre clé de récupération", async () => {
    const sealed = Buffer.from(VECTOR.sealed, "base64");
    await expect(through(sealed, decryptStream(generateIdentity().identity))).rejects.toThrow("n'ouvre pas cette archive");
  });

  it("refuse une archive tronquée ou modifiée", async () => {
    const { identity, recipient } = generateIdentity();
    const sealed = await through(randomBytes(150_000), encryptStream(recipient));
    // Coupée à la fin d'un morceau entier : sans la marque de fin, ce n'est pas l'archive.
    const header = sealed.indexOf("\n", sealed.indexOf("\n---")) + 1 + 16;
    await expect(through(sealed.subarray(0, header + 65_536 + 16), decryptStream(identity))).rejects.toThrow(AgeError);
    await expect(through(sealed.subarray(0, sealed.length - 10), decryptStream(identity))).rejects.toThrow(AgeError);
    const changed = Buffer.from(sealed);
    changed[changed.length - 100] ^= 1;
    await expect(through(changed, decryptStream(identity))).rejects.toThrow(AgeError);
    await expect(through(Buffer.from("PK\u0003\u0004 un zip en clair"), decryptStream(identity))).rejects.toThrow(AgeError);
  });

  it("ne prend pas un zip pour une archive chiffrée", () => {
    expect(looksEncrypted(Buffer.from("PK\u0003\u0004"))).toBe(false);
  });
});
