import { z } from "zod";
import { documentDetail } from "../documents.ts";
import { visibleCommitment } from "../situation.ts";
import { householdCurrency } from "../region.ts";
import { TEXT_BUDGET, TEXT_BUDGET_WITH_CANDIDATES, commitmentBlock, currentCandidates, documentBlocks, type ContractDocument } from "../contracts.ts";
import { ToolError, readTool, today } from "./registry.ts";
import { tk } from "../../lib/i18n.ts";

/* Comparaison d'un contrat en cours et d'offres (électricité, gaz, assurances, télécoms, véhicule…). */

const compareContracts = readTool({
  name: "compare_contracts",
  progress: tk("Lecture des contrats à comparer…"),
  description:
    "Réunit en une lecture ce qu'il faut pour comparer un contrat en cours à une ou plusieurs offres (électricité, gaz, assurance habitation, auto, santé ou emprunteur, box, mobile, crédit ou location d'un véhicule…) : " +
    "pour chaque offre du coffre (devis, proposition, nouveau contrat déposés par l'utilisateur), résumé, faits clés et texte ; pour le contrat en cours, son document du coffre et son engagement du budget " +
    "(montant par mois et par an, prochaine échéance, préavis, dernier jour pour résilier) avec ce qui a réellement été prélevé sur douze mois (total, par mois, dernier prélèvement). " +
    "Sans contrat en cours indiqué, renvoie les candidats (engagements du budget, contrats du coffre) parmi lesquels choisir. Lecture seule : ne conclut pas à ta place.",
  input: z.object({
    offer_document_ids: z.array(z.number().int()).max(3).optional().describe("Documents du coffre qui décrivent les offres à comparer, trois au plus (« Document n° » d'une pièce jointe, ou id de search_documents)"),
    current_document_id: z.number().int().optional().describe("Document du coffre du contrat en cours (contrat, conditions particulières, avis d'échéance, dernière facture)"),
    commitment_id: z.number().int().optional().describe("Engagement du budget du contrat en cours (champ id de get_budget, ou commitment_id d'un candidat)"),
  }),
  async run({ userId }, i) {
    const offerIds = [...new Set(i.offer_document_ids ?? [])].filter((id) => id !== i.current_document_id);
    const load = async (id: number): Promise<ContractDocument> => {
      const d = await documentDetail(userId, id);
      if (!d) throw new ToolError(`Document n° ${id} introuvable dans le coffre`);
      return d;
    };
    const offers = await Promise.all(offerIds.map(load));
    const currentDoc = i.current_document_id != null ? await load(i.current_document_id) : null;
    const commitment = i.commitment_id != null ? await visibleCommitment(userId, i.commitment_id).catch(() => null) : null;
    if (i.commitment_id != null && !commitment) throw new ToolError(`Engagement n° ${i.commitment_id} introuvable dans le budget`);

    // Ce qui n'est pas indiqué du contrat en cours est proposé : son engagement, son document, ou les deux.
    const topics = [...new Set(offers.map((o) => o.topic).filter((t): t is string => !!t))];
    const candidates = await currentCandidates(userId, { commitments: !commitment, documents: !currentDoc }, [...offerIds, ...(currentDoc ? [currentDoc.id] : [])], topics);
    const listed = (candidates.commitments?.length ?? 0) + (candidates.documents?.length ?? 0);
    const docs = documentBlocks([...(currentDoc ? [currentDoc] : []), ...offers], listed ? TEXT_BUDGET_WITH_CANDIDATES : TEXT_BUDGET);
    const hasCurrent = !!commitment || !!currentDoc;
    const next = !hasCurrent
      ? listed
        ? "Contrat en cours non indiqué : s'il y en a un de même nature parmi « candidates », rappelle compare_contracts avec son commitment_id et, s'il existe, son current_document_id. Sinon compare les offres entre elles, ou demande à l'utilisateur son contrat, son dernier avis d'échéance ou sa dernière facture."
        : "Aucun contrat en cours dans le budget ni dans le coffre : compare les offres entre elles, ou demande à l'utilisateur son contrat, son dernier avis d'échéance ou sa dernière facture."
      : listed
        ? `Il manque ${commitment ? "le document" : "l'engagement du budget"} du contrat en cours : si l'un des « candidates » lui correspond, rappelle compare_contracts en l'ajoutant${commitment ? "" : " (montant, échéance et prélèvements réels en dépendent)"}.`
        : null;
    return {
      today: today(),
      currency: householdCurrency(),
      current: hasCurrent ? { commitment: commitment ? await commitmentBlock(userId, commitment) : null, document: currentDoc ? docs[0] : null } : null,
      offers: docs.slice(currentDoc ? 1 : 0),
      ...(listed ? { candidates } : {}),
      ...(next ? { next } : {}),
    };
  },
});

export const contratsTools = [compareContracts];
