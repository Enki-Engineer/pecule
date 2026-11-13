import express, { Router } from "express";
import { z } from "zod";
import { exec, q } from "./db.ts";
import { isDemo, runDemo, runReal } from "./demo-context.ts";
import { requireApiToken, requireAuth } from "./auth.ts";
import { aiClient, aiEnabled, aiModel, recordUsage } from "./ai.ts";
import { recordAlert } from "./journal.ts";
import { LANGS, LANG_IDS, currentLang, registerData, type Lang } from "../lib/i18n.ts";

/*
 * Noms de données dans chaque langue : catégories, postes et groupes du référentiel. Ce sont des données de
 * la famille, pas des textes du code : leurs traductions vivent en base (`data_translations`, toujours la
 * vraie base — la démo partage le même référentiel) et sont gardées en mémoire. L'écran les reçoit par
 * `GET /api/i18n/data` et ne traduit qu'à l'affichage (`td()` de src/lib/i18n.ts) : le nom d'origine reste
 * l'identifiant partout ailleurs. Un nom sans traduction (catégorie créée ou renommée) est traduit par Claude
 * en tâche de fond, dans les cinq langues — il peut avoir été écrit dans n'importe laquelle.
 */

type Names = Record<string, string>;
const cache: Partial<Record<Lang, Names>> = {};
let loadedAt = 0;
let loading: Promise<void> | null = null;
const REFRESH_MS = 60_000;

async function load() {
  const rows = await runReal(() => q<{ source: string; lang: string; text: string }>("SELECT source, lang, text FROM data_translations"));
  const next: Partial<Record<Lang, Names>> = {};
  for (const l of LANG_IDS) next[l] = {};
  for (const r of rows) if (r.lang in next && r.text !== r.source) next[r.lang as Lang]![r.source] = r.text;
  for (const l of LANG_IDS) {
    cache[l] = next[l];
    // Le serveur traduit aussi (textes des actions de l'assistant, notifications) : même table que l'écran.
    registerData(l, next[l]!);
  }
  loadedAt = Date.now();
}

/** Traductions à jour (relues au plus une fois par minute). */
async function ensureLoaded(force = false) {
  if (!force && loadedAt && Date.now() - loadedAt < REFRESH_MS) return;
  loading ??= load().finally(() => {
    loading = null;
  });
  await loading;
}

/** Noms traduits dans une langue : nom d'origine → nom dans cette langue (absents : ceux qui ne changent pas). */
export async function dataNames(lang: Lang): Promise<Names> {
  await ensureLoaded();
  return cache[lang] ?? {};
}

/**
 * Enregistre des traductions. `replace` : remplace celles qui existent (import ou correction à la main) ;
 * sinon elles sont gardées — la traduction automatique ne touche jamais à un nom déjà traduit.
 */
export async function saveDataNames(rows: { source: string; lang: Lang; text: string }[], replace = true) {
  const clean = rows.filter((r) => r.source.trim() && r.text.trim() && r.source.length <= 191 && r.text.length <= 191);
  for (let i = 0; i < clean.length; i += 200) {
    const part = clean.slice(i, i + 200);
    await runReal(() =>
      exec(
        `INSERT ${replace ? "" : "IGNORE "}INTO data_translations (source, lang, text) VALUES ${part.map(() => "(?, ?, ?)").join(", ")}${replace ? " ON DUPLICATE KEY UPDATE text = VALUES(text)" : ""}`,
        part.flatMap((r) => [r.source, r.lang, r.text.trim()]),
      ),
    );
  }
  await ensureLoaded(true);
  return clean.length;
}

/** Noms du référentiel de la base courante (vraie base ou démo) : catégories, postes, groupes. */
async function referentialNames(): Promise<string[]> {
  const rows = await q<{ name: string | null; poste: string | null; group_name: string | null }>("SELECT name, poste, group_name FROM categories");
  return [...new Set(rows.flatMap((r) => [r.name, r.poste, r.group_name]).filter((n): n is string => !!n && n.length <= 191))];
}

const SCHEMA = {
  type: "object",
  properties: {
    names: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          langue: { type: "string", enum: ["fr", "en", "de", "it", "es"], description: "Langue dans laquelle le nom a été écrit" },
          fr: { type: "string" },
          en: { type: "string" },
          de: { type: "string" },
          it: { type: "string" },
          es: { type: "string" },
        },
        required: ["source", "langue", "fr", "en", "de", "it", "es"],
        additionalProperties: false,
      },
    },
  },
  required: ["names"],
  additionalProperties: false,
};
const answer = z.object({ names: z.array(z.object({ source: z.string(), langue: z.enum(LANG_IDS), fr: z.string(), en: z.string(), de: z.string(), it: z.string(), es: z.string() })) });

