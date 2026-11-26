import { DEFAULT_LANG, LANG_IDS, translate, tk, type Lang } from "./i18n.ts";

/*
 * Les mots de la coque de l'appli de bureau (`bureau/src-tauri`) : son menu, son écran de démarrage, ses fenêtres.
 * Elle n'a pas les dictionnaires de l'appli sous la main quand elle s'ouvre — le serveur n'a pas démarré — : ils lui
 * sont donnés dans un fichier, `bureau/src-tauri/textes.json`, fabriqué d'ici par `pnpm exec tsx scripts/bureau-textes.ts`
 * (un test compare). Un texte ajouté ici se traduit comme tout autre texte de Pécule.
 */
export const SHELL_TEXTS = {
  // Menu « Pécule »
  about: tk("À propos de Pécule"),
  update: tk("Rechercher une mise à jour…"),
  hide: tk("Masquer Pécule"),
  hideOthers: tk("Masquer les autres"),
  showAll: tk("Tout afficher"),
  quit: tk("Quitter Pécule"),
  // Menu « Édition »
  edit: tk("Édition"),
  undo: tk("Annuler##défaire"),
  redo: tk("Rétablir"),
  cut: tk("Couper"),
  copy: tk("Copier"),
  paste: tk("Coller"),
  selectAll: tk("Tout sélectionner"),
  // Menu « Présentation »
  view: tk("Présentation##menu"),
  reload: tk("Recharger"),
  back: tk("Page précédente"),
  forward: tk("Page suivante"),
  zoomIn: tk("Agrandir"),
  zoomOut: tk("Rétrécir"),
  zoomReset: tk("Taille réelle"),
  fullscreen: tk("Plein écran"),
  // Menu « Fenêtre »
  window: tk("Fenêtre"),
  minimize: tk("Placer dans le Dock"),
  close: tk("Fermer la fenêtre"),
  // Menu « Aide »
  help: tk("Aide"),
  manual: tk("Manuel de Pécule"),
  forgot: tk("Mot de passe oublié…"),
  dataFolder: tk("Ouvrir le dossier des données"),
  logs: tk("Ouvrir les journaux"),
  site: tk("Site de Pécule"),
  // Écran de démarrage
  starting: tk("Pécule démarre…"),
  stepCreate: tk("Création de la base, une seule fois…"),
  stepDatabase: tk("Démarrage de la base…"),
  stepServer: tk("Démarrage de Pécule…"),
  failed: tk("Pécule n'a pas pu démarrer"),
  stopped: tk("Pécule s'est arrêté"),
  retry: tk("Réessayer"),
  // Mise à jour
  upToDate: tk("Pécule est à jour."),
  updateAvailable: tk("Pécule {version} est disponible."),
  updateAsk: tk("L'installer maintenant ? Pécule se ferme le temps de la mise à jour, puis se rouvre."),
  updateInstall: tk("Installer"),
  updateLater: tk("Plus tard"),
  updating: tk("Mise à jour de Pécule…"),
  updateFailed: tk("La mise à jour n'a pas abouti. Pécule reprend avec la version en place."),
  updateUnreachable: tk("La recherche de mise à jour n'a pas abouti : vérifie ta connexion, puis réessaie."),
  updateStep: tk("Ta version est trop ancienne pour passer d'un coup à la {version} : installe d'abord la version {palier}. La page de Pécule dit comment."),
  // Questions d'une page (`confirm`), et de la coque
  cancel: tk("Annuler"),
  // Fenêtre de la banque, mot de passe oublié
  bank: tk("Relier ta banque"),
  whichMember: tk("Pour quel membre ?"),
  busy: tk("Pécule n'a pas répondu : réessaie dans un instant."),
} as const;

export type ShellTextId = keyof typeof SHELL_TEXTS;

/** Les mots de la coque dans une langue. */
export function shellTexts(lang: Lang): Record<ShellTextId, string> {
  return Object.fromEntries(Object.entries(SHELL_TEXTS).map(([id, text]) => [id, translate(lang, text)])) as Record<ShellTextId, string>;
}

/** Le fichier que la coque embarque : chaque langue de Pécule, le français d'abord (il sert de repli). */
export function shellTextsFile(): string {
  const langs = [DEFAULT_LANG, ...LANG_IDS.filter((l) => l !== DEFAULT_LANG)];
  return `${JSON.stringify(Object.fromEntries(langs.map((l) => [l, shellTexts(l)])), null, 2)}\n`;
}
