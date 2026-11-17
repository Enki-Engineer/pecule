# Journal des versions

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/). Avant toute mise à jour : une
sauvegarde complète (`pnpm sauvegarde`). Les migrations de la base s'appliquent seules au démarrage.

## 1.22.0

- **Mises à jour : Pécule prévient, une commande installe.** Réglages → Suivi technique montre à l'administrateur
  la version en service et, quand une version plus récente est publiée, ses notes et la commande à lancer sur le
  serveur. Une notification peut aussi le prévenir (type « Nouvelle version de Pécule publiée »). Une fois par jour,
  le serveur demande à GitHub quelle est la dernière version ; aucune donnée du foyer ne part avec la question.
- **`node scripts/maj.mjs`** fait la mise à jour d'un bout à l'autre : sauvegarde complète téléchargée et contrôlée,
  nouvelle version (image Docker publiée, ou `git pull` et build), attente du redémarrage, puis diagnostic. Elle
  s'arrête sans rien modifier si la sauvegarde échoue. `--verifier` dit seulement où en est l'installation ;
  `--version` installe une version précise. Guide : `docs/guide/mise-a-jour.md`.
- **Image Docker publiée** à chaque version, pour amd64 et arm64 : `ghcr.io/enki-engineer/pecule`. `docker compose up
  -d` la récupère au lieu de construire Pécule sur place (il la construit encore depuis le dépôt s'il ne peut pas la
  joindre, ou avec `--build`). Une installation Docker existante passe à l'image publiée à sa prochaine mise à jour.
- **Sauvegarde automatique avant une migration.** Avant de changer la structure d'une base déjà en service, le
  serveur en écrit lui-même une sauvegarde complète (`data/sauvegardes`, volume `pecule-sauvegardes` avec Docker) et
  garde les trois dernières. Si elle ne peut pas être écrite, une alerte le dit et la mise à jour se poursuit.
- Une base trop ancienne pour une version est refusée sans être modifiée, et le message nomme la version à installer
  d'abord ; l'écran, `maj` et `doctor` l'annoncent avant.
- Branche `stable` : elle n'avance qu'à chaque version publiée. Un hébergeur relié à GitHub peut la suivre pour ne
  recevoir que des versions publiées.
- `doctor` donne la version en service et signale une mise à jour disponible ; l'assistant sait dire quelle version
  tourne (il ne peut rien installer).
- Réglages nouveaux, tous facultatifs : `UPDATE_CHECK=0` (ne jamais interroger GitHub), `UPDATE_REPO` (suivre les
  versions d'une copie du projet), `BACKUP_BEFORE_MIGRATION=0` et `BACKUP_DIR`. Aucune migration.

## 1.21.0

- **Accueil du téléphone : les comptes comme à la banque.** Le bloc « Comptes » est rangé comme la carte du tableau
  de bord : comptes courants, épargne, placements et crédits, chaque groupe avec son total ; sous chaque compte,
  ses cartes à débit différé (ce qui sera prélevé, et quand), ce qu'il restera une fois prélevées, et son alerte
  de solde bas. Il remplace la liste par titulaire et le bloc à part des encours de carte.
- **Modèles sur téléphone.** En mode construction, « Partir d'un modèle » propose les quatre modèles du tableau de
  bord, en une colonne : « Quotidien » ouvre sur les comptes, puis ce qui est disponible, dépensé et attendu ;
  « Budget » et « Patrimoine » suivent la même idée ; « Vue d'ensemble » rend l'accueil d'origine (elle remplace
  « Revenir à l'ordre d'origine »). L'accueil garde son propre agencement, sur l'appareil : un modèle choisi sur
  l'ordinateur se choisit aussi sur le téléphone.
- Nouveau bloc « Patrimoine net » pour l'accueil : sa valeur, ce qu'il a pris ou perdu en trente jours, sa courbe
  et les dettes restantes. Il n'apparaît pas tout seul : il se trouve dans « Ajouter » et dans le modèle
  « Patrimoine ».

## 1.20.0

