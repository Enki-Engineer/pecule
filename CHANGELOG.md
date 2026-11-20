# Journal des versions

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/). Avant toute mise à jour : une
sauvegarde complète (`pnpm sauvegarde`). Les migrations de la base s'appliquent seules au démarrage.

## 1.34.1

Une installation neuve démarre sur toutes les bases annoncées. Rien ne change pour une installation en service ;
aucune migration.

- **MariaDB 10.6 à 10.9 et MySQL 8 : le premier démarrage échouait.** Le schéma de départ donnait à dix tables une
  collation que seule MariaDB 10.10 et plus connaît (`utf8mb4_uca1400_ai_ci`, celle du serveur sur lequel le fichier
  avait été écrit) : la base s'arrêtait sur « Unknown collation » et restait à moitié créée. Toutes les tables portent
  désormais la collation de Pécule (`utf8mb4_unicode_ci`), une table créée par une migration la reçoit quel que soit
  le serveur, et la vue des opérations s'écrit avec le `NOT` de la norme. Essayé sur une base vide avec MariaDB 10.6,
  10.11 et 11.8 et avec MySQL 8.4 : mêmes réponses, écran par écran, sur les quatre.
- **Un premier démarrage interrompu se reprend.** Si la création de la base s'arrête en route (serveur coupé,
  instruction refusée), le démarrage suivant la reprend là où elle s'était arrêtée, au lieu de prendre la base à
  moitié créée pour une ancienne installation.
- Les contrôles automatiques démarrent désormais Pécule sur MariaDB 10.6 et sur MySQL 8.4, en plus de MariaDB 11.8.

## 1.34.0

Installer Pécule devient l'affaire d'un fichier et de trois commandes — ou d'une phrase dite à son assistant IA.
Rien ne change pour une installation en service ; aucune migration.

- **Docker : le fichier `compose.yaml` suffit.** Ni dépôt à cloner, ni Node sur la machine, ni fichier `.env` à
  écrire : `docker compose up -d` tire lui-même les secrets de l'installation et les garde dans un volume
  (`pecule-reglages`). Un fichier `.env` reste possible — deux lignes pour un serveur en https (`APP_URL`,
  `COMPOSE_PROFILES=https`) — et ce qu'il donne l'emporte toujours : une installation existante garde ses secrets, sa
  base et ses volumes. Essayé avec Docker Compose 2.9 et 2.20 (ceux de bien des NAS) comme avec la version courante.
  Des garde-fous : relancé d'un dossier qui n'a pas le `.env` de l'installation, Pécule refuse de démarrer plutôt
  que de changer d'adresse en silence ; une variable du terminal ne peut ni lui donner un secret trop court pour
  être le sien, ni remplacer celui qui chiffre les clés gardées en base ; et une base déjà là dont les réglages ne
  sont pas donnés n'en reçoit jamais de nouveaux.
- **Un lien pour le premier démarrage.** `node scripts/lien.mjs` (avec Docker :
  `docker compose exec pecule node scripts/lien.mjs`) attend que Pécule soit prêt et donne le lien à ouvrir : il porte
  le code d'installation, et l'écran « Bienvenue dans Pécule » ne demande plus que ton prénom. Ouvert sans ce lien,
  l'écran affiche la commande qui le donne. La même commande dépanne un premier membre resté sans clé d'accès (page
  fermée trop tôt).
