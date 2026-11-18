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
      summary: tk("Ton salaire mois par mois, lu dans tes bulletins de paie, et celui du foyer si chacun partage les siens."),
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
        tk("**Les revenus du foyer.** Dans un foyer de plusieurs membres, [[Foyer]] et [[Moi]] — dans la barre du haut sur ordinateur, à côté du titre sur téléphone — choisissent ce que l'écran compte."),
        {
          list: [
            tk("[[Moi]] : tes seuls bulletins."),
            tk("[[Foyer]] : les tiens et ceux des membres qui partagent leurs revenus. Le graphique empile le net payé de chacun, le tableau par année donne la part de chaque membre puis le total du foyer."),
          ],
        },
        tk("Chacun décide pour lui-même : dans [[Réglages]] → [[Compte et sécurité]], [[Partager mes revenus avec le foyer]]. Tant que tu ne l'as pas activé, toi seul vois tes bulletins. Si un membre ne partage pas les siens, la vue du foyer le dit et ne compte que les autres."),
        { note: tk("Le partage ne montre que des montants. Tes bulletins restent privés au coffre : personne d'autre ne les ouvre, et la remarque de lecture d'un bulletin n'est montrée qu'à toi.") },
        tk("Les revenus mensuels du foyer qui servent au budget se règlent à part : voir [Le budget](/manuel/budget)."),
      ],
      links: [
        { to: "/revenus", label: ["Revenus"] },
        { to: "/reglages/compte#partage", label: ["Réglages", "Compte et sécurité"] },
        { to: "/documents", label: ["Coffre"] },
      ],
      words: tk("salaire fiche de paie bulletin net brut prime bonus prélèvement à la source employeur revenus du foyer couple conjoint partager partage privé foyer moi"),
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
        tk("**Déclaration commune ou personnelle.** Une déclaration est celle du foyer (imposition commune : mariés, pacsés) ou celle d'un seul membre (imposition séparée : avant la vie commune, ou dans un couple ni marié ni pacsé). Une même année peut donc compter une déclaration par membre."),
        {
          list: [
            tk("À la relecture d'un avis déposé au coffre, le champ [[Déclaration]] propose [[Commune (foyer)]] ou le membre que l'avis nomme : corrige-le au besoin."),
            tk("Pour une déclaration déjà enregistrée, choisis [[Commune##declaration]] ou la tienne dans le détail de l'année (sur téléphone : sur sa ligne). L'assistant le fait aussi : « la déclaration 2018 est la mienne »."),
            tk("[[Foyer]] additionne, pour chaque année, la déclaration commune et les déclarations personnelles — les tiennes, et celles des membres qui partagent leurs revenus. [[Moi]] ne garde que la commune et les tiennes."),
          ],
        },
        { note: tk("Une déclaration personnelle ne regarde que son déclarant : les autres membres ne la voient que s'il a activé [[Partager mes revenus avec le foyer]] dans [[Réglages]] → [[Compte et sécurité]]. Les taxes foncières ne dépendent pas de ce choix.") },
        tk("Les dates du calendrier fiscal (déclaration, solde, taxe foncière) figurent dans l'échéancier."),
        { note: tk("Cet écran lit des documents français : il est retiré d'office quand le foyer vit dans un autre pays, et peut être remis dans [[Réglages]] → [[Foyer]].") },
      ],
      links: [
        { to: "/impots", label: ["Impôts"] },
        { to: "/documents", label: ["Coffre"] },
      ],
      words: tk("impôt sur le revenu avis d'imposition taxe foncière fiscalité tmi déclaration revenu fiscal de référence déclaration commune séparée personnelle pacs mariage concubinage foyer moi"),
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
