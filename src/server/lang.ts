import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { exec, one } from "./db.ts";
import { runReal } from "./demo-context.ts";
import { DEFAULT_LANG, extendDict, isLang, registerDict, setLangResolver, type Lang } from "../lib/i18n.ts";
import { de } from "../i18n/de.ts";
import { en } from "../i18n/en.ts";
import { es } from "../i18n/es.ts";
import { it } from "../i18n/it.ts";
import { de as manualDe } from "../i18n/manual/de.ts";
import { en as manualEn } from "../i18n/manual/en.ts";
import { es as manualEs } from "../i18n/manual/es.ts";
import { it as manualIt } from "../i18n/manual/it.ts";

/*
 * Langue côté serveur : chaque requête s'exécute dans la langue de l'écran qui l'envoie (en-tête
 * `X-Langue`), sinon dans celle que le membre a choisie (`users.language`), sinon en français.
 * `t()` (src/lib/i18n.ts) lit ce contexte : il ne traduit donc qu'au moment de la requête — un texte
 * écrit au chargement d'un module se marque avec `tk()` et se traduit là où il est rendu.
 * Les tâches de fond (résumé du lundi, notifications) passent par `runInLang(await memberLang(id), …)`.
 * Les dictionnaires sont importés ici d'un bloc : jamais d'import dynamique d'un module local côté serveur.
 */

registerDict("en", en);
registerDict("de", de);
registerDict("it", it);
registerDict("es", es);
// Textes du manuel : rangés à part pour l'appareil (chargés avec l'écran Manuel), tous connus du serveur.
extendDict("en", manualEn);
extendDict("de", manualDe);
extendDict("it", manualIt);
extendDict("es", manualEs);

const store = new AsyncLocalStorage<Lang>();
setLangResolver(() => store.getStore() ?? DEFAULT_LANG);

/** Exécute fn dans une langue donnée. */
export const runInLang = <T>(lang: Lang, fn: () => T): T => store.run(lang, fn);

/** Langues choisies, gardées en mémoire (un seul processus) : lues à chaque requête. */
const chosen = new Map<number, Lang | null>();

/** Langue choisie par le membre ; null tant qu'il n'a rien choisi. Les membres vivent dans la vraie base, même en démo. */
export async function storedLang(userId: number): Promise<Lang | null> {
  const known = chosen.get(userId);
  if (known !== undefined) return known;
  const row = await runReal(() => one<{ language: string | null }>("SELECT language FROM users WHERE id = ?", [userId]));
  const lang = isLang(row?.language) ? row.language : null;
  chosen.set(userId, lang);
  return lang;
}

/** Langue du membre (le français par défaut). */
export const memberLang = async (userId: number): Promise<Lang> => (await storedLang(userId)) ?? DEFAULT_LANG;

export async function setMemberLang(userId: number, lang: Lang) {
  await runReal(() => exec("UPDATE users SET language = ? WHERE id = ?", [lang, userId]));
  chosen.set(userId, lang);
}

/** Middleware (après loadUser) : pose la langue de la requête. Ne fait jamais échouer la requête. */
export function langContext(req: Request, _res: Response, next: NextFunction) {
  const header = req.get("x-langue");
  if (isLang(header)) return store.run(header, next);
  // Sans en-tête ni membre : le français. La langue du navigateur ne décide de rien (Pécule est en français tant qu'on n'a pas choisi).
  if (!req.user) return store.run(DEFAULT_LANG, next);
  storedLang(req.user.id).then(
    (lang) => store.run(lang ?? DEFAULT_LANG, next),
    () => store.run(DEFAULT_LANG, next),
  );
}
