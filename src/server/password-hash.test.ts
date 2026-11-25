import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password-hash.ts";

describe("empreinte d'un mot de passe", () => {
  it("reconnaît le bon mot de passe et refuse les autres", async () => {
    const hash = await hashPassword("le chat dort sur le toit");
    expect(hash).toMatch(/^scrypt\$15\$8\$3\$[\w-]{22}\$[\w-]{43}$/);
    expect(await verifyPassword("le chat dort sur le toit", hash)).toBe(true);
    expect(await verifyPassword("le chat dort sur le toit ", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("tire un sel à chaque fois : deux empreintes du même mot de passe diffèrent", async () => {
    const [a, b] = await Promise.all([hashPassword("une phrase assez longue"), hashPassword("une phrase assez longue")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("une phrase assez longue", b)).toBe(true);
  });

  it("donne la même empreinte à une lettre accentuée, d'une pièce ou composée", async () => {
    const hash = await hashPassword("\u00e9t\u00e9 au bord de la mer");
    expect(await verifyPassword("e\u0301te\u0301 au bord de la mer", hash)).toBe(true);
  });

  it("relit une empreinte faite avec d'autres réglages, et refuse sans calcul ce qui n'en est pas une", async () => {
    // Empreinte d'un coût moindre (2^10), comme en garderait une installation d'avant un durcissement.
    const { scryptSync } = await import("node:crypto");
    const salt = Buffer.from("0123456789abcdef");
    const old = `scrypt$10$8$1$${salt.toString("base64url")}$${scryptSync("un vieux mot de passe", salt, 32, { N: 1024, r: 8, p: 1 }).toString("base64url")}`;
    expect(await verifyPassword("un vieux mot de passe", old)).toBe(true);
    expect(await verifyPassword("x", "scrypt$99$8$1$AAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$10$abc")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});
