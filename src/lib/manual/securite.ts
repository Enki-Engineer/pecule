import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const securite: ManualTheme = {
  id: "securite",
  title: tk("Sécurité et suivi"),
  hint: tk("Clés d'accès, sauvegarde, accès donnés, journal"),
  articles: [
    {
      id: "cles-d-acces",
      title: tk("Se connecter avec une clé d'accès"),
      summary: tk("Pas de mot de passe : Face ID, Touch ID ou le code de l'appareil."),
      body: [
        tk("Pécule n'a ni mot de passe ni identifiant. Chaque membre se connecte avec une clé d'accès, gardée par son appareil et déverrouillée par Face ID, Touch ID ou le code de l'appareil."),
        {
          list: [
            tk("Sur l'écran de connexion, touche [[Se connecter]] et valide sur l'appareil."),
            tk("Ta première clé se crée avec le lien d'inscription reçu de l'administrateur."),
            tk("Une clé gardée dans un trousseau synchronisé (iCloud, gestionnaire de mots de passe) sert sur tous les appareils qui le partagent."),
          ],
        },
        { tip: tk("Crée une clé sur au moins deux appareils : si l'un est perdu, l'autre te laisse entrer.") },
      ],
      links: [{ to: "/reglages/compte#membres", label: ["Réglages", "Compte et sécurité"] }],
      words: tk("mot de passe passkey connexion login identifiant face id touch id empreinte authentification"),
    },
    {
      id: "appareils",
      title: tk("Ajouter un appareil, en retirer un, se déconnecter"),
      summary: tk("Gérer les clés d'accès et les sessions ouvertes."),
      body: [
        tk("Tout est dans [[Réglages]] → [[Compte et sécurité]], sous [[Membres et clés d'accès]]."),
        {
          list: [
            tk("[[Ajouter cet appareil]], sur ta ligne, crée une clé d'accès sur l'appareil que tu utilises."),
            tk("Pour un appareil que tu n'as pas sous la main, [[Lien d'inscription]] donne un lien à y ouvrir, valable sept jours."),
            tk("La corbeille à côté d'une clé la supprime : cet appareil ne pourra plus se connecter. Ta dernière clé ne peut pas être supprimée."),
            tk("[[Déconnecter mes autres appareils]] ferme toutes tes autres sessions."),
            tk("[[Se déconnecter]] ferme la session de cet appareil, y arrête les notifications et efface les données qu'il gardait."),
          ],
        },
        { note: tk("Ces gestes ne se font qu'à l'écran, et sont coupés en mode démo. L'administrateur peut supprimer la clé d'un autre membre.") },
      ],
      links: [{ to: "/reglages/compte#membres", label: ["Réglages", "Compte et sécurité"] }],
      words: tk("nouvel appareil nouveau téléphone déconnexion appareil perdu volé supprimer une clé session"),
    },
    {
      id: "sauvegarde",
      title: tk("Sauvegarder tout Pécule"),
      summary: tk("Une archive de toute la base et de tous les fichiers, à garder en lieu sûr."),
      body: [
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Compte et sécurité]], section [[Sauvegarde complète]]."),
            tk("Touche [[Télécharger la sauvegarde]] et garde Pécule ouvert jusqu'à la fin du téléchargement."),
          ],
        },
        tk("L'archive contient la base entière — opérations, catégories, patrimoine, réglages, conversations avec l'assistant — et tous les fichiers gardés : factures, documents du coffre, logos."),
        { warning: tk("Elle contient les données privées de tous les membres, en clair : range-la dans un endroit sûr.") },
        tk("La restauration ne se fait pas dans l'appli : elle se lance sur le serveur, dans une base vide, par celui qui héberge Pécule. Fais une sauvegarde avant chaque mise à jour."),
        { note: tk("Réservé à l'administrateur, à l'écran seulement. Indisponible en mode démo.") },
      ],
      links: [{ to: "/reglages/compte#sauvegarde", label: ["Réglages", "Compte et sécurité"] }],
      words: tk("backup archive exporter mes données restaurer export zip copie de sécurité"),
    },
    {
      id: "acces-exterieurs",
      title: tk("Voir et retirer les accès donnés"),
      summary: tk("Banques, applications, jetons, liens : tout ce qui accède à Pécule en ton nom."),
      body: [
        tk("[[Réglages]] → [[Comptes et connexions]] réunit tout ce qui lit Pécule ou l'alimente. Chaque accès se retire d'un geste."),
        {
          list: [
            tk("Accords donnés aux banques : [[Retirer]], dans le bloc « Enable Banking »."),
            tk("[[Applications connectées]] : les accès accordés à l'appli Claude."),
            tk("Jetons du raccourci iPhone : ils ne permettent que de déposer des fichiers."),
            tk("[[Échéancier dans Calendrier]] : le lien d'abonnement de ton agenda."),
            tk("[[Jetons d'administration]] : tous les droits, au nom de l'administrateur. Révoque celui qui ne sert plus."),
          ],
        },
        { tip: tk("Un jeton ou un lien n'est affiché qu'une fois, à sa création : s'il est perdu, révoque-le et crées-en un autre.") },
      ],
      links: [{ to: "/reglages/connexions", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("révoquer accès autorisations applications tierces jeton token partage sécurité"),
    },
    {
      id: "suivi-technique",
      title: tk("Alertes techniques, synchronisations et journal"),
      summary: tk("Savoir si tout tourne, et qui a changé quoi."),
      body: [
        tk("[[Réglages]] → [[Suivi technique]] rassemble :"),
        {
          list: [
            tk("[[Alertes]] : les erreurs du serveur, d'une synchronisation ou d'un service de cours, regroupées quand elles se répètent. [[Marquer comme lue]] en retire une. Le menu en porte le nombre."),
            tk("[[Synchronisations bancaires]] : les dernières lectures, avec le nombre d'opérations nouvelles et de classements automatiques."),
            tk("[[Journal des modifications]] : qui a changé quoi, depuis l'écran, l'assistant ou une application connectée."),
          ],
        },
        { note: tk("Les alertes sont réservées à l'administrateur ; dans le journal, un membre voit ses propres modifications.") },
      ],
      links: [{ to: "/reglages/suivi", label: ["Réglages", "Suivi technique"] }],
      words: tk("erreur panne bug synchronisation échouée audit historique des modifications logs"),
    },
    {
      id: "confidentialite",
      title: tk("Où sont mes données"),
      summary: tk("Pécule est hébergé par ton foyer : ce qui sort, et vers qui."),
      body: [
        tk("Tes données sont dans la base de ton installation de Pécule, chez l'hébergeur choisi par ton foyer. Elles ne sont ni vendues, ni partagées, ni utilisées pour de la publicité."),
        {
          list: [
            tk("La banque : un prestataire agréé lit tes comptes avec ton accord, en lecture seule. Pécule ne peut initier aucun paiement."),
            tk("L'IA : si un fournisseur est branché, il reçoit les questions posées à l'assistant et les documents à lire."),
            tk("Les cours : les services de cours de bourse et de cryptomonnaies reçoivent le nom des titres suivis, pas tes montants."),
            tk("Les clés saisies dans l'appli sont gardées chiffrées."),
          ],
        },
        tk("Aucun de ces services n'est utilisé sans une décision du foyer. Les pages [Confidentialité](/confidentialite) et [Conditions d'utilisation](/conditions) de ton installation le détaillent."),
      ],
      links: [{ to: "/reglages/connexions", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("données personnelles rgpd vie privée hébergement serveur sécurité chiffrement où sont stockées"),
    },
  ],
};
