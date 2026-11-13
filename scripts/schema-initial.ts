/**
 * Écrit le schéma de départ d'une installation neuve (`drizzle/initial/schema.sql`) : la structure complète
 * de la base telle que la laissent toutes les migrations du dépôt, en un seul fichier. Sur une base vide,
 * Pécule applique ce fichier au lieu de rejouer chaque migration depuis la première.
 *
 * À relancer après chaque nouvelle migration (un test échoue sinon) :
 *   pnpm local base && pnpm db:initial
 * Le script travaille dans deux bases jetables de la base locale (compose.dev.yaml) : l'une construite par les
 * migrations, l'autre par le schéma écrit, et il vérifie que les deux sont identiques, table par table.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const ROOT = process.env.SCHEMA_DB_ROOT ?? "mysql://root:pecule-local@127.0.0.1:3316";
const A = "pecule_schema_migrations";
const B = "pecule_schema_initial";
process.env.DATABASE_URL = `${ROOT}/${A}`;
process.env.APP_URL ??= "http://localhost:3000";
process.env.API_TOKEN ??= "schema-initial-jeton-administration-0123456789";
process.env.SYNC_TOKEN ??= "schema-initial-jeton-synchronisation-0123456789";

const root = await mysql.createConnection({ uri: ROOT, multipleStatements: true });
await root.query(`DROP DATABASE IF EXISTS ${A}; DROP DATABASE IF EXISTS ${B}; CREATE DATABASE ${A}; CREATE DATABASE ${B}`);

const { migrate, migrationFiles, foldedMigrations, initialSchema, endPools } = await import("../src/server/db.ts");
const { portableView, schemaSql, schemaStatements, sqlIdent } = await import("../src/server/backup-format.ts");

// Base A : toutes les migrations, depuis la première (jamais le schéma de départ lui-même). Dans un dépôt dont
// l'histoire est repliée (`drizzle/initial/incluses.txt`), les premières ne sont plus là : A part alors du schéma
// de départ en place, complété par les migrations écrites depuis.
const folded = foldedMigrations().length > 0;
if (!folded) process.env.PECULE_SANS_SCHEMA_DE_DEPART = "1";
const applied = await migrate();
const last = migrationFiles().at(-1)?.name ?? initialSchema()!.upTo;
console.log(`A : ${applied.length} ${folded ? "étape(s) depuis le schéma de départ en place" : "migrations rejouées"}, la dernière : ${last}`);

type Row = Record<string, string>;
const structure = async (db: string) => {
  const [objects] = await root.query<mysql.RowDataPacket[]>("SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = ? AND table_name <> '_migrations' ORDER BY table_type, table_name", [db]);
  const out: { label: string; sql: string }[] = [];
  for (const o of objects) {
    const view = o.type === "VIEW";
    const [[r]] = (await root.query(`SHOW CREATE ${view ? "VIEW" : "TABLE"} ${sqlIdent(db)}.${sqlIdent(o.name)}`)) as unknown as [Row[]];
    const sql = view ? portableView(r["Create View"], db) : r["Create Table"].replace(/ AUTO_INCREMENT=\d+/, "");
    out.push({ label: `${view ? "vue" : "table"} ${o.name}`, sql });
  }
  return out;
};

const creates = await structure(A);
const text = schemaSql(`Pécule — schéma de départ d'une installation neuve. Écrit par \`pnpm db:initial\`, ne pas modifier à la main.\n-- inclut-jusqu-a: ${last}`, creates);
mkdirSync("drizzle/initial", { recursive: true });
writeFileSync("drizzle/initial/schema.sql", text);
console.log(`écrit : drizzle/initial/schema.sql (${creates.filter((c) => c.label.startsWith("table")).length} tables, ${creates.filter((c) => c.label.startsWith("vue")).length} vue(s))`);

// Base B : le schéma écrit, rejoué tel quel ; elle doit être identique à A.
const b = await mysql.createConnection({ uri: `${ROOT}/${B}` });
for (const sql of schemaStatements(text)) await b.query(sql);
await b.end();
const again = await structure(B);
const differences = creates.filter((c, i) => again[i]?.label !== c.label || again[i]?.sql !== c.sql).map((c) => c.label);
await root.query(`DROP DATABASE ${A}; DROP DATABASE ${B}`);
await root.end();
await endPools();
if (again.length !== creates.length || differences.length) {
  console.error(`✗ le schéma de départ ne redonne pas la même base : ${differences.join(", ") || "nombre d'objets différent"}`);
  process.exit(1);
}
console.log("✓ une base construite par le schéma de départ est identique à une base construite par les migrations");
