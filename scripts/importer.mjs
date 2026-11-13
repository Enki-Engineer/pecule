#!/usr/bin/env node
// Import massif d'un dossier de documents dans Pécule, en ligne de commande. Même moteur que la zone de dépôt du coffre :
// les fichiers sont annoncés (empreinte calculée ici), envoyés s'ils sont nouveaux, lus par le serveur, puis proposés
// à la relecture. Sans dépendance (Node seul), utilisable par une personne ou par un agent.
//
//   node scripts/importer.mjs <dossier> [--a-blanc] [--valider-surs] [--plafond 5] [--nom "Mon dossier"] [--json]
//   node scripts/importer.mjs --lot <numéro> [--valider-surs] [--json]      suivre ou reprendre un lot
//
// Adresse et jeton : --url et --jeton, sinon PECULE_URL et PECULE_API_TOKEN (variables d'environnement ou fichier .env).
// --a-blanc : liste ce qui serait envoyé, sans rien envoyer. --valider-surs : valide ce qui peut l'être sans relecture
// (contrôles passés, lecture sans doute, rien de changé à l'existant) ; le reste se relit dans l'appli (Documents → Coffre, onglet « Imports »).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const HELP = `Import massif d'un dossier de documents dans Pécule.

  node scripts/importer.mjs <dossier> [--a-blanc] [--valider-surs] [--plafond 5] [--nom "Mon dossier"] [--json]
  node scripts/importer.mjs --lot <numéro> [--valider-surs] [--json]

--a-blanc       liste ce qui serait envoyé, d'après le type et la taille des fichiers, sans contacter Pécule
--valider-surs  valide ce qui peut l'être sans relecture ; le reste se relit dans l'appli
--plafond       dépense d'IA admise pour le lot, en euros (5 par défaut)
--surveiller    reste en marche : toutes les 15 minutes (--toutes <minutes>), envoie les fichiers apparus dans le
                dossier ; ce qui a déjà été envoyé est noté dans <dossier>/.pecule-importes.json
--url, --jeton  adresse de Pécule et jeton d'administration ; à défaut PECULE_URL et PECULE_API_TOKEN, puis
                APP_URL et API_TOKEN du fichier .env du dossier courant
