/*
 * Passage d'un écran à l'autre où un élément glisse de sa place à la suivante : le coffre, de l'écran de connexion à
 * la présentation de bienvenue, puis de celle-ci au menu de l'appli (même `view-transition-name` des deux côtés).
 *
 * Le navigateur prend l'image de l'écran qu'on quitte, on change d'adresse, et il attend que l'écran d'arrivée se
 * soit dessiné (`arrived()`, appelé par cet écran) pour faire glisser l'un vers l'autre. Le routeur ne le fait pas
 * pour nous : sa propre option de transition ne vaut que pour son mode « données ». Là où le navigateur ne sait pas
 * faire, ou quand l'appareil réduit les animations, on change simplement d'écran.
 */

let arrive: (() => void) | null = null;

/** Change d'écran (`change` appelle `navigate`) en laissant le navigateur fondre l'ancien dans le nouveau. */
export function passage(change: () => void) {
  if (!("startViewTransition" in document) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          arrive = null;
          resolve();
        };
        // L'écran d'arrivée n'a rien dit (code encore en route, erreur) : on n'attend pas davantage.
        const timer = setTimeout(done, 700);
        arrive = done;
        change();
      }),
  );
  // Fondu abandonné par le navigateur (onglet masqué, autre passage lancé) : l'écran a changé quand même, rien à dire.
  transition.ready.catch(() => undefined);
  transition.finished.catch(() => undefined);
}

/** À appeler par l'écran d'arrivée une fois dessiné (dans un `useLayoutEffect`). Sans passage en cours : rien. */
export const arrived = () => arrive?.();
