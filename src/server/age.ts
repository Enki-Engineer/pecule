import { createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, timingSafeEqual, type KeyObject } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/*
 * Chiffrement d'une sauvegarde au format « age » (age-encryption.org/v1, destinataire X25519), sans dépendance :
 * l'archive chiffrée se déchiffre aussi avec l'outil `age` lui-même (`age -d -i cle.txt archive.zip.age`), sans Pécule.
 *
 * Le serveur ne garde que la clé publique (« age1… ») : il sait chiffrer, pas déchiffrer. La clé de récupération
 * (« AGE-SECRET-KEY-1… ») n'est montrée qu'une fois à l'administrateur, qui la range ; sans elle, une archive
 * chiffrée est perdue.
 *
 * Format : un en-tête de texte (la clé du fichier, enveloppée pour le destinataire, puis un sceau HMAC), puis le
 * contenu découpé en morceaux de 64 Kio chiffrés chacun en ChaCha20-Poly1305, le dernier marqué comme tel — une
 * archive tronquée ne se déchiffre pas.
 */

const VERSION_LINE = "age-encryption.org/v1";
const X25519_INFO = "age-encryption.org/v1/X25519";
const CHUNK = 64 * 1024;
const TAG = 16;
/** En-têtes DER d'une clé X25519 brute (32 octets) : privée (PKCS#8) et publique (SPKI). */
const PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI = Buffer.from("302a300506032b656e032100", "hex");

export class AgeError extends Error {}

/* ---------- Bech32 (BIP-173), sans limite de longueur ---------- */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i];
  }
  return chk >>> 0;
}

const hrpExpand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >>> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

/** Regroupe des bits (8 → 5 à l'écriture, 5 → 8 à la lecture). */
function convertBits(data: Iterable<number>, from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || (acc << (to - bits)) & max) return null;
  return out;
}

