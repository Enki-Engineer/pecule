/*
 * Hors d'un contexte que le navigateur juge sûr — Pécule servi en http sur le réseau de la maison —, il n'y a pas de
 * `navigator.clipboard` : tous les boutons « Copier » de l'appli échoueraient. On lui rend ici l'essentiel, écrire un
 * texte, par l'ancienne voie (un champ hors de l'écran et `document.execCommand("copy")`), qui marche dans le geste
 * d'un clic. En https et sur localhost, rien n'est touché.
 */
function copyThroughField(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    field.style.opacity = "0";
    document.body.appendChild(field);
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.select();
    let done = false;
    try {
      done = document.execCommand("copy");
    } catch {
      done = false;
    }
    field.remove();
    focused?.focus();
    if (done) resolve();
    else reject(new Error("Copie impossible"));
  });
}

if (typeof navigator !== "undefined" && !navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: copyThroughField }, configurable: true });
}
