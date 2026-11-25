import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/*
 * Empreinte d'un mot de passe (scrypt de Node, sans dépendance), à part de la base pour s'essayer seule. Elle porte
 * ses réglages et son sel — « scrypt$15$8$3$<sel>$<empreinte> » — : on pourra les durcir sans rendre illisibles les
 * mots de passe d'avant.
 */

/** Réglages scrypt : coût 2^15, blocs de 8, trois passes — 32 Mo de mémoire par calcul, une centaine de millisecondes. */
const COST = 15;
const BLOCK = 8;
const PASSES = 3;
const KEY_BYTES = 32;
function derive(password: string, salt: Buffer, cost: number, block: number, passes: number, bytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    // NFKC : un même mot de passe tapé sur deux claviers (lettre accentuée d'une pièce ou composée) donne la même empreinte.
    scrypt(password.normalize("NFKC"), salt, bytes, { N: 2 ** cost, r: block, p: passes, maxmem: 256 * 2 ** cost * block }, (e, key) => (e ? reject(e) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST, BLOCK, PASSES, KEY_BYTES);
  return `scrypt$${COST}$${BLOCK}$${PASSES}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, cost, block, passes, salt, key] = stored.split("$");
  if (kind !== "scrypt" || !salt || !key) return false;
  const [n, r, p] = [Number(cost), Number(block), Number(passes)];
  // Des réglages illisibles ou démesurés ne lancent aucun calcul.
  if (!Number.isInteger(n) || n < 10 || n > 20 || !Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 8) return false;
  const expected = Buffer.from(key, "base64url");
  const got = await derive(password, Buffer.from(salt, "base64url"), n, r, p, expected.length || KEY_BYTES).catch(() => null);
  return !!got && got.length === expected.length && timingSafeEqual(got, expected);
}
