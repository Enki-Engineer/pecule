/*
 * Factures de la démo : neuf achats reliés à leur opération carte (même date d'achat, même montant,
 * même marchand, comme le rapprochement automatique), une facture récente encore sans opération
 * (« à rapprocher ») et une ancienne, antérieure à l'historique, dont la garantie se termine bientôt.
 * Une commande Amazon à plusieurs catégories est ventilée exactement comme `ventilate()`.
 */
import type * as schema from "../db/schema/index.ts";
import { legalWarranty } from "../../lib/invoices.ts";
import type { CardAcc } from "./context.ts";
import type { Scenario } from "./model.ts";
import { demoPdf } from "./pdf.ts";
import { type DemoUser, type Insert, Rand, addDays, addMonths, dateFr, eur, r2 } from "./rng.ts";

/** Article : libellé, montant de la ligne, catégorie, quantité. */
type Item = readonly [label: string, amount: number, cat: string, qty?: number];

export type InvoiceSpec = {
  ref: string;
  /** Mois de l'achat (décalage par rapport au mois en cours) et jour ; null = hors historique. */
  off: number | null;
  day: number;
  date: string;
  merchant: string;
  title: string;
  owner: "a" | "c" | null;
  items: readonly Item[];
  total: number;
  warranty: boolean;
  /** Paiement carte généré dans les opérations (null : pas encore d'opération, ou avant l'historique). */
  payment: { acc: CardAcc; shop: string; merchant: string | null } | null;
  orderRef: string;
  number: string;
};

