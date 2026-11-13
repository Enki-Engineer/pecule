#!/usr/bin/env node
// Garde-fou avant de pousser : aucun mot d'une liste privée (prénoms, lieux, identifiants) ne doit
// entrer dans les fichiers suivis par git, et ceux qui y sont encore ne peuvent que diminuer.
//
//   node scripts/garde-fou.mjs            contrôle (code de sortie 1 si un fichier en porte plus qu'avant)
//   node scripts/garde-fou.mjs --detail   liste aussi les lignes en cause
//   node scripts/garde-fou.mjs --init     enregistre l'état du jour comme point de départ
//   node scripts/garde-fou.mjs --hook     installe le contrôle avant chaque `git push` (hook local)
//
// La liste et l'état vivent HORS du dépôt (la liste révélerait ce qu'elle protège) :
//   <dépôt principal>/data/garde-fou/mots.txt      une expression régulière par ligne (sans casse), « # » = commentaire
//   <dépôt principal>/data/garde-fou/exemptes.txt  fichiers (ou dossiers, avec « / » final) suivis mais pas encore nettoyés : signalés, jamais bloquants
//   <dépôt principal>/data/garde-fou/etat.json     nombre d'occurrences admis par fichier (ne peut que baisser)
// ou dans le dossier donné par GARDE_FOU_DOSSIER. Sans liste, le contrôle ne fait rien (dépôt cloné par un tiers).
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const args = new Set(process.argv.slice(2));

// Une copie de travail (`git worktree`) n'a pas de dossier `data/` : on remonte au dépôt principal.
const top = git("rev-parse", "--show-toplevel");
const common = path.resolve(top, git("rev-parse", "--git-common-dir"));
const main = path.dirname(common);
const dir = process.env.GARDE_FOU_DOSSIER ?? path.join(main, "data", "garde-fou");
const wordsFile = path.join(dir, "mots.txt");
const exemptFile = path.join(dir, "exemptes.txt");
const stateFile = path.join(dir, "etat.json");

if (args.has("--hook")) {
  const hook = path.join(common, "hooks", "pre-push");
  mkdirSync(path.dirname(hook), { recursive: true });
  writeFileSync(hook, '#!/bin/sh\n# Posé par `node scripts/garde-fou.mjs --hook`.\nexec node "$(git rev-parse --show-toplevel)/scripts/garde-fou.mjs"\n');
  chmodSync(hook, 0o755);
  console.log(`✓ contrôle installé : ${hook}`);
  process.exit(0);
}

if (!existsSync(wordsFile)) {
  console.log(`garde-fou : pas de liste (${wordsFile}), rien à contrôler.`);
  process.exit(0);
}

const lines = (file) =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    : [];
const patterns = lines(wordsFile).map((src) => new RegExp(src, "giu"));
// Une ligne qui finit par « / » exempte tout un dossier (fichiers générés, par exemple).
const exemptList = lines(exemptFile);
const exempt = { has: (f) => exemptList.some((e) => (e.endsWith("/") ? f.startsWith(e) : f === e)) };

const SKIP = /(^pnpm-lock\.yaml$|\.(png|jpg|jpeg|webp|ico|woff2?|ttf|pdf|zip)$)/i;
const files = execFileSync("git", ["ls-files", "-z"], { cwd: top, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0")
  .filter((f) => f && !SKIP.test(f));

/** Occurrences par fichier, avec les lignes en cause. */
const found = new Map();
for (const file of files) {
  const abs = path.join(top, file);
  if (!existsSync(abs)) continue; // supprimé dans le dossier de travail, pas encore dans l'index
  const text = readFileSync(abs, "utf8");
  let count = 0;
  const hits = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      count++;
      if (hits.length < 8) hits.push({ line: text.slice(0, m.index).split("\n").length, word: m[0] });
    }
  }
  if (count) found.set(file, { count, hits });
}

const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
const current = Object.fromEntries([...found].filter(([f]) => !exempt.has(f)).map(([f, v]) => [f, v.count]));
const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const exemptTotal = [...found].filter(([f]) => exempt.has(f)).reduce((a, [, v]) => a + v.count, 0);

if (args.has("--init") || !state) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(current, null, 1)}\n`);
  console.log(`garde-fou : point de départ enregistré — ${total(current)} occurrence(s) dans ${Object.keys(current).length} fichier(s), ${exemptTotal} dans les fichiers exemptés.`);
  process.exit(0);
}

const worse = Object.entries(current).filter(([f, n]) => n > (state[f] ?? 0));
const detail = (f) => found.get(f).hits.map((h) => `      ligne ${h.line} : ${h.word}`).join("\n");

if (worse.length) {
  console.error("✗ garde-fou : des mots de la liste privée arrivent dans des fichiers suivis.");
  for (const [f, n] of worse) console.error(`  ${f} : ${n} (admis : ${state[f] ?? 0})\n${detail(f)}`);
  console.error("  Retire-les (ou, si le fichier doit quitter le dépôt plus tard, ajoute-le à exemptes.txt).");
  process.exit(1);
}

// Le compteur ne remonte jamais : on enregistre chaque baisse.
const next = Object.fromEntries(Object.entries(current).map(([f, n]) => [f, Math.min(n, state[f] ?? n)]));
if (JSON.stringify(next) !== JSON.stringify(state)) writeFileSync(stateFile, `${JSON.stringify(next, null, 1)}\n`);

const before = total(state);
const now = total(current);
console.log(
  `✓ garde-fou : ${now} occurrence(s) dans ${Object.keys(current).length} fichier(s)` +
    (now < before ? ` (−${before - now} depuis le dernier contrôle)` : "") +
    (exemptTotal ? ` ; ${exemptTotal} dans ${[...found.keys()].filter((f) => exempt.has(f)).length} fichier(s) exempté(s)` : ""),
);
if (args.has("--detail")) {
  for (const [f, v] of [...found].sort((a, b) => b[1].count - a[1].count)) console.log(`  ${exempt.has(f) ? "(exempté) " : ""}${f} : ${v.count}\n${detail(f)}`);
}
