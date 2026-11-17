import { describe, expect, it } from "vitest";
import { autoBackupDue, autoBackupName, autoBackupsToPrune, backupReminder, cleanBackupSettings, DEFAULT_BACKUP_SETTINGS, parseAutoName } from "./backup-plan.ts";

const at = (iso: string) => new Date(iso);
const ms = (iso: string) => Date.parse(iso);
const TZ = "Europe/Paris";

describe("réglage des sauvegardes automatiques", () => {
  it("part éteint, et ramène une valeur inattendue à celle d'origine", () => {
    expect(cleanBackupSettings(null)).toEqual(DEFAULT_BACKUP_SETTINGS);
    expect(cleanBackupSettings({ auto: "oui", frequence: "heure", garder: "beaucoup" })).toEqual(DEFAULT_BACKUP_SETTINGS);
    expect(cleanBackupSettings({ auto: true, frequence: "semaine", garder: 4 })).toEqual({ auto: true, frequence: "semaine", garder: 4 });
  });

  it("borne le nombre de sauvegardes gardées", () => {
    expect(cleanBackupSettings({ garder: 0 }).garder).toBe(1);
    expect(cleanBackupSettings({ garder: 500 }).garder).toBe(60);
    expect(cleanBackupSettings({ garder: 3.6 }).garder).toBe(4);
  });
});

describe("nom d'une sauvegarde automatique", () => {
  it("porte l'instant, et se relit", () => {
    const name = autoBackupName(at("2026-11-17T02:05:44Z"));
    expect(name).toBe("pecule-auto-2026-11-17-0205.zip");
    expect(parseAutoName(name)).toBe(ms("2026-11-17T02:05:00Z"));
  });

  it("ne prend aucune autre archive pour une sauvegarde automatique", () => {
    expect(parseAutoName("pecule-sauvegarde-2026-11-17-0205.zip")).toBeNull();
    expect(parseAutoName("pecule-avant-migration-2026-11-17-0205-m32-ab12cd34.zip")).toBeNull();
    expect(parseAutoName("pecule-auto-2026-11-17-0205.zip.partiel")).toBeNull();
  });
});

describe("moment d'une sauvegarde automatique", () => {
  const daily = { auto: true, frequence: "jour" as const };
  const weekly = { auto: true, frequence: "semaine" as const };

  it("ne fait rien tant que ce n'est pas demandé", () => {
    expect(autoBackupDue({ auto: false, frequence: "jour" }, { lastOk: null, lastTry: null }, at("2026-11-17T10:00:00Z"), TZ)).toBe(false);
  });

  it("fait la première sans attendre la nuit", () => {
    expect(autoBackupDue(daily, { lastOk: null, lastTry: null }, at("2026-11-17T15:00:00Z"), TZ)).toBe(true);
  });

  it("attend trois heures, à l'heure du foyer, le lendemain", () => {
    const state = { lastOk: ms("2026-11-17T02:10:00Z"), lastTry: ms("2026-11-17T02:10:00Z") };
    // Le même jour, puis le lendemain à 1 h 30 (0 h 30 UTC) : pas encore.
    expect(autoBackupDue(daily, state, at("2026-11-17T20:00:00Z"), TZ)).toBe(false);
    expect(autoBackupDue(daily, state, at("2026-11-18T00:30:00Z"), TZ)).toBe(false);
    // 3 h 05 à Paris (2 h 05 UTC) : c'est l'heure.
    expect(autoBackupDue(daily, state, at("2026-11-18T02:05:00Z"), TZ)).toBe(true);
  });

  it("rattrape une nuit manquée dès que le serveur se réveille", () => {
    const state = { lastOk: ms("2026-11-14T02:10:00Z"), lastTry: ms("2026-11-14T02:10:00Z") };
    expect(autoBackupDue(daily, state, at("2026-11-17T13:00:00Z"), TZ)).toBe(true);
  });

  it("laisse sept jours entre deux sauvegardes hebdomadaires", () => {
    const state = { lastOk: ms("2026-11-10T02:10:00Z"), lastTry: ms("2026-11-10T02:10:00Z") };
    expect(autoBackupDue(weekly, state, at("2026-11-16T05:00:00Z"), TZ)).toBe(false);
    expect(autoBackupDue(weekly, state, at("2026-11-17T05:00:00Z"), TZ)).toBe(true);
  });

  it("ne réessaie pas tout de suite après un échec", () => {
    const state = { lastOk: ms("2026-11-16T02:10:00Z"), lastTry: ms("2026-11-17T02:05:00Z") };
    expect(autoBackupDue(daily, state, at("2026-11-17T05:00:00Z"), TZ)).toBe(false);
    expect(autoBackupDue(daily, state, at("2026-11-17T08:10:00Z"), TZ)).toBe(true);
    // Jamais réussie, dernier essai manqué il y a une heure : on attend aussi.
    expect(autoBackupDue(daily, { lastOk: null, lastTry: ms("2026-11-17T04:00:00Z") }, at("2026-11-17T05:00:00Z"), TZ)).toBe(false);
  });
});

describe("rotation", () => {
  const names = ["pecule-auto-2026-11-15-0205.zip", "pecule-auto-2026-11-17-0205.zip", "pecule-sauvegarde-2026-11-01-1000.zip", "pecule-auto-2026-11-16-0205.zip", "pecule-avant-migration-2026-11-10-0810-m32-ab12cd34.zip"];

  it("ne retire que les sauvegardes automatiques les plus anciennes", () => {
    expect(autoBackupsToPrune(names, 2)).toEqual(["pecule-auto-2026-11-15-0205.zip"]);
    expect(autoBackupsToPrune(names, 1)).toEqual(["pecule-auto-2026-11-16-0205.zip", "pecule-auto-2026-11-15-0205.zip"]);
    expect(autoBackupsToPrune(names, 7)).toEqual([]);
  });
});

describe("rappel", () => {
  const now = ms("2026-11-17T10:00:00Z");

  it("se tait tant que la dernière sauvegarde a moins de trente jours", () => {
    expect(backupReminder(ms("2026-11-01T10:00:00Z"), ms("2026-01-01T00:00:00Z"), now)).toBeNull();
  });

  it("compte les jours depuis la dernière sauvegarde", () => {
    expect(backupReminder(ms("2026-10-01T10:00:00Z"), ms("2026-01-01T00:00:00Z"), now)).toBe(47);
  });

  it("sans aucune sauvegarde, compte depuis le début de l'installation", () => {
    expect(backupReminder(null, ms("2026-11-10T00:00:00Z"), now)).toBeNull();
    expect(backupReminder(null, ms("2026-09-18T10:00:00Z"), now)).toBe(60);
    expect(backupReminder(null, null, now)).toBeNull();
  });
});