function bech32Encode(hrp: string, data: Buffer): string {
  const words = convertBits(data, 8, 5, true)!;
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join("")}`;
}

function bech32Decode(text: string): { hrp: string; data: Buffer } | null {
  // Tout en minuscules ou tout en capitales, jamais un mélange.
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return null;
  const s = text.toLowerCase();
  const at = s.lastIndexOf("1");
  if (at < 1 || at + 7 > s.length) return null;
  const hrp = s.slice(0, at);
  const words = [...s.slice(at + 1)].map((c) => CHARSET.indexOf(c));
  if (words.some((w) => w < 0) || polymod([...hrpExpand(hrp), ...words]) !== 1) return null;
  const bytes = convertBits(words.slice(0, -6), 5, 8, false);
  return bytes ? { hrp, data: Buffer.from(bytes) } : null;
}

/* ---------- Clés ---------- */

const RECIPIENT_HRP = "age";
const IDENTITY_HRP = "age-secret-key-";

const publicKeyOf = (raw: Buffer): KeyObject => createPublicKey({ key: Buffer.concat([SPKI, raw]), format: "der", type: "spki" });
const privateKeyOf = (raw: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8, raw]), format: "der", type: "pkcs8" });
const rawPublic = (key: KeyObject): Buffer => Buffer.from(key.export({ format: "der", type: "spki" })).subarray(-32);
const rawPrivate = (key: KeyObject): Buffer => Buffer.from(key.export({ format: "der", type: "pkcs8" })).subarray(-32);

/** Octets de la clé publique d'un destinataire « age1… » ; `AgeError` si ce n'en est pas un. */
function recipientBytes(recipient: string): Buffer {
  const d = bech32Decode(recipient.trim());
  if (!d || d.hrp !== RECIPIENT_HRP || d.data.length !== 32) throw new AgeError("Clé publique invalide : elle commence par « age1 » et se recopie en entier");
  return d.data;
}

function identityBytes(identity: string): Buffer {
  const d = bech32Decode(identity.trim());
  if (!d || d.hrp !== IDENTITY_HRP || d.data.length !== 32) throw new AgeError("Clé de récupération invalide : elle commence par « AGE-SECRET-KEY-1 » et se recopie en entier");
  return d.data;
}

/** Vrai si le texte est une clé publique age (« age1… ») bien formée. */
export function isRecipient(text: string): boolean {
  try {
    recipientBytes(text);
    return true;
  } catch {
    return false;
  }
}

/** Une paire de clés neuve : la clé de récupération (à ne montrer qu'une fois) et sa clé publique. */
export function generateIdentity(): { identity: string; recipient: string } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return { identity: bech32Encode(IDENTITY_HRP, rawPrivate(privateKey)).toUpperCase(), recipient: bech32Encode(RECIPIENT_HRP, rawPublic(publicKey)) };
}

/** Clé publique d'une clé de récupération. */
export function recipientOf(identity: string): string {
  return bech32Encode(RECIPIENT_HRP, rawPublic(createPublicKey(privateKeyOf(identityBytes(identity)))));
}

/* ---------- Format ---------- */

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");
const unb64 = (s: string): Buffer | null => (/^[A-Za-z0-9+/]*$/.test(s) && s.length % 4 !== 1 ? Buffer.from(s, "base64") : null);
const hkdf = (ikm: Buffer, salt: Buffer, info: string) => Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));
const ZERO_NONCE = Buffer.alloc(12);

/** Nonce d'un morceau : son rang sur 11 octets, puis 1 pour le dernier. */
function chunkNonce(counter: number, last: boolean): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeUIntBE(Math.floor(counter / 0x100000000), 3, 4);
  nonce.writeUInt32BE(counter >>> 0, 7);
  nonce[11] = last ? 1 : 0;
  return nonce;
}

function seal(key: Buffer, nonce: Buffer, plain: Buffer): Buffer {
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG });
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

function open(key: Buffer, nonce: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < TAG) throw new AgeError("Archive chiffrée abîmée ou incomplète");
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG });
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG)), decipher.final()]);
  } catch {
    throw new AgeError("Archive chiffrée abîmée ou incomplète");
  }
}

const headerMac = (fileKey: Buffer, header: string) => createHmac("sha256", hkdf(fileKey, Buffer.alloc(0), "header")).update(header).digest();

/** Vrai si ces premiers octets sont ceux d'un fichier chiffré au format age. */
export const looksEncrypted = (head: Buffer) => head.subarray(0, VERSION_LINE.length).toString("latin1") === VERSION_LINE;

/**
 * Flux de chiffrement pour un destinataire (« age1… ») : ce qu'on y écrit en ressort chiffré, en-tête d'abord.
 * La clé du fichier est tirée au hasard et enveloppée pour le destinataire : seul le détenteur de sa clé de
 * récupération la retrouve.
 */
export function encryptStream(recipient: string): Transform {
  const theirs = recipientBytes(recipient);
  const fileKey = randomBytes(16);
  const ephemeral = generateKeyPairSync("x25519");
  const share = rawPublic(ephemeral.publicKey);
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKeyOf(theirs) });
  const wrapped = seal(hkdf(shared, Buffer.concat([share, theirs]), X25519_INFO), ZERO_NONCE, fileKey);
  const head = `${VERSION_LINE}\n-> X25519 ${b64(share)}\n${b64(wrapped)}\n---`;
  const nonce = randomBytes(16);
  const key = hkdf(fileKey, nonce, "payload");

  let pending: Buffer = Buffer.alloc(0);
  let counter = 0;
  let started = false;
  const start = (t: Transform) => {
    if (started) return;
    started = true;
    t.push(Buffer.from(`${head} ${b64(headerMac(fileKey, head))}\n`));
    t.push(nonce);
  };
  return new Transform({
    transform(data: Buffer, _enc, done: TransformCallback) {
      start(this);
      pending = pending.length ? Buffer.concat([pending, data]) : data;
      // Un morceau n'est écrit que s'il en reste après lui : le dernier doit porter sa marque.
      while (pending.length > CHUNK) {
        this.push(seal(key, chunkNonce(counter++, false), pending.subarray(0, CHUNK)));
        pending = pending.subarray(CHUNK);
      }
      done();
    },
    flush(done: TransformCallback) {
      start(this);
      this.push(seal(key, chunkNonce(counter, true), pending));
      done();
    },
  });
}

/** Lit l'en-tête d'un fichier age et rend la clé du fichier, avec la clé de récupération donnée. */
function unwrapFileKey(header: string, identity: Buffer): Buffer {
  const lines = header.split("\n");
  if (lines[0] !== VERSION_LINE) throw new AgeError("Ce fichier n'est pas une archive chiffrée par Pécule");
  const end = lines.findIndex((l) => l.startsWith("---"));
  const mac = unb64(lines[end].slice(4));
  const mine = privateKeyOf(identity);
  const ours = rawPublic(createPublicKey(mine));
  let fileKey: Buffer | null = null;
  for (let i = 1; i < end && !fileKey; i++) {
    const m = /^-> X25519 ([A-Za-z0-9+/]+)$/.exec(lines[i]);
    const share = m ? unb64(m[1]) : null;
    const body = unb64(lines[i + 1] ?? "");
    if (!share || share.length !== 32 || !body || body.length !== 32) continue;
    try {
      const shared = diffieHellman({ privateKey: mine, publicKey: publicKeyOf(share) });
      fileKey = open(hkdf(shared, Buffer.concat([share, ours]), X25519_INFO), ZERO_NONCE, body);
    } catch {
      // Enveloppe destinée à une autre clé.
    }
  }
  if (!fileKey || fileKey.length !== 16) throw new AgeError("Cette clé de récupération n'ouvre pas cette archive");
  const expected = headerMac(fileKey, lines.slice(0, end).concat("---").join("\n"));
  if (!mac || mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw new AgeError("Archive chiffrée abîmée (en-tête modifié)");
  return fileKey;
}

/** Flux de déchiffrement avec une clé de récupération (« AGE-SECRET-KEY-1… ») : `AgeError` si elle n'ouvre pas l'archive, ou si l'archive est abîmée ou tronquée. */
export function decryptStream(identity: string): Transform {
  const mine = identityBytes(identity);
  let pending: Buffer = Buffer.alloc(0);
  let key: Buffer | null = null;
  let counter = 0;

  /** L'en-tête et le nonce sont-ils là en entier ? Alors la clé du contenu est prête. */
  const readHeader = () => {
    const text = pending.subarray(0, 16_384).toString("latin1");
    const at = text.search(/^---.*\n/m);
    if (at < 0) {
      if (pending.length > 16_384 || (pending.length >= VERSION_LINE.length && !looksEncrypted(pending))) throw new AgeError("Ce fichier n'est pas une archive chiffrée par Pécule");
      return;
    }
    const end = text.indexOf("\n", at) + 1;
    if (pending.length < end + 16) return;
    const fileKey = unwrapFileKey(text.slice(0, end - 1), mine);
    key = hkdf(fileKey, pending.subarray(end, end + 16), "payload");
    pending = pending.subarray(end + 16);
  };

  return new Transform({
    transform(data: Buffer, _enc, done: TransformCallback) {
      try {
        pending = pending.length ? Buffer.concat([pending, data]) : data;
        if (!key) readHeader();
        // Le dernier morceau attend la fin du flux : lui seul porte la marque de fin.
        while (key && pending.length > CHUNK + TAG) {
          this.push(open(key, chunkNonce(counter++, false), pending.subarray(0, CHUNK + TAG)));
          pending = pending.subarray(CHUNK + TAG);
        }
        done();
      } catch (e) {
        done(e as Error);
      }
    },
    flush(done: TransformCallback) {
      try {
        if (!key) throw new AgeError("Archive chiffrée incomplète");
        const last = open(key, chunkNonce(counter, true), pending);
        // Un dernier morceau vide n'est permis que pour un contenu vide.
        if (!last.length && counter > 0) throw new AgeError("Archive chiffrée abîmée ou incomplète");
        this.push(last);
        done();
      } catch (e) {
        done(e as Error);
      }
    },
  });
}
