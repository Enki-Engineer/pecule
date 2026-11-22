import { householdTimeZone } from "./region.ts";
import { exec, one, q } from "./db.ts";
import { assistantEnabled, sendMessage, updateThread } from "./assistant.ts";
import { aiPaused } from "./ai-cost.ts";
import { notify } from "./notify.ts";
import { recordAlert } from "./journal.ts";
import { memberLang, runInLang } from "./lang.ts";
import { t } from "../lib/i18n.ts";
import { inlineText, plainMarkdown } from "../lib/markdown.ts";

/*
 * Résumé de la semaine : chaque lundi à partir de 8 h (heure de Paris), l'assistant prépare pour
 * chaque membre une conversation « Résumé de la semaine » (lecture seule : aucune action proposée).
 * L'accueil l'affiche ; une notification la signale ; on peut continuer la conversation.
 */

const PROMPT = `Prépare mon résumé de la semaine dernière (du lundi au dimanche), court et clair :
1. Dépenses de la semaine comparées à une semaine habituelle (moyenne des 8 semaines précédentes), et les 3 postes qui ont le plus pesé.
2. Faits marquants : gros débits, prélèvements nouveaux ou inhabituels, revenus reçus, opérations encore à classer.
3. Enveloppes du mois en alerte ou dépassées, et objectifs d'épargne si l'un avance ou prend du retard.
4. Ce qui m'attend cette semaine (échéancier).
5. Deux ou trois actions utiles à faire.
Si tes consignes comportent des « Équivalences amusantes », glisse-en une seule, sur le chiffre le plus parlant de la semaine.
Titre « ### Semaine du … au … ». Pas d'action d'écriture : propose seulement.`;

/** Semaine ISO (« 2026-W46 ») d'une date. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

type Summary = { week: string; threadId: string; createdAt: string; preview: string };

export async function latestSummary(userId: number): Promise<(Summary & { text: string }) | null> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [`weekly:${userId}`]);
  if (!row) return null;
  const s = JSON.parse(row.value) as Summary;
  const t = await one<{ display: string }>("SELECT display FROM assistant_threads WHERE id = ? AND user_id = ?", [s.threadId, userId]);
  if (!t) return null;
  const display = JSON.parse(t.display) as { role: string; text: string }[];
  const answer = display.find((d) => d.role === "assistant" && d.text)?.text ?? "";
  return { ...s, text: answer };
}

/** Prépare le résumé du membre pour la semaine en cours (une fois par semaine, sauf `force`). */
export async function generateSummary(userId: number, force = false): Promise<Summary | null> {
  if (!assistantEnabled() || (await aiPaused())) return null;
  const week = isoWeek(new Date());
  const prev = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [`weekly:${userId}`]);
  if (prev && !force && (JSON.parse(prev.value) as Summary).week === week) return null;
  // Personne n'est devant l'écran : toute écriture (mémoire comprise) reste une proposition, à confirmer à l'ouverture.
  const thread = await sendMessage(userId, undefined, PROMPT);
  const answer = [...thread.display].reverse().find((d) => d.role === "assistant" && d.text)?.text ?? "";
  // Aperçu de la notification : la première ligne après le titre, sans sa mise en forme.
  const preview = plainMarkdown(answer)
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .slice(1, 2)
    .join(" ")
    .slice(0, 160);
  // Dans l'historique, la conversation porte le titre du résumé (« Semaine du … au … ») plutôt que la consigne envoyée.
  const heading = /^#{1,4}\s+(.+)$/m.exec(answer)?.[1];
  await updateThread(userId, thread.threadId, { title: heading ? inlineText(heading) : t("Résumé de la semaine") });
  const s: Summary = { week, threadId: thread.threadId, createdAt: new Date().toISOString(), preview };
  await exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [`weekly:${userId}`, JSON.stringify(s)]);
  return s;
}

let running = false;

/** Le lundi à partir de 8 h : résumé de chaque membre, puis notification. */
export async function runWeeklySummaries() {
  if (running) return;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: householdTimeZone(), weekday: "short", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  if (p.weekday !== "Mon" || Number(p.hour) < 8) return;
  running = true;
  try {
    for (const u of await q<{ id: number }>("SELECT id FROM users")) {
      try {
        // Dans la langue du membre : la tâche de fond n'a pas de requête pour la donner.
        await runInLang(await memberLang(u.id), async () => {
          const s = await generateSummary(u.id);
          if (s) await notify(u.id, "resume", `resume:${s.week}`, { title: t("Ton résumé de la semaine"), body: s.preview || t("Dépenses, faits marquants et ce qui t'attend."), url: "/" });
        });
      } catch (e) {
        void recordAlert("assistant", `Résumé de la semaine en échec : ${e instanceof Error ? e.message : String(e)}`, e);
      }
    }
  } finally {
    running = false;
  }
}
