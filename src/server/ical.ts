import { householdTimeZone, moneySymbol } from "./region.ts";
import { withUnit } from "../lib/currencies.ts";
import { randomBytes, createHash } from "node:crypto";
import { Router } from "express";
import { exec, one } from "./db.ts";
import { env } from "./env.ts";
import { agenda } from "./agenda.ts";
import { memberLang, runInLang } from "./lang.ts";
import { locale, t } from "../lib/i18n.ts";

/*
 * Échéancier dans Calendrier Apple (ou tout agenda) : abonnement par un lien privé
 * /ical/<jeton>.ics. Le jeton (portée « ical », empreinte seule en base, révocable dans Réglages)
 * n'ouvre que ce calendrier : tâches, jalons, mensualités, fins de crédit, garanties, documents qui
 * expirent, calendrier fiscal — de 30 jours en arrière à 18 mois devant.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const ymd = (d: string) => d.slice(0, 10).replace(/-/g, "");
const nextDay = (d: string) => {
  const x = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10).replace(/-/g, "");
};
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

/** Lignes de 75 octets au plus (RFC 5545), suite précédée d'une espace. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export async function createCalendarToken(userId: number): Promise<string> {
  const token = `cal_${randomBytes(24).toString("base64url")}`;
  await exec("INSERT INTO api_tokens (user_id, name, token_hash, scope) VALUES (?, ?, ?, 'ical')", [userId, "Calendrier", sha256(token)]);
  return token;
}

export const icalRouter = Router();

icalRouter.get("/ical/:file", async (req, res) => {
  const m = /^(cal_[A-Za-z0-9_-]{20,})\.ics$/.exec(String(req.params.file));
  if (!m) return res.status(404).end();
  const tok = await one<{ id: number; user_id: number }>("SELECT id, user_id FROM api_tokens WHERE token_hash = ? AND scope = 'ical' AND revoked_at IS NULL", [sha256(m[1])]);
  if (!tok) return res.status(404).end();
  await exec("UPDATE api_tokens SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [tok.id]);
  // L'appli d'agenda n'a ni session ni en-tête de langue : le calendrier sort dans la langue du membre à qui appartient le jeton.
  const body = await runInLang(await memberLang(tok.user_id), () => calendar(tok.user_id));
  res.set({ "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900", "X-Robots-Tag": "noindex" }).send(body);
});

/** Texte du calendrier d'un membre ; à appeler dans sa langue (titres des échéances, nom du calendrier, format des montants). */
async function calendar(userId: number): Promise<string> {
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 548 * 86_400_000).toISOString().slice(0, 10);
  const items = (await agenda(userId, from, to)).filter((e) => e.date);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = env.APP_URL?.replace(/\/$/, "") ?? "";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pecule//Echeancier//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(t("Pécule — échéancier"))}`,
    `X-WR-TIMEZONE:${householdTimeZone()}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of items) {
    const title = `${e.kind === "tache" ? (e.status === "fait" ? "✓ " : "☐ ") : ""}${e.title}${e.amount != null ? ` (${withUnit(Math.abs(e.amount).toLocaleString(locale(), { maximumFractionDigits: 2 }), "", moneySymbol())})` : ""}`;
    const desc = [e.notes, e.link ? `${base}${e.link}` : null].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.key.replace(/[^A-Za-z0-9:_-]/g, "-")}@pecule`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.date!)}`,
      `DTEND;VALUE=DATE:${nextDay(e.date!)}`,
      `SUMMARY:${esc(title)}`,
      ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
      ...(e.link ? [`URL:${base}${e.link}`] : []),
      `CATEGORIES:${esc(e.domain)}`,
      "TRANSP:TRANSPARENT",
    );
    // Rappel la veille à 9 h pour les tâches et les échéances (les jalons restent discrets).
    if (e.kind !== "jalon" && e.status !== "fait") lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, "TRIGGER:-PT15H", "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
