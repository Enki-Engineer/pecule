import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const assistant: ManualTheme = {
  id: "assistant",
  title: tk("Assistant"),
  hint: tk("Poser une question, faire faire une action, parler à voix haute"),
  articles: [
    {
      id: "assistant-ouvrir",
      title: tk("Parler à l'assistant"),
      summary: tk("Où il s'ouvre, comment lui écrire, et ce qu'il sait de l'écran ouvert."),
      body: [
        {
          list: [
            tk("Sur ordinateur : ⌘J, ou le bouton [[Assistant]] de la barre du haut. Sur un grand écran il s'ouvre en panneau à droite, à côté de ce que tu regardes ; ⌘⇧J l'ouvre en plein écran."),
            tk("Sur téléphone : le bouton rond au centre de la barre du bas."),
            tk("Depuis un autre écran : [[Demander à l'assistant]] prépare la question sur l'élément ouvert."),
          ],
        },
        tk("Écris ta question et envoie avec Entrée (Maj + Entrée va à la ligne). Une conversation vide propose des questions et des actions toutes prêtes."),
        tk("Dans le panneau, l'assistant sait quel écran est ouvert : devant une opération, une facture, un bien ou un document, « cette opération » ou « ce document » désigne celui que tu regardes. Une pastille au-dessus du champ le rappelle ; sa croix l'écarte."),
        { note: tk("L'assistant demande un fournisseur d'IA branché ; sans lui, tout le reste de Pécule fonctionne. Voir [Brancher un fournisseur d'IA](/manuel/brancher-ia).") },
      ],
      links: [{ to: "/assistant", label: ["Assistant"] }],
      words: tk("ia chat discuter poser une question ouvrir l'assistant panneau intelligence artificielle claude"),
    },
    {
      id: "assistant-questions",
      title: tk("Ce qu'on peut lui demander"),
      summary: tk("Des chiffres, des explications, de l'aide sur l'appli, et des actions."),
      body: [
        {
          list: [
            tk("Tes chiffres : « combien ai-je dépensé en restaurants cette année ? », « où puis-je faire des économies ? », « comment évolue mon patrimoine ? ». Il calcule avec les mêmes définitions que les écrans, et ajoute un tableau ou un graphique quand cela aide."),
            tk("Une opération ou un achat : « c'est quoi ce prélèvement ? », « qu'ai-je acheté sur cette commande ? » — il lit les factures reliées."),
            tk("Tes papiers : « quand finit mon bail ? », « que dit mon contrat d'assurance sur le vol ? » — il cherche dans le coffre."),
            tk("Ce qui t'attend : échéances, prélèvements à venir, comptes qui passeraient sous leur seuil."),
            tk("L'appli elle-même : « comment relier ma banque ? », « où règle-t-on les notifications ? » ou, depuis le panneau, « à quoi sert cet écran ? ». Il lit ce manuel, donne les étapes et le lien vers l'écran."),
            tk("Des actions : classer, corriger, ajouter, régler. Voir [Les actions et leur confirmation](/manuel/assistant-actions)."),
          ],
        },
        tk("Il répond dans ta langue et te tutoie. Les liens vers les écrans de Pécule qu'il écrit sont cliquables."),
        { warning: tk("Ses réponses sont une aide à la décision, pas un conseil financier, fiscal ou juridique. Il ne peut ni faire de virement, ni rien modifier en dehors de Pécule.") },
      ],
      links: [{ to: "/assistant", label: ["Assistant"] }],
      words: tk("exemples de questions que sait faire l'assistant capacités aide comment faire où trouver demander"),
    },
    {
      id: "assistant-actions",
      title: tk("Les actions et leur confirmation"),
      summary: tk("L'assistant propose, tu confirmes : rien n'est modifié sans ton accord."),
      body: [
        tk("Quand tu demandes une action, l'assistant affiche une carte [[Action proposée]] qui décrit exactement ce qui va changer, avec la valeur d'avant et celle d'après quand il y en a une."),
        {
          list: [
            tk("[[Confirmer]] exécute l'action ; [[Annuler]] l'abandonne."),
            tk("Écrire un nouveau message au lieu de confirmer annule la proposition."),
            tk("Une proposition expire au bout de 30 minutes : rien n'est fait si tu confirmes trop tard."),
            tk("Une action faite reste dans la conversation, avec une coche. Pour revenir dessus, demande-lui l'inverse."),
          ],
        },
        tk("Ce qu'il sait faire : classer des opérations et créer des règles, noter une opération, relier ou corriger une facture, corriger le classement d'un document, ajouter ou cocher une tâche, gérer les engagements et les revenus du budget, créer une enveloppe ou un objectif, mettre à jour un placement, un bien ou une position crypto, gérer les catégories et les postes, construire des projections, lancer une synchronisation, et changer certains réglages."),
        { note: tk("Chaque action faite par l'assistant est notée dans le journal des modifications : [[Réglages]] → [[Suivi technique]].") },
      ],
      links: [{ to: "/assistant", label: ["Assistant"] }],
      words: tk("confirmer valider refuser action proposée modifier à ma place sécurité annuler une action"),
    },
    {
      id: "assistant-reglages",
      title: tk("Lui faire changer un réglage"),
      summary: tk("Ce que l'assistant peut régler à ta place, et ce qui reste à faire à l'écran."),
      body: [
        tk("Demande-le simplement : « passe en sombre », « mets Pécule en anglais », « masque les montants ». Comme toute action, le réglage t'est montré avant d'être appliqué."),
        {
          list: [
            tk("Sur l'appareil que tu utilises : clair, sombre ou automatique, la couleur, les thèmes de l'année, la densité, les montants masqués, l'ouverture instantanée."),
            tk("Pour toi, sur tous tes appareils : la langue, les équivalences amusantes, l'alerte de solde bas (seuil, délai, comptes surveillés), et les types de notifications que reçoivent tes appareils."),
            tk("Tes comptes : le nom affiché, un compte masqué ou sorti des statistiques."),
            tk("Pour le foyer, si tu en es l'administrateur : le jour retenu pour les achats par carte, les écrans affichés."),
            tk("Et aussi : enveloppes, objectifs, engagements et revenus du budget, catégories."),
          ],
        },
        tk("Ce qui touche à la sécurité ou à un service extérieur se fait à l'écran : clés d'accès et membres, connexion d'une banque, fournisseur d'IA, activation des notifications sur un appareil, sauvegarde, pays et devise du foyer, mode démo. L'assistant t'explique alors la marche à suivre et te donne le lien."),
        { tip: tk("Pour savoir où se trouve un réglage, demande-le lui : il te donne le lien vers le bon écran.") },
      ],
      links: [{ to: "/reglages", label: ["Réglages"] }],
      words: tk("changer un réglage par l'assistant paramètre configurer à ma place mode sombre langue demander"),
    },
    {
      id: "assistant-pieces-jointes",
      title: tk("Lui confier une facture ou un document"),
      summary: tk("Joins un PDF ou une photo : il le range, le lit et te dit quoi en faire."),
      body: [
        {
          steps: [
            tk("Touche le trombone du champ de l'assistant, ou glisse le fichier dessus. Trois fichiers au plus, PDF ou photo."),
            tk("Ajoute un mot si tu veux, puis envoie."),
            tk("Le fichier est rangé — une facture dans [[Factures]], tout autre document dans le coffre — puis l'assistant dit ce que c'est et ce qu'il en retient."),
          ],
        },
        {
          list: [
            tk("Pour une facture : il cherche l'opération qui l'a payée et propose de la relier, signale la garantie, et demande ce qui manque si la lecture est incomplète."),
            tk("Pour un document : il signale une échéance utile et propose un rappel dans l'échéancier."),
            tk("Pour un devis : il peut le comparer à ton contrat en cours."),
          ],
        },
      ],
      links: [{ to: "/assistant", label: ["Assistant"] }],
      words: tk("pièce jointe trombone joindre fichier photo pdf déposer envoyer un document à l'assistant"),
    },
    {
      id: "comparer-un-contrat",
      title: tk("Comparer une offre à son contrat"),
      summary: tk("Un devis d'électricité, d'assurance, de box ou de crédit vaut-il mieux que ce que tu as ?"),
      body: [
        tk("L'assistant compare un devis ou une proposition à ton contrat en cours : électricité, gaz, assurance, box, mobile, véhicule, crédit. Il retrouve le contrat dans le budget et dans le coffre, et part de ce qui a réellement été prélevé sur douze mois."),
        {
          steps: [
            tk("Dans l'assistant, touche [[Comparer un devis à mon contrat]] : le choix du fichier s'ouvre."),
            tk("Joins le devis (jusqu'à trois offres) et envoie."),
            tk("Lis le verdict, puis le tableau critère par critère : prix, garanties, franchises, engagement, frais, total sur douze mois."),
          ],
        },
        {
          list: [
            tk("Il dit ce que l'offre a en moins ou en plus, et demande ce qui manque pour trancher — la consommation annuelle d'électricité, par exemple — au lieu de conclure."),
            tk("Si l'offre est meilleure : le dernier jour pour résilier, un rappel, puis la mise à jour du budget une fois le changement fait."),
            tk("On peut partir d'ailleurs : [[Comparer à mon contrat actuel]] sur un devis du coffre, [[Comparer à une offre]] sur un contrat du coffre, un engagement du budget ou un renouvellement de l'échéancier."),
          ],
        },
        { note: tk("Un devis déposé est rangé au coffre comme devis, jamais parmi les factures.") },
      ],
      links: [
        { to: "/assistant", label: ["Assistant"] },
        { to: "/budget", label: ["Budget"] },
      ],
      words: tk("devis proposition concurrent changer de fournisseur assurance électricité gaz box mobile moins cher résilier"),
    },
    {
      id: "mode-vocal",
      title: tk("Le mode vocal"),
      summary: tk("Parler à l'assistant et l'écouter répondre, les mains libres."),
      body: [
        {
          steps: [
            tk("Ouvre l'assistant. Quand le champ est vide, le bouton d'envoi devient un bouton rond : touche-le."),
            tk("Autorise le micro, puis parle normalement : il répond quand tu t'arrêtes."),
            tk("Touche le rond pour l'interrompre. Dis « au revoir », ou touche [[Terminer]], pour finir."),
          ],
        },
        tk("Quand il propose une action, il la dit en une phrase : réponds « confirme » ou « annule ». La question comprise et la réponse restent écrites dans la conversation."),
        tk("La voix et les sons de la conversation se choisissent dans [[Réglages]] → [[Assistant]], section [[Mode vocal]] : [[Écouter]] fait entendre chaque voix. Ces réglages sont propres à l'appareil."),
        { note: tk("Le mode vocal n'apparaît que si le serveur est réglé pour la voix. Il est coupé en mode démo. Rien n'est gardé de ce que tu dis.") },
      ],
      links: [{ to: "/reglages/assistant#voix", label: ["Réglages", "Assistant"] }],
      words: tk("voix parler micro dictée oral conversation mains libres écouter audio"),
    },
    {
      id: "assistant-memoire",
      title: tk("Ce que l'assistant retient"),
      summary: tk("Les faits qu'il garde d'une conversation à l'autre, à consulter et à effacer."),
      body: [
        tk("Quand tu lui donnes une information durable — ce qu'est un prélèvement, une situation de vie, une préférence —, l'assistant la retient et le dit. Tu peux aussi le lui demander : « souviens-toi que… »."),
        tk("Ces faits te sont propres et sont joints à ses consignes à chaque conversation. Ils sont listés dans [[Réglages]] → [[Assistant]], sous la mémoire de l'assistant : la corbeille en efface un. Tu peux aussi lui dire « oublie que… »."),
        { note: tk("Tes conversations ne sont visibles que de toi.") },
      ],
      links: [{ to: "/reglages/assistant#memoire", label: ["Réglages", "Assistant"] }],
      words: tk("mémoire se souvenir retenir oublier faits contexte personnalisé"),
    },
    {
      id: "assistant-conversations",
      title: tk("Retrouver ses conversations"),
      summary: tk("L'historique : chercher, renommer, épingler, supprimer."),
      body: [
        tk("Ouvre [[Mes conversations]] dans l'en-tête de l'assistant ([[Historique]] sur téléphone). Les conversations sont rangées par date, les épinglées en tête."),
        {
          list: [
            tk("La recherche porte sur les titres et sur le texte des messages."),
            tk("[[Épingler en tête]], [[Renommer]] et [[Supprimer]] sont sur chaque ligne."),
            tk("[[Nouvelle]] commence une conversation vierge. La dernière conversation est reprise quand tu rouvres l'assistant."),
          ],
        },
        tk("Sous chaque réponse, [[Copier]] en copie le texte, et son coût s'affiche à côté de l'heure."),
        { note: tk("Une très longue conversation finit par demander d'en commencer une nouvelle.") },
      ],
      links: [{ to: "/assistant", label: ["Assistant"] }],
      words: tk("historique anciennes conversations retrouver une réponse fil discussion copier"),
    },
    {
      id: "brancher-ia",
      title: tk("Brancher un fournisseur d'IA"),
      summary: tk("L'assistant et la lecture des documents passent par ta propre clé de fournisseur."),
      body: [
        tk("Pécule fonctionne sans IA. Avec elle s'ajoutent l'assistant, la lecture des factures et des documents, et le résumé de la semaine. Le fournisseur est un réglage commun au foyer, réservé à son administrateur."),
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Comptes et connexions]], bloc [[Intelligence artificielle]]."),
            tk("Choisis le fournisseur : Microsoft Foundry, l'API Claude d'Anthropic, ou une passerelle compatible."),
            tk("Saisis l'adresse ou la ressource s'il y a lieu, le modèle et la clé d'accès."),
            tk("Touche [[Tester]], puis [[Enregistrer]] et [[Utiliser ce fournisseur]]."),
          ],
        },
        {
          list: [
            tk("Un fournisseur est essayé avant d'être choisi ou modifié : si l'essai échoue, rien ne change."),
            tk("La clé est gardée chiffrée et n'est plus jamais affichée."),
            tk("Le fournisseur choisi reçoit tout ce que Pécule confie à l'IA : questions à l'assistant, factures, documents et bulletins de paie."),
          ],
        },
        { note: tk("Ce réglage ne se fait qu'à l'écran : l'assistant ne peut pas le changer. Indisponible en mode démo.") },
      ],
      links: [{ to: "/reglages/connexions?c=ia", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("clé api anthropic claude foundry azure fournisseur modèle configurer l'ia activer l'assistant"),
    },
    {
      id: "assistant-cout",
      title: tk("Ce que coûte l'IA"),
      summary: tk("Le coût de chaque réponse et le total du mois, par usage."),
      body: [
        tk("L'IA est facturée par ton fournisseur, à l'usage. Pécule estime ce coût à partir du tarif public du modèle, converti en euros."),
        {
          list: [
            tk("Sous chaque réponse de l'assistant : le coût de cette réponse."),
            tk("Dans [[Réglages]] → [[Assistant]], section [[Coût de l'IA]] : le total du mois en cours et du mois précédent, pour tout le foyer, par usage — assistant, lecture de factures, rangement de documents, lecture de bulletins."),
            tk("Dans un import de dossier : le coût de la lecture, plafonné pour chaque import."),
          ],
        },
        { note: tk("C'est une estimation : la facture de ton fournisseur fait foi.") },
      ],
      links: [{ to: "/reglages/assistant#ia", label: ["Réglages", "Assistant"] }],
      words: tk("prix tarif facturation consommation dépense ia jetons tokens combien coûte"),
    },
    {
      id: "claude-mcp",
      title: tk("Interroger Pécule depuis l'appli Claude"),
      summary: tk("Pécule expose un serveur MCP : ton propre assistant peut le lire et le tenir à jour."),
      body: [
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Comptes et connexions]], bloc [[Applications connectées]], et copie l'adresse affichée."),
            tk("Dans l'appli Claude : Personnaliser → Connecteurs → ajoute un connecteur personnalisé avec cette adresse."),
            tk("Pécule te demande de te connecter, puis de choisir entre [[Lecture seule]] et [[Lecture et actions]]. Touche [[Autoriser]]."),
          ],
        },
        tk("L'accès ne montre que ta vue. Il se retire à tout moment dans le même bloc, avec la corbeille."),
        tk("Pour la ligne de commande, des scripts ou un assistant en accès complet, l'administrateur crée un jeton dans le bloc [[Jetons d'administration]] : il donne tous les droits, en son nom."),
        { warning: tk("Avec [[Lecture et actions]], l'application peut modifier tes données sans passer par l'écran de confirmation de Pécule : c'est elle qui te demande ton accord.") },
      ],
      links: [{ to: "/reglages/connexions?c=applications", label: ["Réglages", "Comptes et connexions"] }],
      words: tk("mcp connecteur claude desktop claude code api accès externe oauth jeton"),
    },
  ],
};
