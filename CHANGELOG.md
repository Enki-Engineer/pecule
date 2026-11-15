# Journal des versions

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/). Avant toute mise à jour : une
sauvegarde complète (`pnpm sauvegarde`). Les migrations de la base s'appliquent seules au démarrage.

## 1.11.0

- **Comparer une offre à son contrat**, par l'assistant : dépose un devis ou une proposition (électricité, gaz,
  assurance, box, mobile, véhicule, crédit) et demande s'il vaut mieux que ce que tu as. L'assistant retrouve le
  contrat en cours dans le budget et dans le coffre, part de ce qui a réellement été prélevé sur douze mois, et
  répond par un verdict, un tableau critère par critère (prix, garanties, franchises, engagement, frais, total sur
  douze mois), ce que l'offre a en moins ou en plus, puis la marche à suivre : dernier jour pour résilier, rappel,
  mise à jour du budget une fois le changement fait. Jusqu'à trois offres à la fois. S'il manque une donnée pour
  trancher (la consommation annuelle d'électricité, par exemple), il la demande au lieu de conclure.
- **Où le demander** : « Comparer un devis à mon contrat » dans l'assistant (le choix du fichier s'ouvre aussitôt),
  « Comparer à mon contrat actuel » sur un devis du coffre, « Comparer à une offre » sur un contrat du coffre, sur un
  engagement du budget et sur un renouvellement de l'échéancier.
- **Outil `compare_contracts`** (assistant et serveur MCP) : en une lecture, les offres, le contrat en cours,
  l'engagement du budget (montant, prochaine échéance, préavis, dernier jour pour résilier) et les prélèvements
  réels. Il ne modifie rien.
- **Devis** : un devis ou une proposition de contrat déposé est rangé au coffre comme devis, jamais parmi les
  factures ; ses prix, garanties et durée d'engagement entrent dans ses faits clés.
- **Tableaux de l'assistant** sur un téléphone : un texte aligné à droite passe à la ligne au lieu d'écraser la
  première colonne, et un mot n'est plus coupé en son milieu ; un tableau trop large défile.
- Démo : un devis d'assurance auto concurrent, à comparer au contrat de la famille.

## 1.10.0