- **Archive prête à l'emploi.** Chaque version joint `pecule.tar.gz` et `pecule.zip` : le serveur déjà construit et
  ses dépendances, pour un hébergement Node.js sans Docker — ni build, ni pnpm. `node scripts/maj.mjs` met à jour une
  installation faite ainsi (archive téléchargée, empreinte contrôlée, version d'avant gardée dans `.avant-maj`), ou
  prend une archive déjà téléchargée par `--archive`.
- **Les formats sont joints à chaque version** sur GitHub (`compose.yaml`, les deux archives, `SHA256SUMS`), sous des
  noms qui ne changent pas : la dernière version se télécharge toujours à la même adresse. Les notes d'une version
  commencent par un tableau « Installer ou mettre à jour ».
- **Installer par son assistant IA, quel qu'il soit.** `AGENTS.md` est une marche à suivre complète, lisible par son
  adresse sans cloner le dépôt ; la consigne à coller est dans le README et dans
  `docs/guide/installer-avec-une-ia.md`. La compétence `pecule` s'installe par `npx skills add`, `gh skill install`
  ou le catalogue de plugins de Claude Code.
- **La mise à jour affichée est celle de ton installation** : Réglages → Suivi technique donne
  `docker compose pull && docker compose up -d` avec Docker, `node scripts/maj.mjs` sinon.
- **Image plus légère** : elle n'emporte plus que ce que le serveur charge (ses dépendances passent de 211 à 53 Mo).
- `doctor`, `lien`, `maj` et `importer` lisent les réglages où qu'ils soient (fichier `.env`, volume, conteneur) ;
  `doctor` dit « rien n'est installé ici » plutôt qu'une erreur, et un réglage qui manque au démarrage est nommé en
  clair. `setup` et `doctor` essaient la base elle-même (joignable, version, vide ou non) : une adresse fausse se voit
  avant le premier démarrage. Devant un serveur réglé par les variables de son hébergeur, `doctor` le dit et ne
  conseille plus d'écrire un fichier `.env`, et `setup` refuse d'en écrire un à côté de lui. L'import d'un dossier de
  documents se lance aussi dans le conteneur.

Pour celui qui héberge :

- Avec Docker, le projet Compose s'appelle désormais `pecule` où que soit rangé `compose.yaml`. Une installation
  faite dans un dossier d'un autre nom retrouve ses volumes par `COMPOSE_PROJECT_NAME=<nom du dossier>` dans `.env`.
- `compose.yaml` ne lit plus `PECULE_ENV_FILE` (un autre fichier que `.env` : `docker compose --env-file`), et ne
  transmet plus au conteneur `PORT` ni `DATABASE_URL` écrits dans `.env` : le port du conteneur et la base sont ceux
  de `compose.yaml`.
- `setup.mjs --docker` inscrit `COMPOSE_PROFILES=https` pour une adresse publique : `docker compose up -d` suffit
  ensuite (`--proxy` s'il y a déjà un proxy https devant Pécule).
- Développement : la base locale (`pnpm local base`) a son propre projet Compose, `pecule-local` ; son conteneur y
  passe au premier lancement, ses données ne bougent pas.

## 1.33.0

- **L'assistant tient à jour les faits clés d'un bien.** Ce que la fiche d'un bien affiche sous « Faits clés »
  (diagnostic, assurance, copropriété, travaux…) se corrige, s'ajoute ou se retire en le demandant à l'assistant —
  « note que le diagnostic de l'appartement d'Angers est passé en C » —, avec la même confirmation que le reste. Un
  fait corrigé garde sa place dans la fiche et prend la date du jour ; un fait nouveau s'ajoute à la fin.
- **Corrigé : noter quelque chose sur un bien échouait.** L'outil `update_property` acceptait des « notes », alors
  qu'un bien n'a jamais eu de notes en base : la demande était annoncée, puis l'écriture échouait. Le paramètre
  disparaît au profit des faits clés (`facts`), que la fiche montre. Les colonnes qu'un outil d'édition écrit sont
  désormais comparées au schéma par un test (`src/server/tools/edition-columns.ts`).
- Aucune migration, aucun réglage nouveau.

## 1.32.1

- **Dossier des sauvegardes du serveur : une seule règle.** Le serveur range ses sauvegardes dans
  `~/pecule-sauvegardes/<adresse de l'appli>`, sauf si `BACKUP_DIR` en donne un autre — et c'est par `BACKUP_DIR` que
  `compose.yaml` désigne le volume `pecule-sauvegardes` de Docker. Deux cas particuliers de la 1.31.0 disparaissent :
  une installation Node.js qui avait déjà des archives dans `data/sauvegardes` ne garde plus ce dossier (elle passe
  au dossier du compte ; déplacez-y les anciennes archives pour les revoir dans l'appli), et le serveur ne cherche
  plus à deviner s'il tourne dans un conteneur. `data/sauvegardes` ne reste qu'en repli, quand le compte du serveur
  n'a pas de dossier personnel où écrire.
- Avec Docker, un `BACKUP_DIR` écrit dans `.env` est sans effet : pour ranger les archives ailleurs, on change dans
  `compose.yaml` ce qui est monté sur `/app/data/sauvegardes`.

## 1.32.0

Suite de la reprise d'un historique par les relevés : cartes à débit différé, longs relevés, classement par l'IA.

- **Classement en lot proposé par l'IA.** Sur l'écran « À classer », « Proposer un classement » demande à ton
  fournisseur d'IA une catégorie pour chaque libellé encore sans catégorie, les plus fréquents d'abord (120 libellés
  par demande), d'après tes catégories et ce que tu as déjà classé toi-même. Tu relis, tu changes une catégorie, tu
  décoches — une supposition n'est jamais cochée d'office —, puis tu appliques : rien n'est classé avant, seules des
  opérations sans catégorie sont touchées, et l'application s'annule. « Retenir ces choix » crée une règle par
  libellé. Fermé en mode démo ; coût compté à part dans Réglages → Coût de l'IA (« Classement d'opérations »).
- **Cartes à débit différé dans les relevés.** Un achat par carte garde son jour d'achat quand le relevé l'imprime
  (« FACT 120117 », « CARTE 12/01 ») : le réglage « jour d'achat ou jour du débit » s'applique à l'historique repris.
  Quand le compte ne porte que le total du mois et que le détail des achats est imprimé à part, ce détail devient un
  compte de carte — ses achats doivent faire le total prélevé, ils sont écrits le jour du prélèvement avec leur jour
  d'achat, comme pour une carte lue à la banque — et le total écrit sur le compte est rangé en mouvement interne, que
  le compte ou la carte soit validé en premier : les achats ne comptent qu'une fois.
- **Relevés de plus de 40 pages.** Ils sont découpés en tranches de 25 pages lues l'une après l'autre telles
  qu'elles sont imprimées, puis réunies, au lieu d'être lus par leur texte où débits et crédits se mêlent.
- **Confirmation avant de valider un fichier dont un contrôle ne passe pas** (un relevé qui ne tombe pas juste, un
  compte non choisi) : ce qui serait écrit est peut-être faux, Pécule le dit avant d'écrire.
- **Historique des soldes.** Le solde de fin d'un relevé s'inscrit aussi pour un compte relié à une banque, là où
  elle n'a rien donné ; un solde venu d'elle n'est jamais remplacé, et annuler la validation le retire.
- Après la validation de relevés ou d'un export de la banque, l'import renvoie vers « À classer ».
- Manuel : article « Faire proposer un classement par l'IA » ; articles des relevés, du tri et des cartes à débit
  différé complétés.

Une dépendance nouvelle : `pdf-lib` (découpe des PDF). Aucune migration, aucun réglage nouveau.

## 1.31.0

Les sauvegardes du serveur survivent à une mise à jour chez tous les hébergeurs, sans aucun réglage.

- **Le dossier des sauvegardes se choisit tout seul.** Les sauvegardes que le serveur écrit lui-même — avant une
  mise à jour qui change la base, et chaque nuit si l'administrateur le demande — allaient dans `data/sauvegardes`,
  à l'intérieur de l'installation. Or beaucoup d'hébergeurs Node.js installent chaque nouvelle version dans un
  dossier neuf : les archives disparaissaient à la mise en ligne suivante, à moins de régler `BACKUP_DIR`. Elles vont
  désormais dans `~/pecule-sauvegardes/<adresse de l'appli>`, dans le dossier personnel du compte qui fait tourner
  Pécule, hors de l'installation. Il n'y a rien à créer ni à régler.
- **Rien ne change pour une installation en service** : avec Docker, le dossier reste le volume
  `pecule-sauvegardes` ; une installation Node.js qui a déjà des archives dans `data/sauvegardes` garde ce dossier ;
  `BACKUP_DIR`, quand il est donné, l'emporte toujours. Sans dossier personnel inscriptible, le serveur se replie sur
  `data/sauvegardes`, et `doctor` le signale.
- **Réinstaller au même endroit retrouve ses archives** : sur le même compte et à la même adresse, l'écran
  « J'ai une sauvegarde : la restaurer » propose celles de l'installation précédente.
- Le dossier utilisé est affiché par Réglages → Compte et sécurité, par `node scripts/doctor.mjs` (avec sa raison)
  et dans le journal du serveur au démarrage. Pécule le crée fermé aux autres comptes de la machine.
- `node scripts/maj.mjs` dépose sa sauvegarde dans ce même dossier quand le serveur tourne sur la même machine sans
  Docker : elle figure alors avec les autres dans l'appli.
- Guide : « Où le serveur garde ses sauvegardes », dans `docs/guide/installation.md`. Aucune migration, aucun réglage
  nouveau.

## 1.30.1

Logo : l'icône choisie est celle que reçoit le Dock du Mac, et le coffre d'origine passe au fond « Sable ».

- **L'icône du Dock est enfin celle qu'on a choisie.** Ajouté au Dock depuis Safari, Pécule gardait le coffre
  d'origine quel que soit le choix fait dans Réglages → Apparence : Safari retient le manifeste et l'icône écrits
  dans la page telle que le serveur l'envoie, pas ceux que le script d'apparence y met ensuite. Le choix de
  l'appareil est maintenant recopié dans un cookie (`pecule_icone`, un identifiant de la liste des logos, rien
  d'autre) et le serveur écrit la page avec ce manifeste et cette icône. Après un changement de logo : recharger la
  page, puis Fichier → « Ajouter au Dock » ; une icône déjà dans le Dock garde son dessin, il faut la supprimer
  d'abord. Réglages et le manuel le disent.
- **« Sable » est le logo d'origine**, à la place de « Pétrole » : page, onglet, manifeste, icône d'une
  installation, notifications. Un appareil qui avait choisi un fond le garde ; un appareil qui n'avait rien choisi
  passe au sable (« Pétrole » reste proposé dans Réglages → Apparence → Logo).

Aucune migration, aucun réglage nouveau.

## 1.30.0

Patrimoine : un placement peut suivre les versements qu'il rapporte.

- **Versements reçus d'un placement.** Les coupons d'une obligation, des intérêts, ce qu'une plateforme reverse :
  dans la fiche d'un placement, « Suivre les versements reçus » demande un texte présent dans le libellé de ces
  entrées d'argent, et Pécule les retrouve dans les opérations — rien n'est recopié. La fiche montre le dernier
  versement, ce qui a été reçu sur douze mois, le total de chaque année et, quand les versements remontent à un an,
  le rendement (ce qui a été reçu sur douze mois, rapporté à la valeur). « Voir ces opérations » en ouvre la liste.
- **Une valeur qui se met à jour seule.** Pour un portefeuille vidé à chaque versement, « Valeur = dernier
  versement » remplace la saisie : la valeur du placement devient le dernier versement reçu, relue après chaque
  synchronisation. C'est une estimation de ce qu'il contient entre deux versements, et la fiche le dit. Un placement
  suivi ainsi n'est plus rappelé dans « À traiter » pour sa valeur trop ancienne.
- Même fiche sur ordinateur et sur téléphone. L'assistant lit le réglage (`get_wealth`) et peut le changer
  (`update_asset` : `payout_match`, `value_follows_payouts`), après confirmation.
- Manuel : nouvel article « Suivre les versements d'un placement ».

Migration `0033_actif_versements` (une colonne, `assets.payout_match`). Aucun réglage nouveau ; rien ne change pour
un placement sans texte de versements.

## 1.29.2

- Sécurité : `express-rate-limit` passe en 8.7.5 (alerte de l'hébergeur, GHSA-cppf-2hm6-mrvm, gravité modérée). La
  faille permettait de désactiver une limite de débit laissée à sa valeur par défaut, à condition d'avoir déjà
  corrompu le prototype des objets du serveur. Pécule n'y était pas exposé — chacune de ses limites est écrite
  explicitement —, la mise à jour retire l'alerte et la question.

## 1.29.1

Téléphone : le mois reste sous la main, la bascule Foyer / Moi ne bouge plus.

- **Changer de mois sans remonter.** Sur l'écran Mois, la rangée qui porte le mois affiché et ses deux flèches reste
  sous la barre du haut quand on fait défiler : on passe d'un mois à l'autre depuis le bas de l'écran, pour comparer
  la frise ou les dépenses cumulées de deux mois sans perdre sa place.
- **Foyer / Moi sans décalage.** Sur Revenus et Impôts, la phrase sous le titre partageait sa ligne avec la bascule :
  plus longue dans une vue que dans l'autre, elle passait sur une ligne de plus et tout l'écran descendait, bascule
  comprise. À droite d'un titre, un bouton reste désormais sur la ligne du titre et la phrase passe dessous, sur
  toute la largeur — sur tous les écrans du téléphone. La phrase d'Impôts en vue « Moi » est raccourcie pour tenir
  sur une ligne.

Aucune migration, aucun réglage nouveau.

## 1.29.0

- **« Essentiel » devient l'agencement de départ**, sur ordinateur comme sur téléphone : quatre chiffres clés, la
  courbe du patrimoine, l'anneau des dépenses, les comptes en bref, « À traiter » et les prochaines échéances —
  un seul écran. Il passe en tête des modèles. Sur téléphone : ce qui est disponible, les comptes en bref, ce qui
  est dépensé et les opérations à classer.
- Qui a déjà arrangé son tableau de bord ou son accueil garde le sien, tel quel. Qui ne l'a jamais touché passe à
  l'essentiel ; « Vue d'ensemble », dans les modèles, rend l'écran d'avant.

## 1.28.0

- **Tableau de bord allégé.** Il donnait beaucoup à lire et presque rien à voir : la vue d'ensemble de la démo
  comptait 323 mots et 77 montants pour un seul graphique, sur trois écrans de haut. Elle en compte 174 et 52, sur
  moins de deux.
- **Des dessins à la place des phrases.** Les dépenses du mois et la répartition du patrimoine se lisent en anneau,
  le total au centre. Sous un chiffre clé, une petite courbe de ses dernières semaines ou une jauge (ce que les
  dépenses ont pris des revenus, la part du capital remboursée) ; d'où vient le chiffre se lit dans sa pastille
  « i ».
- **L'essentiel ou le détail, carte par carte.** En mode construction, « Comptes », « Dernières opérations »,
  « Prochaines échéances », « Dépenses du mois par poste » et « Répartition du patrimoine » ont un bouton pour
  passer de l'essentiel (un graphique, quelques lignes) au détail (la liste complète). « Comptes » réduit à
  l'essentiel : un total par groupe, une barre, l'encours des cartes et les comptes signalés.
- **Modèle « Essentiel »** : quatre chiffres, la courbe du patrimoine, l'anneau des dépenses, les comptes en bref et
  ce qui demande ton attention — un seul écran. Les autres modèles tiennent en dix cartes au plus ; « Vue
  d'ensemble » n'affiche plus d'emblée « Où part l'argent », « Le chiffre du moment » et « Résumé de la semaine »,
  qui attendent dans « Ajouter ».
- Un tableau de bord déjà arrangé garde ses cartes et leur ordre ; ses listes d'opérations et d'échéances passent à
  l'essentiel et ses répartitions en anneau, « Comptes » reste détaillé. Chaque carte se remet en détail d'un
  bouton.
- Sur téléphone : modèle « Essentiel » et bloc « Comptes en bref » (dans « Ajouter »).

## 1.27.1

Crypto : un portefeuille marqué « à vérifier » ne reste plus bloqué.

- **Confirmer qu'un portefeuille a bien changé.** Quand CoinStats rend un portefeuille vide, ou bien plus bas qu'à la
  lecture d'avant, Pécule garde ses positions et le marque « à vérifier », au cas où sa connexion serait cassée. S'il
  a vraiment été vidé ou vendu, rien ne permettait de le dire : il restait « à vérifier », ses anciennes positions
  comptées pour toujours — et parfois deux fois, quand elles étaient parties vers un autre portefeuille suivi. L'écran
  Crypto l'explique désormais sous le portefeuille, et « C'est exact » confirme la nouvelle valeur : CoinStats est
  relu aussitôt et les positions sont mises à jour.
- **Un portefeuille écarté repart de zéro.** Décocher un portefeuille oublie sa valeur d'avant : recoché, il est relu
  tel que CoinStats le rend, sans rester « à vérifier ».
- Manuel : l'article « Suivre ses cryptomonnaies » décrit le garde-fou et sa confirmation.

Aucune migration, aucun réglage nouveau.

## 1.27.0

Reprendre l'historique d'un compte en déposant ses relevés en PDF dans le coffre.

- **Un relevé de plusieurs comptes donne une proposition par compte.** Jusque-là, seul le premier compte d'un
  relevé qui en portait plusieurs (un compte courant et des livrets) était lu, sans que rien ne le dise. Chaque compte
  a désormais sa ligne dans l'import, avec ses soldes, ses opérations et ses contrôles.
- **Le compte se choisit une fois.** Le compte de Pécule choisi pour un relevé — ou « Nouveau compte… » — vaut pour
  les autres relevés du même compte déposés avec lui : ils deviennent « sûrs » et se valident d'un coup. Le compte
  créé par le premier relevé validé reçoit les suivants.
- **La série se vérifie d'elle-même.** En haut de l'import, l'encadré « Relevés de compte : la série » donne, compte
  par compte, la période couverte et le nombre d'opérations, et signale un relevé manquant ou deux soldes qui ne
  s'enchaînent pas (le solde d'arrivée d'un relevé doit être le solde de départ du suivant).
- **Les opérations se relisent et se corrigent.** La fiche d'un relevé liste toutes ses opérations, avec le solde du
  compte après chacune. On touche une ligne pour la corriger, inverser son signe ou la retirer, et on peut ajouter une
  opération oubliée. Quand le relevé ne tombe pas juste, Pécule donne l'écart, compare ses totaux aux totaux imprimés
  (débits, crédits) et désigne la ligne dont le signe ou la présence expliquerait l'écart.
- **Les longs relevés sont lus en entier.** La lecture arrive en flux et, au-delà de 400 opérations, en plusieurs
  réponses : un relevé de plusieurs centaines d'opérations n'échoue plus après deux minutes. Les pages sont lues
  telles qu'elles sont imprimées jusqu'à 40 pages (20 auparavant). Les dates sans année, les relevés à cheval sur deux
  années et les colonnes Débit / Crédit sont précisés à l'IA ; un compte encore inconnu de Pécule ne fait plus
  baisser la confiance de la lecture.
- **Moins de doublons avec ce que la banque a déjà fourni.** Une opération du relevé est rapprochée d'une opération
  de la banque au même montant jusqu'à trois jours d'écart (la banque ne date pas toujours comme son relevé) ; deux
  relevés, eux, se comparent toujours au jour près. La fiche dit combien d'opérations ont été rapprochées ainsi.
- Un relevé sans mouvement n'est plus écarté : ses soldes comptent dans la série. Le solde d'arrivée de chaque relevé
  validé est gardé dans l'historique du compte, et retiré si la validation est annulée ; le relevé suivant d'un compte
  tenu par ses relevés y compare son solde de départ.
- L'assistant et le serveur MCP relisent les opérations d'un relevé (`get_import_item` avec `lignes`) et les
  corrigent (`review_import_item` : `lignes`, action « corriger »).
- Manuel : article « Reprendre l'historique d'un compte avec ses relevés » ; guide d'import mis à jour.

Une migration : la colonne `part` des lignes d'import (le compte lu, pour un relevé de plusieurs comptes), et les
corrections de relecture gardées dans un champ plus grand. Aucun réglage nouveau.

## 1.26.0

Les revenus et les impôts se lisent pour tout le foyer, ou pour soi.

- **Foyer / Moi sur Revenus et Impôts.** La bascule de la barre du haut, jusque-là grisée sur ces deux écrans, y
  choisit ce qui est compté ; sur téléphone, elle est à côté du titre de l'écran. Elle n'apparaît que dans un foyer de
  plusieurs membres.
- **Revenus du foyer.** « Foyer » réunit les bulletins de paie des membres : net payé du mois et de l'année, graphique
  empilé par membre, part de chacun dans le tableau par année, colonne « Membre » dans la liste des bulletins.
  « Moi » garde l'écran d'avant, avec ses seuls bulletins.
- **Chacun décide de partager ses revenus.** Réglages → Compte et sécurité → « Partager mes revenus avec le foyer »,
  éteint au départ : tant qu'un membre ne l'a pas allumé, lui seul voit ses bulletins, et la vue du foyer des autres
  dit qu'il n'y est pas compté. Le partage ne montre que des montants — ni le bulletin, ni sa remarque de lecture.
  Ce réglage ne se change qu'à l'écran, par le membre lui-même : l'assistant le lit, il ne le modifie pas.
- **Déclarations d'impôt communes ou personnelles.** Une déclaration est celle du foyer (imposition commune) ou celle
  d'un seul membre (avant la vie commune, ou dans un couple ni marié ni pacsé) ; une année de revenus peut en compter
  plusieurs. Elle se choisit dans le détail de l'année (sur sa ligne, au téléphone), à la relecture d'un avis déposé
  au coffre — Pécule propose le membre quand l'avis ne nomme que lui —, ou par l'assistant (« la déclaration 2018 est
  la mienne »). « Foyer » additionne par année la déclaration commune et les déclarations personnelles ; « Moi » ne
  garde que la commune et les siennes. Une déclaration personnelle suit le partage des revenus de son déclarant.
  Pécule refuse de rendre personnelle une déclaration qui porte le salaire d'un autre membre.
- L'avis d'une déclaration n'est proposé à l'ouverture que si le membre peut le lire au coffre.
- Assistant et serveur MCP : `get_payslips` et `get_taxes` prennent `perimetre` (« foyer » ou « moi ») et nomment
  les membres qui ne partagent pas ; `update_tax_return` change le déclarant d'une déclaration ; `get_settings` dit
  si le membre partage ses revenus.
- Démo : Camille a ses bulletins de paie, et la famille une année d'imposition séparée, avant son Pacs.

Migration `0031_declarations_impot` : `tax_returns` reçoit `owner_user_id` (0 = déclaration commune) et sa clé
devient l'année de revenus et le déclarant. Les déclarations en place restent communes : rien ne change tant qu'un
membre ne dit pas qu'une déclaration est la sienne. Aucun réglage nouveau dans `.env`.

## 1.25.1

Corrections issues d'une relecture des trois versions précédentes.

- **Restauration.** Une installation restaurée met ses sauvegardes automatiques en pause, et le dit : une copie
  d'essai ne dépose plus ses archives, ni ne trie celles du stockage extérieur, à la place de l'installation
  d'origine. Quand la clé de récupération est refusée, l'archive envoyée reste sur le serveur : on redonne la clé,
  sans tout renvoyer. Le rapport de fin (qui porte un lien d'inscription) n'est plus lisible qu'une demi-heure.
- **Garde-fous resserrés autour du vidage de la base neuve** : Pécule passe en maintenance avant de contrôler que
  l'installation est neuve, le contrôle est refait juste avant, et la création du premier membre est refusée pendant
  une restauration ; le témoin d'une restauration interrompue est relu sous verrou avant tout ménage.
- **Stockage extérieur** : le secret enregistré ne resert que pour la même adresse et le même identifiant —
  modifier l'un ou l'autre demande de le ressaisir. Retirer le stockage efface l'échec d'envoi affiché.
- **Archives** : une archive ne peut plus faire lire une autre base à la restauration (table remplie d'une lecture,
  vue sur une table d'une autre base) ; les archives écrites par Pécule ne sont pas concernées.
- « Sauvegarde terminée » ne s'affiche plus avant la fin de l'écriture, et un échec d'une sauvegarde demandée à la
  main se voit même quand les sauvegardes automatiques sont éteintes. La notification distingue une sauvegarde qui
  n'a pas été écrite d'une copie extérieure qui n'est pas partie.
- Les fichiers de travail laissés par un arrêt du serveur (archive en cours d'envoi, copie en cours de chiffrement)
  sont retirés au démarrage. Aucune migration.

## 1.25.0

- **Copie des sauvegardes hors du serveur.** Dans Réglages → Compte et sécurité, section « Copie hors du serveur »,
  l'administrateur règle un stockage à lui — compatible S3 (Amazon S3, Backblaze B2, Scaleway, OVH, Cloudflare R2,
  MinIO…) ou WebDAV (Nextcloud, kDrive, un NAS…). Chaque sauvegarde automatique y est alors déposée, et l'on choisit
  ce qui y reste : les dernières copies, puis la première de chaque semaine et de chaque mois. Le stockage est essayé
  pour de bon avant d'être enregistré ; si un envoi échoue, l'archive attend et repart seule, et l'administrateur
  est prévenu.
- **Tout ce qui quitte le serveur est chiffré.** Pécule crée une clé de chiffrement, n'en garde que la moitié
  publique, et montre une seule fois la clé de récupération, à ranger. Le format est celui d'[age](https://age-encryption.org) :
  une copie se déchiffre sans Pécule (`age -d -i cle.txt archive.zip.age`), ou avec lui
  (`pnpm sauvegarde --dechiffrer archive.zip.age --cle cle.txt`). **Sans la clé de récupération, une copie ne peut
  être relue par personne.** On peut aussi donner sa propre clé publique age.
- **Sauvegarde téléchargée chiffrée**, au choix : une case « Chiffrer l'archive » à côté de « Télécharger la
  sauvegarde », une fois la clé créée.
- **Restaurer une copie chiffrée** : l'écran de restauration d'une installation neuve accepte une archive `.zip.age`
  et demande la clé de récupération.
- Le secret du stockage est gardé chiffré en base (avec `SECRET_KEY`, comme les autres clés). Rien ne change tant
  qu'aucun stockage n'est réglé. Aucune migration, aucun réglage d'hébergement nouveau.

## 1.24.0

- **Sauvegardes automatiques.** Dans Réglages → Compte et sécurité, l'administrateur peut demander au serveur d'écrire
  lui-même une sauvegarde complète chaque nuit, ou chaque semaine. Chaque archive est relue en entier avant d'être
  gardée, et seules les plus récentes restent (sept au départ, réglable). « Écrire une sauvegarde maintenant » en fait
  une tout de suite. Éteint tant qu'on ne l'a pas demandé : rien ne change pour une installation existante.
- **Les archives du serveur se voient et se gèrent depuis l'appli** : automatiques, d'avant mise à jour ou déposées
  dans le dossier, avec leur date et leur taille — à télécharger ou à retirer.
- **Pécule prévient quand les sauvegardes manquent** : une notification pour l'administrateur si la sauvegarde
  automatique échoue, ou après un mois sans aucune sauvegarde (type « Sauvegarde automatique en échec, ou aucune
  sauvegarde depuis un mois ») ; l'échec figure aussi dans les alertes du Suivi technique. `doctor` dit de quand date
  la dernière sauvegarde, et l'assistant sait le dire aussi.
- Ces archives sont dans `data/sauvegardes` (ou `BACKUP_DIR`), sur le même serveur que la base : elles protègent
  d'une erreur ou d'une mise à jour qui tourne mal, pas de la perte du serveur. Chez un hébergeur qui installe chaque
  version dans un dossier neuf, donnez à `BACKUP_DIR` un dossier hors de l'installation.
- Aucune migration, aucun réglage d'hébergement nouveau.

## 1.23.0

- **Restaurer une sauvegarde depuis l'appli, à l'installation.** L'écran « Bienvenue dans Pécule » d'une installation
  neuve propose « J'ai une sauvegarde : la restaurer » : le code d'installation, puis l'archive — envoyée depuis
  l'appareil, ou choisie parmi celles du dossier des sauvegardes du serveur. Pécule la relit en entier, recharge la
  base et les fichiers, applique les migrations plus récentes et redémarre. Changer de serveur ou repartir d'une base
  perdue ne demande plus de ligne de commande.
- À la fin, Pécule dit ce qu'il a retrouvé et ce qu'il reste à faire : créer une clé d'accès si l'adresse de
  l'installation a changé (un lien d'inscription est donné à l'administrateur), ressaisir les clés enregistrées dans
  l'appli si le secret du serveur (`SECRET_KEY`) n'est pas celui de l'ancien.
- Garde-fous : seulement dans une installation sans membre ni donnée (rien ne peut être écrasé) ; une archive abîmée,
  ou faite par une version plus récente, est refusée avant toute écriture ; si le serveur s'arrête pendant le
  chargement, le démarrage suivant remet la base à neuf au lieu d'ouvrir sur une base à moitié chargée. Revenir à une
  sauvegarde sur une installation en service reste une affaire de ligne de commande (`pnpm restaurer`, base vide).
- Une sauvegarde note désormais l'adresse de l'installation d'où elle vient (pour dire, à la restauration, si les
  clés d'accès valent encore). Aucune migration, aucun réglage nouveau.

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