- **Accueil du téléphone : mode construction.** « Personnaliser l'accueil » n'ouvre plus une fiche à cases : les
  blocs s'arrangent à l'écran. Un appui long saisit un bloc, qu'on glisse plus haut ou plus bas ; sa barrette porte
  une poignée, des flèches et une croix pour le retirer ; « Ajouter » remet un bloc retiré. Rien n'est enregistré
  avant « Terminé ». Le réglage reste mémorisé sur l'appareil, et celui que tu avais est repris tel quel.
- **Tableau de bord sans trou.** Une rangée qui n'est pas pleine s'étire, en proportion des largeurs choisies : une
  carte seule sur sa rangée en prend toute la largeur, et une carte qui n'a rien à montrer ne laisse plus de vide.
- **Tirer une carte depuis « Ajouter ».** Sur ordinateur, une carte ou un chiffre clé se tire hors du tiroir et se
  lâche à sa place ; un clic le pose toujours à la fin.
- **La construction en cours n'est plus perdue** quand on change d'écran, qu'on recharge la page ou qu'on rétrécit
  la fenêtre : on la retrouve au retour, avec « Annuler » et « Terminé ».
- Sur une tablette, un appui long saisit aussi une carte du tableau de bord (un geste plus bref fait défiler).

## 1.19.1

- Corrigé : une carte à débit différé n'était rattachée à son compte que si le libellé de son relevé portait les
  derniers chiffres que la banque donne pour cette carte — or certaines banques transmettent un autre numéro que
  celui du relevé. Le relevé se reconnaît désormais aussi à son montant : au centime, ce que la carte a fait
  prélever ce jour-là. La carte « Comptes » range donc chaque carte sous le bon compte, et « Soldes à venir » compte
  enfin son prochain prélèvement dans le solde prévu : une alerte de solde bas peut apparaître là où il n'y en avait
  pas.
- Carte « Comptes » : l'encours d'une carte se montre même quand son compte de carte est masqué (masquer retire une
  ligne de la liste, pas ce qui sera prélevé).

## 1.19.0

- **Tableau de bord : mode construction** (ordinateur). Le bouton rond à côté de « Synchroniser » ouvre un mode où
  l'écran s'arrange directement : on saisit une carte et on la glisse où l'on veut (les autres s'écartent, la page
  défile près des bords, Échap la remet en place), on règle sa largeur — un tiers, la moitié, deux tiers, toute la
  largeur —, on la retire d'une croix, et « Ajouter » liste ce qui n'est pas à l'écran. Les chiffres clés du haut se
  déplacent, se retirent et s'ajoutent de la même façon ; deux nouveaux : « Revenus du mois » et « Mis de côté ce
  mois ». Rien n'est enregistré avant « Terminé », « Annuler » rend le tableau de bord d'avant. Tout se fait aussi
  au clavier.
