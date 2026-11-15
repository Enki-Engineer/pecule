import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const situation: ManualTheme = {
  id: "situation",
  title: tk("Revenus, impôts, retraite"),
  hint: tk("Ce que disent tes bulletins de paie, tes avis d'impôt et ton relevé de carrière"),
  articles: [
    {
      id: "revenus",
      title: tk("Revenus et bulletins de paie"),
      summary: tk("Ton salaire mois par mois, lu dans tes bulletins de paie."),
      module: "revenus",
      body: [
        tk("L'écran [[Revenus]] se remplit avec tes bulletins de paie : dépose-les dans le coffre, un par un ou par dossier entier. Pécule lit le brut, le net imposable, l'impôt prélevé à la source, le net payé et les primes, et te propose ces données à valider."),
        {
          list: [
            tk("En tête : le dernier net payé, le brut du mois, le net imposable et l'impôt prélevé de l'année."),
            tk("Le graphique des 36 derniers mois : un clic sur un mois ouvre son bulletin."),
            tk("Les tableaux par année et par bulletin."),
          ],
        },
        { note: tk("Tes bulletins sont privés : toi seul les vois, et l'écran ne montre que les tiens.") },
        tk("Les revenus mensuels du foyer qui servent au budget se règlent à part : voir [Le budget](/manuel/budget)."),
      ],
      links: [
        { to: "/revenus", label: ["Revenus"] },
        { to: "/documents", label: ["Coffre"] },
      ],
      words: tk("salaire fiche de paie bulletin net brut prime bonus prélèvement à la source employeur"),
    },
    {
      id: "impots",
      title: tk("Impôts"),
      summary: tk("L'impôt sur le revenu et les taxes foncières du foyer, année après année."),
      module: "impots",
      body: [
        tk("L'écran [[Impôts]] se remplit avec tes avis : dépose dans le coffre l'avis d'impôt sur le revenu et les avis de taxe foncière. Pécule les lit et te propose leurs chiffres à valider."),
        {
          list: [
            tk("Impôt sur le revenu : revenu imposable, revenu fiscal de référence, impôt net, prélèvements sociaux, taux moyen et tranche marginale, pour chaque année."),
            tk("Taxes foncières : le total par bien et par année, et sa variation."),
            tk("Sur ordinateur, un clic sur une année ouvre son détail."),
          ],
        },
        tk("Les dates du calendrier fiscal (déclaration, solde, taxe foncière) figurent dans l'échéancier."),
        { note: tk("Cet écran lit des documents français : il est retiré d'office quand le foyer vit dans un autre pays, et peut être remis dans [[Réglages]] → [[Foyer]].") },
      ],
      links: [
        { to: "/impots", label: ["Impôts"] },
        { to: "/documents", label: ["Coffre"] },
      ],
      words: tk("impôt sur le revenu avis d'imposition taxe foncière fiscalité tmi déclaration revenu fiscal de référence"),
    },
    {
      id: "retraite",
      title: tk("Retraite"),
      summary: tk("Trimestres, carrière et estimations de pension selon l'âge de départ."),
      module: "retraite",
      body: [
        tk("L'écran [[Retraite]] se remplit avec ton relevé de carrière ou ton estimation de retraite : dépose le document dans le coffre, Pécule le lit et te propose ses données à valider."),
        {
          list: [
            tk("Les trimestres validés face aux trimestres requis, la date de départ au plus tôt et l'âge du taux plein."),
            tk("La pension estimée selon l'âge de départ, d'après les simulations officielles."),
            tk("Ta carrière : périodes, employeurs, revenus et trimestres."),
          ],
        },
        tk("L'assistant peut y ajouter un scénario — un départ plus tôt, une carrière interrompue — à côté des simulations officielles."),
        { note: tk("Ces données sont privées : toi seul les vois. L'écran lit des documents français ; il est retiré d'office quand le foyer vit dans un autre pays.") },
      ],
      links: [
        { to: "/retraite", label: ["Retraite"] },
        { to: "/documents", label: ["Coffre"] },
      ],
      words: tk("pension trimestres relevé de carrière âge de départ taux plein info-retraite estimation"),
    },
  ],
};
