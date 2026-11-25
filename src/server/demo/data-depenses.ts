/*
 * Vie courante d'une famille nantaise (deux adultes, Léo, Moka le chien), avec la saison : vacances
 * d'été (gîte en juillet, location en Bretagne en août), rentrée en septembre, Toussaint, cadeaux
 * en décembre, anniversaire de Léo en mai. Marchands du référentiel des logos quand c'est possible.
 */
import { CARDS, type CardAcc, type Month, type Ops } from "./context.ts";
import { addDays, cardDay } from "./rng.ts";

/** Marchand : libellé bancaire, nom (Finta), poids, montant min et max, catégorie si différente. */
type Shop = readonly [label: string, merchant: string | null, weight: number, min: number, max: number, cat?: string];
type Who = readonly (readonly [CardAcc, number])[];
const JOINT: Who = [["joint", 1]];

const GROCERIES: readonly Shop[] = [
  ["Carrefour Nantes Beaujoire", "Carrefour", 3, 35, 150],
  ["E.leclerc Saint Herblain", "E.Leclerc", 2.5, 38, 152],
  ["Lidl Nantes Doulon", "Lidl", 2.5, 16, 74],
  ["Monoprix Nantes Calvaire", "Monoprix", 1.5, 7, 38],
  ["Picard Nantes Zola", "Picard", 0.8, 14, 52],
  ["Biocoop Nantes Talensac", "Biocoop", 1, 11, 46],
  ["Grand Frais Saint Herblain", "Grand Frais", 1, 21, 63],
];
const MARKET: readonly Shop[] = [
  ["Sumup *Primeur Talensac", null, 2, 8, 31],
  ["Sumup *Fromagerie Talensac", null, 1, 9, 27],
  ["Sumup *Poissonnerie Du Marche", null, 1, 12, 38],
];
const BAKERY: readonly Shop[] = [
  ["Boulangerie Au Pain Dore", null, 4, 2.2, 13.8],
  ["Boulangerie Le Fournil Nantais", null, 3, 2.4, 11.6],
  ["Paul Nantes Gare", "Paul", 1, 3.9, 12.5],
  ["Starbucks Nantes Commerce", "Starbucks", 1, 4.6, 8.9],
  ["Cafe Le Hangar", null, 1, 2.2, 6.4],
];
const RESTAURANTS: readonly Shop[] = [
  ["Creperie Le Ble Noir", null, 2, 31, 68],
  ["Pizzeria Da Marco", null, 2, 34, 72],
  ["Le Quai Des Saveurs", null, 1, 48, 96],
  ["Mcdonald's Nantes Atlantis", "McDonald's", 1.5, 17, 33],
];
const LUNCH_A: readonly Shop[] = [
  ["Cantine Du Hangar", null, 3, 10.5, 15.9],
  ["Sushi Sakura Nantes", null, 1, 13.2, 19.8],
  ["Le Comptoir Du Midi", null, 2, 11, 16.5],
];
const LUNCH_C: readonly Shop[] = [
  ["Salad Bar Graslin", null, 2, 9.5, 13.9],
  ["Le Petit Bouchon", null, 1, 12, 17.5],
  ["Boulangerie Au Pain Dore", null, 1, 6.5, 9.9, "B3-03"],
];
const HOME: readonly Shop[] = [
  ["Ikea Nantes Saint Herblain", "IKEA", 1, 18, 165],
  ["Leroy Merlin Reze", "Leroy Merlin", 1.4, 8, 92],
  ["Castorama Nantes", "Castorama", 0.6, 7, 58],
  ["Maisons Du Monde Nantes", null, 0.3, 24, 119],
  ["Action Nantes Beaujoire", "Action", 1, 4, 32],
];
const CLOTHES: readonly Shop[] = [
  ["Zara Nantes", "Zara", 1, 25, 89],
  ["H&m Nantes Atlantis", "H&M", 1.2, 12, 49],
  ["Uniqlo Nantes", "Uniqlo", 0.8, 19, 79],
  ["Vinted", "Vinted", 0.8, 7, 28],
  ["Celio Nantes", null, 0.4, 19, 59],
];
const MISC: readonly Shop[] = [
  ["La Poste Nantes Bouffay", "La Poste", 1, 1.5, 14],
  ["Mondial Relay", "Mondial Relay", 0.5, 4.5, 6.9],
  ["Tabac Presse Du Commerce", null, 1, 2, 12],
];
const GIFTS: readonly Shop[] = [
  ["Cultura Nantes Atlantis", "Cultura", 1, 12, 38],
  ["Le Pot Commun", null, 1, 10, 30],
  ["Fnac Nantes", "Fnac", 1, 15, 45],
];
const XMAS: readonly Shop[] = [
  ["Fnac Nantes", "Fnac", 2, 25, 110],
  ["Cultura Nantes Atlantis", "Cultura", 1.5, 15, 60],
  ["King Jouet Nantes", null, 1.5, 20, 75],
  ["Sephora Nantes", "Sephora", 1, 25, 70],
  ["Decathlon Saint Herblain", "Decathlon", 1, 20, 90],
  ["Galeries Lafayette Nantes", null, 1, 30, 115],
];

