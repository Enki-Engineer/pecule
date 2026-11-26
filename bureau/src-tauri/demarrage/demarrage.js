// L'écran de démarrage ne sait rien : la coque lui dit quoi montrer (`afficher`), et ses boutons ne sont que des
// liens qu'elle intercepte (« pecule-action://… »). Aucun échange dans l'autre sens.
window.afficher = function (etat) {
  var titre = document.getElementById("titre");
  var detail = document.getElementById("detail");
  var boutons = document.getElementById("boutons");
  document.documentElement.lang = etat.langue || "fr";
  titre.textContent = etat.titre || "";
  titre.className = etat.erreur ? "erreur" : "";
  detail.textContent = etat.detail || "";
  detail.hidden = !etat.erreur || !etat.detail;
  boutons.hidden = !etat.erreur;
  document.getElementById("reessayer").textContent = etat.reessayer || "";
  document.getElementById("journaux").textContent = etat.journaux || "";
};
