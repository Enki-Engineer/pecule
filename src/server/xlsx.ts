/*
 * Lecture d'un classeur Excel (.xlsx) déposé par un membre : les lignes de sa première feuille, en texte. Sans
 * paquet : un classeur est une archive zip de fichiers XML, décompressée par node:zlib. Le fichier vient de
 * l'extérieur — tailles bornées, aucune entité XML développée, rien d'autre que la feuille et ses textes n'est lu.
 */

import { inflateRawSync } from "node:zlib";

/** Taille décompressée au-delà de laquelle une feuille n'est pas lue : un relevé de particulier tient très en dessous. */
const MAX_ENTRY = 40_000_000;
const MAX_ROWS = 200_000;

type Entry = { name: string; method: number; size: number; packed: number; offset: number };

/** Fichiers de l'archive, d'après son répertoire central (les tailles n'y manquent jamais, contrairement aux en-têtes locaux). */
function entries(zip: Buffer): Entry[] {
  // La fin du répertoire central est dans les 65 557 derniers octets (22 + un commentaire de 65 535 au plus).
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("archive illisible");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw new Error("archive illisible");
    const nameLength = zip.readUInt16LE(at + 28);
    out.push({
      name: zip.toString("utf8", at + 46, at + 46 + nameLength),
      method: zip.readUInt16LE(at + 10),
      packed: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      offset: zip.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return out;
}

function read(zip: Buffer, entry: Entry): string {
  if (entry.size > MAX_ENTRY || entry.packed === 0xffffffff) throw new Error("classeur trop grand");
  const at = entry.offset;
  if (at + 30 > zip.length || zip.readUInt32LE(at) !== 0x04034b50) throw new Error("archive illisible");
  const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
  const packed = zip.subarray(start, start + entry.packed);
  if (entry.method === 0) return packed.toString("utf8");
  if (entry.method !== 8) throw new Error("compression non reconnue");
  return inflateRawSync(packed, { maxOutputLength: MAX_ENTRY }).toString("utf8");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** Les cinq entités de XML et les caractères écrits par leur numéro ; toute autre entité reste telle quelle. */
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (all, code: string) => {
    if (code[0] !== "#") return ENTITIES[code];
    const point = code[1] === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : all;
  });

/** Texte d'un élément qui porte des `<t>` (texte simple, ou texte en plusieurs morceaux de mise en forme). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join("");

/** Rang d'une colonne d'après ses lettres : A → 0, Z → 25, AA → 26. */
const column = (letters: string) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

/**
 * Lignes de la première feuille d'un classeur, chaque cellule en texte à la place de sa colonne (une cellule vide
 * donne ""). Un nombre est rendu tel que le classeur l'écrit ("0.0125", "1.2E-7"). Lève une erreur si le fichier
 * n'est pas un classeur lisible.
 */
export function readXlsxRows(file: Buffer): string[][] {
  if (file.length < 22 || file.readUInt32LE(0) !== 0x04034b50) throw new Error("ce n'est pas un classeur Excel");
  const list = entries(file);
  const sheet = list.filter((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))[0];
  if (!sheet) throw new Error("classeur sans feuille");
  const sharedEntry = list.find((e) => e.name === "xl/sharedStrings.xml");
  const shared = sharedEntry ? [...read(file, sharedEntry).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const rows: string[][] = [];
  for (const row of read(file, sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_ROWS) throw new Error("classeur trop grand");
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]{1,3})\d+"/.exec(c[1]);
      const type = /\bt="(\w+)"/.exec(c[1])?.[1] ?? "n";
      const body = c[2] ?? "";
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      const text = type === "s" ? (shared[Number(value)] ?? "") : type === "inlineStr" ? textOf(body) : unescape(value);
      const at = ref ? column(ref[1]) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = text;
    }
    rows.push(cells);
  }
  return rows;
}
