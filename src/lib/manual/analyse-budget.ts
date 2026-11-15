import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const analyseBudget: ManualTheme = {
  id: "analyse-budget",
  title: tk("Analyse et budget"),
  hint: tk("Comprendre le mois, tenir un budget, voir venir"),
  articles: [
    {
      id: "tableau-de-bord",
      title: tk("L'accueil et le tableau de bord"),
      summary: tk("L'essentiel d'un coup d'œil : ce que tu as, ce que tu as dépensé, ce qui t'attend."),
      body: [
        tk("Sur ordinateur, le tableau de bord commence par six chiffres : [[Patrimoine net]], [[Disponible]], [[Cartes à débit différé]] quand un encours est connu, [[Dépensé ce mois]], [[Solde du mois]] et [[Dettes restantes]]. Chacun mène à son écran, et sa pastille « i » dit comment il est calculé."),
        {
          list: [
            tk("[[À traiter]] réunit ce qui demande ton attention : comptes bientôt sous leur seuil, opérations à classer, factures sans paiement retrouvé, tâches en retard, alertes techniques."),
            tk("[[Les sept prochains jours]] montre les mouvements attendus, jour par jour."),
            tk("Les autres blocs : évolution du patrimoine, répartition des dépenses du mois, enveloppes, objectifs, dernières opérations, prochaines échéances, comptes."),
          ],
        },
        tk("Sur téléphone, l'accueil reprend l'essentiel en cartes : [[Disponible sur les comptes]], [[Dépensé ce mois-ci]], [[Les sept prochains jours]], les opérations à classer, les enveloppes, les objectifs, les échéances et les comptes."),
        { tip: tk("Les blocs se masquent et se déplacent : voir [Personnaliser l'accueil et le tableau de bord](/manuel/personnaliser-accueil).") },
      ],
      links: [{ to: "/", label: ["Tableau de bord"] }],
      words: tk("accueil dashboard synthèse résumé chiffres clés à traiter vue d'ensemble"),
    },
    {
      id: "definitions-chiffres",
      title: tk("Ce que veulent dire les chiffres"),
      summary: tk("Revenus, dépenses, épargne, solde, disponible : une seule définition sur tous les écrans."),
      body: [
        tk("Un chiffre a la même définition partout : le tableau de bord, l'analyse et l'assistant donnent les mêmes valeurs. La pastille « i » à côté d'un chiffre rappelle la sienne."),
        {
          list: [
            tk("**Dépenses** : ce qui est classé en dépense sur la période, remboursements déduits ; une sortie sans catégorie compte aussi. Ni l'épargne ni les mouvements entre tes comptes n'en font partie."),
            tk("**Revenus** : ce qui est classé en revenu ; une entrée sans catégorie compte aussi."),
            tk("**Solde du mois** : revenus moins dépenses. L'épargne n'en est pas retirée : c'est ce qui reste avant de mettre de côté."),
            tk("**Épargne** : ce qui est classé en épargne — les versements vers un livret, une assurance vie, un plan d'épargne."),
            tk("**Disponible** : ce qu'il y a sur tes comptes aujourd'hui, hors cartes. Les achats par carte à débit différé pas encore prélevés n'en sont pas déduits."),
            tk("**Patrimoine net** : ce que tu possèdes moins ce que tu dois encore ; un bien ou un crédit commun compte pour ta part."),
          ],
        },
        tk("Trois réglages changent ce que les chiffres comptent : le choix [[Foyer]] ou [[Moi]], les comptes sortis des statistiques, et le jour retenu pour les achats par carte."),
        { warning: tk("Une opération à classer n'entre dans aucun poste : classe-les pour que la répartition soit juste.") },
      ],
      links: [{ to: "/mois", label: ["Analyse"] }],
      words: tk("définition calcul comment est calculé signification revenus dépenses épargne solde reste différence entre"),
    },
    {
      id: "analyse",
      title: tk("Analyser un mois ou une année"),
      summary: tk("Où part l'argent : par poste, par nature, par marchand, mois après mois."),
      body: [
        tk("L'écran [[Analyse]] ([[Mois]] sur téléphone) porte sur la période choisie en haut : un mois ou une année entière."),
        {
          list: [
            tk("[[Vue d'ensemble]] : revenus et dépenses sur douze mois, avec trois mois de prévision en pointillé, les chiffres de la période et la liste des postes."),
            tk("[[Calendrier]] : le mois jour par jour."),
            tk("[[Répartition]] : le solde de la période, puis trois anneaux — revenus, dépenses, épargne — et la liste de celui que tu choisis, avec une barre par poste. [[Comparer à]] choisit la référence : le mois précédent, la moyenne des trois derniers mois ou le même mois de l'an dernier. Un trait sur une barre marque le plafond de son enveloppe."),
            tk("[[Flux]] : d'où vient l'argent et où il part, et les sorties par nature sur douze mois."),
            tk("[[Frise]] : les paiements au fil du mois, par moyen de paiement."),
            tk("[[Marchands]] : les achats par carte, marchand par marchand, comparés à la période précédente."),
            tk("[[Comparer]] : une période face à une autre."),
          ],
        },
        tk("Partout, un clic sur un poste, une barre ou une part de graphique ouvre les opérations qui le composent ; [[Ouvrir dans Opérations]] les montre dans la liste filtrée."),
        { note: tk("Sur téléphone, l'écran réunit le graphique des douze mois, les chiffres, la répartition, le calendrier et la frise. Les flux et les marchands sont sur ordinateur.") },
      ],
      links: [{ to: "/mois", label: ["Analyse"] }],
      words: tk("statistiques graphique dépenses par poste par catégorie où part mon argent évolution tendances mois année"),
    },
    {
      id: "calendrier-du-mois",
      title: tk("Le calendrier du mois"),
      summary: tk("Ce qui est entré, sorti et attendu, jour par jour."),
      body: [
        tk("Dans [[Analyse]] → [[Calendrier]], chaque jour porte ses mouvements marquants : entrées, charges (prélèvements et virements importants), épargne, et ce qui est encore attendu d'ici la fin du mois. Les petits achats du jour sont regroupés en un total."),
        {
          list: [
            tk("Clique sur un jour pour voir ses opérations."),
            tk("Sous la grille, [[Solde prévu :]] ajoute dans chaque jour à venir le solde prévu du compte choisi, en orange s'il passe sous son seuil."),
            tk("Sous le calendrier : les prélèvements passés ce mois-ci et ceux qui sont attendus."),
            tk("Sur téléphone : touche un jour pour lire son détail sous la grille, et glisse sur la grille pour changer de mois."),
          ],
        },
        tk("« Attendu » désigne ce qui revient chaque mois sur tes comptes — un prélèvement, un salaire, un virement — et que Pécule reconnaît dans ton historique."),
      ],
      links: [{ to: "/mois?onglet=calendrier", label: ["Analyse", "Calendrier"] }],
      words: tk("agenda jour par jour prélèvements attendus à venir prévision mensuel"),
    },
    {
      id: "frise",
      title: tk("La frise des paiements"),
      summary: tk("Tous les paiements du mois sur une ligne de temps, et ce qu'il reste au fil des jours."),
      body: [
        tk("Dans [[Analyse]] → [[Frise]], chaque opération est une bulle posée à sa date, dans le couloir de son moyen de paiement : entrées, prélèvements, carte, virements, espèces, frais, épargne. La taille de la bulle suit le montant."),
        tk("Sous les couloirs, la courbe [[Reste du mois]] cumule les entrées moins les sorties ; elle se prolonge en pointillé avec ce qui est encore attendu."),
        {
          list: [
            tk("Un anneau vide : un achat par carte pas encore prélevé."),
            tk("Un contour en pointillé : un mouvement attendu."),
            tk("Clique sur un jour ou sur une bulle pour ouvrir les opérations."),
          ],
        },
        tk("Pour une année, la frise se lit mois par mois."),
      ],
      links: [{ to: "/mois?onglet=frise", label: ["Analyse", "Frise"] }],
      words: tk("timeline chronologie ligne de temps paiements bulles reste du mois"),
    },
    {
      id: "comparer",
      title: tk("Comparer deux périodes"),
      summary: tk("Un mois face au précédent, à l'an dernier, à une moyenne ou à des dates libres."),
      body: [
        tk("Ouvre [[Analyse]] → [[Comparer]] ; sur téléphone, le bouton [[Comparer avec une autre période]] de l'écran [[Mois]]."),
        {
          steps: [
            tk("Choisis la période : un mois, une année, ou [[Dates libres]] pour deux dates quelconques."),
            tk("Choisis la référence : [[Mois précédent]], [[L'an dernier]], [[Moyenne 3 mois]], [[Moyenne 6 mois]], [[Moyenne 12 mois]] ou [[Autre période]]."),
            tk("Lis les écarts : dépenses, revenus, épargne et solde, puis les dépenses poste par poste."),
          ],
        },
        tk("En vert : moins dépensé que la référence. Les dépenses sont nettes des remboursements, et les mouvements internes sont exclus. Un clic sur un poste ouvre ses opérations."),
      ],
      links: [{ to: "/comparer", label: ["Comparer"] }],
      words: tk("comparaison écart évolution par rapport au mois dernier année précédente moyenne différence"),
    },
    {
      id: "budget",
      title: tk("Le budget : revenus, charges fixes, reste à vivre"),
      summary: tk("Ce qui rentre chaque mois, ce qui est déjà engagé, et ce qu'il reste."),
      body: [
        tk("L'écran [[Budget]] part de quatre chiffres :"),
        {
          list: [
            tk("[[Revenus du foyer]] : les revenus mensuels nets que tu as renseignés (salaires, loyers…)."),
            tk("[[Charges fixes]] : la somme, ramenée au mois, de tes engagements en cours."),
            tk("[[Reste après charges fixes]] : ce qu'il reste chaque mois pour tout le reste."),
            tk("[[Reste réel]] : les revenus moins ce que tu dépenses vraiment par mois, en moyenne sur les trois derniers mois complets."),
          ],
        },
        tk("En dessous : les [enveloppes](/manuel/enveloppes) du mois, la liste des [engagements](/manuel/engagements), les revenus du foyer, et tes dépenses réelles par poste."),
        tk("Les revenus du foyer se renseignent avec l'assistant : « ajoute mon salaire de 2 400 par mois », « modifie mon bonus de cette année ». Il te montre le changement avant de l'enregistrer."),
      ],
      links: [{ to: "/budget", label: ["Budget"] }],
      words: tk("reste à vivre charges fixes frais fixes revenus salaire budget mensuel prévisionnel"),
    },
    {
      id: "engagements",
      title: tk("Suivre ses engagements"),
      summary: tk("Crédits, assurances, abonnements, impôts : ce qui revient, combien, jusqu'à quand."),
      body: [
        tk("Un engagement est une dépense qui revient : crédit, assurance, contrat ou abonnement, taxe, garde, budget courant. Leur total, ramené au mois, forme les charges fixes."),
        {
          steps: [
            tk("Sur [[Budget]], touche [[Ajouter]]."),
            tk("Donne l'intitulé, le groupe (Logement, Télécom…), le type, et le montant par mois ou par an."),
            tk("Si tu les connais : la date de fin, la date de renouvellement et le préavis en jours."),
            tk("Touche [[Enregistrer]]."),
          ],
        },
        {
          list: [
            tk("Touche un engagement pour le modifier ou le supprimer. Un engagement au statut [[Résilié]] ou [[Non compté]] reste dans la liste, barré, sans compter dans les charges fixes."),
            tk("Quand Pécule reconnaît le prélèvement dans tes opérations, l'engagement affiche la date et le montant du dernier."),
            tk("Un renouvellement et son préavis apparaissent dans l'échéancier."),
            tk("[[Comparer à une offre]], sur une assurance, un abonnement ou un crédit, demande à l'assistant de comparer un devis à ce contrat."),
          ],
        },
        { tip: tk("Depuis la fiche d'un prélèvement, [[Nommer ce prélèvement]] crée l'engagement en un geste.") },
      ],
      links: [{ to: "/budget", label: ["Budget"] }],
      words: tk("abonnement contrat assurance crédit charge fixe récurrent mensualité résilier préavis renouvellement"),
    },
    {
      id: "enveloppes",
      title: tk("Fixer des enveloppes de dépenses"),
      summary: tk("Un plafond mensuel par poste ou par catégorie, avec une alerte avant de le dépasser."),
      body: [
        {
          steps: [
            tk("Sur [[Budget]], dans [[Enveloppes du mois]], touche [[Enveloppe]]."),
            tk("Choisis [[Poste]] ou [[Catégorie]], puis lequel : Pécule rappelle ta moyenne des trois derniers mois et la propose comme plafond."),
            tk("Ajuste le plafond mensuel et le seuil d'alerte (80 % d'origine)."),
            tk("Touche [[Enregistrer]]."),
          ],
        },
        tk("La jauge se remplit au fil du mois : ce qui est dépensé, ce qu'il reste, et, passé les premiers jours, une estimation de la fin de mois. Elle change de couleur au seuil d'alerte, puis passe au rouge au-delà du plafond."),
        {
          list: [
            tk("Touche une jauge pour voir ses opérations du mois ou supprimer l'enveloppe."),
            tk("Les enveloppes les plus entamées sont aussi sur l'accueil et le tableau de bord."),
            tk("Une notification prévient quand une enveloppe atteint son seuil ou est dépassée, si ce type est activé sur l'appareil."),
          ],
        },
        { tip: tk("L'assistant sait créer une enveloppe : « mets une enveloppe de 400 par mois sur les courses ».") },
      ],
      links: [{ to: "/budget#enveloppes", label: ["Budget", "Enveloppes du mois"] }],
      words: tk("plafond limite budget par poste par catégorie dépassement alerte jauge enveloppe mensuelle"),
    },
    {
      id: "objectifs",
      title: tk("Objectifs d'épargne"),
      summary: tk("Un projet, un montant, une date : Pécule suit l'avancement et dit combien verser chaque mois."),
      body: [
        {
          steps: [
            tk("Ouvre [[Objectifs]] et touche [[Objectif]]."),
            tk("Donne un nom, le montant visé et, si tu veux, la date."),
            tk("Choisis le suivi : relie l'objectif à un livret ou à un placement de ton patrimoine — l'avancement suit alors sa valeur — ou saisis toi-même ce qui est déjà mis de côté."),
            tk("Touche [[Enregistrer]]."),
          ],
        },
        tk("Chaque objectif montre son avancement, ce qu'il reste à réunir et, quand une date est fixée, le versement mensuel pour la tenir. Touche-le pour le modifier ou le supprimer."),
        { note: tk("Les trois premiers objectifs sont rappelés sur l'accueil et le tableau de bord ; le calendrier du mois suit le premier.") },
      ],
      links: [{ to: "/objectifs", label: ["Objectifs"] }],
      words: tk("épargner projet voyage travaux apport mettre de côté économies objectif versement mensuel"),
    },
    {
      id: "soldes-a-venir",
      title: tk("Soldes à venir"),
      summary: tk("Le solde prévu de chaque compte sur les 31 prochains jours."),
      body: [
        tk("L'écran [[Soldes à venir]] part du solde du jour de chaque compte et y ajoute ce qui est attendu sur ce compte : ce qui y revient chaque mois (prélèvements, virements, salaire, mouvements entre comptes) et le relevé d'une carte à débit différé."),
        {
          list: [
            tk("La courbe montre le solde prévu ; la ligne en pointillé est le seuil du compte, et le point marque le plus bas des jours à venir."),
            tk("[[Mouvements attendus]] liste chaque mouvement, avec le solde après lui."),
            tk("Les comptes qui passeraient sous leur seuil viennent en premier, avec ce qu'il manquerait pour rester au-dessus."),
          ],
        },
        tk("[[Régler l'alerte]], en haut, mène au réglage du seuil et du délai de prévenance : voir [Être prévenu d'un solde bas](/manuel/alerte-solde-bas)."),
        { warning: tk("Les achats du quotidien ne sont pas devinés : c'est une estimation des engagements connus, à lire comme « au mieux ».") },
      ],
      links: [{ to: "/soldes", label: ["Soldes à venir"] }],
      words: tk("prévision trésorerie découvert solde futur à découvert prévisionnel anticiper"),
    },
    {
      id: "alerte-solde-bas",
      title: tk("Être prévenu d'un solde bas"),
      summary: tk("Un seuil, un délai : Pécule signale un compte avant qu'il ne passe dessous."),
      body: [
        tk("Le réglage est dans [[Réglages]] → [[Notifications et appareil]], section [[Solde bas]]. Il t'est propre et vaut sur tous tes appareils."),
        {
          list: [
            tk("[[Surveiller mes soldes]] : active ou coupe la surveillance."),
            tk("[[Seuil]] : en dessous de ce montant, un compte est signalé. Un montant négatif prévient avant la limite d'un découvert autorisé."),
            tk("[[Me prévenir]] : combien de jours avant que le compte passe sous le seuil (3, 7, 14 ou 30)."),
            tk("Compte par compte : décoche un compte pour l'écarter, ou donne-lui un seuil à lui."),
          ],
        },
        tk("Un compte signalé apparaît en bandeau sur l'accueil et le calendrier du mois, dans [[À traiter]] sur le tableau de bord, et dans le menu à côté de [[Soldes à venir]]. Le bandeau ouvre la prévision du compte ; son bouton [[Régler]] mène ici."),
        { tip: tk("Pour le recevoir en notification, active le type « Solde bas » sur l'appareil. Tu peux aussi demander à l'assistant : « préviens-moi quand le compte commun passe sous 500 ».") },
      ],
      links: [
        { to: "/reglages/notifications#solde", label: ["Réglages", "Notifications et appareil"] },
        { to: "/soldes", label: ["Soldes à venir"] },
      ],
      words: tk("alerte découvert seuil solde faible prévenir avertir compte bas notification solde"),
    },
    {
      id: "resume-semaine",
      title: tk("Le résumé de la semaine"),
      summary: tk("Chaque lundi matin, l'assistant fait le point : dépenses, faits marquants, ce qui t'attend."),
      body: [
        tk("Chaque lundi matin, l'assistant prépare pour chaque membre un résumé de sa semaine : dépenses, faits marquants, ce qui arrive. Il s'affiche sur l'accueil et le tableau de bord, bloc [[Résumé de la semaine]], et une notification le signale si ce type est activé sur l'appareil."),
        {
          list: [
            tk("[[Lire la suite]] déplie le texte."),
            tk("[[En parler]] ouvre la conversation avec l'assistant, pour creuser un point."),
            tk("[[Le préparer]] le demande sans attendre lundi, une fois par jour au plus."),
          ],
        },
        { note: tk("Le résumé demande un fournisseur d'IA branché : voir [Brancher un fournisseur d'IA](/manuel/brancher-ia).") },
      ],
      links: [{ to: "/", label: ["Tableau de bord"] }],
      words: tk("bilan hebdomadaire lundi récapitulatif point de la semaine synthèse"),
    },
  ],
};
