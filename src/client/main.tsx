import "../styles/index.css";
import { initLang } from "./i18n.ts";
import { watchErrors } from "./report.ts";

// Avant tout le reste : ce que rien n'attrape (erreur de script, promesse sans suite) remonte au serveur du foyer,
// comme un écran tombé — y compris une panne au chargement de l'appli elle-même.
watchErrors();

// La langue et son dictionnaire d'abord, l'appli ensuite : un texte écrit au chargement d'un module
// (menus, libellés d'état, titres d'écran) est ainsi déjà dans la bonne langue. En français, rien à attendre.
void initLang().then(() => import("./app.tsx"));
