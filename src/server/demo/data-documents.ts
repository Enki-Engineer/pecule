/*
 * Coffre de la démo : dix documents fictifs avec résumé, faits clés, texte indexé (déjà sans
 * identifiant sensible) et un PDF d'une page. Les avis d'impôt et de taxe foncière sont reliés
 * aux lignes d'impôts ; échéances (expires_at) visibles dans l'échéancier.
 */
import type * as schema from "../db/schema/index.ts";
import { LOANS } from "./data-patrimoine.ts";
import { PROPERTY_IDS } from "./data-situation.ts";
import { type IncomeModel, PARTS, type Scenario, taxYears, tfYears } from "./model.ts";
import { demoPdf } from "./pdf.ts";
import { type DemoUser, type Insert, addDays, addMonths, dateFr, eur, ymd } from "./rng.ts";

export type DocIds = { avis: Map<number, number>; tfRp: number | null };

type Doc = {
  title: string;
  kind: string;
  domain: string;
  owner: number | null;
  entity?: [type: string, id: string];
  docDate: string;
  expiresAt?: string;
  summary: string;
  facts: [label: string, value: string][];
  lines: string[];
  link?: (id: number) => void;
};

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

export function buildDocuments(s: Scenario, model: IncomeModel, [ua, uc]: readonly [DemoUser, DemoUser]) {
  const ids: DocIds = { avis: new Map(), tfRp: null };
  const year = s.T >= ymd(s.TY, 1, 6) ? s.TY : s.TY - 1;
  const rentNow = 548;
  const docs: Doc[] = [
    {
      title: "Bail meublé — studio d'Angers",
      kind: "bail",
      domain: "immobilier",
      owner: ua.id,
      entity: ["property", PROPERTY_IDS.studio],
      docDate: addDays(s.leaseStart, -10),
      expiresAt: s.nextRevision,
      summary: `Bail de location meublée d'un an, reconduit tacitement, signé avec Lucie Garnier. Loyer de ${rentNow} € charges comprises, révisé chaque année selon l'IRL.`,
      facts: [["Locataire", "Lucie Garnier"], ["Loyer à la signature", `${rentNow} € charges comprises`], ["Dépôt de garantie", "1 040 €"], ["Prochaine échéance", dateFr(s.nextRevision)]],
      lines: [
        "Contrat de location meublée (résidence principale du locataire)",
        `Bailleur : ${ua.name}, 14 allée des Hérons, 44300 Nantes`,
        "Locataire : Lucie Garnier",
        "Logement : studio meublé de 24,3 m², 8 rue des Ardoisiers, 49100 Angers, 2e étage",
        `Prise d'effet : ${dateFr(s.leaseStart)}, pour un an reconduit tacitement`,
        "Loyer : 520 € hors charges + 28 € de provision sur charges, soit 548 € par mois",
        "Révision annuelle à la date anniversaire selon l'indice de référence des loyers",
        "Dépôt de garantie : 1 040 € (deux mois de loyer hors charges)",
        "Annexes : inventaire du mobilier, état des lieux d'entrée, diagnostics",
      ],
    },
    {
      title: `Attestation d'assurance habitation ${year}`,
      kind: "assurance",
      domain: "immobilier",
      owner: null,
      entity: ["property", PROPERTY_IDS.rp],
      docDate: ymd(year, 1, 6),
      expiresAt: ymd(year, 12, 31),
      summary: `Attestation MAIF pour l'appartement de Nantes, valable jusqu'au 31/12/${year}. Cotisation annuelle de 328,80 €.`,
      facts: [["Assureur", "MAIF"], ["Formule", "Multirisque habitation, propriétaire occupant"], ["Cotisation annuelle", "328,80 €"], ["Validité", `01/01/${year} au 31/12/${year}`]],
      lines: [
        `L'assureur certifie que ${ua.name} et ${uc.name} sont assurés pour le logement suivant :`,
        "Appartement de 4 pièces, 86 m², 14 allée des Hérons, 44300 Nantes, avec cave et parking",
        "Garanties : incendie, dégâts des eaux, vol, responsabilité civile vie privée",
        `Période de validité : du 01/01/${year} au 31/12/${year}`,
        "Cotisation annuelle : 328,80 €, prélevée chaque mois",
      ],
    },
    ...taxYears(s).map((iy): Doc => {
      const t = model.tax(iy);
      return {
        title: `Avis d'impôt ${iy + 1} sur les revenus ${iy}`,
        kind: "avis_impot",
        domain: "impots",
        owner: null,
        docDate: ymd(iy + 1, 7, 28),
        summary: `Impôt sur les revenus ${iy} du foyer (${PARTS} parts) : ${eur(t.total, 0)} au total, ${t.balance >= 0 ? `solde de ${eur(t.balance, 0)} prélevé en septembre` : `${eur(-t.balance, 0)} remboursés`}.`,
        facts: [["Revenu fiscal de référence", eur(t.taxable, 0)], ["Nombre de parts", String(PARTS).replace(".", ",")], ["Impôt net", eur(t.netTax, 0)], ["Prélèvements sociaux", eur(t.ps, 0)], ["Taux de prélèvement à la source", `${String(t.rate).replace(".", ",")} %`], ["Solde", eur(t.balance, 0)]],
        lines: [
          `Foyer fiscal : ${ua.name} et ${uc.name}, pacsés, un enfant à charge`,
          `Salaires déclarés : ${eur(t.salA, 0)} et ${eur(t.salC, 0)}`,
          `Location meublée (micro-BIC) : ${eur(t.rent, 0)} de recettes, ${eur(t.bic, 0)} imposables`,
          `Revenu fiscal de référence : ${eur(t.taxable, 0)}`,
          `Impôt sur le revenu net : ${eur(t.netTax, 0)} (dont réduction pour dons : ${eur(t.credits, 0)})`,
          `Prélèvements sociaux sur les revenus du patrimoine : ${eur(t.ps, 0)}`,
          `Déjà prélevé à la source : ${eur(t.withheld, 0)}`,
          `Solde : ${eur(t.balance, 0)}`,
          `Taux de prélèvement à la source à partir de septembre ${iy + 1} : ${String(t.rate).replace(".", ",")} %`,
        ],
        link: (id) => ids.avis.set(iy, id),
      };
    }),
    ...tfYears(s).slice(-1).map((y): Doc => {
      const t = model.tf("rp", y);
      return {
        title: `Avis de taxe foncière ${y} — résidence principale`,
        kind: "taxe_fonciere",
        domain: "impots",
        owner: null,
        entity: ["property", PROPERTY_IDS.rp],
        docDate: ymd(y, 8, 31),
        summary: `Taxe foncière ${y} de l'appartement de Nantes : ${eur(t.total, 0)}, à payer au plus tard le 15 octobre.`,
        facts: [["Montant", eur(t.total, 0)], ["Dont ordures ménagères", eur(t.teom, 0)], ["Date limite", `15/10/${y}`]],
        lines: [`Base d'imposition : ${eur(t.base, 0)}`, `Cotisations communales et intercommunales : ${eur(t.contributions, 0)}`, `Taxe d'enlèvement des ordures ménagères : ${eur(t.teom, 0)}`, `Frais de gestion : ${eur(t.fees, 0)}`, `Montant à payer : ${eur(t.total, 0)}, date limite le 15/10/${y}`],
        link: (id) => (ids.tfRp = id),
      };
    }),
    {
      title: "Offre de prêt immobilier — résidence principale",
      kind: "pret",
      domain: "immobilier",
      owner: null,
      entity: ["loan", LOANS.rp.id],
      docDate: addMonths(s.rpBought, -2),
      summary: `Offre de prêt amortissable de ${eur(LOANS.rp.principal, 0)} sur 25 ans au taux fixe de 1,20 %, assurance emprunteur comprise.`,
      facts: [["Montant", eur(LOANS.rp.principal, 0)], ["Taux fixe", "1,20 %"], ["Durée", "300 mois"], ["Banque", LOANS.rp.bank]],
      lines: [`Emprunteurs : ${ua.name} et ${uc.name}`, "Objet : acquisition d'un appartement de 4 pièces à Nantes (résidence principale)", `Montant : ${eur(LOANS.rp.principal, 0)}, taux fixe 1,20 %, 300 mensualités`, `Assurance emprunteur : ${eur(LOANS.rp.insurance)} par mois, quotité 50 % par emprunteur`, "Garantie : caution d'un organisme spécialisé", "Remboursement anticipé : indemnité plafonnée à 6 mois d'intérêts"],
    },
    {
      title: `Contrat de mutuelle santé — ${uc.name}`,
      kind: "contrat",
      domain: "budget",
      owner: uc.id,
      docDate: ymd(year, 1, 2),
      expiresAt: ymd(year, 12, 31),
      summary: "Complémentaire santé individuelle, renouvelée chaque 1er janvier, résiliable à tout moment après un an.",
      facts: [["Organisme", "Harmonie Mutuelle"], ["Cotisation", "61,90 € par mois"], ["Renouvellement", `01/01/${year + 1}`]],
      lines: [`Adhérente : ${uc.name}`, "Garanties : hospitalisation, soins courants, optique (forfait 250 € tous les deux ans), dentaire", "Cotisation mensuelle : 61,90 €", `Échéance annuelle : 31/12/${year}, reconduction tacite`],
    },
    {
      title: `Relevé de situation individuelle — ${ua.name}`,
      kind: "releve",
      domain: "retraite",
      owner: ua.id,
      entity: ["retirement", String(ua.id)],
      docDate: addMonths(s.T, -4, 14),
      summary: "Relevé de carrière tous régimes : 68 trimestres validés sur 172 requis, droits Agirc-Arrco détaillés par employeur.",
      facts: [["Trimestres validés", "68"], ["Trimestres requis", "172"], ["Points Agirc-Arrco", "13 170"]],
      lines: ["Régime général : 68 trimestres validés au 31 décembre dernier", "Agirc-Arrco : 13 170 points", "Âge légal de départ : 64 ans ; taux plein automatique : 67 ans"],
    },
    {
      title: "Diagnostic de performance énergétique — studio d'Angers",
      kind: "diagnostic",
      domain: "immobilier",
      owner: ua.id,
      entity: ["property", PROPERTY_IDS.studio],
      docDate: addMonths(s.studioBought, -3, 12),
      expiresAt: addMonths(s.studioBought, 117, 12),
      summary: "DPE du studio : classe D (198 kWh/m²/an), classe climat B. Valable 10 ans.",
      facts: [["Classe énergie", "D (198 kWh/m²/an)"], ["Classe climat", "B"], ["Surface", "24,3 m²"]],
      lines: ["Logement : studio, 24,3 m², chauffage électrique, eau chaude par ballon", "Consommation : 198 kWh/m²/an (classe D)", "Émissions : 6 kg CO2/m²/an (classe B)", "Recommandations : isolation des combles, ventilation hygroréglable"],
    },
    {
      title: "Contrat d'assurance auto — Macif",
      kind: "assurance",
      domain: "budget",
      owner: null,
      docDate: addMonths(s.macifRenewal, -12),
      expiresAt: s.macifRenewal,
      summary: "Assurance tous risques de la citadine électrique du foyer, échéance annuelle à venir (préavis de résiliation d'un mois).",
      facts: [["Véhicule", "Citadine électrique (2022)"], ["Formule", "Tous risques"], ["Cotisation", "573,60 € par an"], ["Bonus", "0,50"]],
      lines: [`Souscripteurs : ${ua.name} et ${uc.name}`, "Véhicule : citadine électrique, première mise en circulation en 2022", "Formule tous risques, assistance 0 km, prêt de véhicule", "Cotisation annuelle : 573,60 €, prélevée chaque mois", `Échéance principale : ${dateFr(s.macifRenewal)}`],
    },
  ];

  const documents: Insert<typeof schema.documents>[] = [];
  const documentFiles: Insert<typeof schema.documentFiles>[] = [];
  docs.forEach((d, i) => {
    const id = i + 1;
    const file = demoPdf(d.title, d.lines);
    documents.push({
      id,
      ownerUserId: d.owner,
      title: d.title,
      kind: d.kind,
      domain: d.domain,
      entityType: d.entity?.[0] ?? null,
      entityId: d.entity?.[1] ?? null,
      docDate: d.docDate,
      expiresAt: d.expiresAt ?? null,
      summary: d.summary,
      facts: JSON.stringify(d.facts.map(([label, value]) => ({ label, value }))),
      contentText: file.text,
      fileName: `${slug(d.title)}.pdf`,
      fileMime: "application/pdf",
      fileSize: file.size,
      fileSha256: file.sha256,
      source: "appli",
    });
    documentFiles.push({ documentId: id, content: file.content });
    d.link?.(id);
  });
  return { documents, documentFiles, ids };
}
