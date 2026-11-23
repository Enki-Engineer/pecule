import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readXlsxRows } from "./xlsx.ts";

/** Archive zip minimale : `flags` à 8 écrit les tailles après les données, comme le font les exports des applis. */
function zip(files: Record<string, string>, { stored = false, flags = 8 } = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, "utf8");
    const data = stored ? raw : deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    // Avec le drapeau 8, l'en-tête local ne dit pas les tailles : seul le répertoire central les donne.
    if (!flags) {
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
    }
    local.writeUInt16LE(Buffer.byteLength(name), 26);
    const descriptor = flags ? Buffer.alloc(16) : Buffer.alloc(0);
    locals.push(local, Buffer.from(name), data, descriptor);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(Buffer.byteLength(name), 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, Buffer.from(name));
    offset += 30 + Buffer.byteLength(name) + data.length + descriptor.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const sheet = (rows: string) => `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;

describe("readXlsxRows", () => {
  it("lit les textes écrits dans la feuille, les nombres et les cellules sautées", () => {
    const file = zip({
      "xl/sharedStrings.xml": '<sst count="0"/>',
      "xl/worksheets/sheet1.xml": sheet(
        '<row r="4"><c r="A4" t="inlineStr"><is><t>Local time</t></is></c><c r="C4" t="inlineStr"><is><t>Note &amp; d&#233;tail</t></is></c></row>' +
          '<row r="5"><c r="A5" t="inlineStr"><is><t>2026-01-02 10:00:00</t></is></c><c r="B5"><v>1.2E-7</v></c><c r="C5" s="3"/><c r="D5" t="n"><v>0.0125</v></c></row>',
      ),
    });
    expect(readXlsxRows(file)).toEqual([
      ["Local time", "", "Note & détail"],
      ["2026-01-02 10:00:00", "1.2E-7", "", "0.0125"],
    ]);
  });

  it("lit les textes partagés, en plusieurs morceaux aussi, d'une archive non compressée", () => {
    const file = zip(
      {
        "xl/worksheets/sheet2.xml": sheet('<row><c t="s"><v>0</v></c></row>'),
        "xl/worksheets/sheet1.xml": sheet('<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>0</v></c><c r="AA1" t="str"><v>a &lt; b</v></c></row>'),
        "xl/sharedStrings.xml": '<sst><si><t>Alex</t></si><si><r><t xml:space="preserve">Nan</t></r><r><t>tes</t></r></si></sst>',
      },
      { stored: true, flags: 0 },
    );
    const [row] = readXlsxRows(file);
    expect(row.slice(0, 2)).toEqual(["Nantes", "Alex"]);
    expect(row[26]).toBe("a < b");
    expect(row).toHaveLength(27);
  });

  it("refuse ce qui n'est pas un classeur", () => {
    expect(() => readXlsxRows(Buffer.from("Date,Libellé\n2026-01-01,rien\n"))).toThrow("classeur");
    expect(() => readXlsxRows(zip({ "document.txt": "bonjour" }))).toThrow("sans feuille");
    expect(() => readXlsxRows(zip({ "xl/worksheets/sheet1.xml": sheet("") }).subarray(0, 60))).toThrow();
  });
});
