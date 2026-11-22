import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { env } from "./env.ts";
import { ActionError } from "./actions.ts";
import { requireAuth } from "./auth.ts";
import { aiEnabled, foundryAccess, recordCost } from "./ai.ts";
import { assertAiBudget } from "./ai-cost.ts";
import { recordAlert } from "./journal.ts";
import { isDemo } from "./demo-context.ts";
import { VOICES, VOICE_IDS, isPhantom, speechSsml, speechText, voiceFor, type VoiceId } from "../lib/voice.ts";
import { speechCostUsd, transcriptionCost, type TranscriptionUsage } from "../lib/ai-usage.ts";
import { currentLang, t } from "../lib/i18n.ts";

/*
 * Mode vocal de l'assistant : voix → texte et texte → voix par la ressource Microsoft Foundry des réglages
 * (`foundryAccess()` : son nom et sa clé, même quand Claude est servi par un autre fournisseur — sans
 * ressource Foundry, pas de mode vocal). Le raisonnement reste celui de l'assistant (Claude et ses outils) : ici, seulement
 * la transcription de la question (déploiement AI_STT_DEPLOYMENT) et la lecture de la réponse.
 * Rien n'est gardé : ni l'enregistrement, ni l'audio produit.
 *
 * La lecture passe par les voix neuronales françaises du service Speech de la ressource (VOICES) : la langue
 * est celle de la voix. L'ancien déploiement « tts-hd » devinait la langue d'après le texte et basculait en
 * anglais en cours de réponse (noms de marques, textes longs) — mesuré le 11/11/2026.
 */

const API_VERSION = "2025-03-01-preview";
const MAX_AUDIO = 8 * 1024 * 1024;
const deployment = (resource: string, name: string, path: string) => `https://${resource}.openai.azure.com/openai/deployments/${encodeURIComponent(name)}/audio/${path}?api-version=${API_VERSION}`;

const speechUrl = (resource: string) => `https://${resource}.cognitiveservices.azure.com/tts/cognitiveservices/v1`;

export const voiceEnabled = () => aiEnabled() && !!foundryAccess() && !!env.AI_STT_DEPLOYMENT;
/** Ressource et clé du mode vocal (les routes ont déjà vérifié voiceEnabled). */
function access() {
  const a = foundryAccess();
  if (!a) throw new ActionError(503, t("Mode vocal non configuré"));
  return a;
}
/**
 * Voix de la réponse : celle que l'appareil a choisie si elle parle la langue de la requête, sinon la voix par
 * défaut de cette langue (AI_TTS_VOICE pour le français). Jamais une voix d'une autre langue que celle de Pécule.
 */
const voiceOf = (wanted?: string | null): VoiceId => voiceFor(currentLang(), wanted ?? (currentLang() === "fr" ? env.AI_TTS_VOICE : null));

/** Extension de fichier attendue par le modèle, d'après le type de l'enregistrement du navigateur. */
const EXT: [RegExp, string][] = [
  [/webm/, "webm"],
  [/mp4|m4a|aac/, "mp4"],
  [/ogg/, "ogg"],
  [/wav/, "wav"],
  [/mpeg|mp3/, "mp3"],
];

/** `what` : pour l'alerte technique (en français) ; `message` : ce que lit le membre, dans sa langue. */
async function failure(what: string, message: string, res: Response): Promise<never> {
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  void recordAlert("voix", `${what} : la Foundry a répondu ${res.status}`, detail);
  throw new ActionError(502, message);
}