let translating = false;
let lastFailure = 0;

/**
 * Traduit par Claude les noms qui n'ont pas encore leurs cinq langues. En tâche de fond, un lot à la fois ;
 * après un échec, pas de nouvel essai avant dix minutes. Sans IA configurée : rien (les noms restent tels quels).
 */
async function translateMissing(names: string[]) {
  if (translating || !aiEnabled() || Date.now() - lastFailure < 10 * 60_000) return;
  await ensureLoaded();
  const known = await runReal(() => q<{ source: string; n: number }>("SELECT source, COUNT(*) AS n FROM data_translations GROUP BY source"));
  const done = new Set(known.filter((r) => Number(r.n) >= LANGS.length).map((r) => r.source));
  const missing = names.filter((n) => !done.has(n)).slice(0, 80);
  if (!missing.length) return;
  translating = true;
  try {
    const response = await aiClient().messages.create({
      model: aiModel(),
      max_tokens: 8000,
      system:
        "Tu traduis les noms de catégories, de postes et de groupes de dépenses d'une application de finances familiales. Chaque nom a été écrit par un membre de la famille, " +
        "en français le plus souvent, parfois en anglais, allemand, italien ou espagnol. Pour chaque nom, donne son équivalent court et naturel dans les cinq langues " +
        "(fr, en : anglais britannique, de, it, es), comme le libellé d'une catégorie dans une appli bancaire : même sens, même forme (ponctuation, parenthèses, barres obliques), " +
        "majuscule initiale, sans ajout. « langue » dit dans quelle langue il a été écrit. Un nom propre (société, personne, marque) ne se traduit pas. « source » reprend le nom reçu, à l'identique.",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: `Noms à traduire (un par ligne) :\n${missing.join("\n")}` }] }],
    });
    await runReal(() => recordUsage("traduction", aiModel(), response.usage));
    const out = response.content.find((b) => b.type === "text");
    const parsed = out && out.type === "text" ? answer.safeParse(JSON.parse(out.text)) : null;
    if (!parsed?.success) throw new Error("réponse illisible");
    const wanted = new Set(missing);
    // Dans sa langue d'origine, le nom reste écrit exactement comme son auteur l'a écrit ; rien de ce qui existe n'est remplacé.
    const rows = parsed.data.names.filter((n) => wanted.has(n.source)).flatMap((n) => LANG_IDS.map((lang) => ({ source: n.source, lang, text: lang === n.langue ? n.source : n[lang] })));
    await saveDataNames(rows, false);
  } catch (e) {
    lastFailure = Date.now();
    void recordAlert("traduction", `Traduction des noms de catégories en échec : ${e instanceof Error ? e.message : String(e)}`, e);
  } finally {
    translating = false;
  }
}

/* ---------- Routes (sous /api) ---------- */

export const dataI18nApi = Router();

/** Noms traduits dans la langue de la requête ; lance au passage la traduction des noms nouveaux. */
dataI18nApi.get("/i18n/data", requireAuth, async (req, res) => {
  const lang = currentLang();
  const names = await dataNames(lang);
  // En démo : seulement les noms du référentiel fictif (les traductions vivent dans la vraie base, avec les noms du foyer).
  if (req.user?.demo || isDemo()) {
    const demo = new Set(await runDemo(() => referentialNames()).catch(() => [] as string[]));
    return res.json({ lang, names: Object.fromEntries(Object.entries(names).filter(([name]) => demo.has(name))) });
  }
  res.json({ lang, names });
  // Après la réponse : un nom apparu depuis (catégorie créée, renommée) sera traduit pour la prochaine fois.
  void referentialNames()
    .then((all) => translateMissing(all))
    .catch(() => undefined);
});

/**
 * Import d'administration (jeton d'administration) : lignes [nom d'origine, fr, en, de, it, es] ; une valeur vide est ignorée.
 * Le lecteur JSON est posé ici : ce routeur est monté avant celui de l'appli.
 */
dataI18nApi.post("/i18n/data", requireApiToken, express.json({ limit: "500kb" }), async (req, res) => {
  if (isDemo()) return res.status(403).json({ error: "Indisponible en mode démo" });
  const { rows } = z.object({ rows: z.array(z.tuple([z.string(), z.string(), z.string(), z.string(), z.string(), z.string()])).max(2000) }).parse(req.body);
  const saved = await saveDataNames(rows.flatMap(([source, ...texts]) => LANG_IDS.map((lang, i) => ({ source, lang, text: texts[i] ?? "" }))));
  res.json({ ok: true, saved });
});
