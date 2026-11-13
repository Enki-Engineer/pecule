import "../styles/index.css";
import { initLang } from "./i18n.ts";

// La langue et son dictionnaire d'abord, l'appli ensuite : un texte écrit au chargement d'un module
// (menus, libellés d'état, titres d'écran) est ainsi déjà dans la bonne langue. En français, rien à attendre.
void initLang().then(() => import("./app.tsx"));
