import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const premiersPas: ManualTheme = {
  id: "premiers-pas",
  title: tk("Premiers pas"),
  hint: tk("Se repérer, chercher, aller vite"),
  articles: [
    {
      id: "decouvrir",
      title: tk("Ce que fait Pécule"),
      summary: tk("Le tour de l'appli en une page : ce qu'on y suit et où le trouver."),
      body: [
        tk("Pécule réunit les finances de ton foyer au même endroit : les comptes et leurs opérations, le budget, le patrimoine, les papiers. Il ne fait que lire tes comptes : aucun paiement ne part de Pécule."),
        {
          list: [
            tk("[[Au quotidien]] : les opérations de tous les comptes, classées par catégorie, l'analyse du mois, le budget, les soldes à venir et les factures."),
            tk("[[Patrimoine]] : comptes, épargne, placements, immobilier, crédits, crypto, objectifs et projections."),
            tk("[[Situation]] : bulletins de paie, impôts et retraite."),
            tk("[[Documents]] : le coffre, où chaque papier est rangé et lu, et l'échéancier de ce qui arrive."),
            tk("[[Assistant]] : il répond à tes questions sur tes chiffres et sur l'appli, et peut agir à ta place, toujours après ta confirmation."),
          ],
        },
        tk("Pour commencer, il faut des comptes : relie une banque, importe un fichier de ta banque ou crée un compte tenu à la main ([d'où viennent les opérations](/manuel/sources-de-donnees)). Classe ensuite quelques opérations : Pécule retient tes choix et classe les suivantes de lui-même."),
        { tip: tk("Chaque membre du foyer a sa propre vue, et [[Réglages]] → [[Mode démo]] montre l'appli avec une famille fictive.") },
      ],
      links: [
        { to: "/", label: ["Tableau de bord"] },
        { to: "/reglages/connexions", label: ["Réglages", "Comptes et connexions"] },
      ],
      words: tk("présentation fonctionnalités à quoi sert démarrer débuter commencer introduction"),
    },
    {
      id: "presentation",
      title: tk("La présentation de bienvenue"),
      summary: tk("Les quelques étapes qui t'accueillent à ta première connexion, à revoir quand tu veux."),
      body: [
        tk("À ta première connexion, Pécule t'accueille par une présentation de quelques étapes : les réglages du foyer (pays, devise, écrans à garder ; l'administrateur seulement), les repères pour t'y retrouver, puis tes comptes, avec un guide pas à pas pour relier ta banque."),
        {
          list: [
            tk("[[Passer]] la referme tout de suite : rien n'est perdu, tout ce qu'elle propose se règle ensuite dans [[Réglages]]."),
            tk("Quittée en cours de route, elle se rouvre à ta prochaine visite, à l'étape où tu l'as laissée, jusqu'à ce que tu l'aies finie ou passée."),
            tk("Une fois vue, elle ne revient plus d'elle-même, sur aucun de tes appareils. Pour la revoir : cherche [[Présentation de Pécule]] dans la recherche, ou ouvre le lien ci-dessous."),
          ],
        },
        tk("Son étape [[Tes comptes]] mène au guide [Relier une banque](/manuel/relier-une-banque) ; tu peux aussi choisir d'importer un fichier de ta banque, ou d'y revenir plus tard."),
        tk("Sa dernière étape propose la [visite guidée](/manuel/visite-guidee) : le tour de l'appli elle-même, un endroit après l'autre."),
        { note: tk("Chaque membre a la sienne, à sa première connexion. Indisponible en mode démo.") },
      ],
      links: [{ to: "/bienvenue", label: ["Présentation de Pécule"] }],
      words: tk("onboarding accueil bienvenue premier lancement première fois réglages du foyer démarrage guide de démarrage"),
    },
    {
      id: "visite-guidee",
      title: tk("La visite guidée"),
      summary: tk("Le tour de l'appli dans l'appli elle-même : chaque endroit s'éclaire, avec une bulle qui l'explique."),
      body: [
        tk("La visite guidée fait le tour de Pécule sans quitter l'appli : un voile se pose sur l'écran, chaque endroit s'éclaire à son tour et une bulle dit en deux phrases à quoi il sert. Sur ordinateur, elle parcourt le menu — chaque famille ouvre son écran derrière la bulle — puis les outils de la barre du haut ; sur téléphone, les onglets, puis les boutons du haut."),
        {
          list: [
            tk("Pour la lancer : [[Visite guidée]], en bas du menu, sous [[Assistant]] ; sur téléphone, dans [[Tout Pécule]]. La recherche la trouve aussi."),
            tk("[[Suivant]] et [[Précédent]] font avancer et reculer, comme les flèches → et ← du clavier ; toucher l'endroit éclairé passe aussi à la suite."),
            tk("[[Quitter la visite]], ou la touche Échap, l'arrête à tout moment : tu reviens à l'écran d'où tu es parti."),
          ],
        },
        tk("Elle ne change rien : le temps de la visite, l'appli est seulement montrée. Elle ne passe que par les écrans que ton foyer a gardés, et se rejoue autant de fois que tu veux — y compris en mode démo, pour montrer Pécule à quelqu'un."),
      ],
      links: [{ to: "/?visite=1", label: ["Visite guidée"] }],
      words: tk("tour de l'appli bulles explications découvrir prise en main tutoriel montrer rejouer aide au démarrage où est quoi"),
    },
    {
      id: "naviguer-ordinateur",
      title: tk("Se repérer sur ordinateur"),
      summary: tk("Le menu, la barre du haut, les fiches et le clic droit."),
      body: [
        tk("À gauche, le menu range les écrans par groupes : [[Au quotidien]], [[Patrimoine]], [[Situation]], [[Documents]]. En bas du menu : [[Assistant]], [[Visite guidée]] (le tour de l'appli, une bulle après l'autre), [[Manuel]], [[Réglages]], puis [[Replier]], qui ne garde que les icônes."),
        tk("Un nombre à droite d'une ligne du menu compte ce qui t'attend (opérations à classer, comptes signalés, factures à rapprocher, tâches en retard). Clique sur le nombre : l'écran s'ouvre déjà filtré."),
        tk("La barre du haut porte, de gauche à droite : le chemin de l'écran ouvert, la période (sur [[Analyse]] et [[Opérations]]), le choix [[Foyer]] ou [[Moi]], la recherche, l'œil qui masque les montants, le « ? » qui ouvre la page du manuel de l'écran affiché, la synchronisation des banques et l'assistant."),
        {
          list: [
            tk("Une ligne cliquée ouvre sa fiche dans un tiroir à droite : clique à côté ou appuie sur Échap pour la fermer."),
            tk("Un clic droit sur une ligne de tableau propose ses actions : ouvrir, filtrer, demander à l'assistant, copier."),
            tk("Un clic sur un graphique ouvre les opérations qui le composent."),
            tk("Un en-tête de colonne trie le tableau."),
          ],
        },
        { tip: tk("La petite pastille « i » à côté d'un chiffre explique comment il est calculé.") },
      ],
      links: [{ to: "/", label: ["Tableau de bord"] }],
      words: tk("navigation menu latéral barre fil d'ariane tiroir fiche clic droit interface bureau mac pc"),
    },
    {
      id: "naviguer-telephone",
      title: tk("Se repérer sur téléphone"),
      summary: tk("Les onglets du bas, le menu « Tout Pécule » et les gestes."),
      body: [
        tk("En bas de l'écran : [[Accueil]], [[Opérations]], le bouton de l'assistant au centre, [[Mois]] et [[Patrimoine]]. Les factures sont dans [[Opérations]] : une bascule [[Opérations]] | [[Factures]] se trouve en haut des deux écrans."),
        tk("Tous les autres écrans sont dans le menu [[Tout Pécule]], le bouton en haut à gauche des écrans principaux. On y trouve aussi le choix [[Foyer]] ou [[Moi]], [[Masquer les montants]], [[Assistant]], [[Visite guidée]], [[Manuel]] et [[Réglages]]."),
        {
          list: [
            tk("Tire l'écran vers le bas pour synchroniser les banques et rafraîchir."),
            tk("Une fiche s'ouvre depuis le bas : tire-la vers le bas pour la fermer."),
            tk("Sur une opération, balaie vers la gauche pour la classer, ou garde le doigt appuyé pour toutes ses actions."),
            tk("La loupe, en haut à droite, cherche partout ; le « ? », à côté, ouvre la page du manuel de l'écran affiché."),
          ],
        },
        { tip: tk("Installée sur l'écran d'accueil, Pécule s'ouvre comme une appli et peut envoyer des notifications : voir [Installer Pécule sur son téléphone](/manuel/installer-telephone).") },
      ],
      links: [{ to: "/", label: ["Accueil"] }],
      words: tk("iphone android mobile smartphone onglets gestes balayer swipe menu navigation"),
    },
    {
      id: "recherche",
      title: tk("Rechercher partout"),
      summary: tk("Une seule recherche pour les écrans, les opérations, les factures, les documents et le manuel."),
      body: [
        tk("Sur ordinateur, appuie sur ⌘K (Ctrl+K sur Windows) ou clique sur le champ de recherche de la barre du haut. Sur téléphone, touche la loupe en haut à droite."),
        {
          list: [
            tk("Tape le nom d'un écran ou d'un réglage pour y aller."),
            tk("À partir de deux lettres : les opérations (libellé, marchand, note, catégorie), les factures, les comptes, le patrimoine, les documents du coffre et la crypto."),
            tk("À partir de trois lettres : les articles de ce manuel, et une ligne pour poser la question à l'assistant."),
          ],
        },
        tk("Les flèches ↑ ↓ parcourent les résultats, Entrée ouvre, Échap ferme."),
        { note: tk("Chaque écran a aussi sa propre recherche : [[Opérations]], [[Factures]] et [[Coffre]] cherchent dans leur liste, le coffre jusque dans le texte des documents.") },
      ],
      words: tk("chercher trouver loupe palette commandes cmd k ctrl k retrouver une opération"),
    },
    {
      id: "raccourcis-clavier",
      title: tk("Raccourcis clavier"),
      summary: tk("Aller d'un écran à l'autre et agir sans la souris, sur ordinateur."),
      body: [
        tk("Appuie sur « ? » pour afficher la liste dans l'appli. Les raccourcis ne jouent pas pendant que tu écris dans un champ. Sur Windows, Ctrl remplace ⌘."),
        {
          list: [
            tk("⌘K : rechercher partout."),
            tk("⌘J : ouvrir ou fermer l'assistant ; ⌘⇧J : l'assistant en plein écran."),
            tk("⌥← et ⌥→ : période précédente ou suivante, sur [[Analyse]] et [[Opérations]]."),
            tk("M : masquer ou afficher les montants."),
            tk("Échap : fermer la fiche ou la fenêtre ouverte."),
          ],
        },
        tk("« G » puis une lettre ouvre un écran : D tableau de bord, O opérations, A analyse, B budget, F factures, P patrimoine, I immobilier, C crypto, R revenus, T impôts, K coffre, E échéancier, M manuel, S réglages."),
        tk("Dans le tableau des opérations : ↑ ↓ (ou J et K) changent de ligne, X coche l'opération, Maj + clic coche une plage. Dans le tri des opérations à classer : 1, 2 ou 3 choisit une suggestion, → ou S passe à la suivante, / ouvre les autres catégories."),
      ],
      words: tk("clavier touches raccourci commandes rapide cmd ctrl"),
    },
    {
      id: "periode",
      title: tk("Choisir la période"),
      summary: tk("Un mois ou une année entière, la même sur tous les écrans d'analyse."),
      body: [
        tk("La période est un mois ou une année entière. Elle vaut pour [[Analyse]] et [[Opérations]], et elle est gardée tant que l'appli reste ouverte."),
        {
          list: [
            tk("Sur ordinateur : dans la barre du haut, les flèches passent à la période précédente ou suivante, la liste en choisit une, et [[Mois##pas]] | [[Année]] change de pas. [[Aujourd'hui]] revient à la période en cours."),
            tk("Sur [[Opérations]], la liste propose aussi [[Toutes les dates]]."),
            tk("Sur téléphone : les flèches autour du nom de la période, en haut de l'écran [[Mois]]."),
          ],
        },
        tk("Raccourcis : ⌥← et ⌥→. On ne peut pas choisir une période à venir."),
        { tip: tk("Pour mettre deux périodes face à face, voir [Comparer deux périodes](/manuel/comparer).") },
      ],
      links: [{ to: "/mois", label: ["Analyse"] }],
      words: tk("mois année date changer de mois précédent suivant calendrier"),
    },
    {
      id: "foyer-moi",
      title: tk("Foyer ou Moi"),
      summary: tk("Voir tout le foyer — comptes, revenus, impôts — ou seulement ce qui est à toi."),
      body: [
        tk("[[Foyer]] compte tous les comptes que tu vois, comptes communs compris. [[Moi]] ne garde que tes comptes : ni le compte commun, ni ceux des autres."),
        tk("Dans [[Moi]], ce que tu vires au compte commun compte comme une dépense, « Versements au compte commun » : voir [Apports et versements entre comptes](/manuel/apports-versements)."),
        tk("Sur ordinateur, le choix est dans la barre du haut. Sur téléphone, il est en tête du menu [[Tout Pécule]]. Il est mémorisé sur l'appareil."),
        tk("Il change le tableau de bord, [[Opérations]], les opérations à classer, [[Analyse]], [[Comparer]] et [[Budget]]."),
        tk("Il vaut aussi pour [[Revenus]] et [[Impôts]], où il compte les membres : [[Foyer]] réunit tes bulletins et tes déclarations avec ceux des membres qui partagent les leurs, [[Moi]] ne garde que les tiens. Sur téléphone, le choix est alors à côté du titre de l'écran. Voir [Revenus et bulletins de paie](/manuel/revenus) et [Impôts](/manuel/impots)."),
        tk("Ailleurs il est grisé : ces écrans n'en dépendent pas."),
        { note: tk("Le choix n'est pas proposé quand il ne changerait rien : tous les comptes sont à toi, ou le foyer n'a qu'un membre.") },
      ],
      words: tk("périmètre personnel commun compte joint mes comptes vue revenus du foyer impôts du foyer"),
    },
    {
      id: "mode-discret",
      title: tk("Masquer les montants"),
      summary: tk("Le mode discret remplace tous les montants par « ••• »."),
      body: [
        tk("Pour montrer l'écran à quelqu'un ou travailler dans un lieu public, masque les montants : chiffres clés, listes, graphiques et étiquettes affichent « ••• »."),
        {
          list: [
            tk("Sur ordinateur : l'œil de la barre du haut, ou la touche M."),
            tk("Sur téléphone : [[Tout Pécule]] → [[Masquer les montants]]."),
          ],
        },
        tk("Les pourcentages, les nombres d'opérations et les libellés restent lisibles, tout comme le texte déjà écrit par l'assistant. Le réglage est mémorisé sur l'appareil : refais le même geste pour afficher de nouveau les montants."),
        { tip: tk("Tu peux aussi le demander à l'assistant : « masque les montants ».") },
      ],
      words: tk("discret discrétion cacher chiffres confidentialité œil vie privée public"),
    },
    {
      id: "synchroniser",
      title: tk("Synchroniser les banques"),
      summary: tk("Faire venir les dernières opérations, à la demande ou toute seule."),
      body: [
        tk("Pécule relit les banques de lui-même, plusieurs fois par jour. Pour le demander tout de suite :"),
        {
          list: [
            tk("sur ordinateur, le bouton aux deux flèches de la barre du haut, ou [[Synchroniser]] sur le tableau de bord ;"),
            tk("sur téléphone, le bouton rond de l'accueil, ou tire l'écran vers le bas."),
          ],
        },
        tk("Un message donne le nombre de nouvelles opérations. Celles que Pécule reconnaît sont classées aussitôt ; les autres attendent dans les opérations à classer."),
        { note: tk("Une banque limite le nombre de lectures par jour : si une lecture est refusée, réessaie plus tard. Les dernières lectures et leurs erreurs sont dans [[Réglages]] → [[Suivi technique]]. En mode démo, aucune banque n'est contactée.") },
      ],
      links: [{ to: "/reglages/suivi", label: ["Réglages", "Suivi technique"] }],
      words: tk("synchro mise à jour actualiser rafraîchir nouvelles opérations banque relire"),
    },
    {
      id: "mode-demo",
      title: tk("Le mode démo"),
      summary: tk("Montrer Pécule avec une famille fictive, sans rien dévoiler."),
      body: [
        tk("Le mode démo fait passer l'appli sur une famille imaginaire, avec ses comptes, ses opérations, ses factures, son patrimoine et son échéancier. Tout fonctionne, l'assistant compris, mais sur ces données fictives."),
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Mode démo]]."),
            tk("Touche [[Passer en mode démo]]."),
            tk("Pour revenir à tes données : [[Quitter le mode démo]], puis Face ID, Touch ID ou le code de l'appareil."),
          ],
        },
        {
          list: [
            tk("Il ne vaut que sur l'appareil où tu l'actives : les autres membres et tes autres appareils restent sur les vraies données."),
            tk("La synchronisation, les notifications, les clés d'accès, l'import d'un dossier et le mode vocal sont coupés pendant la démo."),
            tk("Les données fictives sont remises à neuf chaque jour : ce que tu y changes ne reste pas."),
          ],
        },
        { note: tk("Un badge [[Démo]] reste affiché en haut de l'écran tant que le mode est actif.") },
      ],
      links: [{ to: "/reglages/demo", label: ["Réglages", "Mode démo"] }],
      words: tk("démonstration présenter montrer données fictives fausse famille essayer"),
    },
  ],
};
