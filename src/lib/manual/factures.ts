import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const factures: ManualTheme = {
  id: "factures",
  title: tk("Factures et garanties"),
  hint: tk("Garder ses factures, les relier à leur paiement, suivre les garanties"),
  articles: [
    {
      id: "ajouter-une-facture",
      title: tk("Ajouter une facture"),
      summary: tk("Dépose un PDF ou une photo : Pécule lit la facture et cherche l'opération qui l'a payée."),
      body: [
        {
          steps: [
            tk("Ouvre [[Factures]] et touche [[Ajouter]]."),
            tk("Choisis le PDF ou la photo du ticket."),
            tk("Pécule lit le marchand, la date, le total, les articles et la garantie, puis ouvre la fiche de la facture."),
          ],
        },
        {
          list: [
            tk("Si une seule opération correspond (montant, marchand, date), la facture lui est reliée d'office."),
            tk("Si la lecture n'aboutit pas, la facture est gardée « à compléter » : corrige-la avec [[Modifier]]."),
            tk("Un fichier déjà déposé est reconnu : il n'est pas ajouté deux fois."),
          ],
        },
        tk("Autres façons de déposer une facture : la joindre à un message de l'assistant (trombone), [[Joindre une facture]] depuis la fiche d'une opération, le raccourci de l'iPhone, ou le coffre — une facture déposée au coffre est rangée ici d'elle-même."),
        { note: tk("La lecture automatique demande un fournisseur d'IA branché. Sans lui, la facture est gardée avec le nom du fichier pour titre.") },
      ],
      links: [{ to: "/factures", label: ["Factures"] }],
      words: tk("ticket de caisse reçu justificatif photo pdf scanner déposer importer une facture"),
    },
    {
      id: "rapprocher-une-facture",
      title: tk("Relier une facture à son paiement"),
      summary: tk("Le rapprochement : dire quelle opération a payé la facture."),
      body: [
        tk("Une facture « à rapprocher » n'a pas encore d'opération reliée. Le filtre [[À rapprocher]] de l'écran [[Factures]] les réunit, et le menu en porte le nombre."),
        {
          steps: [
            tk("Ouvre la fiche de la facture."),
            tk("Sous [[Opérations reliées]], Pécule propose les opérations proches par la date, le montant et le marchand."),
            tk("Touche la bonne : la facture est reliée."),
          ],
        },
        {
          list: [
            tk("La croix à côté d'une opération reliée retire le lien ; [[Relier une autre opération]] en ajoute une (un paiement en plusieurs fois)."),
            tk("Une fois reliée, la catégorie des articles se reporte sur l'opération, ventilée si les catégories diffèrent."),
            tk("Aucune opération ne viendra (payée par un tiers, carte absente de Pécule) : [[Modifier]], puis coche la case qui dit qu'aucune opération n'est attendue. La facture sort du filtre et du compteur."),
          ],
        },
        { tip: tk("Un achat par carte à débit différé n'apparaît qu'au prélèvement, le mois suivant : la facture se reliera à ce moment-là.") },
      ],
      links: [{ to: "/factures?filtre=a_rapprocher", label: ["Factures", "À rapprocher"] }],
      words: tk("rapprochement lier associer paiement opération correspondante justificatif pas de paiement"),
    },
    {
      id: "garanties",
      title: tk("Suivre les garanties"),
      summary: tk("Savoir ce qui est encore sous garantie, et être prévenu avant la fin."),
      body: [
        tk("Quand une facture porte une garantie, sa fiche affiche la date de fin. Le filtre [[Sous garantie]] de l'écran [[Factures]] liste tout ce qui est encore couvert."),
        {
          list: [
            tk("La date se corrige ou s'ajoute avec [[Modifier]], champ de la garantie ; laisse-le vide s'il n'y en a pas."),
            tk("Chaque fin de garantie figure dans l'échéancier."),
            tk("Une notification prévient 30 jours avant la fin, si ce type est activé sur l'appareil."),
          ],
        },
        { tip: tk("Pour un bien durable neuf sans garantie indiquée, l'assistant propose la garantie légale de deux ans : joins-lui la facture.") },
      ],
      links: [
        { to: "/factures?filtre=garantie", label: ["Factures", "Sous garantie"] },
        { to: "/echeancier", label: ["Échéancier"] },
      ],
      words: tk("garantie sav panne retour expiration électroménager appareil couvert"),
    },
    {
      id: "corriger-une-facture",
      title: tk("Corriger, rendre privée ou supprimer une facture"),
      summary: tk("Reprendre ce que Pécule a lu, et choisir qui voit la facture."),
      body: [
        tk("Depuis la fiche d'une facture, [[Modifier]] permet de corriger ce qui a été acheté, le marchand, la date, le total, la garantie et la note."),
        {
          list: [
            tk("[[Visible par moi seul]] : la facture n'est plus visible des autres membres."),
            tk("Sous [[Articles]], chaque article a sa catégorie : elle se reporte sur l'opération reliée."),
            tk("[[Ouvrir le fichier]] affiche le PDF ou la photo ; depuis une opération, le trombone ouvre la visionneuse, d'où l'on télécharge le fichier."),
            tk("[[Supprimer la facture]] retire la facture et son fichier, après confirmation."),
          ],
        },
        tk("La recherche de l'écran [[Factures]] porte sur le marchand, les articles et le numéro de commande ; le filtre [[Sans fichier]] liste les factures dont le fichier manque."),
      ],
      links: [{ to: "/factures", label: ["Factures"] }],
      words: tk("modifier facture erreur de lecture mauvais montant privé supprimer effacer télécharger"),
    },
    {
      id: "raccourci-iphone",
      title: tk("Envoyer un fichier depuis l'iPhone"),
      summary: tk("Un raccourci dans la feuille de partage : le fichier part à Pécule, qui le range."),
      body: [
        tk("Depuis Mail, Fichiers ou Photos, le raccourci « Envoyer à Pécule » dépose un PDF ou une photo : une facture va dans [[Factures]], tout autre document dans le coffre."),
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Comptes et connexions]], bloc du raccourci iPhone."),
            tk("Touche [[Créer un jeton]] et copie-le aussitôt : il n'est affiché qu'une fois."),
            tk("Touche [[Mode d'emploi]] et suis les étapes dans l'app Raccourcis de l'iPhone."),
          ],
        },
        tk("Le jeton ne permet que de déposer des fichiers, en ton nom. Révoque-le dans le même bloc s'il ne sert plus : le raccourci cesse aussitôt de fonctionner."),
        { note: tk("Indisponible en mode démo.") },
      ],
      links: [{ to: "/reglages/connexions?c=raccourci", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("partager partage ios raccourcis shortcut envoyer photo mail pièce jointe jeton"),
    },
  ],
};