- **Quatre modèles**, depuis le mode construction : « Vue d'ensemble » (l'agencement d'origine), « Quotidien »
  (combien j'ai, là, maintenant ?), « Budget » (est-ce que je tiens mon mois ?) et « Patrimoine » (où je vais ?). Un
  modèle est un point de départ : il remplace l'agencement, qui se modifie ensuite librement. L'assistant sait en
  appliquer un (« mets-moi le tableau de bord Quotidien »).
- **Carte « Comptes » façon banque** : comptes courants, épargne, placements et crédits, un total par groupe ; sous
  chaque compte, ses cartes à débit différé (ce qui sera prélevé, et quand) et ce qu'il restera une fois prélevées ;
  une étiquette signale le compte qui passerait sous son seuil et mène à sa prévision. Les comptes hors statistiques
  sont à part. La carte s'étale sur deux ou trois colonnes quand on l'élargit.
- L'agencement du tableau de bord est désormais gardé par Pécule, par membre : on le retrouve sur tous ses
  ordinateurs. Celui que le navigateur gardait (ordre et blocs masqués) est repris tel quel au premier passage.
  L'accueil du téléphone garde son réglage actuel.

## 1.18.0

- **Opérations : l'année d'un coup d'œil** (ordinateur). Tous les mois de l'année ont leur bandeau dès l'ouverture,
  avec leur bilan ; les plus récents sont dépliés, et un mois ne lit ses opérations que quand tu le déplies — toutes
  d'un coup. « Tout replier » ne garde que les bandeaux, et un bouton en bas de la liste ajoute l'année précédente
  (« Afficher 2025 »). Une recherche qui tient en une page montre comme avant tous ses résultats, sur toutes ses
  années.
- Corrigé : avec les mois repliés, « Afficher plus » semblait sans effet — il chargeait des lignes d'un mois replié,
  et il fallait un second clic pour voir arriver le mois suivant. Rangée par mois, la liste n'a plus ce bouton ; il
  reste sur téléphone et pour la liste triée par montant.
- « Tout sélectionner » et la sélection par plage (Maj) ne cochent que les lignes affichées, plus celles d'un mois
  replié. Une opération ancienne ouverte depuis la recherche fait apparaître son année et déplie son mois.

## 1.17.0

- **Coût de l'IA, un écran à part** : Réglages → Coût de l'IA montre la dépense du mois et ce qu'elle donnerait à la
  fin du mois au même rythme, le mois dernier (entier, et à la même date), douze mois en barres colorées par usage,
  puis le détail du mois choisi — par usage (avec le coût moyen d'une conversation, d'une facture lue, d'un document
  ou d'un bulletin), par membre et par modèle —, ce que le cache a fait économiser, et tes conversations et imports
  de dossier les plus coûteux. Les sessions de démo ont leur ligne. Réglages → Assistant en garde le résumé.
- **Plafond du mois** : l'administrateur fixe une dépense à ne pas dépasser. Il est prévenu par une notification à
  80 % du plafond, puis quand il est atteint ; s'il le choisit, les lectures de fond (imports de dossier, traduction
  des noms) attendent alors le mois suivant ou un plafond relevé. L'assistant et les fichiers déposés un à un
  répondent toujours. Le plafond se règle aussi en le demandant à l'assistant.
- **Le mode vocal est compté** : la lecture à voix haute (au caractère lu) et la transcription (à l'audio transcrit)
  étaient enregistrées à 0 €. Les appels passés restent sans coût.
- **Tarifs des modèles** : un modèle ou un déploiement que Pécule ne reconnaît pas n'est plus compté en silence au
  tarif d'Opus : il est marqué « tarif estimé », et son tarif se saisit (les appels déjà comptés sont recalculés).
  Un déploiement qui porte le nom d'un modèle connu (« claude-sonnet-5-5-… ») prend son tarif.
- **L'assistant connaît le coût de l'IA** : « combien m'a coûté l'IA ce mois-ci ? », « qu'est-ce qui consomme le
  plus ? ». Outil `get_ai_usage` (assistant et serveur MCP) ; `update_settings` règle le plafond.
- La démo a un historique de coût fictif sur douze mois.

## 1.16.0

- **Opérations rangées par mois** : la liste se lit en une boîte par mois, avec son bilan en tête — nombre
  d'opérations, celles qui restent à classer, dépenses et solde du mois (revenus et épargne aussi sur un écran
  large). Ce sont les chiffres de l'Analyse, calculés par le serveur sur toutes les opérations du mois, même celles
  que la liste n'a pas encore chargées ; filtrée ou en recherche, la liste donne le bilan de ce qu'elle garde, et une
  ligne « Total » réunit les mois. Sur ordinateur, le bandeau du mois reste collé sous l'en-tête des colonnes et un
  clic le replie ; triée par montant, la liste redevient d'un seul tenant. Sur téléphone, chaque mois a son titre et
  son bilan au-dessus de ses jours. L'étiquette « à classer » d'un mois filtre la liste sur ces opérations.
- **Une liste plus lisible** : la date n'est écrite qu'à la première opération du jour (elle revient au survol) ; un
  mouvement entre tes comptes est écrit en gris, puisqu'il ne compte ni en revenu ni en dépense ; une opération à
  classer porte un liseré orangé à gauche ; devant la catégorie d'une dépense, une pastille prend la couleur de son
  poste, la même que sur l'anneau des dépenses de l'Analyse. La nature d'une ligne (carte, prélèvement, virement…)
  se reconnaît désormais à une icône, la couleur étant réservée au poste.
- Le nombre d'opérations affiché sous le titre est celui de toute la liste filtrée, plus celui des lignes chargées.

## 1.15.0

- **L'assistant depuis la fiche d'une opération** : un bouton [Assistant] en haut de la fiche ouvre l'assistant sur
  cette opération, jointe à la question (pastille « À propos de »). Sur un grand écran, le panneau s'ouvre à côté de
  la fiche, qui reste ouverte ; sur téléphone ou dans une fenêtre étroite, l'assistant prend l'écran et l'opération
  reste jointe jusqu'à l'envoi du message. Une conversation vide propose d'abord ce qui se demande sur elle :
  l'expliquer, la classer, la noter, voir les opérations semblables.
- « Demander à l'assistant » (clic droit sur une ligne, menu d'une ligne sur téléphone, tri rapide) joint désormais
  l'opération elle-même : l'assistant la lit par son identifiant au lieu de la rechercher d'après son libellé.