- **Mode discret** : un bouton (l'œil, dans la barre du haut ; « Masquer les montants » dans le menu du téléphone)
  ou la touche M remplace tous les montants par « ••• » — chiffres clés, listes, graphiques, bulles, étiquettes.
  Pour montrer l'écran à quelqu'un ou travailler dans un lieu public. Ce qui n'est pas un montant reste lisible
  (pourcentages, nombres d'opérations, libellés), tout comme le texte déjà écrit par l'assistant. Réglage mémorisé
  sur l'appareil.
- **Pastille « i »** sur les chiffres calculés : revenus, dépenses, épargne et solde (analyse et écran Mois),
  les six chiffres du tableau de bord, le budget (revenus du foyer, charges fixes, restes), le patrimoine (net,
  actifs bruts, crédits restants, disponible), l'équité et le rendement brut d'un bien. La définition s'ouvre au
  survol, au clavier ou au toucher.
- **Densité** (Réglages → Apparence, ordinateur) : « Compacte » resserre marges et lignes pour montrer plus
  d'opérations par écran, sans réduire le texte.

## 1.9.0

- **Soldes à venir** (nouvel écran, menu « Au quotidien ») : pour chaque compte, le solde du jour, la courbe du
  solde prévu sur 31 jours avec la ligne de son seuil, ce qu'il manquerait pour rester au-dessus, et les mouvements
  attendus un par un avec le solde après chacun. Les comptes signalés viennent en premier ; le menu en porte le
  nombre. « Régler l'alerte », en haut, mène au réglage.
- **Bandeau de solde bas** : il ouvre désormais la prévision du compte (« Soldes à venir ») ; un bouton « Régler »,
  à sa droite, mène au réglage de l'alerte. La notification et la ligne d'« À traiter » y mènent aussi.
- **Solde prévu dans le calendrier** : sur ordinateur, chaque jour à venir peut porter le solde prévu d'un compte
  (liste « Solde prévu », sous la grille ; sans choix, celui du premier compte signalé) — en orange sous son seuil.
  Sur le téléphone, le jour touché donne le solde prévu de chaque compte surveillé.
- **Listes déroulantes** : la même allure et la même hauteur que les champs et les boutons voisins dans tous les
  navigateurs (Safari leur gardait son apparence d'origine, plus basse — barre de filtres des opérations, entre
  autres). Dans Safari, le champ « mois » des opérations dit son format.

## 1.8.0

- **Tableau de bord à la carte** (ordinateur) : le bouton à côté de « Synchroniser » ouvre « Personnaliser le
  tableau de bord » — cocher pour afficher un bloc, flèches pour le déplacer, et le retour à l'ordre d'origine. Les
  chiffres clés restent en tête ; les blocs se rangent d'eux-mêmes sur la grille. Comme pour l'accueil du téléphone,
  le réglage est mémorisé sur l'appareil.

## 1.7.0

- **Solde bas à venir** : Pécule ne signale plus seulement un compte déjà bas, il prévient avant. Pour chaque
  compte, il part du solde du jour et y ajoute ce qui est attendu sur ce compte-là — ce qui y revient chaque mois
  (prélèvements, virements, salaire, mouvements entre comptes compris) et le relevé d'une carte à débit différé. Si
  le compte doit passer sous son seuil dans le délai choisi, une notification le dit, avec le jour, le montant et
  le prélèvement en cause ; le calendrier du mois, « Les sept prochains jours » et « À traiter » le montrent aussi.
  Les achats du quotidien ne sont pas devinés : c'est une estimation des engagements connus.
- **Une règle par membre** (Réglages → Notifications et appareil → Solde bas) : surveiller ou non, le seuil (un
  montant négatif prévient avant la limite d'un découvert autorisé), le délai de prévenance (3, 7, 14 ou 30 jours),
  et compte par compte : surveillé ou non, seuil propre. Chaque compte y montre son solde, son point le plus bas à
  venir et l'alerte en cours. La règle vaut sur tous les appareils du membre ; à l'origine : 200, sept jours
  avant, tous les comptes hors cartes. L'ancien seuil réglé par appareil est repris une fois.
- **Assistant et serveur MCP** : deux outils, `get_balance_alert` (règle et prévision de chaque compte : « est-ce
  que je vais être à découvert ? ») et `set_balance_alert` (changer le seuil, le délai, un compte — après
  « Confirmer » dans l'assistant).

## 1.6.0

- **Les sept prochains jours** (tableau de bord et accueil du téléphone) : d'aujourd'hui à dans six jours, comme une
  ligne du calendrier — ce qui est passé aujourd'hui, ce qui est attendu d'ici là et son total. Sur le téléphone,
  c'est un bloc de l'accueil comme les autres (« Personnaliser l'accueil » le déplace ou le masque).
- **Calendrier et prélèvements réunis** : l'onglet « Prélèvements » de l'analyse disparaît. Ses listes — passés ce
  mois-ci, encore attendus, absents d'un mois passé — se lisent sous la grille du calendrier ; pour une année
  entière, l'onglet « Calendrier » montre les prélèvements mois par mois. Un lien gardé vers l'ancien onglet y mène.
- **Calendrier du téléphone** : un glissement du doigt sur la grille passe au mois précédent ou suivant.
- **Accueil du téléphone** : les écarts s'écrivent dans une étiquette, comme sur ordinateur.
- **« Où part l'argent »** : le pourcentage de chaque moyen de paiement se lit dans la légende ; il n'est plus écrit
  en blanc sur la couleur de la barre, où il se lisait mal.
- **Bulles des graphiques** : la même petite carte partout au survol d'une courbe ou d'une barre.

## 1.5.0

- **Nouvelle allure** : fond chaud, cartes blanches sans filet aux coins plus ronds, police Figtree (hébergée par
  Pécule, rien n'est chargé d'un autre site), grands chiffres, menus, onglets et bascules en pastilles, titres en
  minuscules. Le vert et le rouge sont réservés à l'argent — ce qui entre, ce qui sort, ce qui est mis de côté — et
  les écarts s'écrivent dans une étiquette pâle. Le thème sombre, les thèmes de l'année et l'écran de connexion
  suivent.
- **Couleur** (Réglages → Apparence) : l'encre devient la couleur d'origine ; « Vert » s'ajoute, et l'indigo des
  versions précédentes reste proposé avec Océan, Sauge, Corail et Ardoise. Qui n'avait rien choisi, ou avait gardé
  l'indigo d'origine, passe à l'encre ; un autre choix est conservé.
- **Calendrier du mois** (Analyse → Calendrier, et écran Mois du téléphone) : le mois sur une grille. Les entrées en
  vert pâle, les charges (prélèvements, virements) en rouge pâle, l'épargne en vert plein, ce qui est encore attendu
  en pointillé ; les petits achats du jour ne font qu'un total discret. Sur ordinateur : ce qui est entré, sorti et
  mis de côté, le premier objectif d'épargne et les sorties semaine par semaine ; un clic sur un jour ouvre ses
  opérations. Sur le téléphone : un trait de couleur par mouvement, et le jour touché se lit sous la grille.
- **Infobulles** : une bulle lisible remplace partout celle du navigateur, avec le raccourci clavier écrit comme une
  touche ; elle s'affiche aussi au clavier. Sur le tableau de bord, une pastille « i » explique le patrimoine net,
  le disponible et le solde du mois.
- **Chiffres clés** : leur taille suit la largeur de la carte (panneau de l'assistant ouvert, fenêtre étroite), ils
  ne débordent plus.
- Cache de l'appli installée renouvelé (couleur de l'écran de lancement).

## 1.4.1

- **Écran vide après un déploiement** : une fenêtre restée ouverte pendant une mise à jour demandait encore les
  fichiers de code de l'ancienne version. Le premier écran ou graphique chargé à la demande échouait alors et toute
  l'appli disparaissait (il ne restait que le fond) — typiquement à la fin d'une réponse de l'assistant qui se
  termine par un graphique. Désormais la page se recharge d'elle-même, une fois, sur la nouvelle version quand le
  code d'un écran manque ; un graphique qui ne peut pas se charger laisse la conversation en place, avec
  « Recharger » ; et une erreur d'affichage, quelle qu'elle soit, montre un message au lieu d'un écran vide.
- **Serveur** : un fichier de `/assets` qui n'existe plus répond « introuvable » (404) au lieu de la page d'accueil,
  que le navigateur prenait pour du code et gardait en cache (cache de l'appli installée renouvelé).

## 1.4.0

- **Assistant en plein écran** (ordinateur) : le panneau s'agrandit — son bouton, ⌘⇧J ou l'adresse `/assistant` — en
  une fenêtre de lecture : « Mes conversations » dans une colonne à gauche, la réponse dans une colonne large. C'est
  la même conversation que le panneau : passer de l'un à l'autre garde le fil, le texte en cours de saisie et la
  réponse qui s'écrit. Échap, ou un lien suivi dans une réponse, ramène au panneau.
- **Historique des conversations** : recherche dans les titres et dans le texte des messages, rangement par
  ancienneté (aujourd'hui, hier, cette semaine, ce mois-ci), conversations épinglées en tête, renommer, supprimer.
  Le résumé de la semaine y porte son titre (« Semaine du … au … ») au lieu de la consigne envoyée.
- **Réponses mises en forme** : le texte se lit à même la page, sans bulle. Tableaux à en-tête teinté, lignes
  alternées, chiffres alignés et total mis en avant ; encadrés « À retenir », « Attention », « Conseil » et
  « À savoir » ; surlignage du point à ne pas manquer ; écarts en vert ou en rouge selon qu'ils sont favorables ou
  non pour le foyer. Sous chaque réponse : « Copier » (texte brut, liens complets), l'heure et le coût.
- **Une lecture qui ne saute plus** : pendant qu'une réponse s'écrit, remonter lire plus haut ne ramène plus en bas ;
  « Suite de la réponse » y retourne. Le champ de saisie grandit avec le texte.
- **Réponse suivie d'un graphique** : quand l'assistant rédige sa réponse puis demande un graphique (ou retient un
  fait) dans la foulée, le texte reste dans la conversation. Il était remplacé par « … » une fois la réponse terminée.
- Base : deux colonnes sur `assistant_threads` (`title`, `pinned`), ajoutées au démarrage par la migration 0029.

## 1.3.1

- **Prévision** : un paiement fixe (mensualité de crédit, box, forfait) reste reconnu quand son libellé change — autre
  source de synchronisation, opération renommée — parce qu'il se suit aussi à son montant au centime, dans la même
  catégorie et par le même moyen de paiement. Deux contrats du même créancier sont attendus chacun pour son montant.
- **Opérations** : dans une liste qui traverse plusieurs années (recherche, toutes les dates), la date d'une ligne
  écrit son année quand ce n'est pas celle en cours.
- **Opérations | Factures** : passer de l'un à l'autre ne reconstruit plus l'écran. Les deux listes restent prêtes,
  celle qu'on quitte est seulement masquée : plus de logos qui réapparaissent un à un, et chaque écran se retrouve tel
  qu'on l'a laissé (filtres, recherche, fiche ouverte, hauteur de défilement). Sur le téléphone, la pastille de la
  bascule glisse d'un côté à l'autre.

## 1.3.0

- **Analyse sur une année entière** : le sélecteur de période de la barre du haut choisit un mois ou une année
  (« Mois | Année »), et « Aujourd'hui » ramène à la période en cours. Chaque onglet suit : cumul mois par mois face
  à l'année précédente, répartition, flux, frise de l'année, tableau des prélèvements (un créancier par ligne, un
  mois par colonne), marchands, comparaison avec l'année d'avant. Le filtre des Opérations accepte aussi une année.
- **Douze mois glissants et prévision** : le graphique mois par mois suit le mois choisi quand il sort de la fenêtre,
  et montre les trois mois à venir — ce qui est déjà écrit, et en pointillé ce qui revient chaque mois
  (prélèvements, abonnements, salaire), reconnu dans l'historique.
- **Jour d'achat ou jour du débit** : un achat par carte à débit différé est écrit par la banque le mois suivant.
  Le foyer choisit de compter ses achats au jour de l'achat ou au jour du débit (Réglages → Foyer, ou depuis la
  frise) ; tous les écrans, l'assistant et le serveur MCP suivent, sans rien réécrire. Par défaut : le jour du
  débit, comme avant. Une opération montre son autre date (« sera prélevé le… », « achat du… »).
- **Frise** : achats pas encore prélevés cerclés, récurrences attendues dans tous les couloirs (entrées comprises),
  et la même frise, resserrée, sur l'écran Mois du téléphone.
- **Libellés d'Enable Banking** : le libellé de la banque est gardé ligne par ligne. Son intitulé devient le
  libellé de l'opération (stable d'un mois à l'autre), le texte du créancier (« Solde impôt revenus… ») s'affiche
  sous le nom, et une opération sans nom prend celui du créancier dès la synchronisation, sans export de la banque.
- **Encours des cartes à débit différé** mis en avant : chiffre clé du tableau de bord (montant, date du
  prélèvement, ce qu'il restera sur les comptes) et rappel sur l'accueil du téléphone.
- **Mes enseignes** (Réglages → Classement) : le foyer ajoute ses propres enseignes — commerce de quartier, artisan,
  association — avec un nom, les mots du libellé qui la font reconnaître et, si elle en a un, son site pour le logo.
  Un aperçu dit combien d'opérations des douze derniers mois ces mots reconnaissent ; sans site, l'enseigne garde ses
  initiales. Elles passent avant le référentiel commun.
- **Logos des banques reliées** : quand le site d'une banque n'a pas de bonne icône (banque hors du référentiel,
  petit favicon), sa pastille prend le logo fourni par Enable Banking, téléchargé une fois par le serveur. Rien sans
  clé Enable Banking, rien en démo.
- **Échéancier** : un clic sur une ligne ouvre sa fiche (détail, notes, modification) au lieu de la cocher ; seule
  la pastille coche, le message propose « Annuler », et ce qui a été fait reste visible trente jours dans « Fait
  récemment ».
- **Patrimoine → Évolution** : durée « 1 mois » ; les durées plus longues que l'historique sont grisées, avec la date
  où il commence.
- **Foyer / Moi** n'est plus proposé quand tous les comptes sont ceux du membre.
- Migration `0028_jour_achat_enseignes` (appliquée au démarrage) : colonne `purchase_date`, vue `tx_lines`, table
  `custom_brands`. Le jour d'achat des opérations déjà là est lu dans leur libellé à la première ouverture.

## 1.2.0

- **Un seul endroit pour les documents** : l'écran « Importer » rejoint le **Coffre**. En haut, une zone de dépôt (un
  fichier, plusieurs, un dossier entier, glissés n'importe où dans la page) ; chaque fichier est rangé, lu quand
  Pécule le reconnaît, et ses données sont proposées à la relecture. En dessous, la liste des documents et l'onglet
  « Imports ». Un lot se relit à l'adresse `/documents?lot=…` ; l'ancienne adresse `/importer` y renvoie.
- **Analyse → Frise** : les paiements du mois posés sur le calendrier, un couloir par moyen de paiement, une bulle
  par opération (l'aire suit le montant), le reste du mois cumulé jour après jour et, pour le mois en cours, les
  prélèvements habituels encore attendus. Survol : le détail du jour ; clic : ses opérations ; vue en tableau.
- **Diagramme de flux** : ce qui s'ouvre au clic se reconnaît (chevron, halo à l'arrivée, survol et clavier).
- **Menu** : un clic sur un compteur ouvre l'écran déjà filtré (opérations à classer, factures à rapprocher, tâches
  en retard, alertes). **Foyer / Moi** est grisé sur les écrans qui ne dépendent pas des comptes.
- **Réglages → Comptes et connexions** : encart « Quelle source choisir ? » (Enable Banking gratuit pour un usage
  personnel, Finta sur abonnement, fichiers de la banque).
- **Logos** : près de deux cents enseignes de plus dans le référentiel des marques.

## 1.1.0

- **Pays, devise et fuseau horaire du foyer** (Réglages → Foyer) : tous les totaux s'expriment dans la devise du
  foyer, l'euro par défaut. Trente devises, celles dont la Banque centrale européenne publie un cours de référence.
- **Comptes en devise** : un compte peut être tenu dans une autre devise que celle du foyer (Enable Banking, fichier
  OFX / QIF / CSV, relevé importé, saisie à la main). Ses montants sont convertis au cours du jour de chaque opération
  et gardent leur valeur d'origine, affichée sous le montant ; son solde suit le cours du jour.
- Changer la devise du foyer recalcule opérations, soldes et historiques ; les montants saisis à la main (budgets,
  objectifs, placements, biens, crédits) gardent leur chiffre.
- Titres cotés dans une autre devise que l'euro acceptés (convertis au cours du jour) ; cours et crypto valorisés dans
  la devise du foyer.
- Hors de France : pas de calendrier fiscal français ni de fêtes locales ; les écrans Impôts et Retraite sont retirés
  d'office (on peut les remettre). Hémisphère sud : pas de thème de saison.
- Les unités amusantes des thèmes, dont le prix est fixé en euros, ne s'affichent que pour un foyer en euros. Le coût
  de l'IA reste compté en euros.
- Migrations `0026_devises` et `0027_evenement_crypto_valeur` (appliquées au démarrage). Un foyer en euros ne voit
  aucun changement.

## 1.0.0

Première version publique.

- Comptes, opérations, catégories et règles, analyse du mois, enveloppes et objectifs, factures et rapprochement.
- Patrimoine : épargne, placements, immobilier, crédits et échéanciers, crypto, projections.
- Situation : revenus et bulletins de paie, impôts, retraite. Coffre de documents et échéancier.
- Sources bancaires : Enable Banking, fichiers OFX / QIF / CSV, comptes tenus à la main.
- Import massif de documents avec contrôles, relecture et annulation.
- Assistant facultatif (fournisseur d'IA au choix), mode vocal, serveur MCP et connexion OAuth.
- Foyer à plusieurs membres, clés d'accès, mode démo, sauvegarde complète et restauration.
- Cinq langues : français, anglais, allemand, italien, espagnol.
- Installation par Docker ou sur un hébergement Node.js, `setup` et `doctor`, guide pour un agent IA.
