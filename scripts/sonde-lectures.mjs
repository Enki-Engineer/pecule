#!/usr/bin/env node
// Sonde des lectures : sur un serveur démarré, appelle chaque route de lecture avec ses réglages (scripts/sonde/lectures.mjs),
// dans les deux périmètres, puis chaque outil de lecture du serveur MCP avec des arguments fabriqués depuis son schéma.
// Elle échoue dès qu'un appel répond par une erreur du serveur.
//
// Une requête que MariaDB accepte et que MySQL 8 refuse (un regroupement par un alias qui porte le nom d'une colonne…)
// échoue sans qu'il faille une seule ligne : la sonde vaut donc sur une base vide, et les contrôles automatiques la
// passent sur chaque moteur annoncé. À lancer sur une installation d'essai : elle ne fait que lire, mais elle lit tout.
//
// Usage : node scripts/sonde-lectures.mjs --url http://127.0.0.1:3000 --jeton <API_TOKEN> [--code <SETUP_CODE>] [--json]
//   --code   crée d'abord le premier membre (installation neuve) ; sans effet s'il existe déjà.
import { lectures } from "./sonde/lectures.mjs";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (args.includes("--help") || !opt("--url") || !opt("--jeton")) {
  console.log("Usage : node scripts/sonde-lectures.mjs --url <adresse du serveur> --jeton <API_TOKEN> [--code <SETUP_CODE>] [--json]");
  process.exit(args.includes("--help") ? 0 : 2);
}
const url = opt("--url").replace(/\/$/, "");
const auth = { Authorization: `Bearer ${opt("--jeton")}` };
const fails = [];
const seen = { routes: 0, outils: 0, appels: 0 };

if (opt("--code")) await fetch(`${url}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Alex", code: opt("--code") }) }).catch(() => undefined);

// Sans accès, tout répondrait « non autorisé » et rien ne serait lu : la sonde le dit au lieu de conclure que tout va bien.
const acces = await fetch(`${url}/api/accounts`, { headers: auth }).catch(() => null);
if (!acces || acces.status === 401 || acces.status === 403) {
  console.error(`✗ sonde des lectures : ${acces ? `accès refusé (${acces.status})` : "serveur injoignable"} — vérifier --url, --jeton, et --code sur une installation neuve`);
  process.exit(2);
}

/* ---------- Routes ---------- */
const jour = new Date().toISOString().slice(0, 10);
for (const perimetre of ["foyer", "moi"])
  for (const appel of lectures(jour)) {
    const res = await fetch(`${url}/api${appel}`, { headers: { ...auth, "x-perimetre": perimetre } }).catch((e) => ({ status: 0, text: async () => String(e) }));
    seen.routes++;
    if (res.status >= 500 || res.status === 0) fails.push(`${appel} (${perimetre}) → ${res.status} ${(await res.text()).slice(0, 120)}`);
    else await res.arrayBuffer?.();
  }

/* ---------- Outils de lecture du serveur MCP ---------- */
async function mcp(method, params, again = true) {
  const res = await fetch(`${url}/api/mcp`, { method: "POST", headers: { ...auth, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  // Le serveur MCP limite les appels par minute : la sonde attend la minute suivante plutôt que de compter un refus.
  if (res.status === 429 && again) {
    await new Promise((r) => setTimeout(r, 61_000));
    return mcp(method, params, false);
  }
  const text = await res.text();
  const body = text.startsWith("{") ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? "null");
  return { status: res.status, json: JSON.parse(body) };
}
/** Valeurs à essayer pour un réglage : toutes celles d'une liste fermée, sinon une valeur plausible pour son type. */
function exemples(nom, schema) {
  if (schema.enum) return schema.enum;
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  const aide = schema.description ?? "";
  if (/^(mois|month|periode|period)$/.test(nom) || /AAAA-MM(?!-)/.test(aide)) return [jour.slice(0, 7), jour.slice(0, 4)];
  if (/(^|_)(from|to|debut|fin|date|depuis|jusqu)/.test(nom) || /AAAA-MM-JJ/.test(aide)) return [/to|fin|jusqu/.test(nom) ? jour : `${jour.slice(0, 4)}-01-01`];
  if (type === "integer" || type === "number") return [Math.max(schema.minimum ?? 1, Math.min(schema.maximum ?? 5, 5))];
  if (type === "boolean") return [true, false];
  if (type === "array") return [[]];
  if (type === "string") return ["ab"];
  return [];
}
const outils = ((await mcp("tools/list")).json?.result?.tools ?? []).filter((t) => t.annotations?.readOnlyHint);
if (!outils.length) fails.push("serveur MCP : aucun outil de lecture annoncé");
for (const outil of outils) {
  const reglages = Object.entries(outil.inputSchema?.properties ?? {});
  const requis = new Set(outil.inputSchema?.required ?? []);
  const base = Object.fromEntries(reglages.filter(([nom]) => requis.has(nom)).map(([nom, schema]) => [nom, exemples(nom, schema)[0]]));
  // Les réglages obligatoires seuls, puis chaque valeur de chaque réglage, une à la fois.
  const cas = [base, ...reglages.flatMap(([nom, schema]) => exemples(nom, schema).filter((v) => JSON.stringify(base[nom]) !== JSON.stringify(v)).map((v) => ({ ...base, [nom]: v })))];
  seen.outils++;
  for (const argumentsOutil of cas.slice(0, 60)) {
    const r = await mcp("tools/call", { name: outil.name, arguments: argumentsOutil });
    seen.appels++;
    const texte = r.json?.result?.content?.map((c) => c.text ?? "").join(" ") ?? "";
    // Un refus (réglage invalide, objet introuvable) est une réponse ; « Erreur interne » est une panne.
    if (r.status >= 500 || r.json?.error || texte.startsWith("Erreur interne")) fails.push(`outil ${outil.name} ${JSON.stringify(argumentsOutil)} → ${texte.slice(0, 120) || JSON.stringify(r.json?.error ?? r.status)}`);
  }
}

if (args.includes("--json")) console.log(JSON.stringify({ ok: fails.length === 0, ...seen, pannes: fails }, null, 1));
else {
  console.log(`${fails.length ? "✗" : "✓"} sonde des lectures : ${seen.routes} appels de routes, ${seen.outils} outils de lecture (${seen.appels} appels), ${fails.length} en panne`);
  for (const f of fails) console.log(`  - ${f}`);
}
process.exit(fails.length ? 1 : 0);
