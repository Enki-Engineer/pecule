import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const operations: ManualTheme = {
  id: "operations",
  title: tk("Opérations et classement"),
  hint: tk("Retrouver une opération, la classer, apprendre à Pécule à le faire"),
  articles: [
    {
      id: "liste-des-operations",
      title: tk("Parcourir et filtrer les opérations"),
      summary: tk("Toutes les opérations de tes comptes, à chercher et à filtrer."),
      body: [
        tk("L'écran [[Opérations]] liste les opérations de tous tes comptes, les plus récentes d'abord, rangées par mois. Chaque ligne donne le marchand ou le libellé, la catégorie, le compte et le montant ; un trombone signale une facture jointe."),
        tk("Chaque mois a son bilan en tête : le nombre d'opérations, celles qui restent à classer, les dépenses et le solde du mois — sur un écran large, les revenus et l'épargne aussi. Ce sont les chiffres de l'Analyse, calculés sur toutes les opérations du mois, même celles que la liste n'a pas encore chargées. Quand la liste est filtrée, le bilan est celui de ce qu'elle garde, et une ligne [[Total]] réunit les mois."),
        {
          list: [
            tk("Sur ordinateur, tous les mois de l'année sont affichés d'emblée, les plus récents dépliés : un clic sur le bandeau d'un mois le déplie ou le replie, et il reste en haut de l'écran pendant que ses lignes défilent."),
            tk("[[Tout replier]] ne garde que les bandeaux : l'année se lit d'un coup d'œil, mois par mois. En bas de la liste, un bouton ajoute l'année précédente."),
            tk("Un mois qui compte des opérations à classer le dit dans son bilan : touche cette étiquette pour ne garder que celles-là."),
            tk("Une opération à classer porte un liseré orangé à gauche."),
            tk("Un mouvement entre tes comptes est écrit en gris : il ne compte ni dans les revenus ni dans les dépenses."),
            tk("Devant la catégorie d'une dépense, une pastille prend la couleur de son poste, la même que sur l'anneau des dépenses de l'Analyse ; grise, le poste n'a pas de couleur à lui."),
            tk("Sur ordinateur, la date n'est écrite qu'à la première opération du jour ; elle réapparaît au survol d'une ligne."),
          ],
        },
        {
          list: [
            tk("Recherche : un libellé, un marchand, une note, ou un article d'une facture reliée."),
            tk("Filtres : par compte, par catégorie, par nature (achats carte, prélèvements, virements, espèces, frais bancaires, mouvements internes, remboursements, entrées), par mois, et [[À classer]] pour ne voir que ce qui attend."),
            tk("Sur ordinateur, un clic sur [[Date]] ou [[Montant]] trie les lignes affichées (triée par montant, la liste n'est plus rangée par mois) ; un clic droit sur une ligne filtre sur sa catégorie, sa nature ou son mois."),
            tk("Sur téléphone, les filtres en cours sont des pastilles : touche-en une pour la retirer."),
          ],
        },
        tk("Touche une opération pour ouvrir sa fiche : libellé de la banque, catégorie, note, factures reliées. Sur téléphone, et sur ordinateur quand la liste est triée par montant, elle charge 80 opérations à la fois ; [[Afficher plus]] charge la suite."),
        { note: tk("Les opérations d'un compte sorti des statistiques ne s'affichent que si tu filtres sur ce compte.") },
      ],
      links: [{ to: "/operations", label: ["Opérations"] }],
      words: tk("transactions mouvements dépenses liste chercher filtre trier relevé débit crédit mois année bilan solde replier déplier couleur pastille gris"),
    },
    {
      id: "classer-une-operation",
      title: tk("Classer une opération"),
      summary: tk("Donner sa catégorie à une opération, lui ajouter une note, revenir en arrière."),
      body: [
        tk("Une opération sans catégorie est « à classer » : tant qu'elle le reste, elle fausse les totaux par poste. Ouvre sa fiche depuis [[Opérations]]."),
        {
          steps: [
            tk("Sous [[Suggestions]], Pécule propose jusqu'à trois catégories, d'après tes règles, la facture reliée, ou les opérations de même libellé ou de même marchand. Touche celle qui convient."),
            tk("Sinon, tape quelques lettres dans le champ de recherche des catégories, ou touche [[Toutes les catégories]]."),
            tk("La fiche se ferme : l'opération est classée."),
          ],
        },
        {
          list: [
            tk("Note : écris-la dans le champ [[Ajouter une note…]] de la fiche ; elle s'enregistre quand tu quittes le champ, et la recherche la retrouve."),
            tk("Annuler : juste après un classement, un bandeau propose [[Annuler##retour en arrière]] pendant quelques secondes."),
            tk("Sur téléphone : balaie une ligne vers la gauche pour la classer dans la première suggestion."),
            tk("Une catégorie en italique a été devinée d'après une opération semblable : choisis-en une pour la confirmer ou la corriger."),
            tk("Un doute : le bouton [[Assistant]] de la fiche ouvre l'assistant sur cette opération. Demande-lui ce qu'elle est, de la classer, de la noter ou de te montrer les opérations semblables."),
          ],
        },
        { tip: tk("Pour que Pécule classe seul les prochaines opérations du même libellé, coche la case de règle avant de choisir la catégorie : voir [Les règles de classement](/manuel/regles-de-classement).") },
      ],
      links: [{ to: "/operations?a_classer=1", label: ["Opérations", "À classer"] }],
      words: tk("catégoriser catégorie ranger affecter note commentaire corriger changer de catégorie annuler"),
    },
    {
      id: "regles-de-classement",
      title: tk("Les règles de classement"),
      summary: tk("Apprendre à Pécule à classer seul un libellé, et retirer une règle."),
      body: [
        tk("Une règle dit : « ce libellé va toujours dans cette catégorie ». Elle s'applique aux opérations à venir, et tout de suite aux opérations de même libellé qui n'étaient pas classées à la main."),
        {
          steps: [
            tk("Ouvre la fiche d'une opération."),
            tk("Coche [[Créer une règle : toujours classer ce libellé ainsi]]."),
            tk("Choisis la catégorie : l'opération est classée et la règle créée."),
          ],
        },
        tk("Dans le tri des opérations à classer, la règle est proposée d'office quand plusieurs opérations de la file portent le même libellé."),
        tk("Toutes les règles sont listées dans [[Réglages]] → [[Classement]] : cherche un libellé ou une catégorie, et touche la corbeille pour retirer une règle. Les opérations déjà classées gardent leur catégorie."),
        { tip: tk("L'assistant sait aussi classer en nombre et créer des règles : « classe mes opérations à classer ».") },
      ],
      links: [{ to: "/reglages/classement#regles", label: ["Réglages", "Classement"] }],
      words: tk("règle automatique apprendre mémoriser toujours classer supprimer une règle classement automatique"),
    },
    {
      id: "tri-rapide",
      title: tk("Classer vite les opérations en attente"),
      summary: tk("Le tri : une opération à la fois, avec ses suggestions."),
      body: [
        tk("Le tri présente les opérations à classer une par une, avec leurs suggestions. On y arrive par [[Trier##à classer]] sur l'écran [[Opérations]] du téléphone, par la carte [[Opérations à classer]] de l'accueil, ou par [[À traiter]] sur le tableau de bord."),
        {
          list: [
            tk("Touche une suggestion pour classer et passer à la suivante."),
            tk("[[Autre##catégorie]] ouvre toutes les catégories ; [[Passer]] laisse l'opération pour plus tard ; [[Assistant]] lui demande son avis."),
            tk("Sur téléphone : balaie à droite pour la première suggestion, à gauche pour passer."),
            tk("Sur ordinateur : 1, 2 ou 3 pour une suggestion, → pour passer, / pour une autre catégorie."),
          ],
        },
        tk("Quand d'autres opérations de la file ont le même libellé, une case cochée d'office les classe toutes d'un coup et retient la règle."),
        tk("Beaucoup d'opérations d'un coup ? [[Proposer un classement]] fait proposer une catégorie par libellé à l'IA : voir [Faire proposer un classement par l'IA](/manuel/classer-avec-ia)."),
        { note: tk("Une opération passée revient à ta prochaine visite.") },
      ],
      links: [{ to: "/tri", label: ["À classer"] }],
      words: tk("triage trier en masse rapidement file d'attente non classées sans catégorie"),
    },
    {
      id: "classer-avec-ia",
      title: tk("Faire proposer un classement par l'IA"),
      summary: tk("Des centaines d'opérations sans catégorie : l'IA propose, tu relis, tu appliques."),
      body: [
        tk("Après la reprise d'un historique, des centaines d'opérations arrivent sans catégorie. Sur l'écran du tri, [[Proposer un classement]] demande à ton fournisseur d'IA une catégorie pour chaque libellé encore sans catégorie — un libellé, pas une opération : quelques centaines de libellés couvrent des milliers d'opérations."),
        {
          steps: [
            tk("Ouvre le tri ([[À traiter]] sur le tableau de bord, [[Opérations à classer]] sur l'accueil du téléphone) et touche [[Proposer un classement]]."),
            tk("Relis la liste : chaque ligne donne le libellé, le nombre d'opérations, leur total et la catégorie proposée. Change la catégorie dans sa liste, ou choisis [[Ne pas classer]]."),
            tk("Décoche ce que tu préfères classer toi-même. Une supposition de l'IA n'est jamais cochée d'office."),
            tk("Touche le bouton de classement en bas de la liste. S'il reste des libellés, les suivants sont proposés aussitôt."),
          ],
        },
        {
          list: [
            tk("L'IA s'appuie sur tes catégories et sur ce que tu as déjà classé toi-même : plus tu as classé, plus elle te suit."),
            tk("Rien n'est classé avant que tu l'appliques, et seules des opérations encore sans catégorie sont touchées. Juste après, un bandeau propose [[Annuler##retour en arrière]]."),
            tk("La case « Retenir ces choix » crée une règle par libellé : les prochaines opérations de même libellé seront classées seules. Un libellé trop court pour en faire une règle (un chèque) n'en crée pas."),
            tk("Les libellés partent chez ton fournisseur d'IA ; une demande coûte quelques centimes, comptés dans [Le coût de l'IA](/manuel/assistant-cout)."),
          ],
        },
        { note: tk("Indisponible en mode démo, et sans fournisseur d'IA réglé.") },
      ],
      links: [{ to: "/tri", label: ["À classer"] }],
      words: tk("classer automatiquement intelligence artificielle catégoriser en masse historique repris proposition lot libellés"),
    },
    {
      id: "classer-en-lot",
      title: tk("Classer plusieurs opérations d'un coup"),
      summary: tk("Cocher des lignes et leur donner la même catégorie, sur ordinateur."),
      body: [
        {
          steps: [
            tk("Sur [[Opérations]], coche les lignes : la case en début de ligne, la touche X, ou Maj + clic pour une plage. [[Tout sélectionner]] coche toute la liste affichée."),
            tk("Dans la barre qui apparaît, choisis la catégorie dans [[Classer dans…]]."),
            tk("Clique sur [[Classer]]."),
          ],
        },
        tk("Le classement en lot peut être annulé juste après. Il ne crée pas de règle : pour cela, classe l'une des opérations depuis sa fiche en cochant la case de règle."),
        { tip: tk("Filtre d'abord (un marchand dans la recherche, [[À classer]]) pour ne cocher que ce qui va ensemble.") },
      ],
      links: [{ to: "/operations", label: ["Opérations"] }],
      words: tk("sélection multiple plusieurs lot masse cocher tout sélectionner"),
    },
    {
      id: "ventilation",
      title: tk("Répartir une opération entre plusieurs catégories"),
      summary: tk("Un achat qui mêle plusieurs postes se ventile d'après sa facture."),
      body: [
        tk("Un passage en caisse peut mêler de l'alimentation, de la maison et un cadeau. Pécule répartit l'opération entre ces catégories à partir de sa facture : chaque article porte sa catégorie, et l'opération est ventilée au prorata des montants."),
        {
          steps: [
            tk("Ajoute la facture et relie-la à l'opération ([Ajouter une facture](/manuel/ajouter-une-facture))."),
            tk("Dans la fiche de la facture, sous [[Articles]], vérifie ou choisis la catégorie de chaque article."),
            tk("Quand tous les articles ont une catégorie, la fiche de l'opération montre sa [[Ventilation]], et les analyses comptent chaque part dans son poste."),
          ],
        },
        { warning: tk("Il n'y a pas de ventilation à la main : choisir une catégorie pour l'opération entière remplace sa ventilation.") },
      ],
      links: [{ to: "/factures", label: ["Factures"] }],
      words: tk("ventiler diviser séparer partager split plusieurs catégories ticket de caisse articles"),
    },
    {
      id: "nommer-un-prelevement",
      title: tk("Nommer un prélèvement"),
      summary: tk("Donner un nom clair à un prélèvement et le relier à un engagement du budget."),
      body: [
        tk("Le libellé d'un prélèvement est souvent une suite de références. Depuis la fiche d'un prélèvement, [[Nommer ce prélèvement]] lui donne un nom, valable pour tous les prélèvements de même forme, passés et à venir."),
        {
          list: [
            tk("[[Nouvel engagement]] : donne un nom et un type ; l'engagement est ajouté au budget pour le montant du prélèvement, dans la catégorie de l'opération."),
            tk("[[Engagement existant]] : relie le prélèvement à un engagement déjà dans le budget."),
          ],
        },
        tk("Ensuite, le budget sait quand cet engagement a été prélevé pour la dernière fois, et [[Soldes à venir]] l'attend chaque mois."),
        { tip: tk("Si ta banque fournit un export qui porte le nom des créanciers, voir [Retrouver le nom des créanciers](/manuel/libelles-banque).") },
      ],
      links: [
        { to: "/operations", label: ["Opérations"] },
        { to: "/budget", label: ["Budget"] },
      ],
      words: tk("prélèvement sepa créancier renommer abonnement mandat référence engagement"),
    },
    {
      id: "libelles-banque",
      title: tk("Retrouver le nom des créanciers"),
      summary: tk("L'export CSV de BoursoBank donne un nom aux prélèvements et aux virements."),
      body: [
        tk("Pour un prélèvement ou un virement, la synchronisation ne transmet souvent qu'une référence. L'export de BoursoBank porte le nom du créancier : en le déposant, Pécule nomme ces opérations et les classe comme celles du même nom."),
        {
          steps: [
            tk("Sur le site de BoursoBank, exporte les opérations de tous les comptes au format CSV."),
            tk("Dans Pécule, ouvre [[Réglages]] → [[Classement]], section [[Libellés de la banque]]."),
            tk("Touche [[Déposer l'export CSV]]. Un bilan dit combien d'opérations ont été retrouvées, nommées et classées."),
          ],
        },
        tk("Tu peux redéposer le même fichier : rien n'est compté deux fois, et un nom déjà posé n'est jamais remplacé."),
        { note: tk("Seul l'export de BoursoBank est reconnu. Indisponible en mode démo.") },
      ],
      links: [{ to: "/reglages/classement#libelles", label: ["Réglages", "Classement"] }],
      words: tk("boursobank boursorama libellé prélèvement virement référence nom du créancier export csv"),
    },
    {
      id: "enseignes",
      title: tk("Faire reconnaître un commerce"),
      summary: tk("Mes enseignes : un nom et un logo pour le commerce du quartier, l'artisan ou l'association."),
      body: [
        tk("Pécule reconnaît les grandes enseignes dans tes libellés et leur donne leur nom et leur logo. Pour un commerce qu'il ne connaît pas, ajoute ta propre enseigne."),
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Classement]], section [[Mes enseignes]]."),
            tk("Touche [[Ajouter une enseigne]] et donne son nom."),
            tk("Écris quelques mots du libellé de la banque à reconnaître : Pécule dit aussitôt dans combien d'opérations des douze derniers mois il les trouve."),
            tk("Si le commerce a un site, indique-le : son logo en sera tiré."),
            tk("Touche [[Enregistrer]]."),
          ],
        },
        tk("L'enseigne vaut pour tout le foyer. La retirer ne change pas la catégorie de ses opérations."),
      ],
      links: [{ to: "/reglages/classement#enseignes", label: ["Réglages", "Classement"] }],
      words: tk("marchand commerçant magasin logo marque boutique reconnaître un libellé nom du marchand"),
    },
    {
      id: "categories",
      title: tk("Catégories et postes"),
      summary: tk("Comment les dépenses sont rangées, et comment changer ce rangement."),
      body: [
        tk("Chaque opération va dans une catégorie, et chaque catégorie appartient à un poste (Alimentation, Logement, Transports…). Les analyses, le budget et les enveloppes se lisent par poste, puis par catégorie."),
        {
          list: [
            tk("Une catégorie est une dépense, un revenu, de l'épargne ou un mouvement interne."),
            tk("Les mouvements internes — un virement entre deux comptes du foyer — ne sont ni une dépense ni un revenu : ils ne comptent dans aucun total."),
            tk("Un remboursement classé dans une catégorie de dépense vient en déduction de cette dépense."),
          ],
        },
        tk("Renommer une catégorie, la déplacer vers un autre poste, en créer une ou renommer un poste se demande à l'assistant : « crée une catégorie Animaux dans le poste Maison », « renomme la catégorie Restaurants ». Il montre le changement, et rien n'est modifié avant ta confirmation."),
        { note: tk("Dans une autre langue que le français, les noms de catégories et de postes sont traduits à l'affichage.") },
      ],
      links: [{ to: "/mois?onglet=repartition", label: ["Analyse", "Répartition"] }],
      words: tk("catégorie poste référentiel créer une catégorie renommer supprimer déplacer mouvement interne virement interne"),
    },
    {
      id: "jour-achat-debit",
      title: tk("Jour d'achat ou jour du débit"),
      summary: tk("Choisir le jour où comptent les achats par carte, pour tout le foyer."),
      body: [
        tk("Un achat par carte a deux dates : le jour de l'achat, et le jour où la banque le prélève — le mois suivant pour une carte à débit différé. Le foyer choisit laquelle compte, sur tous les écrans."),
        {
          list: [
            tk("[[Jour d'achat]] : chaque achat pèse sur le mois où il a été fait."),
            tk("[[Jour du débit]] : il pèse sur le mois où l'argent quitte le compte. C'est le réglage d'origine."),
          ],
        },
        tk("Le réglage est dans [[Réglages]] → [[Foyer]], ligne [[Achats par carte]], et aussi au pied du calendrier du mois et de la frise. Aucune opération n'est modifiée : seuls les écrans changent de jour de référence."),
        { note: tk("C'est une définition des chiffres du foyer : seul l'administrateur la change (en mode démo, chacun peut l'essayer). L'assistant peut le faire pour lui.") },
      ],
      links: [{ to: "/reglages/foyer#pays", label: ["Réglages", "Foyer"] }],
      words: tk("date d'achat date de débit date d'écriture date de valeur carte différé mois de rattachement"),
    },
  ],
};