/** Totaux par catégorie, du plus gros au plus petit (la catégorie de l'opération est la première). */
export function categoryTotals(items: readonly Item[]): [string, number][] {
  const map = new Map<string, number>();
  for (const [, amount, cat] of items) map.set(cat, r2((map.get(cat) ?? 0) + amount));
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function invoiceSpecs(s: Scenario, ids: Rand): InvoiceSpec[] {
  const month0 = `${s.T.slice(0, 7)}-01`;
  const spec = (
    ref: string,
    off: number | null,
    day: number,
    date: string,
    merchant: string,
    title: string,
    items: readonly Item[],
    payment: InvoiceSpec["payment"],
    opts: { owner?: "a" | "c"; warranty?: boolean; order?: string } = {},
  ): InvoiceSpec => ({
    ref,
    off,
    day,
    date,
    merchant,
    title,
    owner: opts.owner ?? null,
    items,
    total: r2(items.reduce((t, i) => t + i[1], 0)),
    warranty: opts.warranty ?? false,
    payment,
    orderRef: `${opts.order ?? "CMD"}-${ids.int(100000, 999999)}${ids.int(10, 99)}`,
    number: `F${date.slice(0, 4)}-${ids.int(1000000, 9999999)}`,
  });
  const linked = (ref: string, off: number, day: number, merchant: string, title: string, items: readonly Item[], payment: NonNullable<InvoiceSpec["payment"]>, opts?: { owner?: "a" | "c"; warranty?: boolean; order?: string }) =>
    spec(ref, off, day, addMonths(month0, off, day), merchant, title, items, payment, opts);
  return [
    linked("lave-linge", -12, 14, "Darty", "Lave-linge hublot 9 kg", [["Lave-linge hublot 9 kg, 1 400 tr/min", 529, "B1-06"], ["Livraison et installation", 20, "B1-06"]], { acc: "joint", shop: "Darty Nantes Beaujoire", merchant: "Darty" }, { warranty: true, order: "DA" }),
    linked("televiseur", -10, 22, "Boulanger", "Téléviseur 55 pouces", [["Téléviseur 4K 55 pouces", 649.99, "B1-06"], ["Support mural orientable", 49.9, "B1-06"]], { acc: "joint", shop: "Boulanger Saint Herblain", merchant: "Boulanger" }, { warranty: true, order: "BL" }),
    linked("bureau-leo", -8, 9, "IKEA", "Bureau et rangements de Léo", [["Bureau enfant blanc", 89, "B1-06"], ["Lampe de bureau LED", 19.99, "B1-06"], ["Étagère murale", 49.98, "B1-06", 2]], { acc: "joint", shop: "Ikea Nantes Saint Herblain", merchant: "IKEA" }, { order: "IK" }),
    linked("amazon-rentree", -6, 17, "Amazon", "Cartable, croquettes et ampoules", [["Cartable primaire 38 cm", 34.9, "B4-01"], ["Croquettes chien adulte 12 kg", 52.99, "B5-01"], ["Ampoules LED E27 (lot de 6)", 14.99, "B1-06"]], { acc: "joint", shop: "Amzn Mktp Fr", merchant: "Amazon" }, { order: "402" }),
    linked("velo-leo", -5, 6, "Decathlon", "Vélo enfant 20 pouces", [["Vélo enfant 20 pouces 6-9 ans", 229, "B4-02"], ["Casque vélo enfant", 19.99, "B4-02"]], { acc: "joint", shop: "Decathlon Saint Herblain", merchant: "Decathlon" }, { warranty: true, order: "DK" }),
    linked("tablette", -4, 11, "Apple", "Tablette 11 pouces", [["Tablette 11 pouces Wi-Fi 128 Go", 449, "B1-06"], ["Étui de protection", 39, "B1-06"]], { acc: "a", shop: "Apple Store Atlantis", merchant: "Apple" }, { owner: "a", warranty: true, order: "W" }),
    linked("perceuse", -3, 19, "Leroy Merlin", "Perceuse et peinture", [["Perceuse-visseuse sans fil 18 V", 89.9, "B1-06"], ["Peinture murale blanche 10 L", 54.9, "B1-06"]], { acc: "joint", shop: "Leroy Merlin Reze", merchant: "Leroy Merlin" }, { warranty: true, order: "LM" }),
    linked("cadeaux-fnac", s.decOff, 13, "Fnac", "Cadeaux de Noël", [["Console de jeux portable", 299.99, "B12-01"], ["Jeu de société familial", 32.99, "B12-01"]], { acc: "a", shop: "Fnac Nantes", merchant: "Fnac" }, { warranty: true, order: "FN" }),
    linked("cadeaux-amazon", s.decOff, 6, "Amazon", "Cadeaux de Noël de Léo", [["Coffret de construction 6 ans et +", 59.99, "B12-01"], ["Album illustré", 14.5, "B12-01"]], { acc: "c", shop: "Amazon Payments", merchant: "Amazon" }, { owner: "c", order: "171" }),
    spec("aspirateur", null, 0, addDays(s.T, -1), "Boulanger", "Aspirateur balai sans fil", [["Aspirateur balai sans fil", 199.99, "B1-06"]], null, { warranty: true, order: "BL" }),
    spec("refrigerateur", null, 0, addMonths(s.T, -23, 4), "Darty", "Réfrigérateur combiné", [["Réfrigérateur combiné 300 L", 579, "B1-06"]], null, { warranty: true, order: "DA" }),
  ];
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Lignes des factures, fichiers, articles, liens avec les opérations et ventilations. */
export function buildInvoices(specs: InvoiceSpec[], txByRef: Map<string, { id: string; amount: number }>, [ua, uc]: readonly [DemoUser, DemoUser]) {
  const invoices: Insert<typeof schema.invoices>[] = [];
  const invoiceFiles: Insert<typeof schema.invoiceFiles>[] = [];
  const invoiceItems: Insert<typeof schema.invoiceItems>[] = [];
  const invoiceTransactions: Insert<typeof schema.invoiceTransactions>[] = [];
  const transactionSplits: Insert<typeof schema.transactionSplits>[] = [];
  let itemId = 0;
  specs.forEach((sp, i) => {
    const tx = sp.payment ? txByRef.get(sp.ref) : undefined;
    if (sp.payment && !tx) return; // achat non généré (date hors historique) : pas de facture orpheline
    const id = i + 1;
    const warrantyUntil = sp.warranty ? legalWarranty(sp.date) : null;
    const client = sp.owner === "a" ? ua.name : sp.owner === "c" ? uc.name : `${ua.name} et ${uc.name}`;
    const file = demoPdf(`${sp.merchant} — facture n° ${sp.number}`, [
      `Date : ${dateFr(sp.date)}      Commande : ${sp.orderRef}`,
      `Client : ${client}, 14 allée des Hérons, 44300 Nantes`,
      "",
      ...sp.items.map(([label, amount, , qty]) => `${qty ?? 1} × ${label} : ${eur(amount)}`),
      "",
      `Total TTC : ${eur(sp.total)}      dont TVA 20 % : ${eur(sp.total - sp.total / 1.2)}`,
      sp.payment ? "Réglé par carte bancaire." : "Réglé par carte bancaire (débit à venir).",
      warrantyUntil ? `Garantie légale de conformité jusqu'au ${dateFr(warrantyUntil)}.` : "",
    ]);
    invoices.push({
      id,
      ownerUserId: sp.owner === "a" ? ua.id : sp.owner === "c" ? uc.id : null,
      merchant: sp.merchant,
      title: sp.title,
      invoiceDate: sp.date,
      orderRef: sp.orderRef,
      invoiceNumber: sp.number,
      total: sp.total,
      warrantyUntil,
      source: "appli",
      fileName: `facture-${slug(sp.merchant)}-${sp.date}.pdf`,
      fileMime: "application/pdf",
      fileSize: file.size,
      fileSha256: file.sha256,
    });
    invoiceFiles.push({ invoiceId: id, content: file.content });
    sp.items.forEach(([label, amount, cat, qty], position) => invoiceItems.push({ id: ++itemId, invoiceId: id, position, label, quantity: qty ?? 1, amount, categoryId: cat }));
    if (!tx) return;
    invoiceTransactions.push({ invoiceId: id, transactionId: tx.id, source: "auto" });
    // Ventilation au prorata des articles, l'arrondi sur la plus grosse part (même calcul que ventilate()).
    const groups = categoryTotals(sp.items);
    if (groups.length < 2) return;
    const sum = groups.reduce((t, [, v]) => t + v, 0);
    const parts = groups.map(([cat, total]) => ({
      cat,
      amount: r2((tx.amount * total) / sum),
      label: sp.items.filter((it) => it[2] === cat).map((it) => it[0]).join(" · ").slice(0, 255),
    }));
    parts[0].amount = r2(parts[0].amount + tx.amount - parts.reduce((t, p) => t + p.amount, 0));
    parts.forEach((p, position) => transactionSplits.push({ transactionId: tx.id, position, amount: p.amount, categoryId: p.cat, label: p.label }));
  });
  return { invoices, invoiceFiles, invoiceItems, invoiceTransactions, transactionSplits };
}
