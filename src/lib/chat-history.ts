/*
 * Historique des conversations de l'assistant : rangement par ancienneté (« Aujourd'hui », « Hier »…),
 * les épinglées en tête, et titre d'une conversation. Fonctions pures : le jour est celui de l'appareil.
 */

import { t } from "./i18n.ts";
import { hideOpenMarks, plainMarkdown, type CalloutKind } from "./markdown.ts";

/** Titre d'une conversation : celui que le membre lui a donné, sinon sa première question. */
export const threadTitle = (title: string | null, display: readonly { role: string; text: string }[]): string =>
  title?.trim() || (display.find((d) => d.role === "user")?.text ?? t("Conversation")).replace(/\s+/g, " ").trim().slice(0, 120);

export type HistoryGroup = "pinned" | "today" | "yesterday" | "week" | "month" | "older";

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Groupe d'une conversation d'après sa dernière activité (date ISO). */
export function historyGroup(updatedAt: string, pinned: boolean, now: Date = new Date()): HistoryGroup {
  if (pinned) return "pinned";
  const days = Math.round((dayStart(now) - dayStart(new Date(updatedAt))) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  if (days < 31) return "month";
  return "older";
}

/** Conversations regroupées, dans l'ordre reçu (épinglées puis plus récentes d'abord). */
export function groupHistory<T extends { updatedAt: string; pinned: boolean }>(threads: T[], now: Date = new Date()): { group: HistoryGroup; threads: T[] }[] {
  const out: { group: HistoryGroup; threads: T[] }[] = [];
  for (const t of threads) {
    const group = historyGroup(t.updatedAt, t.pinned, now);
    const last = out.at(-1);
    if (last?.group === group) last.threads.push(t);
    else out.push({ group, threads: [t] });
  }
  return out;
}

/* ---------- Export d'une conversation en texte ---------- */

export type ExportItem = {
  role: "user" | "assistant" | "action";
  text: string;
  details?: string[];
  /** `pending` : une action proposée, que le membre n'a encore ni confirmée ni refusée. */
  status?: "done" | "declined" | "error" | "expired" | "pending";
  attachments?: { name: string }[];
  context?: string;
  charts?: { title?: string }[];
  at?: string;
  stopped?: boolean;
};

/** Les mots de l'export, dans la langue du membre (le serveur les donne par `t()`). */
export type ExportWords = {
  header: string;
  you: string;
  assistant: string;
  action: string;
  about: (label: string) => string;
  attachment: (name: string) => string;
  chart: (title: string) => string;
  /** Intitulé d'un encadré d'une réponse (« Attention », « Conseil »…). */
  callout: (kind: CalloutKind) => string;
  stopped: string;
  status: Record<NonNullable<ExportItem["status"]>, string>;
};

/**
 * Une conversation avec l'assistant en texte brut, à garder ou à transmettre : qui parle, quand, ce qui a été dit,
 * les actions proposées et ce qu'elles sont devenues. Une réponse y perd sa mise en forme — gras, couleurs,
 * surlignage, encadrés réduits à leur intitulé —, comme par « Copier » ; un lien vers un écran y garde son adresse
 * entière (`origin` : l'adresse de l'appli) ; un graphique n'y laisse que son titre.
 */
export function conversationText(title: string, items: readonly ExportItem[], words: ExportWords, moment: (iso: string) => string, origin?: string): string {
  const out = [title, words.header, ""];
  for (const m of items) {
    const who = m.role === "user" ? words.you : m.role === "assistant" ? words.assistant : words.action;
    out.push(`— ${who}${m.at ? ` · ${moment(m.at)}` : ""}${m.role === "action" && m.status ? ` · ${words.status[m.status]}` : ""}`);
    if (m.context) out.push(words.about(m.context));
    // Une réponse arrêtée peut finir sur une marque ouverte (« {+12 ») : elle ne s'écrit pas en clair.
    const text = m.role === "assistant" ? plainMarkdown(m.stopped ? hideOpenMarks(m.text) : m.text, { label: words.callout, origin }) : m.text.trim();
    if (text) out.push(text);
    for (const d of m.details ?? []) out.push(`  · ${d}`);
    for (const a of m.attachments ?? []) out.push(words.attachment(a.name));
    for (const c of m.charts ?? []) out.push(words.chart(c.title?.trim() || "—"));
    if (m.stopped) out.push(words.stopped);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** Nom du fichier d'export : le titre réduit à des lettres simples, et le jour. */
export function exportFileName(title: string, day: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `pecule-conversation-${slug || "sans-titre"}-${day}.txt`;
}
