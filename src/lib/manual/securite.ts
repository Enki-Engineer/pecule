import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const securite: ManualTheme = {
  id: "securite",
  title: tk("Sécurité et suivi"),
  hint: tk("Clés d'accès, sauvegarde, mise à jour, accès donnés, journal"),
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
        tk("Appareil perdu, ou membre qui quitte le foyer : sur la ligne de ce membre, l'administrateur touche [[Couper ses accès]]. Ses clés d'accès, ses sessions, son lien de calendrier, ses jetons de dépôt, ses applications connectées et les notifications de ses appareils cessent d'un coup. Ses données restent ; un nouveau [[Lien d'inscription]] le fait revenir."),
      ],
      links: [{ to: "/reglages/compte#membres", label: ["Réglages", "Compte et sécurité"] }],
      words: tk("nouvel appareil nouveau téléphone déconnexion appareil perdu volé supprimer une clé session couper les accès révoquer membre parti"),
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
        tk("Pour ne plus avoir à y penser, coche [[Écrire une sauvegarde sur le serveur, sans que j'aie à y penser]], section [[Sauvegardes automatiques]] : Pécule en écrit une chaque nuit ou chaque semaine, la relit en entier, et ne garde que les plus récentes. La liste des archives du serveur permet d'en télécharger une ou d'en retirer une ; [[Écrire une sauvegarde maintenant]] en fait une tout de suite."),
        { warning: tk("Ces archives sont sur le même serveur que la base : elles protègent d'une erreur ou d'une mise à jour qui tourne mal, pas de la perte du serveur. Télécharges-en une de temps en temps, et range-la ailleurs.") },
        tk("Si la sauvegarde automatique échoue, ou si aucune sauvegarde n'a été prise depuis un mois, l'administrateur est prévenu par une notification, type [[Sauvegarde automatique en échec, ou aucune sauvegarde depuis un mois]]."),
        tk("Pour qu'une copie parte toute seule ailleurs que sur le serveur, voir [Garder une copie des sauvegardes hors du serveur](/manuel/sauvegarde-hors-serveur)."),
        tk("Une sauvegarde se [restaure](/manuel/restaurer) dans une installation neuve de Pécule. La commande de [mise à jour](/manuel/mise-a-jour) en prend une avant de commencer."),
        { note: tk("Réservé à l'administrateur, à l'écran seulement. Indisponible en mode démo.") },
      ],
      links: [{ to: "/reglages/compte#sauvegarde", label: ["Réglages", "Compte et sécurité"] }],
      words: tk("backup archive exporter mes données export zip copie de sécurité automatique chaque nuit planifiée programmée rotation"),
    },
    {
      id: "sauvegarde-hors-serveur",
      title: tk("Garder une copie des sauvegardes hors du serveur"),
      summary: tk("Une copie chiffrée de chaque sauvegarde automatique, sur un stockage à toi."),
      body: [
        tk("Une sauvegarde gardée sur le même serveur que la base ne protège pas de la perte du serveur. Pécule peut déposer une copie chiffrée de chaque sauvegarde automatique sur un stockage extérieur : compatible S3 (Amazon S3, Backblaze B2, Scaleway, OVH, Cloudflare R2…) ou WebDAV (Nextcloud, kDrive, un NAS…)."),
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Compte et sécurité]], section [[Copie hors du serveur]]."),
            tk("Touche [[Créer la clé de chiffrement]] : Pécule te montre une seule fois ta clé de récupération. Range-la dans ton gestionnaire de mots de passe, coche [[Je l'ai rangée en lieu sûr]], puis touche [[Continuer]]."),
            tk("Choisis [[Compatible S3]] ou WebDAV, donne l'adresse et les identifiants, puis touche [[Essayer et enregistrer]] : Pécule dépose un petit fichier d'essai, le retrouve et le retire avant d'enregistrer quoi que ce soit."),
            tk("Active les sauvegardes automatiques, section [[Sauvegardes automatiques]] : chaque sauvegarde part alors aussi sur ton stockage."),
          ],
        },
        { warning: tk("Sans ta clé de récupération, une copie chiffrée ne peut être relue par personne : ni par toi, ni par Pécule, qui ne la garde pas.") },
        tk("[[Copies gardées sur ce stockage]] règle la conservation : les dernières copies, puis la première de chaque semaine et de chaque mois. Si un envoi échoue, l'archive attend sur le serveur et Pécule réessaie tout seul ; l'administrateur en est prévenu."),
        tk("Pour reprendre une copie, télécharge-la depuis ton stockage, puis [restaure-la](/manuel/restaurer) dans une installation neuve avec ta clé de récupération. Elle se déchiffre aussi sans Pécule, avec l'outil libre « age »."),
        tk("La sauvegarde téléchargée à la main peut être chiffrée de la même façon : coche [[Chiffrer l'archive : elle ne s'ouvrira qu'avec ta clé de récupération]] avant de la télécharger."),
        { note: tk("Réservé à l'administrateur. Indisponible en mode démo.") },
      ],
      links: [{ to: "/reglages/compte#sauvegardes-dehors", label: ["Réglages", "Compte et sécurité"] }],
      words: tk("hors site offsite cloud s3 webdav nextcloud nas backblaze scaleway chiffrement chiffrer age clé de récupération externaliser stockage extérieur copie distante"),
    },
    {
      id: "restaurer",
      title: tk("Restaurer une sauvegarde"),
      summary: tk("Reprendre une sauvegarde complète dans une installation neuve de Pécule."),
      body: [
        tk("Une sauvegarde complète se restaure dans une installation neuve de Pécule — nouveau serveur, changement d'hébergeur, base perdue. Rien ne peut donc être écrasé."),
        {
          steps: [
            tk("Installe Pécule sur le serveur et ouvre le lien du premier démarrage que donne son installation : l'écran [[Bienvenue dans Pécule]] s'affiche tant qu'aucun membre n'existe."),
            tk("Touche [[J'ai une sauvegarde : la restaurer]]. Le lien porte le code d'installation ; si l'écran le demande, la commande affichée sous le champ redonne ce lien."),
            tk("Choisis l'archive sur ton appareil, ou une archive déjà présente sur le serveur, puis touche [[Restaurer cette sauvegarde]]."),
            tk("Garde la page ouverte : Pécule vérifie l'archive, recharge la base et les fichiers, puis redémarre."),
          ],
        },
        tk("Une copie chiffrée (son nom finit par « .age ») demande ta clé de récupération : le champ apparaît quand tu la choisis."),
        tk("À la fin, Pécule dit ce qu'il a retrouvé et ce qu'il reste à faire :"),
        {
          list: [
            tk("Si l'adresse de Pécule a changé, les clés d'accès d'avant ne fonctionnent plus : l'administrateur crée la sienne par le bouton proposé, puis donne un lien d'inscription à chaque membre."),
            tk("Si le secret du serveur n'est pas celui de l'ancien, les clés enregistrées dans l'appli (IA, banque, crypto) sont à ressaisir, et les notifications à réactiver sur chaque appareil."),
            tk("Les sauvegardes automatiques sont mises en pause sur l'installation restaurée, pour qu'une copie d'essai n'écrive pas à la place de l'installation d'origine : réactive-les dans les réglages quand c'est bien elle qui sert.")
          ],
        },
        { warning: tk("Une archive abîmée, ou faite par une version plus récente de Pécule, est refusée avant que quoi que ce soit soit modifié.") },
        { note: tk("Revenir à une sauvegarde sur une installation déjà en service ne se fait pas dans l'appli : celui qui héberge Pécule la restaure dans une base vide, en ligne de commande.") },
      ],
      words: tk("restauration restore reprendre récupérer nouveau serveur migrer déménager changer d'hébergeur base perdue réinstaller"),
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
      id: "mise-a-jour",
      title: tk("Mettre Pécule à jour"),
      summary: tk("Savoir qu'une version est publiée, et l'installer sans risque."),
      body: [
        tk("Pécule ne se met pas à jour tout seul : il prévient l'administrateur, qui lance la mise à jour sur le serveur où Pécule est installé."),
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Suivi technique]], section [[Version et mises à jour]] : tu y lis la version en service et, s'il y en a une plus récente, ce qu'elle apporte."),
            tk("Sur le serveur, dans le dossier de Pécule, lance la commande affichée : elle dépend de la façon dont Pécule est installé (`docker compose pull && docker compose up -d` avec Docker, `node scripts/maj.mjs` sinon)."),
            tk("Elle installe la version et relance Pécule ; une sauvegarde complète est prise avant que la base ne soit modifiée. Pendant le redémarrage, l'appli affiche « Pécule démarre… »."),
          ],
        },
        tk("Une fois par jour, Pécule demande à GitHub si une version plus récente est publiée ; [[Vérifier maintenant]] pose la question tout de suite. L'administrateur peut aussi en être prévenu par une notification, type [[Nouvelle version de Pécule publiée]]."),
        tk("Avant une mise à jour qui change la base, le serveur en garde lui-même une sauvegarde complète : la section dit où se trouve la dernière. Elle sert à revenir en arrière si la mise à jour se passe mal."),
        { note: tk("Si ta version est très ancienne, Pécule peut demander de passer d'abord par une version intermédiaire : la commande à lancer est alors indiquée à la place.") },
        { note: tk("Réservé à l'administrateur. Rien ne s'installe depuis l'appli ni par l'assistant, et la section n'apparaît pas en mode démo.") },
      ],
      links: [{ to: "/reglages/suivi#version", label: ["Réglages", "Suivi technique"] }],
      words: tk("update upgrade nouvelle version release nouveautés numéro de version installer la dernière version changelog"),
    },
    {
      id: "suivi-technique",
      title: tk("Alertes techniques, synchronisations et journal"),
      summary: tk("Savoir si tout tourne, et qui a changé quoi."),
      body: [
        tk("[[Réglages]] → [[Suivi technique]] rassemble :"),
        {
          list: [
            tk("[[Version et mises à jour]] : la version de Pécule en service et celle qui est publiée, pour l'administrateur (voir [Mettre Pécule à jour](/manuel/mise-a-jour))."),
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
            tk("Les mises à jour : une fois par jour, le serveur demande à GitHub quelle est la dernière version de Pécule. Aucune donnée du foyer ne part avec la question ; celui qui héberge peut la couper."),
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
