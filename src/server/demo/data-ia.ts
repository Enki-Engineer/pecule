/*
 * Coût de l'IA de la famille fictive : douze mois d'appels (assistant, factures, documents, bulletins, un import de
 * dossier, un peu de mode vocal), pour que Réglages → Coût de l'IA ait de quoi montrer en démo. Chaque ligne est
 * un appel, compté au tarif public comme le fait le serveur. Les conversations elles-mêmes ne sont pas créées :
 * leurs identifiants ne servent qu'à compter le coût moyen d'une conversation.
 */
import type * as schema from "../db/schema/index.ts";
import { speechCostUsd, transcriptionCost, usageCostUsd } from "../../lib/ai-usage.ts";
import type { Scenario } from "./model.ts";
import { type DemoUser, type Insert, Rand, addMonths, daysIn, monthOf, pad, yearOf } from "./rng.ts";

const MODEL = "claude-opus-5-5";
const VOICE = "fr-FR-Vivienne:DragonHDLatestNeural";
/** Euros pour un dollar, figé : la démo ne lit aucun cours. */
const RATE = 0.86;
const r6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

type Row = Insert<typeof schema.aiUsage>;

export function buildAiUsage(s: Scenario, [ua, uc]: readonly [DemoUser, DemoUser]): { aiUsage: Row[] } {
  const R = new Rand(`pecule-demo-ia|${s.T}`);
  const rows: Row[] = [];
  for (let back = 11; back >= 0; back--) {
    const first = addMonths(s.T, -back, 1);
    const month = first.slice(0, 7);
    // Le mois en cours s'arrête au jour de la démo.
    const lastDay = back === 0 ? s.TD : daysIn(yearOf(first), monthOf(first));
    const at = () => `${month}-${pad(R.int(1, lastDay))} ${pad(R.int(7, 22))}:${pad(R.int(0, 59))}:${pad(R.int(0, 59))}`;
    const share = lastDay / daysIn(yearOf(first), monthOf(first));
    const times = (mean: number) => Math.max(0, Math.round(mean * share * (0.75 + R.next() * 0.5)));

    const call = (userId: number | null, feature: string, createdAt: string, tokens: { input: number; output: number; read?: number; write?: number }, threadId: string | null = null) => {
      const usd = usageCostUsd(MODEL, { input_tokens: tokens.input, output_tokens: tokens.output, cache_read_input_tokens: tokens.read ?? 0, cache_creation_input_tokens: tokens.write ?? 0 });
      rows.push({ userId, threadId, feature, model: MODEL, inputTokens: tokens.input, cacheReadTokens: tokens.read ?? 0, cacheWriteTokens: tokens.write ?? 0, outputTokens: tokens.output, costUsd: r6(usd), costEur: r6(usd * RATE), createdAt });
    };

    // Assistant : une conversation = deux à quatre appels, les consignes relues en cache après le premier.
    for (const [user, mean] of [[ua, 13], [uc, 6]] as const)
      for (let i = times(mean); i > 0; i--) {
        const thread = R.uuid();
        const when = at();
        for (let step = R.int(2, 4), k = 0; k < step; k++)
          call(user.id, "assistant", when, { input: R.int(900, 3200), output: R.int(250, 1100), read: k === 0 ? R.int(0, 9000) : R.int(11000, 26000), write: k === 0 ? R.int(2500, 9000) : R.int(0, 1800) }, thread);
      }
    // Factures : la lecture, puis le classement de ses articles.
    for (let i = times(7); i > 0; i--) {
      const user = R.chance(0.6) ? ua : uc;
      const when = at();
      call(user.id, "facture", when, { input: R.int(2800, 6200), output: R.int(500, 1300) });
      call(user.id, "classement", when, { input: R.int(1500, 2600), output: R.int(200, 500) });
    }
    for (let i = times(3); i > 0; i--) call((R.chance(0.5) ? ua : uc).id, "document", at(), { input: R.int(2400, 7000), output: R.int(250, 600) });
    // Un bulletin par adulte et par mois.
    if (share > 0.2) for (const user of [ua, uc]) call(user.id, "fiche de paie", at(), { input: R.int(3500, 5200), output: R.int(700, 1100) });
    // Un dossier de papiers importé d'un coup, il y a quelques mois, et les avis d'impôt à l'automne dernier.
    if (back === 4) for (const [kind, n] of [["releve", 12], ["bulletin", 9], ["pret", 2], ["contrat", 4]] as const) for (let i = n; i > 0; i--) call(ua.id, `import : ${kind}`, at(), { input: R.int(4000, 11000), output: R.int(700, 1900), read: R.int(1500, 2500) });
    if (back === 9) for (let i = 5; i > 0; i--) call(uc.id, "import : avis_impot", at(), { input: R.int(5000, 9000), output: R.int(800, 1500), read: R.int(1500, 2500) });
    // Noms de catégories traduits quand il en apparaît (tâche de fond : aucun membre).
    if (back % 4 === 3) call(null, "traduction", at(), { input: R.int(600, 1200), output: R.int(900, 2400) });
    // Mode vocal : quelques questions dictées, la réponse lue à voix haute.
    for (let i = times(back < 5 ? 5 : 0); i > 0; i--) {
      const when = at();
      const heard = transcriptionCost(null, Array.from({ length: R.int(8, 24) }, () => "mot").join(" "));
      rows.push({ userId: ua.id, threadId: null, feature: "voix : transcription", model: "gpt-transcribe", costUsd: r6(heard.usd), costEur: r6(heard.usd * RATE), createdAt: when });
      const spoken = speechCostUsd(VOICE, R.int(180, 620));
      rows.push({ userId: ua.id, threadId: null, feature: "voix : lecture", model: VOICE, costUsd: r6(spoken), costEur: r6(spoken * RATE), createdAt: when });
    }
  }
  return { aiUsage: rows };
}