/** Voix → texte, dans la langue de Pécule pour ce membre (imposée : jamais devinée). */
export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const ext = EXT.find(([re]) => re.test(mime))?.[1] ?? "webm";
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(audio)], { type: mime.split(";")[0] || "audio/webm" }), `question.${ext}`);
  form.set("language", currentLang());
  const { resource, key } = access();
  const send = () => fetch(deployment(resource, env.AI_STT_DEPLOYMENT, "transcriptions"), { method: "POST", headers: { "api-key": key }, body: form, signal: AbortSignal.timeout(45_000) });
  let res = await send();
  // Quota du déploiement atteint (15 demandes par minute, mesuré le 11/11/2026) : une seconde tentative après une courte attente.
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, Math.min(4000, Math.max(1000, Number(res.headers.get("retry-after")) * 1000 || 2000))));
    res = await send();
  }
  if (!res.ok) return failure("La transcription est", t("La transcription est indisponible pour l'instant."), res);
  const out = (await res.json()) as { text?: string; usage?: TranscriptionUsage };
  const text = (out.text ?? "").trim();
  // Coût : d'après le décompte du service quand il en donne un, sinon d'après la durée estimée de la phrase.
  const cost = transcriptionCost(out.usage, text);
  void recordCost("voix : transcription", env.AI_STT_DEPLOYMENT, cost.usd, { input_tokens: cost.inputTokens, output_tokens: cost.outputTokens });
  // Sur un bruit ou un silence, la transcription invente parfois un générique de sous-titres : rien n'a été dit.
  return isPhantom(text) ? "" : text;
}

/** Texte → voix (MP3), dans la langue de la voix quel que soit le texte. */
export async function speak(text: string, voice: VoiceId = voiceOf()): Promise<Response> {
  const { resource, key } = access();
  const res = await fetch(speechUrl(resource), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
      "User-Agent": "pecule",
    },
    body: speechSsml(text, voice),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok || !res.body) return failure("La voix de l'assistant est", t("La voix de l'assistant est indisponible pour l'instant."), res);
  // Coût : la lecture est facturée au caractère lu.
  const name = VOICES.find((v) => v.id === voice)!.name;
  void recordCost("voix : lecture", name, speechCostUsd(name, text.length));
  return res;
}

/* ---------- Routes (sous /api, membre connecté) ---------- */

export const voiceApi = Router();

const limit = (prefix: string, max: number) =>
  rateLimit({
    windowMs: 60 * 60_000,
    limit: max,
    keyGenerator: (req) => `${prefix}${req.user?.id ?? 0}`,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Fonction : la langue n'est connue qu'au moment de la requête.
    message: () => ({ error: t("Trop d'échanges vocaux cette heure-ci.") }),
  });
const limiter = limit("v", 240);
// Une réponse est lue en plusieurs morceaux (phrase par phrase, au fil de son écriture).
const speakLimiter = limit("s", 1200);

// requireAuth route par route : ce routeur est monté sur /api avant les autres et ne doit rien intercepter d'autre.
voiceApi.get("/voice/status", requireAuth, (_req, res) => res.json({ enabled: voiceEnabled() && !isDemo(), voice: voiceOf() }));

voiceApi.post("/voice/transcribe", requireAuth, limiter, express.raw({ type: () => true, limit: MAX_AUDIO }), async (req, res) => {
  if (isDemo() || req.user?.demo) throw new ActionError(403, t("Indisponible en mode démo"));
  if (!voiceEnabled()) throw new ActionError(503, t("Mode vocal non configuré"));
  await assertAiBudget();
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new ActionError(400, t("Enregistrement vide"));
  res.json({ text: await transcribe(req.body, req.get("content-type") ?? "audio/webm") });
});

voiceApi.post("/voice/speak", requireAuth, speakLimiter, express.json({ limit: "50kb" }), async (req, res) => {
  if (isDemo() || req.user?.demo) throw new ActionError(403, t("Indisponible en mode démo"));
  if (!voiceEnabled()) throw new ActionError(503, t("Mode vocal non configuré"));
  await assertAiBudget();
  const { text, voice } = z.object({ text: z.string().min(1).max(8000), voice: z.enum(VOICE_IDS).optional() }).parse(req.body);
  const spoken = speechText(text);
  if (!spoken) throw new ActionError(400, t("Rien à lire"));
  const audio = await speak(spoken, voiceOf(voice));
  res.status(200).set({ "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
  res.send(Buffer.from(await audio.arrayBuffer()));
});
