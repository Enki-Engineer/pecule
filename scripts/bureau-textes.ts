// Fabrique `bureau/src-tauri/textes.json` : les mots de la coque de l'appli de bureau, dans chaque langue de Pécule,
// tirés des dictionnaires de l'appli (`src/lib/desktop-texts.ts`). À relancer quand un de ces textes change :
//
//   pnpm exec tsx scripts/bureau-textes.ts
import { writeFileSync } from "node:fs";
import { registerDict } from "../src/lib/i18n.ts";
import { shellTextsFile } from "../src/lib/desktop-texts.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { it } from "../src/i18n/it.ts";

registerDict("en", en);
registerDict("de", de);
registerDict("it", it);
registerDict("es", es);
const file = new URL("../bureau/src-tauri/textes.json", import.meta.url);
writeFileSync(file, shellTextsFile());
console.log(`✓ ${file.pathname}`);