- Fiche d'une opération sur téléphone : « Catégorie : » ne se coupe plus en deux lignes devant un nom long.

## 1.14.0

- **Aide de l'écran ouvert** : un « ? » dans la barre du haut (ordinateur et téléphone) ouvre la page du manuel
  qui explique l'écran affiché — l'article du budget depuis Budget, celui de la frise depuis Analyse → Frise,
  « Relier une banque » depuis le bloc Enable Banking des réglages. Dans le panneau de l'assistant, « à quoi sert
  cet écran ? » ou « comment ça marche ici ? » se rapporte à l'écran ouvert.
- **Notifications par l'assistant** : il peut cocher ou décocher un type de notification, sur tous tes appareils
  abonnés ou sur un seul — « ne m'envoie plus le résumé de la semaine sur l'iPhone », « quelles notifications est-ce
  que je reçois ? ». Activer les notifications sur un appareil demande toujours ton accord, à l'écran. Outil
  `set_notification_types` (assistant et serveur MCP) ; `get_settings` liste les appareils abonnés et ce qu'ils
  reçoivent.
- **Démarrage plus léger dans une autre langue que le français** : les traductions du manuel ne sont plus
  téléchargées à l'ouverture de l'appli, mais avec le manuel — le dictionnaire chargé au démarrage est presque deux
  fois plus petit.
- **Fournisseur d'IA** : l'encadré « L'assistant n'est pas branché », l'import d'un dossier et le message d'une
  extraction refusée renvoient désormais au bon endroit, Réglages → Comptes et connexions (bloc Intelligence
  artificielle) ; les guides d'installation aussi.
- L'outil `read_manual` accepte l'identifiant d'un thème et rend alors la liste de ses articles.

## 1.13.0

- **Répartition repensée** (Analyse, ordinateur). En tête, le solde de la période et trois jauges — revenus,
  dépenses, épargne — puis trois anneaux : revenus, dépenses et, nouveau, **épargne par support**. Dessous, une
  seule liste à pleine largeur, celle de l'anneau choisi : chaque poste a sa barre de couleur, sa part en %, son
  montant et son écart à la période de référence ; un poste se déplie sur ses catégories. Survoler une ligne fait
  ressortir sa part dans l'anneau, et inversement ; un clic sur un autre anneau change de liste. Plus de libellé
  coupé ni de cartes de hauteurs inégales.
- **« Comparer à »** : la référence se choisit — le mois précédent, la moyenne des trois derniers mois ou le même
  mois de l'an dernier (réglage mémorisé sur l'appareil). Pour un mois terminé, l'écart s'écrit dans une étiquette
  verte ou rouge ; pour le mois en cours, c'est un simple rappel — un mois entamé ne se compare pas à un mois entier.
- **Enveloppes sur les barres** : quand un poste ou une catégorie a une enveloppe (Budget), un trait marque son
  plafond sur la barre — rouge une fois dépassé ; au survol, le plafond et ce qu'il reste.
- Le téléphone garde un anneau à la fois (écran Mois).

## 1.12.3

- **Lecture des documents déposés** : depuis la 1.12.1, le fournisseur d'IA refusait le schéma de reconnaissance
  (la nature du contrat y était mal déclarée) ; un fichier déposé était rangé sous son nom de fichier, sans titre,
  résumé ni nature, et une facture déposée par l'assistant n'était plus reconnue comme telle. Corrigé ; un test
  vérifie désormais la forme des schémas envoyés à l'IA. Un document déposé entre-temps se relit par
  « Extraire les données vers mes écrans », ou se complète par « Modifier ».

