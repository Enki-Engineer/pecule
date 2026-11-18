import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const documents: ManualTheme = {
  id: "documents",
  title: tk("Coffre et échéancier"),
  hint: tk("Ranger ses papiers, en tirer les données, ne rien oublier"),
  articles: [
    {
      id: "coffre",
      title: tk("Ranger un document dans le coffre"),
      summary: tk("Dépose un PDF ou une photo : Pécule le range, le résume et retient ses dates."),
      body: [
        tk("Le [[Coffre]] garde tous tes papiers : contrats, baux, actes, avis d'impôt, relevés, diagnostics, devis."),
        {
          list: [
            tk("Sur ordinateur : glisse des fichiers ou un dossier entier n'importe où sur l'écran, ou utilise [[Choisir des fichiers]] et [[Choisir un dossier]]."),
            tk("Sur téléphone : bouton [[Ajouter]], puis un PDF ou une photo."),
          ],
        },
        tk("Pour chaque document, Pécule détermine le type, le domaine, un titre, la date, l'échéance s'il y en a une, un résumé et les faits clés (montants, dates, références). Un document qui a une échéance apparaît dans l'échéancier."),
        {
          list: [
            tk("Une facture d'achat est rangée dans [[Factures]], pas dans le coffre."),
            tk("Un fichier déjà présent est reconnu : il n'est pas rangé deux fois."),
            tk("Formats : PDF, photo (JPEG, PNG, HEIC), texte ou CSV, 20 Mo au plus par fichier."),
            tk("Les documents de retraite et de revenus sont privés d'office."),
          ],
        },
        { note: tk("Sans fournisseur d'IA, le fichier est gardé avec son nom pour titre, sans être lu.") },
      ],
      links: [{ to: "/documents", label: ["Coffre"] }],
      words: tk("document papier contrat bail acte déposer scanner archiver ranger pdf photo coffre-fort"),
    },
    {
      id: "retrouver-un-document",
      title: tk("Retrouver, corriger ou supprimer un document"),
      summary: tk("Chercher dans le texte des documents, reprendre leur classement, choisir qui les voit."),
      body: [
        tk("La recherche du [[Coffre]] porte sur le titre, le résumé et le texte même des documents. Les pastilles filtrent par domaine : banque, immobilier, patrimoine, crypto, impôts, retraite, revenus, budget."),
        tk("Une seconde rangée de pastilles filtre par nature de contrat : assurance auto, assurance habitation, assurance emprunteur, mutuelle santé, électricité et gaz, box internet, forfait mobile. Elle réunit tous les papiers d'un même contrat (contrat, avenant, attestation, devis concurrent), quel que soit leur domaine. Seules les natures présentes dans ton coffre sont proposées."),
        tk("Touche un document pour ouvrir sa fiche : résumé, faits clés, échéance."),
        {
          list: [
            tk("[[Ouvrir]] affiche le fichier ; sur ordinateur, un aperçu est dans la fiche."),
            tk("[[Modifier]] corrige le titre, le type, le domaine, la date, l'échéance et le résumé."),
            tk("[[Nature du contrat]], dans [[Modifier]], range le document sous une pastille ou l'en retire. Pécule la reconnaît à la lecture ; corrige-la s'il s'est trompé."),
            tk("[[Visible par moi seul]], dans [[Modifier]], rend le document privé : un cadenas le signale."),
            tk("[[Demander à l'assistant]] lui fait résumer le document et dire ce qu'il faut en retenir."),
            tk("[[Supprimer le document]] retire le document et son fichier, après confirmation."),
          ],
        },
        { tip: tk("Sur un devis, [[Comparer à mon contrat actuel]] lance la comparaison par l'assistant ; sur un contrat, [[Comparer à une offre]].") },
      ],
      links: [{ to: "/documents", label: ["Coffre"] }],
      words: tk("chercher document retrouver modifier renommer supprimer privé télécharger ouvrir fichier étiquette pastille filtre assurance auto habitation emprunteur mutuelle électricité gaz"),
    },
    {
      id: "documents-vers-ecrans",
      title: tk("Quel document alimente quel écran"),
      summary: tk("Bulletins, avis d'impôt, prêts, actes, relevés : ce que Pécule sait en tirer."),
      body: [
        tk("Certains documents ne sont pas seulement rangés : Pécule en lit les données et te propose de les écrire dans tes écrans. Rien n'est écrit sans ta validation."),
        {
          list: [
            tk("Bulletin de paie → [[Revenus]]."),
            tk("Avis d'impôt sur le revenu, avis de taxe foncière → [[Impôts]]."),
            tk("Tableau d'amortissement ou offre de prêt → un crédit, dans [[Patrimoine]]."),
            tk("Relevé de carrière ou estimation de retraite → [[Retraite]]."),
            tk("Acte, compromis ou bail → un bien, dans [[Immobilier]]."),
            tk("Relevé de placement → la valeur d'un placement, dans [[Patrimoine]]."),
            tk("Relevé de compte et export de la banque → des opérations ([Reprendre l'historique d'un compte avec ses relevés](/manuel/reprendre-un-historique))."),
            tk("Contrat d'assurance ou d'abonnement → un engagement du budget."),
          ],
        },
        tk("Sur ordinateur, tout dépôt dans le coffre ouvre un import, où chaque proposition se relit ([Relire, valider ou annuler un import](/manuel/relire-un-import)). Pour un document déjà au coffre, sa fiche propose [[Extraire les données vers mes écrans]]."),
        { note: tk("La lecture passe par ton fournisseur d'IA ; les exports de la banque (OFX, QIF, CSV) sont lus sans lui.") },
      ],
      links: [{ to: "/documents", label: ["Coffre"] }],
      words: tk("ajouter un crédit ajouter un bien ajouter un bulletin extraire données lecture automatique ocr alimenter remplir"),
    },
    {
      id: "import-massif",
      title: tk("Importer un dossier entier"),
      summary: tk("Dépose des années de papiers d'un coup : Pécule range tout et lit ce qu'il reconnaît."),
      body: [
        {
          steps: [
            tk("Sur ordinateur, ouvre le [[Coffre]] et glisse ton dossier sur l'écran, ou touche [[Choisir un dossier]]."),
            tk("Les fichiers sont envoyés puis lus un à un. Tu peux quitter l'écran : l'import se retrouve dans l'onglet [[Imports]]."),
            tk("Chaque fichier est rangé au coffre. Ceux que Pécule sait lire donnent une proposition, marquée [[À relire]]."),
            tk("Relis et valide les propositions, ou valide d'un coup les fichiers sûrs."),
          ],
        },
        {
          list: [
            tk("400 fichiers au plus par import, 20 Mo par fichier."),
            tk("Un fichier déjà connu de Pécule n'est pas envoyé une seconde fois."),
            tk("Le coût de la lecture par l'IA est affiché et plafonné pour chaque import ; au plafond, la lecture se met en pause jusqu'à ce que tu l'autorises à continuer."),
            tk("Si le foyer a fixé un [plafond du mois](/manuel/assistant-cout) pour l'IA et choisi d'y arrêter les lectures de fond, un import attend aussi quand ce plafond est atteint."),
            tk("Le bouton des fichiers non importés télécharge la liste de ceux qui ont été écartés, avec la raison."),
          ],
        },
        { note: tk("L'import d'un dossier n'est pas proposé en mode démo. Un import n'est visible que du membre qui l'a lancé.") },
      ],
      links: [{ to: "/documents?vue=imports", label: ["Coffre", "Imports"] }],
      words: tk("import en masse lot dossier plusieurs fichiers archives reprise historique glisser déposer"),
    },
    {
      id: "reprendre-un-historique",
      title: tk("Reprendre l'historique d'un compte avec ses relevés"),
      summary: tk("Dépose tes relevés de compte en PDF : Pécule en tire toutes les opérations, compte par compte."),
      body: [
        tk("Une banque ne donne souvent que quelques mois d'opérations ; ses relevés, eux, remontent à l'ouverture du compte. Dépose-les dans le coffre : Pécule lit chaque relevé avec ton fournisseur d'IA et te propose ses opérations. Rien n'est écrit sans ta validation."),
        {
          steps: [
            tk("Télécharge tes relevés en PDF dans l'espace client de ta banque, et réunis-les dans un dossier."),
            tk("Sur ordinateur, ouvre le [[Coffre]] et glisse le dossier sur l'écran, ou touche [[Choisir un dossier]]."),
            tk("Ouvre le premier relevé d'un compte et choisis, dans [[Compte]], le compte de Pécule qui reçoit ses opérations, ou [[Nouveau compte…]]. Ce choix vaut pour les autres relevés du même compte."),
            tk("Valide d'un coup les fichiers sûrs, puis relis ceux qui restent."),
          ],
        },
        {
          list: [
            tk("Un relevé qui porte plusieurs comptes (un compte courant et des livrets) donne une proposition par compte."),
            tk("Chaque relevé est vérifié : son solde de départ et ses opérations doivent donner son solde d'arrivée. S'il ne tombe pas juste, sa fiche montre toutes les opérations avec le solde après chacune, et désigne la ligne dont le signe ou la présence expliquerait l'écart."),
            tk("Touche une opération pour la corriger : [[Inverser le signe]], [[Retirer la ligne]], ou [[Ajouter une ligne]] pour une opération oubliée."),
            tk("En haut de l'import, l'encadré [[Relevés de compte : la série]] dit quelle période couvrent les relevés de chaque compte, et s'il en manque un entre deux autres."),
            tk("Une opération que le compte connaît déjà n'est pas ajoutée deux fois : tu peux déposer des relevés qui recouvrent ce que la banque a déjà fourni."),
            tk("Les opérations ajoutées sont classées par tes règles et par les libellés déjà classés."),
          ],
        },
        { note: tk("La lecture d'un relevé coûte quelques centimes à ton fournisseur d'IA, davantage pour un relevé de plusieurs centaines d'opérations. Si ta banque propose un export (OFX, QIF, CSV), il est lu sans IA : voir [Importer un fichier de la banque](/manuel/importer-fichier-banque).") },
      ],
      links: [{ to: "/documents", label: ["Coffre"] }],
      words: tk("relevé de compte relevés bancaires pdf historique ancien reprise années passées opérations manquantes plusieurs comptes livret solde"),
    },
    {
      id: "relire-un-import",
      title: tk("Relire, valider ou annuler un import"),
      summary: tk("Ce que Pécule a lu dans chaque fichier, à corriger avant de l'écrire dans tes écrans."),
      body: [
        tk("Ouvre un import depuis l'onglet [[Imports]] du coffre, ou par [[Relire]] sur le rappel affiché en haut du coffre. Touche une ligne [[À relire]] pour voir sa proposition."),
        {
          list: [
            tk("Les champs lus se corrigent sur place."),
            tk("Les opérations d'un relevé de compte sont toutes listées : touche une ligne pour la corriger, la retirer, ou en ajouter une ([Reprendre l'historique d'un compte avec ses relevés](/manuel/reprendre-un-historique))."),
            tk("[[Contrôles]] liste les vérifications faites (totaux qui tombent juste, dates cohérentes) ; l'encadré du haut dit ce qui changerait dans ce que Pécule contient déjà."),
            tk("[[Valider]] écrit les données dans tes écrans ; [[Annuler la validation]] les en retire."),
            tk("[[Écarter]] laisse le document au coffre, sans rien écrire."),
            tk("[[Relire le fichier]] relance la lecture."),
          ],
        },
        tk("Un fichier est marqué [[Sûr]] quand tous les contrôles passent, que la lecture est sans doute et que rien de ce que Pécule contient déjà ne changerait : le bouton de validation des fichiers sûrs les valide tous d'un coup."),
        { warning: tk("[[Annuler l'import]] retire tout ce que l'import a apporté — documents, factures, données validées. Les fichiers que Pécule connaissait avant ne sont pas touchés.") },
      ],
      links: [{ to: "/documents?vue=imports", label: ["Coffre", "Imports"] }],
      words: tk("validation vérifier proposition corriger lecture annuler un import écarter sûr contrôle"),
    },
    {
      id: "echeancier",
      title: tk("L'échéancier"),
      summary: tk("Tes tâches et toutes les dates qui comptent, réunies au même endroit."),
      body: [
        tk("L'[[Échéancier]] réunit ce que tu notes et ce que Pécule calcule : la prochaine mensualité et la fin de chaque crédit, les fins de garantie des factures, les documents qui arrivent à échéance, les renouvellements de contrats avec leur préavis, l'accord bancaire à renouveler et, pour un foyer français, les dates du calendrier fiscal."),
        {
          steps: [
            tk("Touche [[Ajouter]]."),
            tk("Choisis [[Tâche à faire]] (elle se coche) ou [[Date à retenir]]."),
            tk("Donne l'intitulé, la date et, pour une tâche, sa récurrence : une fois, chaque mois, chaque trimestre ou chaque année."),
            tk("Touche [[Ajouter]]."),
          ],
        },
        {
          list: [
            tk("Touche la pastille ronde d'une tâche pour la cocher ; une tâche récurrente crée alors la suivante."),
            tk("Une tâche dont la date est passée est « en retard » : le menu en porte le nombre."),
            tk("Touche une ligne pour sa fiche : la modifier, la supprimer, ou aller à l'écran d'où elle vient."),
            tk("Une échéance calculée ne se modifie pas ici : on agit dans son écran d'origine."),
            tk("Sur ordinateur, choisis la vue [[Calendrier]] ou [[Liste]], et l'horizon : 3 mois, 1 an ou 5 ans."),
          ],
        },
        { tip: tk("L'assistant ajoute un rappel si tu le lui demandes : « rappelle-moi de résilier la box le 15 mars ».") },
      ],
      links: [{ to: "/echeancier", label: ["Échéancier"] }],
      words: tk("rappel tâche à faire échéance date limite agenda todo calendrier fiscal renouvellement retard"),
    },
    {
      id: "calendrier-abonnement",
      title: tk("Voir l'échéancier dans son calendrier"),
      summary: tk("Abonner Calendrier (iPhone, Mac) à l'échéancier, avec un rappel la veille."),
      body: [
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Comptes et connexions]], bloc [[Échéancier dans Calendrier]]."),
            tk("Touche [[Créer le lien d'abonnement]]."),
            tk("Touche [[S'abonner sur cet appareil]], ou copie le lien pour l'ajouter à un autre agenda. Le lien n'est affiché qu'une fois."),
          ],
        },
        tk("L'agenda reçoit tes tâches, les mensualités, les fins de crédit, les garanties, les documents qui expirent et le calendrier fiscal, et se met à jour toutes les six heures."),
        { warning: tk("Le lien est privé : qui l'a peut lire ton échéancier. [[Nouveau lien]] remplace l'ancien, [[Couper##abonnement]] l'arrête.") },
        { note: tk("Indisponible en mode démo.") },
      ],
      links: [{ to: "/reglages/connexions?c=calendrier", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("ical agenda apple google calendar abonnement synchroniser le calendrier webcal rappel"),
    },
  ],
};
