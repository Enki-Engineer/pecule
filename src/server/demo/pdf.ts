import { createHash } from "node:crypto";

/*
 * PDF minimal d'une page (Helvetica, encodage WinAnsi) pour les documents et factures de la démo :
 * titre, lignes de texte, mention « document fictif » en pied de page. Aucune dépendance.
 */

const WIN_ANSI: Record<string, number> = {
  "€": 0x80,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "–": 0x96,
  "—": 0x97,
  "œ": 0x9c,
  "Œ": 0x8c,
  "\u202f": 0x20,
  "\u00a0": 0x20,
};

/** Texte d'une chaîne PDF : caractères WinAnsi (un octet chacun), parenthèses et barres échappées. */
function pdfString(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63;
    out += WIN_ANSI[ch] != null ? String.fromCharCode(WIN_ANSI[ch]) : c < 0x7f || (c >= 0xa0 && c <= 0xff) ? ch : "?";
  }
  return out.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(line: string, width = 95): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let cur = "";
  for (const w of line.split(" ")) {
    if (cur && `${cur} ${w}`.length > width) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

export type DemoFile = { content: Buffer; size: number; sha256: string; text: string };

export function demoPdf(title: string, lines: string[]): DemoFile {
  const body = ["BT", "/F2 15 Tf", "50 790 Td", `(${pdfString(title)}) Tj`, "ET", "BT", "/F1 10 Tf", "14 TL", "50 760 Td"];
  const shown = lines.flatMap((l) => (l ? wrap(l) : [" "])).slice(0, 50);
  shown.forEach((l, i) => body.push(`(${pdfString(l)}) ${i === 0 ? "Tj" : "'"}`));
  body.push("ET", "BT", "/F1 8 Tf", "50 40 Td", `(${pdfString("Document fictif généré pour la démonstration de Pécule.")}) Tj`, "ET");
  const stream = body.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Une lettre = un octet (WinAnsi) : la longueur du flux et les positions de la table xref sont exactes.
  const content = Buffer.from(pdf, "latin1");
  return { content, size: content.length, sha256: createHash("sha256").update(content).digest("hex"), text: [title, ...lines].join("\n") };
}