## 1.12.2

- **Démarrage après une migration interrompue** : si le serveur est arrêté entre deux instructions d'une migration
  (redémarrage de l'hébergeur pendant un déploiement), le démarrage suivant reprend la migration au lieu d'échouer
  sans fin sur « colonne déjà présente ». C'est ce qui a rendu l'appli indisponible au déploiement de la 1.12.1.

## 1.12.1

- **Étiquettes par nature de contrat dans le coffre** : sous la recherche, une seconde rangée d'étiquettes —
  Assurance auto, Assurance habitation, Assurance emprunteur, Mutuelle santé, Autre assurance, Électricité et gaz,
  Box internet, Forfait mobile, Location ou crédit auto — avec le nombre de documents. Seules les natures présentes
  au coffre sont proposées. Un contrat et tous ses papiers (avenant, attestation, avis d'échéance, devis concurrent)
  se retrouvent d'un geste, quel que soit leur domaine ou leur type.
- **D'où vient la nature** : elle est reconnue à la lecture du document, et se corrige dans sa fiche (« Modifier »,
  « Nature du contrat ») ou par l'assistant. Les documents déjà au coffre sont étiquetés au premier démarrage,
  d'après leur titre et leur résumé, sans appel à l'IA ; celui dont la nature n'a pas été devinée se complète à la
  main.
- **Comparaison de contrats** : face à une offre, l'assistant ne propose plus que les papiers de même nature
  (l'assurance auto en cours pour un devis d'assurance auto), avec le début de leur résumé.
- Outils `search_documents` (filtre `topic`) et `update_document` (champ `topic`), assistant et serveur MCP.

## 1.12.0

- **Manuel** (nouvel écran, entre « Assistant » et « Réglages » dans le menu ; dans « Tout Pécule » sur le
  téléphone ; « g » puis « m » au clavier) : tout ce que sait faire Pécule, en douze thèmes et près de cent
  articles — premiers pas, comptes et banques, opérations et classement, analyse et budget, factures, patrimoine,
  revenus, impôts et retraite, coffre et échéancier, assistant, personnalisation, foyer, sécurité. Chaque article
  donne les étapes, nomme les boutons comme l'écran les affiche, et ouvre l'écran ou le réglage dont il parle. Dans
  les cinq langues.
- **Recherche dans le manuel** : par mots-clés ou par une question entière (« comment relier ma banque »), sans tenir
  compte des accents. La recherche générale (⌘K) propose aussi les articles du manuel.
- **L'assistant connaît Pécule** : demande-lui comment faire, où se trouve un réglage ou ce que veut dire un
  chiffre — il lit le manuel, répond par les étapes et donne le lien vers le bon écran. L'accueil de l'assistant
  propose « Comment faire, dans Pécule, pour… ? ».
- **Réglages par l'assistant**, toujours après confirmation : sur l'appareil — clair, sombre ou automatique, couleur,
  thèmes de l'année, densité, montants masqués, ouverture instantanée ; pour toi — la langue, les équivalences
  amusantes, le nom d'un compte, un compte masqué ou sorti des statistiques (l'alerte de solde bas l'était déjà) ; pour
  le foyer, par son administrateur — le jour retenu pour les achats par carte et les écrans affichés. Ce qui touche à
  la sécurité ou à un service extérieur (clés d'accès, membres, banque, fournisseur d'IA, notifications de l'appareil,
  sauvegarde, pays et devise) reste à l'écran : l'assistant explique la marche à suivre et donne le lien.
- **Liens vers une section des réglages** : une adresse comme `/reglages/notifications#solde` ouvre le groupe et
  défile jusqu'à la section.
- **Outils** `read_manual`, `get_settings`, `update_settings`, `update_account` (assistant et serveur MCP) et
  `set_device_settings` (assistant seulement : il règle l'appareil de celui qui est devant l'écran).
- L'écran d'autorisation d'une application dit désormais où retirer l'accès : Réglages → Comptes et connexions.

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
