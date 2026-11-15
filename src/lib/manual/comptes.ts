import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const comptes: ManualTheme = {
  id: "comptes",
  title: tk("Comptes et banques"),
  hint: tk("Relier une banque, importer un fichier, régler ses comptes"),
  articles: [
    {
      id: "sources-de-donnees",
      title: tk("D'où viennent les opérations"),
      summary: tk("Trois façons d'alimenter un compte : la banque en lecture seule, un fichier, ou la saisie à la main."),
      body: [
        tk("Tout se règle dans [[Réglages]] → [[Comptes et connexions]]. Chaque source y montre ses comptes ; rien n'est obligatoire, et les sources se combinent."),
        {
          list: [
            tk("**Enable Banking** : Pécule lit tes comptes auprès de ta banque, avec ton accord — comptes, soldes, opérations et encours des cartes à débit différé. Gratuit pour un usage personnel. Voir [Relier une banque](/manuel/relier-une-banque)."),
            tk("[[Fichiers de la banque]] : tu déposes l'export de ta banque (OFX, QIF ou CSV) quand tu veux. Voir [Importer un fichier de la banque](/manuel/importer-fichier-banque)."),
            tk("[[Comptes tenus à la main]] : aucun lien avec une banque, tu ajoutes toi-même les opérations. Voir [Tenir un compte à la main](/manuel/compte-a-la-main)."),
          ],
        },
        tk("Les documents (relevés, bulletins de paie, avis d'impôt, tableaux d'amortissement) entrent par le coffre : voir [Quel document alimente quel écran](/manuel/documents-vers-ecrans)."),
        { note: tk("Une banque ne transmet qu'un historique limité : pour remonter plus loin, importe les fichiers des années passées.") },
      ],
      links: [{ to: "/reglages/connexions", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("connexion banque source alimenter ajouter un compte agrégateur dsp2 historique"),
    },
    {
      id: "relier-une-banque",
      title: tk("Relier une banque"),
      summary: tk("Donner à Pécule l'accord de lire tes comptes, par Enable Banking."),
      body: [
        tk("Enable Banking est un prestataire agréé qui lit tes comptes auprès de ta banque, en lecture seule. Il faut d'abord que l'administrateur du foyer ait créé une application sur enablebanking.com et enregistré son identifiant et sa clé dans Pécule : le bloc « Enable Banking » de [[Réglages]] → [[Comptes et connexions]] l'y guide."),
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Comptes et connexions]], bloc « Enable Banking »."),
            tk("Sous [[Relier une banque]], choisis le pays puis la banque, et touche [[Relier]]."),
            tk("Valide la page d'accord, puis identifie-toi auprès de ta banque. Fais-le sans attendre : la page d'accord expire au bout d'un quart d'heure."),
            tk("De retour dans Pécule, la première lecture commence ; les comptes apparaissent quelques minutes plus tard."),
          ],
        },
        {
          list: [
            tk("La banque demande de redonner ton accord tous les 180 jours. Pécule l'inscrit à l'échéancier et le signale avant la date."),
            tk("[[Lire maintenant]] relit les comptes sans attendre ; la banque limite le nombre de lectures par jour."),
            tk("Chaque adulte relie ses propres comptes. Pour des comptes à ton seul nom, l'usage gratuit demande ta propre application : « J'ai des comptes à mon seul nom », dans le même bloc."),
          ],
        },
        { note: tk("Réglages réservés à l'écran : l'assistant ne peut ni relier une banque ni saisir une clé. Indisponible en mode démo.") },
      ],
      links: [{ to: "/reglages/connexions?c=banque", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("connecter banque enable banking accord consentement dsp2 synchronisation automatique ajouter ma banque boursobank"),
    },
    {
      id: "accord-bancaire",
      title: tk("Renouveler ou retirer l'accord d'une banque"),
      summary: tk("L'accord donné à une banque dure 180 jours au plus : le prolonger, ou y mettre fin."),
      body: [
        tk("Dans [[Réglages]] → [[Comptes et connexions]], le bloc « Enable Banking » liste les accords donnés : la banque, le membre, la date de fin et le nombre de comptes. Une date proche passe en orange, et l'échéancier porte un rappel « Accord bancaire à renouveler »."),
        {
          list: [
            tk("[[Renouveler]] relance le parcours d'accord auprès de la même banque."),
            tk("[[Retirer]] met fin à l'accord. Les opérations déjà lues restent dans Pécule."),
          ],
        },
        tk("Chacun retire ses propres accords ; l'administrateur peut retirer ceux de tous. Tu peux aussi retirer ton accord directement auprès de ta banque."),
        { warning: tk("Un accord expiré n'alimente plus ses comptes : leurs opérations restent, mais plus rien n'arrive tant qu'il n'est pas renouvelé.") },
      ],
      links: [
        { to: "/reglages/connexions?c=banque", label: ["Réglages", "Comptes et connexions"] },
        { to: "/echeancier", label: ["Échéancier"] },
      ],
      words: tk("expiration expiré 180 jours reconnecter consentement révoquer déconnecter la banque plus de nouvelles opérations"),
    },
    {
      id: "importer-fichier-banque",
      title: tk("Importer un fichier de la banque"),
      summary: tk("Déposer un export OFX, QIF ou CSV : ses opérations rejoignent le compte choisi, sans doublon."),
      body: [
        {
          steps: [
            tk("Télécharge l'export de tes opérations sur le site de ta banque (OFX, QIF ou CSV)."),
            tk("Dans Pécule, ouvre [[Réglages]] → [[Comptes et connexions]], bloc [[Fichiers de la banque]]."),
            tk("Choisis le compte qui reçoit les opérations, ou [[Nouveau compte…]] : donne alors sa nature, son titulaire et son nom."),
            tk("Touche [[Choisir un fichier]]. Pécule montre d'abord un aperçu — combien d'opérations seront ajoutées, combien sont déjà connues, sur quelle période — sans rien écrire."),
            tk("Touche [[Importer]]."),
          ],
        },
        tk("Tu peux redéposer un fichier qui recouvre le précédent : une opération déjà présente à la même date et pour le même montant n'est pas ajoutée deux fois. Les opérations ajoutées sont classées par tes règles et par les libellés déjà classés."),
        { note: tk("Fichier de 12 Mo au plus. Si le fichier mêle plusieurs comptes, Pécule demande lequel importer. Indisponible en mode démo.") },
      ],
      links: [{ to: "/reglages/connexions?c=fichiers", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("export relevé ofx qif csv télécharger import manuel historique ancien doublons"),
    },
    {
      id: "compte-a-la-main",
      title: tk("Tenir un compte à la main"),
      summary: tk("Un compte qu'aucune banque n'alimente : tu y ajoutes ses opérations toi-même."),
      body: [
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Comptes et connexions]], bloc [[Comptes tenus à la main]]."),
            tk("Touche [[Créer un compte à la main]] : nom, nature, titulaire, solde et devise."),
            tk("Touche [[Créer le compte]]."),
          ],
        },
        tk("Pour y ajouter une opération : écran [[Opérations]], bouton [[Ajouter]] (il n'apparaît que si un tel compte existe). Choisis [[Dépense]] ou [[Revenu]], le montant, le libellé et la date, puis [[Ajouter l'opération]]. Elle est classée comme les autres, et le solde du compte suit."),
        {
          list: [
            tk("Le solde et la devise se corrigent en dépliant le compte dans la liste."),
            tk("Une opération saisie à la main se supprime depuis sa fiche."),
            tk("Tu peux aussi y importer un fichier de banque."),
          ],
        },
        { note: tk("Indisponible en mode démo.") },
      ],
      links: [
        { to: "/reglages/connexions?c=manuel", label: ["Réglages", "Comptes et connexions"] },
        { to: "/operations", label: ["Opérations"] },
      ],
      words: tk("compte manuel espèces liquide cash saisir une opération ajouter une dépense à la main sans banque"),
    },
    {
      id: "regler-un-compte",
      title: tk("Renommer, masquer ou sortir un compte des statistiques"),
      summary: tk("Les réglages d'un compte : son nom, sa place sur ton accueil, sa part dans tes totaux."),
      body: [
        tk("Ouvre [[Réglages]] → [[Comptes et connexions]] et touche un compte pour le déplier."),
        {
          list: [
            tk("[[Nom affiché]] : le nom du compte dans toute l'appli, pour tout le foyer. Laisse vide pour reprendre le nom donné par la banque."),
            tk("[[Masqué##compte]] : le compte est retiré de ton accueil ; ses opérations restent comptées."),
            tk("[[Hors statistiques]] : le compte est exclu de tes totaux et de tes opérations à classer."),
          ],
        },
        tk("Masquer un compte ou le sortir des statistiques ne vaut que pour toi : les autres membres gardent leurs propres réglages. Les comptes masqués sont repliés en bas de la liste."),
        { tip: tk("L'assistant peut le faire à ta place : « masque le livret de Léo », « sors le compte professionnel de mes statistiques ».") },
      ],
      links: [{ to: "/reglages/connexions", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("renommer compte cacher exclure ignorer ne pas compter nom du compte hors stats"),
    },
    {
      id: "carte-debit-differe",
      title: tk("Cartes à débit différé"),
      summary: tk("Les achats déjà faits mais pas encore prélevés, et le jour où ils comptent."),
      body: [
        tk("Avec une carte à débit différé, la banque prélève en une fois, le mois suivant, les achats du mois. Quand la banque le transmet, Pécule montre cet encours : le total des achats en attente et la date du prélèvement."),
        {
          list: [
            tk("Sur le tableau de bord, le chiffre [[Cartes à débit différé]] ; sur l'accueil du téléphone, sous [[Disponible sur les comptes]]."),
            tk("Le chiffre [[Disponible]] n'en est pas diminué : ces achats ne sont pas encore sortis du compte."),
            tk("[[Soldes à venir]] compte le prochain relevé de la carte dans le solde prévu du compte."),
          ],
        },
        tk("Un achat par carte peut compter le jour de l'achat ou le jour où la banque le prélève : c'est un réglage du foyer, voir [Jour d'achat ou jour du débit](/manuel/jour-achat-debit)."),
      ],
      links: [{ to: "/soldes", label: ["Soldes à venir"] }],
      words: tk("carte bancaire différé encours prélèvement fin de mois en attente visa"),
    },
    {
      id: "devises",
      title: tk("Comptes en devise étrangère"),
      summary: tk("Un compte tenu dans une autre devise est converti, et garde ses montants d'origine."),
      body: [
        tk("Tous les totaux, les budgets et le patrimoine sont dans la devise du foyer. Un compte tenu dans une autre devise est converti au cours de référence de la Banque centrale européenne du jour de chaque opération."),
        tk("Le montant d'origine reste affiché sous le montant converti, sur l'opération comme sur le solde du compte."),
        tk("La devise du foyer se choisit dans [[Réglages]] → [[Foyer]] : voir [Pays, devise et fuseau horaire](/manuel/pays-devise)."),
      ],
      links: [{ to: "/reglages/foyer", label: ["Réglages", "Foyer"] }],
      words: tk("monnaie dollar franc suisse livre conversion taux de change étranger euro"),
    },
  ],
};
