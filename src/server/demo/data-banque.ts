/*
 * Banque de la démo : référentiel des catégories (mêmes codes que le vrai, A2 et B10 adaptés), comptes
 * et motifs de règles de classement candidats (gardés seulement s'ils sont cohérents avec les opérations).
 */
import type * as schema from "../db/schema/index.ts";
import type { AccKey } from "./context.ts";
import { type DemoUser, type Insert, Rand, memberKey } from "./rng.ts";

type Cat = readonly [id: string, poste: string, name: string, description?: string];

const CATEGORIES: readonly Cat[] = [
  ["A1", "Revenus", "Salaire", "Salaires nets versés par les employeurs"],
  ["A2", "Revenus", "Revenus locatifs", "Loyers du studio meublé"],
  ["A3", "Revenus", "Ventes ponctuelles", "Vinted, leboncoin…"],
  ["A4", "Revenus", "Revenus d'investissements (dividendes, intérêts)", "Intérêts des livrets"],
  ["A5", "Revenus", "Cadeaux/dons"],
  ["A6", "Revenus", "Remboursements", "Assurance maladie, mutuelle"],
  ["B1-01", "Logement", "Loyer / Crédit immobilier"],
  ["B1-02", "Logement", "Charges de copropriété"],
  ["B1-03", "Logement", "Électricité / Gaz / Eau"],
  ["B1-04", "Logement", "Assurance habitation"],
  ["B1-05", "Logement", "Internet / Téléphonie"],
  ["B1-06", "Logement", "Ameublement/Equipement"],
  ["B2-01", "Transports", "Entretien/réparations"],
  ["B2-02", "Transports", "Assurance auto"],
  ["B2-03", "Transports", "Péages et recharges"],
  ["B2-04", "Transports", "Transports/déplacements"],
  ["B3-01", "Alimentation", "Courses (supermarché)"],
  ["B3-02", "Alimentation", "Marché"],
  ["B3-03", "Alimentation", "Boulangerie/café"],
  ["B3-04", "Alimentation", "Restaurants"],
  ["B3-05", "Alimentation", "Livraisons de repas"],
  ["B4-01", "Famille", "Ecole/Fournitures (enfant)"],
  ["B4-02", "Famille", "Activités/Périscolaires/Loisirs (enfant)"],
  ["B4-03", "Famille", "Crèche/Garderie (enfant)"],
  ["B4-04", "Famille", "Vêtements (enfant)"],
  ["B4-05", "Famille", "Soins (enfant)"],
  ["B5-01", "Animaux", "Nourriture (chien)"],
  ["B5-02", "Animaux", "Soins/Vétérinaires (chien)"],
  ["B5-03", "Animaux", "Garde (chien)"],
  ["B5-04", "Animaux", "Accessoires/Friandises (chien)"],
  ["B6-01", "Santé & Prévoyance (adulte)", "Soins (médecin, pharmacie)"],
  ["B6-02", "Santé & Prévoyance (adulte)", "Mutuelle/Assurance vie (adulte)"],
  ["B7", "Impôts & Taxes", "Impôts / Taxes"],
  ["B8", "Epargne & Investissements", "Épargne & Investissements"],
  ["B9-01", "Loisirs & Vacances", "Loisirs (cinéma, concerts, sport)"],
  ["B9-02", "Loisirs & Vacances", "Abonnements (streaming, apps, etc.)"],
  ["B9-03", "Loisirs & Vacances", "Hébergements"],
  ["B9-04", "Loisirs & Vacances", "Voyages"],
  ["B10", "Dépenses de la SCI familiale", "SCI familiale", "Quote-part des appels de fonds de la maison de famille"],
  ["B11", "Frais bancaires", "Frais bancaires"],
  ["B12-01", "Divers & Imprévus", "Cadeaux / Dons"],
  ["B12-02", "Divers & Imprévus", "Divers / Imprévus"],
  ["B12-03", "Divers & Imprévus", "Esthétique (coiffure, massage,…)"],
  ["B12-04", "Divers & Imprévus", "Vêtements/chaussures"],
  ["C1", "Mouvements internes", "Transferts entre comptes"],
  ["C2", "Mouvements internes", "Retraits / dépôts espèces"],
];

/** Nature d'une catégorie, comme la reprise Notion (`kindOf` de scripts/import-notion.ts). */
export const kindOf = (id: string) => (id.startsWith("A") ? "revenu" : id === "B8" ? "epargne" : id.startsWith("C") ? "interne" : "depense");
const GROUPS: Record<string, string> = { revenu: "Revenus", depense: "Dépenses", epargne: "Épargne", interne: "Mouvements internes" };

