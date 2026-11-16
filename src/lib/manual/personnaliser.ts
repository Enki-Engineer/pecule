import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const personnaliser: ManualTheme = {
  id: "personnaliser",
  title: tk("Personnaliser"),
  hint: tk("Langue, apparence, accueil, notifications"),
  articles: [
    {
      id: "langue",
      title: tk("Changer de langue"),
      summary: tk("Français, anglais, allemand, italien ou espagnol : la langue te suit sur tous tes appareils."),
      body: [
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Apparence]]."),
            tk("Sous [[Langue]], touche la langue voulue."),
            tk("L'appli se recharge dans cette langue."),
          ],
        },
        tk("La langue t'est propre : chaque membre choisit la sienne. Elle vaut pour les écrans, les réponses de l'assistant, le mode vocal et les notifications. Les montants et les dates prennent le format habituel de la langue."),
        { tip: tk("Tu peux le demander à l'assistant : « mets Pécule en anglais ».") },
      ],
      links: [{ to: "/reglages/apparence#langue", label: ["Réglages", "Apparence"] }],
      words: tk("english deutsch italiano español traduction traduire anglais allemand italien espagnol français language"),
    },
    {
      id: "apparence",
      title: tk("Clair, sombre, couleur et densité"),
      summary: tk("L'allure de l'appli sur cet appareil."),
      body: [
        tk("Tout se règle dans [[Réglages]] → [[Apparence]], et vaut pour l'appareil que tu utilises."),
        {
          list: [
            tk("[[Auto]], [[Clair]] ou [[Sombre]] : « Auto » suit le réglage de l'appareil."),
            tk("[[Couleur]] : la couleur des boutons et des repères de l'appli, parmi sept."),
            tk("[[Densité]], sur ordinateur : [[Compacte]] resserre les marges et les lignes pour montrer plus d'opérations par écran, sans réduire le texte."),
          ],
        },
        tk("Le vert et le rouge restent réservés à l'argent : ce qui entre, ce qui sort. Les couleurs des graphiques ne changent pas."),
        { tip: tk("L'assistant peut le faire pour toi : « passe en sombre », « mets la couleur océan », « affichage compact ».") },
      ],
      links: [{ to: "/reglages/apparence#apparence", label: ["Réglages", "Apparence"] }],
      words: tk("thème sombre mode nuit dark mode clair couleur accent compact dense taille affichage design"),
    },
    {
      id: "themes-annee",
      title: tk("Thèmes de l'année et anniversaires"),
      summary: tk("L'appli change d'allure aux fêtes, aux saisons et le jour d'un anniversaire."),
      body: [
        tk("Au fil de l'année, Pécule s'habille de lui-même : fond, couleur, motif et petit décor sur l'accueil. Les fêtes sont plus marquées ; les saisons habillent le reste de l'année."),
        {
          list: [
            tk("[[Thèmes de l'année]] : [[Fêtes et saisons]], [[Fêtes seulement]] ou [[Aucun##thème]]. Réglage de l'appareil."),
            tk("[[Aperçu]], à côté de chaque fête et de chaque saison, montre un thème sans attendre sa date."),
            tk("[[Anniversaires]] : ajoute un prénom et une date ; ce jour-là, l'appli prend les couleurs de l'anniversaire sur tous les appareils du foyer et le souhaite sur l'accueil."),
          ],
        },
        tk("Pendant un thème, il remplace la couleur que tu as choisie."),
      ],
      links: [{ to: "/reglages/apparence", label: ["Réglages", "Apparence"] }],
      words: tk("noël halloween pâques saison fête décor anniversaire thème saisonnier désactiver les décorations"),
    },
    {
      id: "equivalences",
      title: tk("Équivalences amusantes"),
      summary: tk("Lire une dépense en temps de travail, ou dans l'unité de la fête du moment."),
      body: [
        tk("Les équivalences donnent une autre lecture d'un montant : toute l'année, en temps de travail d'après tes bulletins de paie ; pendant un thème, dans l'unité du moment. Elles apparaissent dans la fiche d'une opération et, sur l'accueil, dans le bloc [[Le chiffre du moment]]."),
        tk("Aucun montant ne change : c'est seulement une autre façon de le dire."),
        tk("Pour les couper ou les remettre : [[Réglages]] → [[Apparence]], case [[Équivalences amusantes]]. Le réglage t'est propre et vaut sur tous tes appareils, assistant compris."),
        { note: tk("Les unités des thèmes ont un prix fixé en euros : dans une autre devise, seule l'équivalence en temps de travail s'affiche.") },
      ],
      links: [{ to: "/reglages/apparence", label: ["Réglages", "Apparence"] }],
      words: tk("fun heures de travail chiffre du moment équivalent ludique désactiver"),
    },
    {
      id: "logo-icone",
      title: tk("Logo et icône de l'écran d'accueil"),
      summary: tk("Choisir le fond du coffre, et l'icône de l'appli installée."),
      body: [
        tk("Dans [[Réglages]] → [[Apparence]] :"),
        {
          list: [
            tk("[[Logo]] : le fond du coffre affiché dans l'appli et dans l'onglet du navigateur. Pendant un thème, il prend le décor du moment."),
            tk("[[Icône sur l'écran d'accueil]] : l'icône de l'appli installée — comme le logo, ou celle d'un thème."),
          ],
        },
        { warning: tk("L'iPhone garde l'icône du jour où Pécule a été ajouté à l'écran d'accueil. Pour en changer : ouvre Pécule dans Safari, choisis l'icône, supprime l'ancienne de l'écran d'accueil, puis ajoute Pécule de nouveau. Il faudra te reconnecter et réactiver les notifications.") },
      ],
      links: [{ to: "/reglages/apparence", label: ["Réglages", "Apparence"] }],
      words: tk("icône app logo coffre fond écran d'accueil changer l'icône"),
    },
    {
      id: "personnaliser-accueil",
      title: tk("Personnaliser l'accueil et le tableau de bord"),
      summary: tk("Déplacer les cartes, régler leur largeur, en ajouter, en retirer, ou repartir d'un modèle."),
      body: [
        tk("Sur ordinateur, le tableau de bord s'arrange directement à l'écran. Le bouton rond à côté de [[Synchroniser]], [[Modifier le tableau de bord]], ouvre le [[Mode construction]] : chaque carte et chaque chiffre clé prend un cadre en pointillés et une petite barrette."),
        {
          list: [
            tk("Déplacer : saisis une carte n'importe où et glisse-la ; les autres s'écartent à mesure. Près du haut ou du bas de la fenêtre, la page défile. La touche Échap pendant le geste la remet où elle était."),
            tk("Régler la largeur : les quatre petits dessins de la barrette — [[Un tiers]], [[La moitié]], [[Deux tiers]], [[Toute la largeur]]. Certaines cartes ont besoin de place et n'en proposent que deux ou trois. Une rangée qui n'est pas pleine s'étire pour ne laisser aucun trou : une carte seule sur sa rangée en prend toute la largeur."),
            tk("Retirer : la croix de la barrette. Rien n'est supprimé, la carte attend dans [[Ajouter]]."),
            tk("Ajouter : [[Ajouter]] liste les chiffres clés et les cartes absents. Un clic pose l'élément à la fin ; tu peux aussi le tirer hors du tiroir et le lâcher à sa place."),
            tk("Au clavier : la poignée de la barrette déplace la carte avec les flèches, et les boutons [[Placer avant]] et [[Placer après]] font de même."),
          ],
        },
        tk("Rien n'est enregistré avant [[Terminé]] ; [[Annuler]] rend le tableau de bord d'avant. Si tu changes d'écran ou recharges la page en cours de route, tu retrouves ta construction au retour. Pendant la construction, les cartes ne réagissent pas aux clics : on ne risque pas d'ouvrir un écran en voulant les déplacer."),
        tk("Les modèles : [[Modèles]], dans la barre du mode construction, propose quatre points de départ. En choisir un remplace l'agencement en cours ; tu le modifies ensuite librement."),
        {
          list: [
            tk("[[Vue d'ensemble]] : un peu de tout, l'agencement d'origine."),
            tk("[[Quotidien]] : combien j'ai, là, maintenant ? La carte [[Comptes]] en tête, comme l'appli d'une banque, puis ce qui est à traiter, les sept prochains jours, les dernières opérations et les échéances."),
            tk("[[Budget##modèle]] : est-ce que je tiens mon mois ? Où part l'argent, les enveloppes, les dépenses par poste, le résumé de la semaine."),
            tk("[[Patrimoine##modèle]] : où je vais ? L'évolution du patrimoine net, sa répartition, les comptes et les crédits, les objectifs d'épargne."),
          ],
        },
        { tip: tk("Tu peux aussi le demander à l'assistant : « mets-moi le tableau de bord Quotidien ». Il applique le modèle après ta confirmation.") },
        tk("L'agencement du tableau de bord est gardé par Pécule, pour toi seul : tu le retrouves sur tous tes ordinateurs, et chaque membre du foyer a le sien."),
        tk("Sur téléphone, [[Personnaliser l'accueil]], tout en bas de l'accueil, ouvre le même mode : un appui long sur un bloc le saisit, et tu le glisses plus haut ou plus bas. Sa barrette porte une poignée, les flèches [[Monter]] et [[Descendre]] et une croix pour le retirer ; [[Ajouter]] remet un bloc retiré, [[Revenir à l'ordre d'origine]] remet tout en place. [[Terminé]] enregistre. L'agencement de l'accueil est mémorisé sur l'appareil : il ne suit pas celui du tableau de bord."),
      ],
      links: [{ to: "/", label: ["Tableau de bord"] }],
      words: tk("blocs cartes widgets réorganiser déplacer glisser appui long masquer retirer ajouter ordre disposition agencement largeur modèle template mode construction modifier page d'accueil"),
    },
    {
      id: "notifications",
      title: tk("Recevoir des notifications"),
      summary: tk("Activer les alertes sur un appareil et choisir lesquelles recevoir."),
      body: [
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Notifications et appareil]]."),
            tk("Sous [[Notifications de cet appareil]], touche [[Activer sur cet appareil]] et accepte la demande du navigateur."),
            tk("Coche les types à recevoir, puis touche [[Essai]] pour vérifier."),
          ],
        },
        {
          list: [
            tk("Opérations à classer, le soir."),
            tk("Prélèvement nouveau ou inhabituel."),
            tk("Solde bas, aujourd'hui ou à venir."),
            tk("Loyer pas encore reçu."),
            tk("Échéances à sept jours et tâches du jour."),
            tk("Garantie qui expire dans 30 jours."),
            tk("Enveloppe à son seuil d'alerte ou dépassée."),
            tk("Résumé de la semaine, le lundi matin."),
            tk("Coût de l'IA à 80 % du [plafond du mois](/manuel/assistant-cout), puis quand il est atteint — pour l'administrateur du foyer."),
          ],
        },
        tk("Le réglage vaut pour l'appareil : active les notifications sur chacun de ceux où tu veux les recevoir. Les dernières notifications reçues sont rappelées dans la même section."),
        { warning: tk("Sur iPhone et iPad, il faut d'abord installer Pécule sur l'écran d'accueil, puis l'ouvrir depuis son icône. Activer les notifications demande ton accord sur l'appareil : l'assistant ne peut pas le faire à ta place. Indisponible en mode démo.") },
        { tip: tk("Une fois les notifications activées, l'assistant peut cocher ou décocher un type pour toi, sur tous tes appareils ou sur un seul : « ne m'envoie plus le résumé de la semaine sur l'iPhone ».") },
      ],
      links: [{ to: "/reglages/notifications#notifications", label: ["Réglages", "Notifications et appareil"] }],
      words: tk("alertes push notifier prévenir activer désactiver les notifications iphone"),
    },
    {
      id: "ouverture-instantanee",
      title: tk("Ouverture instantanée et hors ligne"),
      summary: tk("L'appli s'ouvre tout de suite, même sans réseau, sur les dernières données connues."),
      body: [
        tk("Pécule garde sur l'appareil les dernières données de synthèse — soldes, mois, patrimoine, budget, opérations récentes — pendant sept jours au plus. L'appli s'ouvre ainsi sans attendre et, sans réseau, un bandeau signale que ce sont les dernières données connues."),
        {
          list: [
            tk("Ces données sont effacées à la déconnexion."),
            tk("Les factures, les documents et les conversations ne sont jamais gardés sur l'appareil."),
          ],
        },
        tk("Pour le couper : [[Réglages]] → [[Notifications et appareil]], [[Ouverture instantanée]]. Les données gardées sont alors effacées de l'appareil."),
      ],
      links: [{ to: "/reglages/notifications#hors-ligne", label: ["Réglages", "Notifications et appareil"] }],
      words: tk("hors connexion offline cache sans réseau avion rapide données sur l'appareil"),
    },
    {
      id: "installer-telephone",
      title: tk("Installer Pécule sur son téléphone"),
      summary: tk("Ajouter Pécule à l'écran d'accueil pour l'ouvrir comme une appli."),
      body: [
        tk("Pécule s'utilise dans le navigateur et s'installe sur l'écran d'accueil, sans passer par un magasin d'applications."),
        {
          steps: [
            tk("Sur iPhone ou iPad, ouvre l'adresse de ton Pécule dans Safari."),
            tk("Touche Partager, puis « Sur l'écran d'accueil »."),
            tk("Ouvre Pécule depuis sa nouvelle icône et connecte-toi avec ta clé d'accès."),
          ],
        },
        {
          list: [
            tk("L'appli installée s'ouvre en plein écran, et le retour se fait en balayant depuis le bord gauche."),
            tk("C'est elle qui peut recevoir les notifications sur iPhone."),
            tk("Sur Android ou sur ordinateur, le navigateur propose l'installation dans son menu."),
          ],
        },
        { tip: tk("Pour déposer un fichier depuis une autre appli de l'iPhone, voir [Envoyer un fichier depuis l'iPhone](/manuel/raccourci-iphone).") },
      ],
      links: [{ to: "/reglages/notifications", label: ["Réglages", "Notifications et appareil"] }],
      words: tk("installer application pwa écran d'accueil ajouter à l'écran d'accueil app store télécharger l'appli mobile"),
    },
  ],
};