Types lus : pdf, jpg, jpeg, png, webp, gif, heic, heif, txt, md, csv, ofx, qfx, qif — 20 Mo au plus par fichier.
Les fichiers et dossiers cachés (nom commençant par un point), node_modules et __MACOSX sont laissés de côté.`;
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
// Une option mal écrite (« --a_blanc ») ne doit jamais lancer un vrai import à la place d'un essai.
const KNOWN = new Map([["a-blanc", 0], ["valider-surs", 0], ["json", 0], ["surveiller", 0], ["toutes", 1], ["plafond", 1], ["nom", 1], ["lot", 1], ["url", 1], ["jeton", 1]]);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  if (!KNOWN.has(argv[i].slice(2))) {
    console.error(`✗ Option inconnue : ${argv[i]}\n\n${HELP}`);
    process.exit(1);
  }
  i += KNOWN.get(argv[i].slice(2));
}
const flag = (n) => argv.includes(`--${n}`);
const value = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const json = flag("json");
const say = (...a) => !json && console.log(...a);
const fail = (m) => {
  if (json) console.log(JSON.stringify({ ok: false, error: m }));
  else console.error(`✗ ${m}`);
  process.exit(1);
};

const env = { ...process.env };
if (existsSync(".env"))
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
const url = (value("url") ?? env.PECULE_URL ?? env.APP_URL ?? "").replace(/\/+$/, "");
const token = value("jeton") ?? env.PECULE_API_TOKEN ?? env.API_TOKEN;
const positional = argv.filter((a, i) => !a.startsWith("--") && !["--url", "--jeton", "--plafond", "--nom", "--lot", "--toutes"].includes(argv[i - 1]));
const folder = positional[0];
const dry = flag("a-blanc");
if (!folder && !value("lot")) fail("Usage : node scripts/importer.mjs <dossier> [--a-blanc] [--valider-surs] [--plafond 5] [--json]");
if (!dry && (!url || !token)) fail("Il manque l'adresse de Pécule (--url ou PECULE_URL) ou le jeton d'administration (--jeton ou PECULE_API_TOKEN).");

const EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "txt", "md", "csv", "ofx", "qfx", "qif"]);
const MAX = 20 * 1024 * 1024;

let hidden = 0;
function walk(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__MACOSX") {
      hidden++;
      continue;
    }
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(full, rel));
    else if (entry.isFile()) out.push({ full, path: rel, size: statSync(full).size });
  }
  return out;
}

async function call(method, route, body, raw) {
  const r = await fetch(`${url}/api${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(raw ? { "Content-Type": "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  }).catch((e) => {
    throw new Error(`Pécule est injoignable sur ${url} (${e.cause?.code ?? e.message}).`);
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!r.ok) throw new Error(data.error ?? `${r.status} sur ${route}`);
  return data;
}

const LABELS = { envoi: "à envoyer", attente: "en attente", lecture: "lecture", a_relire: "à relire", valide: "validé", range: "rangé", ecarte: "écarté", doublon: "déjà connu", ignore: "non importé", erreur: "erreur" };
const pending = (b) => b.items.some((i) => ["envoi", "attente", "lecture"].includes(i.status)) && !b.capped;

function show(batch) {
  for (const i of batch.items) {
    const detail = i.status === "a_relire" ? `${i.title ?? ""} · contrôles ${i.checksOk}/${i.checksTotal} · confiance ${i.confidence}${i.changes ? ` · ${i.changes} écart(s) avec l'existant` : ""}${i.safe ? " · sûr" : ""}` : (i.summary ?? i.title ?? i.error ?? "");
    say(`  ${(LABELS[i.status] ?? i.status).padEnd(12)} ${i.path}${detail ? `\n               ${detail}` : ""}`);
  }
  say(`\nLot ${batch.id} « ${batch.name} » : ${Object.entries(batch.counts).map(([s, n]) => `${n} ${LABELS[s] ?? s}`).join(", ")} · coût de l'IA ${batch.costEur.toFixed(2)} € (plafond ${batch.costCapEur} €)${batch.capped ? " — plafond atteint, lecture en pause" : ""}`);
}

/**
 * Dossier surveillé : à chaque passage, les fichiers pas encore envoyés (et que personne n'est en train d'écrire)
 * partent dans un nouveau lot. La mémoire de ce qui a été envoyé est un fichier caché du dossier ; la relecture se
 * fait dans l'appli (Documents → Coffre, onglet « Imports »).
 */
async function watch() {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) fail(`${folder} n'est pas un dossier.`);
  const stateFile = path.join(folder, ".pecule-importes.json");
  const every = Math.max(1, Number(value("toutes") ?? 15)) * 60_000;
  const cap = value("plafond") ? Number(value("plafond")) : undefined;
  say(`Surveillance de ${path.resolve(folder)} (toutes les ${every / 60_000} min). Ctrl+C pour arrêter.`);
  for (;;) {
    try {
      let seen = {};
      try {
        seen = JSON.parse(readFileSync(stateFile, "utf8"));
      } catch {
        seen = {};
      }
      const fresh = [];
      for (const f of walk(folder)) {
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        // Un fichier modifié il y a moins de 20 secondes est peut-être encore en cours de copie : au prochain passage.
        if (!EXTENSIONS.has(ext) || !f.size || f.size > MAX || Date.now() - statSync(f.full).mtimeMs < 20_000) continue;
        const sha256 = createHash("sha256").update(readFileSync(f.full)).digest("hex");
        if (!seen[sha256]) fresh.push({ ...f, sha256 });
      }
      if (fresh.length) {
        const batch = await call("POST", "/imports", { name: `${value("nom") ?? path.basename(path.resolve(folder))} — ${new Date().toLocaleDateString("sv-SE")}`, files: fresh.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })), ...(cap !== undefined ? { costCapEur: cap } : {}) });
        const byPath = new Map(fresh.map((f) => [f.path, f]));
        for (const item of batch.items) {
          const f = byPath.get(item.path);
          if (!f) continue;
          if (item.status === "envoi") await call("POST", `/imports/items/${item.id}/file`, null, readFileSync(f.full));
          seen[f.sha256] = new Date().toISOString();
        }
        writeFileSync(stateFile, JSON.stringify(seen, null, 1));
        say(`${new Date().toLocaleTimeString("fr-FR")} · lot ${batch.id} : ${fresh.length} fichier(s) envoyé(s) — à relire : ${url}/documents?lot=${batch.id}`);
      }
    } catch (e) {
      // Pécule injoignable ou refus passager : on réessaie au prochain passage, sans rien noter comme envoyé.
      say(`${new Date().toLocaleTimeString("fr-FR")} · ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, every));
  }
}

// Toute erreur du déroulé (réseau, refus du serveur) sort en clair, et en JSON avec --json.
async function main() {
  if (flag("surveiller")) return watch();
  let batch;
  if (value("lot")) batch = await call("GET", `/imports/${Number(value("lot"))}`);
  else {
    if (!existsSync(folder) || !statSync(folder).isDirectory()) fail(`${folder} n'est pas un dossier.`);
    const files = walk(folder);
    if (!files.length) fail("Aucun fichier dans ce dossier.");
    if (dry) {
      const rows = files.map((f) => {
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        const reason = !EXTENSIONS.has(ext) ? "type non pris en charge" : !f.size ? "vide" : f.size > MAX ? "plus de 20 Mo" : null;
        return { path: f.path, size: f.size, send: !reason, reason };
      });
      if (json) console.log(JSON.stringify({ ok: true, dryRun: true, toSend: rows.filter((r) => r.send).length, left: rows.filter((r) => !r.send).length, hidden, files: rows }));
      else {
        for (const r of rows) console.log(`  ${r.send ? "à envoyer  " : "non importé"} ${r.path}${r.reason ? ` (${r.reason})` : ""}`);
        console.log(`\n${rows.filter((r) => r.send).length} fichier(s) seraient envoyés, ${rows.filter((r) => !r.send).length} laissés de côté${hidden ? `, ${hidden} fichier(s) ou dossier(s) cachés ignorés` : ""}. Rien n'a été envoyé.`);
        console.log("Tri d'après le type et la taille seulement : un fichier que Pécule connaît déjà ne sera pas renvoyé au moment de l'import.");
      }
      process.exit(0);
    }
    say(`Empreintes de ${files.length} fichier(s)…`);
    const declared = files.map((f) => ({ path: f.path, size: f.size, sha256: f.size && f.size <= MAX ? createHash("sha256").update(readFileSync(f.full)).digest("hex") : null }));
    const cap = value("plafond") ? Number(value("plafond")) : undefined;
    batch = await call("POST", "/imports", { name: value("nom") ?? path.basename(path.resolve(folder)), files: declared, ...(cap !== undefined ? { costCapEur: cap } : {}) });
    say(`Lot ${batch.id} ouvert${batch.ai ? ` · coût de l'IA estimé à ${batch.estimateEur.toFixed(2)} €` : " · IA non réglée : les fichiers seront rangés au coffre sans être lus"}.`);
    const byPath = new Map(files.map((f) => [f.path, f.full]));
    const toSend = batch.items.filter((i) => i.status === "envoi");
    let sent = 0;
    for (const item of toSend) {
      const full = byPath.get(item.path);
      if (!full) continue;
      await call("POST", `/imports/items/${item.id}/file`, null, readFileSync(full));
      say(`  envoyé ${++sent}/${toSend.length} : ${item.path}`);
    }
  }

  say("Lecture par le serveur…");
  for (let i = 0; i < 900 && pending(batch); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    batch = await call("GET", `/imports/${batch.id}`);
  }
  let validated = null;
  if (flag("valider-surs")) {
    const r = await call("POST", `/imports/${batch.id}/validate-safe`);
    validated = { validated: r.validated, failed: r.failed };
    batch = r.batch;
  }
  if (json) console.log(JSON.stringify({ ok: true, batch, ...(validated ?? {}) }));
  else {
    show(batch);
    if (validated) console.log(`${validated.validated} fichier(s) validé(s) sans relecture${validated.failed.length ? `, ${validated.failed.length} en échec` : ""}.`);
    const left = batch.counts.a_relire ?? 0;
    if (left) console.log(`${left} fichier(s) à relire : ${url}/documents?lot=${batch.id}`);
  }
}
await main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
