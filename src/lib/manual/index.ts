import type { ManualTheme } from "../manual.ts";
import { premiersPas } from "./premiers-pas.ts";
import { comptes } from "./comptes.ts";
import { operations } from "./operations.ts";
import { analyseBudget } from "./analyse-budget.ts";
import { factures } from "./factures.ts";
import { patrimoine } from "./patrimoine.ts";
import { situation } from "./situation.ts";
import { documents } from "./documents.ts";
import { assistant } from "./assistant.ts";
import { personnaliser } from "./personnaliser.ts";
import { foyer } from "./foyer.ts";
import { securite } from "./securite.ts";

/*
 * Contenu du manuel, un fichier par thème (règles d'écriture : src/lib/manual.ts). Ajouter un article = l'écrire
 * dans son thème, avec ses traductions ; un thème de plus = son fichier, une ligne ici et son icône dans
 * src/client/pages/Manual.tsx. L'assistant le trouve tout seul (recherche et sommaire de ses consignes).
 */
export const MANUAL: ManualTheme[] = [premiersPas, comptes, operations, analyseBudget, factures, patrimoine, situation, documents, assistant, personnaliser, foyer, securite];
