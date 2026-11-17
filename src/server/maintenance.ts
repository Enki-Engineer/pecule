/*
 * Ce que le reste du serveur a besoin de savoir d'une restauration en cours, sans dépendre de `restore.ts`
 * (qui dépend lui-même de l'identification) : pendant qu'une sauvegarde est rechargée dans une installation neuve,
 * personne ne doit y créer le premier membre.
 */

let restoring = false;

export const setRestoring = (value: boolean) => {
  restoring = value;
};

/** Une sauvegarde est en cours de restauration dans ce processus. */
export const isRestoring = () => restoring;
