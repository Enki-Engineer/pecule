import { open } from "node:fs/promises";
import { promisify } from "node:util";
import { crc32, deflateRaw, inflateRaw } from "node:zlib";

/*
 * Archive zip, sans dépendance : écriture au fil de l'eau (chaque fichier est connu en entier avant
 * d'être écrit : taille et contrôle dans son en-tête, donc lisible par tous les outils) et lecture
 * par le répertoire central. Zip64 dès que l'archive dépasse 4 Go ou 65 535 fichiers ; un fichier
 * seul reste sous 4 Go. Noms en UTF-8.
 */

const deflate = promisify(deflateRaw);
const inflate = promisify(inflateRaw);

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const LOCATOR64 = 0x07064b50;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
/** Drapeau « nom en UTF-8 ». */
const UTF8 = 0x0800;

export type ZipEntry = { name: string; size: number; compressedSize: number; crc: number; method: 0 | 8; offset: number };

/** Date et heure au format DOS (à la seconde paire près). */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  private entries: ZipEntry[] = [];
  private offset = 0;
  private readonly stamp: { time: number; date: number };

  /** `zip64` force les enregistrements Zip64 (tests) ; sinon ils ne sont écrits que s'il le faut. */
  constructor(private readonly opts: { date?: Date; zip64?: boolean } = {}) {
    this.stamp = dosDateTime(opts.date ?? new Date());
  }

  /** Octets écrits jusqu'ici (en-têtes compris). */
  get bytes(): number {
    return this.offset;
  }

  /**
   * Un fichier de l'archive : renvoie les octets à écrire à la suite (en-tête puis contenu).
   * `store` : pas de compression (PDF, images) ; sinon compressé seulement si cela fait gagner de la place.
   */
  async file(name: string, data: Buffer, opts: { store?: boolean } = {}): Promise<Buffer[]> {
    if (data.length >= MAX32) throw new Error(`Fichier trop gros pour l'archive : ${name}`);
    const nameBytes = Buffer.from(name, "utf8");
    if (!nameBytes.length || nameBytes.length > MAX16) throw new Error(`Nom de fichier invalide dans l'archive : ${name}`);
    let body = data;
    let method: 0 | 8 = 0;
    if (!opts.store && data.length) {
      const packed = await deflate(data);
      if (packed.length < data.length) {
        body = packed;
        method = 8;
      }
    }
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(LOCAL, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(UTF8, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(this.stamp.time, 10);
    head.writeUInt16LE(this.stamp.date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    head.writeUInt16LE(0, 28);
    this.entries.push({ name, size: data.length, compressedSize: body.length, crc, method, offset: this.offset });
    this.offset += head.length + nameBytes.length + body.length;
    return [head, nameBytes, body];
  }

  /** Fin de l'archive : répertoire central et enregistrements de fin, à écrire en dernier. */
  end(): Buffer {
    const parts: Buffer[] = [];
    for (const e of this.entries) {
      const nameBytes = Buffer.from(e.name, "utf8");
      const far = this.opts.zip64 || e.offset >= MAX32;
      const extra = Buffer.alloc(far ? 12 : 0);
      if (far) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(8, 2);
        extra.writeBigUInt64LE(BigInt(e.offset), 4);
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(CENTRAL, 0);
      h.writeUInt16LE((3 << 8) | (far ? 45 : 20), 4);
      h.writeUInt16LE(far ? 45 : 20, 6);
      h.writeUInt16LE(UTF8, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(this.stamp.time, 12);
      h.writeUInt16LE(this.stamp.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressedSize, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(nameBytes.length, 28);
      h.writeUInt16LE(extra.length, 30);
      // Fichier ordinaire, lecture pour tous, écriture pour son propriétaire (attributs Unix).
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      h.writeUInt32LE(far ? MAX32 : e.offset, 42);
      parts.push(h, nameBytes, extra);
    }
    const dirSize = parts.reduce((n, p) => n + p.length, 0);
    const dirOffset = this.offset;
    const count = this.entries.length;
    if (this.opts.zip64 || count >= MAX16 || dirSize >= MAX32 || dirOffset >= MAX32) {
      const end64 = Buffer.alloc(56);
      end64.writeUInt32LE(END64, 0);
      end64.writeBigUInt64LE(44n, 4);
      end64.writeUInt16LE((3 << 8) | 45, 12);
      end64.writeUInt16LE(45, 14);
      end64.writeBigUInt64LE(BigInt(count), 24);
      end64.writeBigUInt64LE(BigInt(count), 32);
      end64.writeBigUInt64LE(BigInt(dirSize), 40);
      end64.writeBigUInt64LE(BigInt(dirOffset), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(LOCATOR64, 0);
      locator.writeBigUInt64LE(BigInt(dirOffset + dirSize), 8);
      locator.writeUInt32LE(1, 16);
      parts.push(end64, locator);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    end.writeUInt16LE(Math.min(count, MAX16), 8);
    end.writeUInt16LE(Math.min(count, MAX16), 10);
    end.writeUInt32LE(Math.min(dirSize, MAX32), 12);
    end.writeUInt32LE(Math.min(dirOffset, MAX32), 16);
    parts.push(end);
    const out = Buffer.concat(parts);
    this.offset += out.length;
    return out;
  }
}

/** Accès direct aux octets d'une archive (fichier ou mémoire). */
export type ZipSource = { size: number; read(position: number, length: number): Promise<Buffer>; close?(): Promise<void> };

export const bufferSource = (buf: Buffer): ZipSource => ({ size: buf.length, read: async (p, n) => buf.subarray(p, p + n) });

export async function fileSource(file: string): Promise<ZipSource> {
  const fd = await open(file, "r");
  const { size } = await fd.stat();
  return {
    size,
    async read(position, length) {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buf, 0, length, position);
      return buf.subarray(0, bytesRead);
    },
    close: () => fd.close(),
  };
}

export class ZipError extends Error {}

/**
 * Bornes de lecture. Les tailles écrites dans une archive ne sont que ce qu'elle annonce : une archive piégée peut
 * annoncer n'importe quoi, et chaque taille annoncée devient une réservation de mémoire. Une entrée d'une sauvegarde
 * de Pécule pèse au plus quelques dizaines de Mo (un fichier du coffre, une tranche de table).
 */
const MAX_ENTRY = 256 * 1024 * 1024;
const MAX_DIRECTORY = 64 * 1024 * 1024;

/** Lit le répertoire central d'une archive ; `extract` rend le contenu d'un fichier, contrôle (CRC) compris. */
export async function readZip(src: ZipSource): Promise<{ entries: ZipEntry[]; extract(entry: ZipEntry): Promise<Buffer> }> {
  const tailSize = Math.min(src.size, 22 + MAX16);
  const tail = await src.read(src.size - tailSize, tailSize);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === END && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
      at = i;
      break;
    }
  if (at < 0) throw new ZipError("Archive incomplète ou illisible (fin du zip introuvable)");
  let count = tail.readUInt16LE(at + 10);
  let dirSize = tail.readUInt32LE(at + 12);
  let dirOffset = tail.readUInt32LE(at + 16);
  if (count === MAX16 || dirSize === MAX32 || dirOffset === MAX32) {
    const locatorAt = src.size - tailSize + at - 20;
    const locator = locatorAt >= 0 ? await src.read(locatorAt, 20) : Buffer.alloc(0);
    if (locator.length < 20 || locator.readUInt32LE(0) !== LOCATOR64) throw new ZipError("Archive illisible (repère Zip64 absent)");
    const end64 = await src.read(Number(locator.readBigUInt64LE(8)), 56);
    if (end64.length < 56 || end64.readUInt32LE(0) !== END64) throw new ZipError("Archive illisible (fin Zip64 absente)");
    count = Number(end64.readBigUInt64LE(32));
    dirSize = Number(end64.readBigUInt64LE(40));
    dirOffset = Number(end64.readBigUInt64LE(48));
  }
  // Le répertoire tient dans le fichier, et chaque entrée y occupe au moins 46 octets.
  if (!Number.isSafeInteger(dirSize) || !Number.isSafeInteger(dirOffset) || dirSize > MAX_DIRECTORY || dirOffset + dirSize > src.size || count > dirSize / 46)
    throw new ZipError("Archive illisible (répertoire central incohérent)");
  const dir = await src.read(dirOffset, dirSize);
  if (dir.length < dirSize) throw new ZipError("Archive incomplète (répertoire central tronqué)");
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.length || dir.readUInt32LE(p) !== CENTRAL) throw new ZipError("Archive illisible (répertoire central abîmé)");
    const method = dir.readUInt16LE(p + 10);
    if (method !== 0 && method !== 8) throw new ZipError(`Compression non prise en charge (${method})`);
    const nameLen = dir.readUInt16LE(p + 28);
    const extraLen = dir.readUInt16LE(p + 30);
    const commentLen = dir.readUInt16LE(p + 32);
    let size = dir.readUInt32LE(p + 24);
    let compressedSize = dir.readUInt32LE(p + 20);
    let offset = dir.readUInt32LE(p + 42);
    const name = dir.toString("utf8", p + 46, p + 46 + nameLen);
    // Champ Zip64 : ne porte que les valeurs marquées 0xFFFFFFFF, dans l'ordre taille, taille compressée, position.
    const extraEnd = p + 46 + nameLen + extraLen;
    for (let x = p + 46 + nameLen; x + 4 <= extraEnd; ) {
      const id = dir.readUInt16LE(x);
      const len = dir.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let v = x + 4;
        if (size === MAX32) (size = Number(dir.readBigUInt64LE(v))), (v += 8);
        if (compressedSize === MAX32) (compressedSize = Number(dir.readBigUInt64LE(v))), (v += 8);
        if (offset === MAX32) offset = Number(dir.readBigUInt64LE(v));
      }
      x += 4 + len;
    }
    // Une entrée ne peut pas être plus longue que le fichier qui la porte, ni se décompresser sans borne.
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(compressedSize) || !Number.isSafeInteger(offset) || compressedSize > src.size || offset > src.size || size > MAX_ENTRY)
      throw new ZipError(`Archive illisible (taille incohérente : ${name.slice(0, 80)})`);
    entries.push({ name, size, compressedSize, crc: dir.readUInt32LE(p + 16), method, offset });
    p = extraEnd + commentLen;
  }
  return {
    entries,
    async extract(e) {
      const head = await src.read(e.offset, 30);
      if (head.length < 30 || head.readUInt32LE(0) !== LOCAL) throw new ZipError(`Archive abîmée : ${e.name}`);
      const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const raw = await src.read(start, e.compressedSize);
      if (raw.length !== e.compressedSize) throw new ZipError(`Archive incomplète : ${e.name}`);
      // Bornée à la taille annoncée : une entrée qui se décompresse en plus que prévu est refusée (archive piégée).
      const data = e.method === 8 ? await inflate(raw, { maxOutputLength: Math.max(1, e.size) }) : raw;
      if (data.length !== e.size || crc32(data) !== e.crc) throw new ZipError(`Fichier abîmé dans l'archive : ${e.name}`);
      return data;
    },
  };
}
