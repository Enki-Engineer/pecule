/*
 * Journal des mouvements crypto : les genres d'un mouvement, son état, et ce qu'on en déduit (cours unitaire, titre
 * proposé) — sans base ni réseau (testé dans crypto-events.test.ts). Le journal est un récit tenu par le membre : un
 * mouvement peut résumer une période (« récompenses de l'année »), il n'a pas à suivre chaque ligne d'un relevé.
 */

import { tk } from "./i18n.ts";

/** Genres d'un mouvement (colonne `crypto_events.type`) : une liste fermée, traduite à l'affichage. */
export const EVENT_KINDS = ["achat", "vente", "echange", "depot", "retrait", "transfert", "staking", "fin-staking", "recompense", "interets", "minage", "prime", "autre"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Libellé de chaque genre, et ce qu'il recouvre (dit sous la liste du formulaire). */
export const EVENT_KIND_INFO: Record<EventKind, { label: string; hint: string }> = {
  achat: { label: tk("Achat##mouvement"), hint: tk("De la crypto achetée avec de la monnaie.") },
  vente: { label: tk("Vente##mouvement"), hint: tk("De la crypto vendue contre de la monnaie.") },
  echange: { label: tk("Échange##mouvement"), hint: tk("Une crypto échangée contre une autre.") },
  depot: { label: tk("Dépôt##mouvement"), hint: tk("De la monnaie versée sur une plateforme, par virement ou par carte.") },
  retrait: { label: tk("Retrait##mouvement"), hint: tk("De la monnaie revenue d'une plateforme vers ta banque.") },
  transfert: { label: tk("Transfert##mouvement"), hint: tk("De la crypto déplacée d'un portefeuille à un autre.") },
  staking: { label: tk("Mise en staking"), hint: tk("De la crypto immobilisée pour produire des récompenses.") },
  "fin-staking": { label: tk("Sortie de staking"), hint: tk("De la crypto immobilisée qui redevient disponible.") },
  recompense: { label: tk("Récompenses##mouvement"), hint: tk("Ce que le staking a rapporté.") },
  interets: { label: tk("Intérêts##mouvement"), hint: tk("Ce qu'un prêt ou un compte rémunéré a rapporté.") },
  minage: { label: tk("Minage"), hint: tk("De la crypto reçue en minant.") },
  prime: { label: tk("Prime ou airdrop"), hint: tk("De la crypto reçue sans rien payer : parrainage, airdrop, remise.") },
  autre: { label: tk("Autre##mouvement"), hint: tk("Tout ce qui ne rentre dans aucun autre genre.") },
};

/** État d'un mouvement : fait, ou en attente (ordre posé et pas encore exécuté, retrait en cours d'examen). */
export const EVENT_STATUSES = ["fait", "attente"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Genres écrits en toutes lettres avant la liste fermée (reprise d'un autre outil), du plus précis au plus large. */
const LEGACY: [RegExp, EventKind][] = [
  [/^staking\b.*sortie/, "fin-staking"],
  [/^staking\b.*recompense/, "recompense"],
  [/^staking\b/, "staking"],
  [/^depot\b/, "depot"],
  [/^retrait\b/, "retrait"],
  [/^interets?\b/, "interets"],
  [/^(mining|minage)\b/, "minage"],
  [/^(echange|swap)\b/, "echange"],
  [/^(achat|buy)\b/, "achat"],
  [/^(vente|sell)\b/, "vente"],
  [/^transfert\b/, "transfert"],
  [/^(airdrop|prime|parrainage)\b/, "prime"],
];

/**
 * Genre d'un mouvement tel qu'il est écrit en base ou donné par une reprise : un genre de la liste, ou `null` pour
 * un texte que Pécule ne connaît pas (il reste affiché tel quel, rien n'est deviné).
 */
export function kindOf(raw: string | null | undefined): EventKind | null {
  const text = plain(raw ?? "");
  if (!text) return null;
  if ((EVENT_KINDS as readonly string[]).includes(text)) return text as EventKind;
  return LEGACY.find(([re]) => re.test(text))?.[1] ?? null;
}

/** Genres où la crypto s'échange contre de la monnaie : le montant divisé par la quantité donne un cours. */
const PRICED: EventKind[] = ["achat", "vente"];

/**
 * Cours unitaire d'un mouvement, dans la devise du foyer : celui qui a été noté, sinon — pour un achat ou une
 * vente d'une seule crypto — le montant divisé par la quantité. `derived` : il est déduit, donc frais compris.
 */
export function unitPrice(e: { type: string | null; quantity: number | null; value: number | null; price?: number | null }): { price: number; derived: boolean } | null {
  if (e.price != null && Number(e.price) > 0) return { price: Number(e.price), derived: false };
  const kind = kindOf(e.type);
  const quantity = Math.abs(Number(e.quantity ?? 0));
  const value = Math.abs(Number(e.value ?? 0));
  if (!kind || !PRICED.includes(kind) || !(quantity > 0) || !(value > 0)) return null;
  return { price: value / quantity, derived: true };
}

/** Titre proposé quand le membre n'en écrit pas : le genre, ce qui a bougé, où (« Achat · 0,094 BTC · Kraken »). */
export function defaultTitle(kindLabel: string, what: string | null, where: string | null): string {
  return [kindLabel, what, where]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" · ")
    .slice(0, 255);
}

/** Vrai si la période d'un mouvement est cohérente : pas de fin, ou une fin qui ne précède pas le début. */
export const validPeriod = (date: string, endDate: string | null | undefined) => !endDate || endDate >= date;