export function categoryRows(): Insert<typeof schema.categories>[] {
  return CATEGORIES.map(([id, poste, name, description], i) => ({ id, name, poste, groupName: GROUPS[kindOf(id)], kind: kindOf(id), sortOrder: i, description: description ?? null }));
}

export type AccountDef = { id: string; name: string; displayName: string | null; institution: string; owner: string; kind: "courant" | "epargne"; opening: number; sortOrder: number };

/** Comptes de la famille (identifiants de compte fictifs au format GoCardless), solde d'ouverture de l'historique. */
export function accountDefs(ids: Rand, [a, c]: readonly [DemoUser, DemoUser]): Record<AccKey, AccountDef> {
  return {
    joint: { id: ids.uuid(), name: `Compte joint ${a.name} ou ${c.name}`, displayName: "Compte commun", institution: "BoursoBank", owner: "joint", kind: "courant", opening: 2400, sortOrder: 0 },
    a: { id: ids.uuid(), name: `Compte courant ${a.name}`, displayName: null, institution: "BoursoBank", owner: memberKey(a.name), kind: "courant", opening: 2100, sortOrder: 1 },
    livret: { id: ids.uuid(), name: `Livret A ${a.name}`, displayName: null, institution: "BoursoBank", owner: memberKey(a.name), kind: "epargne", opening: 6500, sortOrder: 2 },
    c: { id: ids.uuid(), name: `Compte courant ${c.name}`, displayName: null, institution: "Crédit Agricole", owner: memberKey(c.name), kind: "courant", opening: 1350, sortOrder: 3 },
    ldds: { id: ids.uuid(), name: `LDDS ${c.name}`, displayName: null, institution: "Crédit Agricole", owner: memberKey(c.name), kind: "epargne", opening: 4800, sortOrder: 4 },
  };
}

export function accountRows(defs: Record<AccKey, AccountDef>, final: Record<AccKey, number>, T: string): Insert<typeof schema.accounts>[] {
  return (Object.keys(defs) as AccKey[]).map((k) => {
    const d = defs[k];
    return { id: d.id, name: d.name, displayName: d.displayName, institution: d.institution, owner: d.owner, kind: d.kind, currency: "EUR", balance: final[k], balanceAt: `${T} 07:00:00`, sortOrder: d.sortOrder };
  });
}

/**
 * Motifs de règles (contenus dans la clé de libellé, comme `guessCategory`). Un motif n'est gardé que
 * si toutes les opérations dont il est le motif le plus long ont sa catégorie.
 */
export const RULE_CANDIDATES: readonly (readonly [string, string])[] = [
  ["nexalia conseil", "A1"],
  ["clinique de l estuaire", "A1"],
  ["lucie garnier", "A2"],
  ["vinted uab", "A3"],
  ["leboncoin", "A3"],
  ["interets crediteurs", "A4"],
  ["cpam", "A6"],
  ["harmonie mutuelle remboursement", "A6"],
  ["caisse d epargne", "B1-01"],
  ["syndic atlantique", "B1-02"],
  ["cabinet gerance anjou", "B1-02"],
  ["edf", "B1-03"],
  ["saur", "B1-03"],
  ["maif", "B1-04"],
  ["axa", "B1-04"],
  ["freebox", "B1-05"],
  ["free mobile", "B1-05"],
  ["orange", "B1-05"],
  ["macif", "B2-02"],
  ["vinci autoroutes", "B2-03"],
  ["naolib", "B2-04"],
  ["carrefour", "B3-01"],
  ["e leclerc", "B3-01"],
  ["lidl", "B3-01"],
  ["deliveroo", "B3-05"],
  ["uber eats", "B3-05"],
  ["restauration scolaire", "B4-01"],
  ["accueil de loisirs", "B4-02"],
  ["periscolaire", "B4-03"],
  ["harmonie mutuelle", "B6-02"],
  ["dgfip", "B7"],
  ["versement pea", "B8"],
  ["versement assurance vie", "B8"],
  ["coinbase", "B8"],
  ["basic fit", "B9-01"],
  ["netflix", "B9-02"],
  ["spotify", "B9-02"],
  ["disney", "B9-02"],
  ["canal", "B9-02"],
  ["sci les tilleuls", "B10"],
  ["cotisation offre", "B11"],
  ["participation", "C1"],
  ["complement compte joint", "C1"],
  ["vers livret", "C1"],
  ["vers ldds", "C1"],
  ["depuis livret", "C1"],
  ["depuis ldds", "C1"],
  ["compte courant", "C1"],
];
