import { AsyncLocalStorage } from "node:async_hooks";

/*
 * Mode démo : une requête d'une session « démo » s'exécute dans ce contexte, et la connexion à la
 * base (pool, q/one/exec, Drizzle) vise alors la base de données fictives au lieu de la vraie.
 * Module sans dépendance : db.ts l'importe.
 */

const store = new AsyncLocalStorage<boolean>();

/** Vrai pendant une requête de démo (et tout ce qu'elle déclenche, même en différé). */
export const isDemo = () => store.getStore() === true;

/** Exécute fn sur la base de démo. */
export const runDemo = <T>(fn: () => T): T => store.run(true, fn);

/** Exécute fn sur la vraie base, même depuis une requête de démo (journal technique, coût de l'IA, logos). */
export const runReal = <T>(fn: () => T): T => store.run(false, fn);