export function spendMonth(ops: Ops, mo: Month): void {
  const R = ops.R;
  const { m, off, n, rnd, at } = mo;
  const summer = m === 7 || m === 8;
  const pickShop = (shops: readonly Shop[]) => R.weighted(shops.map((x) => [x, x[2]] as const));
  const spend = (mean: number, cat: string, who: Who, shops: readonly Shop[]) => {
    for (let i = n(mean); i > 0; i--) {
      const s = pickShop(shops);
      ops.card(R.weighted(who), rnd(), s[0], s[1], R.amount(s[3], s[4]), s[5] ?? cat);
    }
  };
  /** Consultation à 30 € remboursée par l'Assurance maladie quelques jours plus tard. */
  const care = (who: Who, mean: number, shop: string, cat: string) => {
    for (let i = n(mean); i > 0; i--) {
      const acc = R.weighted(who);
      const t = ops.card(acc, rnd(), shop, null, 30, cat);
      if (t) ops.virIn(acc, addDays(t.date, R.int(4, 9)), "Cpam Loire Atlantique Remboursement Soins", 19, "A6");
    }
  };
  const often = (p: number) => R.chance(p * mo.share);

  // Alimentation
  spend(m === 8 ? 9 : m === 7 ? 11 : m === 12 ? 17 : 16, "B3-01", [["joint", 86], ["a", 7], ["c", 7]], GROCERIES);
  spend(4, "B3-01", [["c", 1]], [["Monop'daily Nantes Commerce", "Monoprix", 1, 4, 16]]);
  spend(summer ? 1.5 : 4.5, "B3-02", JOINT, MARKET);
  spend(20, "B3-03", [["joint", 5], ["a", 3], ["c", 2]], BAKERY);
  spend(summer ? 5 : 8, "B3-03", [["a", 1]], [["Selecta Distributeur Cafe", null, 1, 0.6, 1.8]]);
  spend(summer ? 5 : 2.2, "B3-04", JOINT, RESTAURANTS);
  spend(summer ? 6 : 9, "B3-04", [["a", 1]], LUNCH_A);
  spend(summer ? 5 : 7, "B3-04", [["c", 1]], LUNCH_C);
  spend(1.4, "B3-05", JOINT, [["Deliveroo", "Deliveroo", 2, 19, 44], ["Uber Eats Help.uber.com", "Uber Eats", 1, 17, 39]]);

  // Transports (voiture électrique : recharges, péages ; bus et tram)
  spend(summer ? 3.5 : 2.4, "B2-03", [["joint", 7], ["a", 3]], [["Totalenergies Rechar Nantes", "TotalEnergies", 3, 9, 31], ["Ionity Gmbh", "Ionity", summer ? 3 : 0.6, 18, 42]]);
  spend(summer ? 4 : 1, "B2-03", JOINT, [["Vinci Autoroutes", "Vinci Autoroutes", 1, 2.6, 26.4]]);
  spend(1.2, "B2-04", JOINT, [["Parking Nantes Commerce", null, 1, 2.8, 12]]);
  spend(5, "B2-04", [["a", 1]], [["Naolib Ticket Unite", null, 1, 1.9, 1.9]]);
  spend(0.25, "B2-04", [["a", 1], ["c", 1]], [["Uber Trip Help.uber.com", "Uber", 1, 11, 27]]);
  if (often(0.15)) ops.card("joint", rnd(), "Norauto Saint Herblain", null, R.amount(49, 260), "B2-01");
  if (off === -9) ops.card("joint", at(R.int(3, 25)), "Garage Du Pont Rousseau", null, 864.2, "B2-01", { note: "Plaquettes, disques et deux pneus" });

  // Maison
  spend(2, "B1-06", JOINT, HOME);

  // Léo
  if (!summer) spend(1.5, "B4-02", JOINT, [["Piscine Du Petit Port", null, 1, 4.8, 4.8]]);
  spend(m === 9 || m === 11 ? 1.6 : 0.5, "B4-04", JOINT, [["Kiabi Nantes Paridis", "Kiabi", 3, 12, 58], ["Vertbaudet", null, 1, 19, 64]]);
  spend(0.3, "B4-05", JOINT, [["Pharmacie Des Olivettes", null, 1, 4, 18]]);
  care(JOINT, 0.15, "Dr Le Gall Pediatre", "B4-05");
  if (m === 8) ops.card("joint", at(R.int(20, 28)), "Cultura Nantes Atlantis", "Cultura", R.amount(38, 72), "B4-01", { note: "Fournitures de rentrée" });
  if (m === 9) {
    ops.card("joint", at(R.int(2, 6)), "Action Nantes Beaujoire", "Action", R.amount(9, 24), "B4-01", { note: "Fournitures de rentrée" });
    ops.card("joint", at(R.int(8, 16)), "Judo Club Nantes Erdre", null, 185, "B4-02", { note: "Licence et cotisation de judo de Léo" });
  }

  // Moka
  if (often(1)) ops.card("joint", rnd(), "Maxi Zoo Saint Herblain", null, R.amount(46, 64), "B5-01");
  if (m === 3) ops.card("joint", at(R.int(4, 24)), "Clinique Veterinaire De L'erdre", null, R.amount(72, 96), "B5-02", { note: "Rappel des vaccins de Moka" });
  else if (often(0.1)) ops.card("joint", rnd(), "Clinique Veterinaire De L'erdre", null, R.amount(48, 190), "B5-02");
  if (m === 8) ops.virOut("joint", at(R.int(1, 5)), "Pension Canine Les Mille Pattes", 210, "B5-03");
  spend(0.4, "B5-04", JOINT, [["Animalis Nantes", null, 1, 6, 29]]);

  // Santé des adultes
  spend(1.5, "B6-01", [["joint", 2], ["a", 1], ["c", 2]], [["Pharmacie Des Olivettes", null, 1, 3.5, 32]]);
  care([["a", 1], ["c", 1.4]], 0.35, "Dr Morel Medecin Generaliste", "B6-01");
  if (often(0.08)) ops.card(R.pick(["a", "c"] as const), rnd(), "Cabinet Dentaire Graslin", null, R.amount(45, 120), "B6-01");
  if (off === -7) {
    const t = ops.card("c", at(R.int(3, 12)), "Opticien Du Commerce", null, 289, "B6-01", { note: "Nouvelles lunettes" });
    if (t) ops.virIn("c", addDays(t.date, 12), "Mutuelle Nerine Remboursement", 210, "A6");
  }

  // Loisirs et vacances
  spend(0.5, "B9-01", JOINT, [["Cinema Pathe Atlantis", null, 1, 24, 38]]);
  spend(0.35, "B9-01", [["joint", 1], ["a", 1]], [["Fnac Nantes", "Fnac", 1, 12, 45], ["Decathlon Saint Herblain", "Decathlon", 1, 9, 68]]);
  spend(0.12, "B9-01", [["a", 1], ["c", 1]], [["Billetweb", null, 1, 29, 95]]);
  if (m === 10) ops.card("joint", at(R.int(20, 30)), "Puy Du Fou Billetterie", null, 133, "B9-01", { note: "Sortie des vacances de la Toussaint" });
  if (m === 2) ops.card("joint", at(R.int(6, 18)), `Airbnb * Hm${R.hex(8).toUpperCase()}`, "Airbnb", 236, "B9-03", { note: "Week-end à La Baule" });
  if (m === 4) ops.card("a", at(R.int(1, 8)), "Sncf Connect", "SNCF", 152.4, "B9-04", { note: "Pâques chez les grands-parents" });
  if (m === 7) {
    ops.virOut("joint", at(R.int(3, 7)), "Gites De France Dordogne Solde Sejour", 1140, "B9-03");
    spend(3, "B3-01", JOINT, [["Intermarche Sarlat", "Intermarché", 1, 35, 96]]);
    ops.card("joint", at(R.int(12, 24)), "Canoe Vezere Loisirs", null, 64, "B9-01");
  }
  if (m === 8) {
    ops.card("joint", at(R.int(2, 6)), `Airbnb * Hm${R.hex(8).toUpperCase()}`, "Airbnb", 1280, "B9-03", { note: "Vacances en Bretagne" });
    spend(3, "B3-01", JOINT, [["Super U Crozon", null, 1, 38, 92]]);
    spend(2, "B3-04", JOINT, [["Glacier Les Iles", null, 1, 8, 14]]);
  }

  // Fêtes et cadeaux
  if (m === 12) {
    ops.card("a", at(R.int(1, 10)), "Sncf Connect", "SNCF", 186, "B9-04", { note: "Noël chez les grands-parents" });
    for (let i = 0; i < 8; i++) {
      const s = pickShop(XMAS);
      ops.card(R.pick(["joint", "a", "c"] as const), at(R.int(1, 22)), s[0], s[1], R.amount(s[3], s[4]), "B12-01");
    }
    ops.virOut("joint", at(R.int(10, 20)), "Les Restos Du Coeur Don", 150, "B12-01");
    ops.virIn("joint", at(R.int(18, 23)), "Martine Lefort Cadeau De Noel", 150, "A5");
  }
  if (m === 5) {
    ops.card("joint", at(R.int(10, 18)), "King Jouet Nantes", null, R.amount(45, 70), "B12-01", { note: "Anniversaire de Léo" });
    ops.virIn("joint", at(R.int(10, 18)), "Martine Lefort Anniversaire Leo", 50, "A5");
    ops.card("a", at(R.int(20, 28)), "Interflora", null, 39.9, "B12-01", { note: "Fête des mères" });
  }
  if (m === 6) ops.card("c", at(R.int(12, 20)), "Cave Des Vins De Loire", null, 34.5, "B12-01", { note: "Fête des pères" });
  spend(0.5, "B12-01", [["joint", 1], ["a", 1], ["c", 1]], GIFTS);

  // Divers, beauté, vêtements
  spend(2, "B12-02", [["joint", 1], ["a", 1], ["c", 1]], MISC);
  spend(2.5, "B12-02", [["a", 1]], [["Relay Gare Nantes", null, 1, 2.1, 8.9]]);
  for (let i = n(2); i > 0; i--) {
    const cat = R.weighted([["B12-02", 5], ["B1-06", 2], ["B9-01", 1.5], ["B4-01", 1.5]] as const);
    ops.card(R.weighted([["joint", 3], ["a", 2], ["c", 1]] as const), rnd(), R.pick(["Amzn Mktp Fr", "Amazon Payments"]), "Amazon", R.amount(8.99, 59.9), cat);
  }
  if (often(0.7)) ops.card("c", rnd(), "Salon Mademoiselle Coiffure", null, R.amount(52, 74), "B12-03");
  if (often(0.8)) ops.card("a", rnd(), "Barber Shop Bouffay", null, R.amount(22, 26), "B12-03");
  if (often(0.45)) ops.card("joint", rnd(), "Barber Shop Bouffay", null, 14, "B12-03", { note: "Coupe de Léo" });
  spend(0.45, "B12-03", [["c", 1]], [["Sephora Nantes", "Sephora", 2, 14, 58], ["Nocibe Nantes", "Nocibé", 1, 12, 44]]);
  spend(m === 1 || m === 7 ? 2.2 : 1.3, "B12-04", [["a", 1], ["c", 1.5]], CLOTHES);
  if (off === -5) {
    const d = at(R.int(8, 20));
    ops.push({ acc: "c", date: addDays(d, 1), amount: 39.95, label: `Avoir ${cardDay(d)} Zara Nantes Cb ${CARDS.c}`, merchant: "Zara", cat: "B12-04", kind: "avoir", source: "manuel", note: "Retour d'un pantalon" });
  }

  // Espèces et petites ventes
  for (let i = n(0.9); i > 0; i--) ops.withdraw(R.weighted([["a", 5], ["c", 3], ["joint", 2]] as const), rnd(), R.pick([20, 30, 40, 50, 60, 80]));
  for (let i = n(0.4); i > 0; i--) ops.virIn("c", rnd(), "Vinted Uab Porte Monnaie", R.amount(8, 32), "A3");
  if (off === -10) ops.virIn("joint", at(R.int(5, 20)), "Leboncoin Paiement Securise", 120, "A3", null, { note: "Vente de l'ancienne poussette" });
}
