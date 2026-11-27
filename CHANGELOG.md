# Journal des versions

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/). Avant toute mise à jour : une
sauvegarde complète (`pnpm sauvegarde`). Les migrations de la base s'appliquent seules au démarrage.

## 1.54.0

Crypto : un achat ou une vente chez Kraken se propose au journal avec sa vraie date, son cours et ses frais. Une
migration (colonnes `price` et `fee` de `crypto_proposals`), aucun réglage nouveau.

- **Le registre de Kraken, quand la clé permet de le lire.** Jusque-là, Pécule ne lisait chez un exchange que les
  soldes : d'un achat, il ne voyait que l'avant et l'après, et le proposait au jour de la synchronisation. Si ta clé
  porte aussi le droit « Query ledger entries » (sous « Data », dans les réglages de l'API chez Kraken — il s'ajoute
  à une clé existante et ne permet que de lire), Pécule retrouve dans le registre les exécutions de l'ordre : la
  proposition porte le jour de l'exécution, le cours d'exécution, les frais ramenés à ta devise, et la quantité
  reçue frais déduits.
- **Rien ne change sans ce droit**, ni pour les autres exchanges : la proposition garde le jour de la lecture et le
  montant de la monnaie dépensée ou reçue. Le registre n'est lu que lorsqu'un achat ou une vente vient d'être
  reconnu dans les soldes, et seulement depuis la lecture d'avant ; s'il ne dit rien de clair (une autre quantité,
  deux monnaies), l'estimation est gardée.
- **Le guide « Un exchange, par une clé en lecture seule »** dit quel droit cocher chez Kraken pour cela.
- **Pour celui qui héberge** : la migration `0043_propositions_exactes` ajoute deux colonnes ; un seul chemin de
  lecture de plus est appelé chez Kraken avec la clé (`/0/private/Ledgers`).

## 1.53.0

Crypto : les mouvements lus dans les exports d'une appli se consultent, et se notent au journal. Aucune migration,
aucun réglage nouveau.

- **« Voir ses mouvements »** : un portefeuille tenu par ses exports (l'appli Crypto.com, SwissBorg) montre tout ce
  que Pécule a lu dans les fichiers déposés, du plus récent au plus ancien — la date, le genre écrit par l'appli et
  celui du journal qui lui ressemble, la quantité. Jusque-là ces lignes ne servaient qu'à calculer les soldes.
- **Une ligne se note au journal en un geste** : la toucher ouvre le mouvement rempli (genre, date, crypto,
  quantité, plateforme), à relire et à compléter de son montant. Une ligne déjà notée le dit, et ne se note pas deux
  fois. Rien n'y est noté d'office : un export compte des centaines de lignes.
- **Un virement de quelques centimes n'est plus proposé au journal** : c'est l'essai par lequel une plateforme
  vérifie un compte bancaire (moins d'une unité de la devise du foyer).

## 1.52.0

Crypto : Pécule propose de noter au journal ce qu'il voit passer — dans la banque et dans les portefeuilles. Une
migration (table `crypto_proposals`, colonne `crypto_events.transaction_id`), aucun réglage nouveau.

- **Un virement vers une plateforme crypto se propose au journal.** Pécule reconnaît, au libellé de la banque, une
  opération vers Kraken, Binance, Coinbase, Crypto.com, Bitpanda, Bitvavo et une douzaine d'autres plateformes —
  ou vers la société qui encaisse pour elles —, sur tes comptes et sur les comptes communs. Il la propose en dépôt
  (ou en retrait, quand l'argent revient) au-dessus du journal de l'écran Crypto.
- **Un solde qui a bougé se propose aussi.** À chaque synchronisation, Pécule compare ce que portaient tes
  portefeuilles (adresses, exchanges) à ce qu'ils portent : de la monnaie en moins et une crypto en plus, c'est un
  achat, au prix de la monnaie dépensée ; l'inverse, une vente ; une crypto contre une autre, un échange ; la même
  crypto qui part d'un portefeuille et arrive dans un autre, aux frais près, un transfert. Ce dont l'autre bout
  n'est pas connu est proposé comme une arrivée ou un départ.
- **Rien n'est noté sans toi.** « Noter » ouvre le mouvement déjà rempli, à relire et à corriger ; « Écarter »
  retire la proposition pour de bon ; « Tout écarter » les retire toutes. Une opération bancaire que le journal
  raconte déjà — même plateforme, mêmes dates, ou une période qui les couvre — n'est pas proposée.
- **Ce qui n'est pas proposé** : les petits écarts (moins de 20 € au cours du jour, ou moins de 2 % d'une ligne :
  récompenses au fil de l'eau, poussière), un jeton sans cours, ce que porte un portefeuille le jour où tu le
  relies, et la monnaie qui bouge seule chez un exchange — c'est l'opération bancaire qui la raconte.
- **Dépôts et retraits notés** : sous le titre du journal, la somme des dépôts et celle des retraits qu'il porte.
  Ce n'est pas une plus-value : le journal ne dit pas tout ce qui a été acheté.
- **L'assistant voit les propositions** (`get_crypto_events`) et en note une avec toi (`add_crypto_event`, paramètre
  `proposal_ref`).
- **Pour celui qui héberge** : la migration `0042_propositions_crypto` crée `crypto_proposals` (les propositions
  nées d'une synchronisation, et les opérations bancaires écartées) et ajoute `crypto_events.transaction_id`.

## 1.51.0

Crypto : le journal des mouvements se tient dans Pécule, à l'écran et par l'assistant. Une migration (table
`crypto_events`), aucun réglage nouveau.

- **Le journal des mouvements s'écrit à l'écran.** Jusque-là, il ne se remplissait que par une reprise depuis un
  autre outil : un foyer qui n'en avait pas fait ne le voyait jamais. Il est maintenant affiché à tous, en bas de
  l'écran Crypto : « Ajouter un mouvement » note un achat, une vente, un transfert, une mise en staking, ce qu'elle
  rapporte — sa date, la crypto, la quantité, le montant, et si tu veux le cours, les frais, la plateforme et une
  note. Toucher un mouvement le corrige ou le retire. Le journal raconte : il ne change ni les positions ni leur
  valeur, et il reste privé à chaque membre.
- **L'assistant tient le journal.** Dis-lui ce que tu as fait : il montre le mouvement, puis l'écrit après
  « Confirmer » ; il corrige et retire de même (outils `add_crypto_event`, `update_crypto_event`,
  `delete_crypto_event`, offerts aussi par le serveur MCP).
- **Un mouvement peut attendre sa suite** : coche « En attente » pour un ordre posé et pas encore exécuté, ou un
  retrait en cours. Il reste en vue en tête du journal, même replié, jusqu'à ce que tu le complètes.
- **Un mouvement peut résumer une période** (« Sur une période ») : les récompenses d'une année, une série de
  virements — le journal n'a pas à suivre chaque ligne d'un relevé.
- **Le cours d'un achat ou d'une vente s'affiche** : celui que tu as noté, sinon le montant divisé par la quantité.
- **Les genres de mouvement sont une liste, traduite dans les cinq langues** : achat, vente, échange, dépôt, retrait,
  transfert, mise en staking, sortie de staking, récompenses, intérêts, minage, prime ou airdrop, autre. Les genres
  écrits en toutes lettres par une reprise (« Dépôt fiat », « Staking — sortie ») y sont rangés par la migration ; un
  texte qu'elle ne connaît pas est gardé tel quel.
- **Le nom d'un portefeuille relié, choisi comme plateforme, rattache le mouvement à ce portefeuille** : s'il change
  de nom, le journal suit.
- **Manuel** : un article « Tenir le journal de ses cryptos ».
- **Pour celui qui héberge** : la migration `0041_journal_crypto` ajoute au journal la fin de période, l'état, le
  cours, les frais, le portefeuille et l'origine de chaque ligne ; la référence d'une reprise
  (`POST /api/admin/import/crypto-events`) distingue désormais les lignes d'un membre, plus celles de tout le foyer,
  et la reprise accepte les nouveaux champs (`endDate`, `price`, `fee`, `status`).

## 1.50.0

Opérations sur téléphone : tous les filtres se choisissent, comme sur ordinateur. Aucune migration, aucun réglage
nouveau.

- **Une barre de filtres sous la recherche** : « À classer », « Catégorie », « Compte », « Nature », « Mois », en
  pastilles sur une seule ligne qui défile au doigt. Jusque-là, le téléphone ne proposait que « À classer » : un
  filtre par catégorie, par compte, par nature ou par mois ne pouvait y arriver que par un lien venu d'un autre écran,
  et l'on ne pouvait que le retirer. Une pastille qui filtre prend la couleur de l'appli, écrit le choix et passe en
  tête ; la toucher rouvre le choix, sa croix la retire. L'en-tête garde la même hauteur quel que soit le nombre de
  filtres.
- **Catégorie** : les catégories rangées sous leur poste, avec la couleur du poste sur l'anneau des dépenses et un
  champ de recherche — la même présentation que la fiche d'une opération. « Tout le poste » filtre sur un poste
  entier, ce qu'aucun écran ne proposait. Rouverte sur un filtre en cours, la feuille s'ouvre à sa hauteur.
- **Mois** : les douze mois de l'année, chacun avec le nombre d'opérations qu'il garde avec les autres filtres en
  cours, l'année entière au-dessus, et les années précédentes tant qu'elles ont des opérations. Un mois vide ou à
  venir ne se choisit pas.
- **Compte** et **Nature** : une liste, avec le logo de la banque ou l'icône de la nature ; un compte sorti des
  statistiques le dit.
- **Appui long sur une ligne** : le menu propose aussi de filtrer la liste sur la catégorie, la nature ou le mois de
  l'opération, comme le clic droit sur ordinateur.

## 1.49.4

Opérations : le filtre par catégorie distingue deux catégories de même nom. Aucune migration, aucun réglage nouveau.

- **Le filtre « Catégorie » de l'écran Opérations range les catégories sous leur poste**, comme la liste du classement
  proposé par l'IA. Jusque-là il n'écrivait que leur nom : deux catégories de même nom — un revenu et une dépense —
  s'y confondaient, et choisir la première venue pouvait donner une liste vide alors que les opérations étaient
  rangées dans l'autre.

## 1.49.3

Relevés de compte : les achats par carte retrouvent leurs catégories. Aucune migration, aucun réglage nouveau.

- **Un achat par carte écrit « CB marchand FACT jjmmaa »** (la forme de certaines banques sur leurs relevés) est
  gardé sous la forme que Pécule connaît, « Carte jj mm aa Marchand ». Jusque-là, un historique repris par ses
  relevés gardait le libellé brut : aucune règle de classement ni aucune catégorie déjà donnée au même marchand ne
  s'y appliquait, l'opération passait pour un prélèvement, et la recherche du paiement d'une facture ne la
  reconnaissait pas. Vaut pour les relevés validés à partir de cette version ; pour un relevé déjà validé, « Annuler
  la validation » puis « Valider » réécrit ses opérations.

## 1.49.2

Relevés de compte : deux corrections tirées d'une vraie reprise d'historique (une cinquantaine de relevés, trois
comptes). Aucune migration, aucun réglage nouveau.

- **Un même compte n'est plus coupé en deux séries** quand le nom de la banque est lu de deux façons d'un relevé à
  l'autre — avec ou sans sa région, avec ou sans accent. L'encadré « Relevés de compte : la série » annonçait alors de
  faux relevés manquants, le compte choisi pour un relevé n'était pas reporté à toute la série, et un relevé déposé
  plus tard pouvait ne pas retrouver le compte créé par les premiers.
- **Un relevé ne se range plus d'un coup dans le compte d'un autre.** Quand le compte proposé porte un autre numéro
  que le relevé — dans son nom (« •••• 1234 ») ou son identifiant —, la fiche le montre comme un écart : le relevé
  n'est plus « sûr » et demande un regard. L'IA reçoit aussi le titulaire de chaque compte, et la consigne de ne
  retenir aucun compte que son numéro ou son titulaire contredit : dans un foyer où deux membres ont le même livret
  dans la même banque, elle proposait parfois celui de l'autre.
- **Un livret ou un plan imprimé sur un relevé mensuel** garde la période de ses propres soldes (un trimestre, une
  année) au lieu de celle du relevé : ses opérations ne sortent plus de « la période du relevé », contrôle qui
  demandait jusque-là une correction à la main.

## 1.49.1

Pécule a son appli pour Mac : sur un Mac à puce Apple, une commande l'installe, et tout — l'appli, sa base, tes
données — reste sur l'ordinateur, sans serveur à tenir ni Docker. Rien ne change pour une installation sur un
serveur. Aucune migration ; un réglage nouveau, facultatif (`LISTEN_HOST`).

- **L'appli pour Mac** (puce Apple, macOS 14 ou plus récent) : dans le Terminal,
  `curl -fsSL https://github.com/Enki-Engineer/pecule/releases/latest/download/pecule-mac.sh | sh`. Elle embarque
  Pécule, Node.js et MySQL — rien d'autre à installer —, crée sa base à la première ouverture et te demande ton
  prénom. Elle convient à qui suit ses finances depuis un seul Mac ; pour le téléphone ou une autre machine, il faut
  toujours un Pécule sur un serveur. Le guide : `docs/guide/appli-mac.md`.
- **Y entrer** : par un mot de passe, si tu en choisis un ; sans lui, Pécule s'ouvre sur cet ordinateur sans rien
  demander. Mot de passe oublié : menu Aide → « Mot de passe oublié… ». Les écrans y parlent de « cet ordinateur »
  et du menu de l'appli, jamais d'un serveur ni d'une commande.
- **Relier sa banque** : l'accord se donne dans une fenêtre à part, dont le titre dit chez qui tu es, et qui se
  referme d'elle-même. L'adresse de retour à déclarer chez Enable Banking est celle que l'appli affiche
  (`https://localhost:<port>/reglages/comptes`) : personne ne la sert, l'appli la reconnaît et reprend la main.
- **Mettre à jour** : menu Pécule → « Rechercher une mise à jour… ». L'appli télécharge la version, vérifie sa
  signature, se remplace et se rouvre ; une archive qui ne vient pas du projet est refusée.
- **Fermer n'est pas quitter** : la fenêtre fermée, l'appli reste dans le Dock et continue de synchroniser ;
  « Quitter Pécule » arrête tout, base comprise. Un lien extérieur s'ouvre dans ton navigateur, un document ou une
  facture dans une fenêtre de l'appli, un téléchargement dans le dossier Téléchargements.
- **Ce qu'elle n'a pas** : les notifications, la clé d'accès, l'accès depuis un téléphone. Tes données ne sont que
  sur ce Mac : les sauvegardes de Pécule (Réglages → Compte et sécurité) et leur copie hors de l'ordinateur y
  prennent toute leur importance. Une sauvegarde complète se restaure d'une appli à un serveur, et l'inverse.
- **Sécurité** : rien ne sort de la machine — Pécule n'écoute que sur `127.0.0.1` et ne répond qu'à ce nom, sa base
  n'a aucun port. Le compte du Mac est la seule frontière : sur un compte partagé à plusieurs, « privé » ne protège
  de personne (`SECURITY.fr.md`, « L'appli pour Mac »). L'appli n'est pas signée par un compte Apple : installée par
  la commande, elle se lance sans que macOS s'y oppose ; téléchargée par un navigateur, il faut l'autoriser dans
  Réglages Système → Confidentialité et sécurité.
- **Pour qui héberge un serveur** : `LISTEN_HOST=127.0.0.1` attache le serveur à la machine seule (un Pécule que
  seul un proxy de la même machine joint) ; sans ce réglage, rien ne change. Un serveur dont le port est déjà pris
  le dit dans son journal, au lieu de s'y déclarer « à l'écoute ».
- **Sous le capot** : l'appli est l'archive prête à l'emploi avec Node.js 24 et MySQL 8.4 fournis, épinglés par leur
  empreinte (`bureau/pieces.json`). Un superviseur (`scripts/bureau.mjs`) fait tout ce qui n'est pas la fenêtre —
  dossier des données, réglages, base sans port, serveur — et se lance aussi seul ; la fenêtre est une coque Tauri 2,
  à qui la page de Pécule ne peut rien demander. Quatre essais rejouables sans personne devant l'écran
  (`bureau/essais/`), dont la recette dans la vraie fenêtre et une mise à jour de bout en bout, tournent sur une
  machine Mac avant chaque publication (`.github/workflows/bureau.yml`). Deux relectures de sécurité indépendantes
  ont précédé l'envoi.

La 1.49.0 portait déjà tout cela, mais n'a pas été publiée : sa publication s'est arrêtée avant de créer la version
(l'étape qui signe l'appli ne recevait pas sa clé). Cette version corrige cette étape et rien d'autre.

## 1.49.0

Non publiée : son contenu est celui de la 1.49.1.

## 1.48.0

Le premier lancement ne bute plus sur la clé d'accès : on entre d'abord, l'écran dit pourquoi une clé ne peut pas se
créer, et un mot de passe la remplace là où il le faut — Pécule s'installe aussi sur le réseau de la maison, en http.
Une migration (table `passwords`) ; un réglage nouveau, facultatif, pour Docker (`PECULE_BIND`).

- **Premier démarrage** : le prénom donné, tu es connecté. L'écran suivant propose de protéger ton accès — une clé
  d'accès, un mot de passe, ou plus tard — sans que ce choix te barre l'entrée. Avant, une clé d'accès qui ne se
  créait pas laissait devant « Opération annulée. », sans avoir vu l'appli.
- **Pourquoi la clé d'accès ne se crée pas** : l'écran le dit avant que tu essaies — la page n'est pas ouverte à
  l'adresse de l'installation (`127.0.0.1` au lieu de `localhost`, par exemple : il donne le lien de la bonne),
  l'adresse est une adresse IP, ou en http hors de `localhost` — et après un refus, il distingue ce que tu as annulé
  de ce que le navigateur a refusé de lui-même, certificat non reconnu compris.
- **Mot de passe** : un membre peut en choisir un, à l'inscription ou dans Réglages → Compte et sécurité (douze
  caractères au moins, une phrase convient). Il se connecte alors avec son prénom et lui. La clé d'accès reste
  proposée d'abord ; les deux peuvent coexister. Cinq mots de passe faux de suite ferment la connexion par mot de
  passe de ce membre une minute, puis jusqu'à quinze. Un mot de passe oublié se remplace par un lien d'inscription,
  que donne l'administrateur — ou, pour lui-même, le serveur : `node scripts/lien.mjs --membre <prénom>`.
- **Exiger la clé d'accès** (administrateur, Réglages → Compte et sécurité) : sur une installation en https où
  chacun a sa clé, plus aucun mot de passe n'est accepté. Rien ne change pour une installation existante tant que
  personne ne choisit de mot de passe.
- **Sur le réseau de la maison, en http** : Pécule s'installe à l'adresse d'une machine du réseau
  (`http://192.168.1.20:3000`) et s'ouvre depuis une autre — le cas d'un serveur de la maison ou d'un NAS. On s'y
  connecte par mot de passe ; tout y circule en clair sur ce réseau, ce que l'écran rappelle. Les boutons « Copier »
  y marchent aussi. En http sur une adresse publique, l'installation reste refusée.
- **Pour celui qui héberge** : `scripts/setup.mjs` accepte une adresse du réseau de la maison et dit comment on s'y
  connectera (`signIn` : `cle` ou `mot-de-passe`) ; `doctor` le dit aussi, et signale une adresse IP. Avec Docker,
  `PECULE_BIND=0.0.0.0` publie le port sur le réseau de la maison (sans lui, comme avant : la machine seule). Les
  consignes des agents (`AGENTS.md`), le guide d'installation et la compétence demandent désormais d'où Pécule sera
  ouvert, et interdisent le certificat autosigné et l'adresse IP « pour que la clé marche ».
- **Sécurité** : la connexion par mot de passe et le premier démarrage n'acceptent qu'une demande venue de l'adresse
  de l'installation ; l'empreinte gardée est un scrypt (2^15, 8, 3) avec son sel ; chaque essai est compté avant
  d'être vérifié, pour que des demandes simultanées ne passent pas sous l'arrêt ; changer de mot de passe redemande
  l'actuel — y compris par un lien qu'on se donne soi-même — et ferme les autres sessions, comme le retirer ou exiger
  la clé d'accès ; « Couper ses accès » efface aussi le mot de passe ; aucun mot de passe, actuel compris, ne s'écrit
  au journal.

## 1.47.2

La démo ne nomme plus aucun assureur réel, son écran Retraite compare trois familles de simulations, et la page du
projet dit comment le soutenir. Aucune migration, aucun réglage nouveau.

- **Mode démo, assureurs** : les trois derniers assureurs réels de la famille fictive — assurance habitation,
  assurance du studio, mutuelle santé — deviennent « Galerne », « Valmire » et « Mutuelle Nérine », trois noms
  fictifs, dans les opérations, le budget, le coffre et les règles de classement. La démo se recrée seule : rien à
  faire.
- **Mode démo, retraite** : l'écran Retraite d'Alex montre, à côté des simulations officielles, une carrière complète
  et un arrêt à 55 ans (FIRE), âge par âge. Ses chiffres clés sont justes — 68 trimestres sur 172, taux plein à
  67 ans, départ au plus tôt daté : ils affichaient « 0 / 172 » et « Taux plein à ? ans », les faits de la démo ne
  portant pas les libellés que l'écran lit.
- **Page du projet** : le README, dans ses cinq langues, détaille à part l'analyse, la paie, les impôts et la
  retraite, et gagne une rubrique « Soutenir Pécule » avec deux adresses de dons (Bitcoin, Ethereum). Le dépôt porte
  un bouton « Sponsor » (`.github/FUNDING.yml`).

## 1.47.1

La démo ne nomme plus d'assureurs réels, et la page du projet se lit en cinq langues. Aucune migration, aucun
réglage nouveau.

- **Mode démo** : le contrat d'assurance auto de la famille fictive et le devis à lui comparer portaient les noms de
  deux assureurs réels, avec des prix et des garanties inventés. Ils s'appellent désormais « Orvane » et « Mutuelle
  Lisière », deux noms fictifs — dans le coffre, le budget, les opérations et les réponses de l'assistant. La démo se
  recrée seule : rien à faire.
- **Page du projet** : le README existe aussi en allemand, en italien et en espagnol, avec les écrans de l'appli
  dans chaque langue ; il présente la personnalisation (couleurs, thèmes de l'année, équivalences amusantes) et le
  serveur MCP. La politique de sécurité, le guide de contribution et le code de conduite sont en anglais par
  défaut, leur version française à côté (`SECURITY.fr.md`, `CONTRIBUTING.fr.md`, `CODE_OF_CONDUCT.fr.md`).

## 1.47.0

L'assistant s'arrête et se relance, une conversation s'exporte, et un écran qui tombe laisse une trace. Aucune
migration, aucun réglage nouveau.

- **Arrêter une réponse de l'assistant** : pendant qu'il écrit, le bouton d'envoi devient « Arrêter la réponse ».
  Ce qui est déjà écrit reste dans la conversation, l'appel à l'IA est coupé, et « Relancer » repose la même
  question. Fermer l'écran n'arrête toujours rien : la réponse se termine et t'attend dans la conversation. Le coût
  d'une réponse arrêtée est estimé d'après ce qui était écrit : le fournisseur ne le dit qu'en fin de réponse.
- **Exporter une conversation** : dans l'historique, « Exporter en texte » télécharge la conversation — questions,
  réponses, actions et ce qu'elles sont devenues —, dans ta langue et sans les marques de mise en forme, comme
  « Copier ».
- **Un écran qui ne s'affiche pas laisse une alerte** : « Cet écran n'a pas pu s'afficher », ou une erreur que rien
  n'attrapait, arrive dans Réglages → Suivi technique avec l'écran concerné. « Voir le détail » donne de quoi
  chercher, et dit si l'appareil tournait sur la version en service ou sur une version d'avant. L'erreur ne va qu'au
  serveur de ton installation, sans le contenu de l'écran ni les paramètres de l'adresse. Le détail des autres
  alertes s'ouvre de la même façon.
- **Réseaux sans IPv4** (DNS64, NAT64) : depuis un tel réseau, les sites publics n'étaient plus joignables — logos
  introuvables, fournisseur d'IA ou assistant extérieur refusés. Pécule juge désormais l'adresse IPv4 que porte une
  adresse traduite par le réseau ; le réseau privé reste hors d'atteinte par ce chemin.

## 1.46.2

Correctifs. Aucune migration, aucun réglage nouveau.

- **Le bas du menu reste visible** sur un écran peu haut (un portable de 13 pouces) : l'assistant, la visite guidée,
  le manuel, les réglages et « Replier » ne demandent plus de faire défiler le menu. Quand tout ne tient pas, ils se
  resserrent en une rangée d'icônes, et ce sont les groupes d'écrans qui défilent au-dessus.
- **Comparer deux périodes fonctionne sur MySQL 8** : la comparaison de l'Analyse y répondait « Erreur interne ».
  MariaDB n'était pas touché.
- **Recherche** : à égalité de jour, elle rend toujours les mêmes lignes dans le même ordre, et le jour d'une
  opération y est celui de la liste des opérations (jour d'achat ou jour du débit, selon le réglage du foyer). La
  liste des opérations et la recherche de documents ne peuvent plus répéter ni sauter une ligne d'une page à l'autre.
- **Mini-courbe « Disponible »** : son premier point n'apparaît plus et ne disparaît plus d'un chargement à l'autre.
- Un identifiant mal formé dans une adresse reçoit « Données invalides » au lieu d'une erreur interne.
- Accessibilité : le bouton de recherche et les compteurs du menu portent un nom qui contient ce qu'ils affichent.
- Côté dépôt : les contrôles automatiques appellent chaque lecture — routes et outils de l'assistant — sur
  MariaDB 10.6 et sur MySQL 8.4 (`scripts/sonde-lectures.mjs`) ; une option dépréciée de la construction du serveur
  est remplacée.

## 1.46.1

Crypto : l'écran s'ouvre de nouveau partout, et la courbe monte en tête.

- **Correctif** : après la mise à jour 1.46.0, l'écran Crypto pouvait rester sur « Cet écran n'a pas pu
  s'afficher ». L'appareil gardait la réponse de la version d'avant, sans l'historique que la courbe lit, et
  « Recharger » la relisait. La courbe s'en passe désormais, le temps que la réponse soit rafraîchie.
- **« Recharger » répare** : sur l'écran d'erreur, le bouton oublie d'abord les données gardées sur l'appareil
  (elles sont rechargées depuis le serveur) : une donnée gardée sous une ancienne forme ne peut plus enfermer un
  écran dans son message d'erreur.
- **« Évolution » en tête de l'écran Crypto**, sous le total et avant la liste « Par crypto » et la répartition.

Aucune migration, aucun réglage nouveau.

## 1.46.0

Crypto : la valeur du portefeuille dans le temps.

- **« Évolution », en bas de l'écran Crypto** (téléphone et ordinateur) : une courbe de la valeur de tes cryptos,
  un point par jour, sur un mois, trois mois, six mois ou depuis le début, avec l'écart sur la période. Les points
  viennent des instantanés quotidiens du patrimoine : la courbe remonte donc aussi loin qu'eux, sans rien à
  régler. Le dernier point est la valeur à l'instant, celle affichée en tête d'écran. Un portefeuille ajouté ou
  retiré fait bouger la courbe comme un achat ou une vente.
- Répartition : plus de « NaN % » quand aucune crypto n'a encore de cours.

Aucune migration, aucun réglage nouveau.

## 1.45.0

Crypto : SwissBorg par son relevé, des logos partout, les lignes archivées se suppriment.

- **SwissBorg, par son relevé de compte** : « Ajouter un portefeuille → Une appli, par son export » propose
  désormais Crypto.com et SwissBorg. Le relevé « Account Statement » de SwissBorg (classeur Excel) se dépose tel
  quel : dépôts, retraits, achats, ventes et versements de rendement donnent le solde de chaque crypto, un
  mouvement déjà connu n'est jamais compté deux fois. Un genre de ligne que Pécule ne connaît pas n'est pas
  deviné : il est laissé de côté et signalé. Pécule lit le classeur lui-même, sans paquet nouveau.
- **Un logo pour chaque provenance** : Bitpanda, Bitvavo, OKX, Bybit, KuCoin, Bitget, SwissBorg, Trezor et
  Phantom rejoignent les marques reconnues ; un portefeuille lu par son adresse et nommé librement prend le logo
  de sa blockchain plutôt que des initiales ; chaque compartiment de la liste (« Par leur adresse »,
  « Exchanges », « Par leurs exports », « Via CoinStats », « Saisis à la main ») porte son pictogramme, le même
  que dans « Ajouter un portefeuille ».
- **Lignes saisies à la main archivées** : chacune se supprime pour de bon par sa corbeille. Après un dépôt de
  fichier, Pécule signale la ligne saisie à la main qui ferait doublon, comme il le fait pour une adresse.

Aucune migration, aucun réglage nouveau.

## 1.44.0

Crypto : voir ce que porte chaque portefeuille, lire un jeton rare, corriger un export incomplet.

- **Les cryptos d'un portefeuille ressortent** : touche un portefeuille ou un exchange dans la liste, et ses cryptos
  sont mises en avant dans « Par crypto » — fond teinté, filet de couleur, et « dont … ici » quand la crypto est
  aussi ailleurs. Un bandeau dit le portefeuille choisi, combien de cryptos il porte et pour quelle valeur ;
  « Tout afficher » revient à la liste entière. Sur téléphone, ses cryptos passent en tête de liste. Vaut aussi
  pour les lignes saisies à la main.
- **Jetons rares d'une adresse Ethereum** : en plus des jetons courants de sa table, Pécule demande à un
  explorateur public (Blockscout, sans clé) tous les jetons de l'adresse, sur Ethereum et Optimism. Il ne garde
  qu'un jeton au cours et à la capitalisation connus, que l'explorateur ne dit pas frauduleux, et qui vaut plus
  d'un centime : les jetons déposés pour appâter n'entrent pas. Si l'explorateur ne répond pas, les jetons trouvés
  la fois d'avant sont gardés. Les explorateurs de Base, d'Arbitrum et de Polygon refusent les programmes : ces
  chaînes se lisent par la table seule, comme avant.
- **« Corriger un solde »** pour un portefeuille tenu par ses exports (le crayon de sa ligne) : l'export d'une
  appli a parfois un trou — celui de l'appli Crypto.com ne contient pas les récompenses « Supercharger » de 2021.
  On relève le solde que l'appli affiche pour une crypto : Pécule part de lui, et les mouvements des exports
  déposés ensuite s'y ajoutent, sans rien compter deux fois. Un solde constaté se retire ; la liste dit lesquels
  sont en place et depuis quand.
- Vérifié sur un vrai compte Crypto.com, soldes de l'appli en regard : là où l'export est complet, le calcul de
  Pécule tombe juste ; les écarts viennent des récompenses reçues depuis le dernier export et du trou de 2021.

Aucune migration, aucun réglage nouveau. La lecture des jetons rares interroge deux services de plus
(`eth.blockscout.com`, `explorer.optimism.io`), avec la seule adresse publique du portefeuille.

## 1.43.1

Coinbase : la marche à suivre suit le portail d'aujourd'hui.

- **Créer la clé Coinbase** : le portail range désormais les clés sous « Settings → API Keys », le bouton s'appelle
  « Create secret API key » et le droit de lecture « Read ». Les trois étapes affichées à l'ajout d'un compte
  Coinbase le disent ainsi, dans les cinq langues. Rien ne change pour un compte déjà relié.
- Le connecteur Coinbase a été lu sur un vrai compte (clé ECDSA, droit « Read » seul) : après Kraken et Binance,
  c'est le troisième des onze exchanges vérifié ainsi. Les huit autres restent à confirmer ; un écart se signale
  sur le dépôt.

Aucune migration, aucun réglage nouveau.

## 1.43.0

Crypto : la liste des portefeuilles dit d'où vient chacun, et trois blockchains de plus se lisent sans intermédiaire.

- **Portefeuilles rangés par provenance** (téléphone et ordinateur) : « Par leur adresse », « Exchanges », « Par
  leurs exports », « Via CoinStats », « Saisis à la main », chacun dans son compartiment, avec son total. On voit
  d'un coup d'œil ce qui dépend de quoi — et ce qu'il reste à un agrégateur. Les portefeuilles qui ne comptent rien
  (vides, en double, ou déjà comptés par une lecture directe) se replient.
- **Cardano** : une adresse du portefeuille suffit (addr1… ou stake1…) ; Pécule en tire l'adresse de staking et lit
  le solde de tout le portefeuille, récompenses comprises. Les jetons natifs ne sont pas lus.
- **MultiversX** : une adresse est désormais lue en entier — EGLD du portefeuille, EGLD délégués et jetons, au cours
  que donne MultiversX. Une adresse déjà suivie pour son seul staking devient un portefeuille entier quand on
  l'ajoute de nouveau, sans rien compter deux fois.
- **VeChain** : ses adresses ont la forme de celles d'Ethereum ; une adresse 0x… y est lue aussi (VET et VTHO).
- **Jetons** : deux cents jetons par chaîne au lieu de cent vingt, et les jetons enveloppés ou de staking liquide
  entrent dans la table fabriquée (il n'en reste que treize tenus à la main, les versions pontées).
- **Doublons** : une seule crypto commune suffit à proposer « Compté deux fois ? » quand sa quantité n'a rien de
  rond.

Pour celui qui héberge : aucune migration, aucun réglage nouveau. Le serveur interroge en plus, pour les seules
adresses ajoutées, api.koios.rest (Cardano), api.multiversx.com (déjà employé) et mainnet.vechain.org.

## 1.42.0

Crypto : les doublons se signalent d'eux-mêmes, quel que soit l'outil, et les jetons enveloppés ou de staking
liquide sont enfin lus à une adresse.

- **« Compté deux fois ? »** remplace l'encart « Déjà suivi dans CoinStats ? ». Quand une source que tu as reliée
  toi-même (adresse, exchange, export) et une source venue d'un autre outil portent les mêmes cryptos pour les mêmes
  quantités, Pécule le signale — à l'ajout et dans l'écran, donc aussi pour ce qui était déjà relié. « Ne compter
  qu'une fois » garde ta lecture directe, crypto par crypto, et laisse à l'autre source ce qu'elle est seule à voir ;
  « Ce sont deux portefeuilles » fait taire la question. La règle ne dépend pas de l'outil : elle vaudra telle
  quelle pour un autre agrégateur que CoinStats. Un compte que l'agrégateur découpe en plusieurs portefeuilles
  (spot, financement…) se règle portefeuille par portefeuille.
- **Jetons enveloppés et staking liquide** : stETH, wstETH, WBTC, WETH, cbETH, rETH, weETH, cbBTC sur Ethereum et
  leurs équivalents sur les autres chaînes, JitoSOL et mSOL sur Solana. La table des jetons, tirée du classement de
  CoinGecko, les ignorait : ce classement les écarte, alors qu'ils sont parmi les plus détenus. Vingt-neuf contrats,
  chacun vérifié à part.
- **Binance** : une épargne souple que l'API d'épargne ne cite pas est comptée par son reçu du compte spot (et
  jamais deux fois) ; l'épargne bloquée a sa propre ligne.

Pour celui qui héberge : migration `0039_sources_crypto_remplacees` (une colonne élargie). Aucun réglage nouveau.

## 1.41.0

Crypto : plus de voie privilégiée. CoinStats devient une façon parmi d'autres de relier ce qu'on a, sept exchanges
s'ajoutent, et l'appli Crypto.com entre par ses exports.

- **« Ajouter un portefeuille » commence par un choix** : un portefeuille par son adresse publique, un exchange par
  une clé en lecture seule, l'appli Crypto.com par son export, ou un compte CoinStats. Aucune n'est la voie
  « normale » ; elles se combinent.
- **Le bouton s'appelle « Synchroniser »** et relit tout ce qui est relié, d'où que cela vienne. L'écran ne parle
  plus de CoinStats que là où il sert : une source parmi les autres, avec sa mention « Powered by CoinStats ».
- **Sept exchanges de plus** par clé en lecture seule : Bitvavo, OKX, Bybit, KuCoin, Bitget, Bitfinex et Crypto.com
  Exchange — onze en tout. OKX, KuCoin et Bitget demandent aussi la phrase de passe de la clé. Bybit et Bitfinex
  disent les droits d'une clé : celle qui peut faire plus que lire est refusée. OKX et Bybit ont un site par
  région : Pécule essaie chacun tant que la clé y est inconnue.
- **L'appli Crypto.com, qui n'a pas de clé d'API**, se suit par les fichiers de son historique (« Crypto Wallet »,
  CSV) : le solde de chaque crypto est la somme de ses mouvements. Les fichiers se déposent dans n'importe quel
  ordre, un mouvement déjà connu n'est jamais recompté, ce qui est immobilisé dans l'appli (staking, carte,
  « Earn ») reste compté, et un solde négatif signale un fichier manquant. L'export du portefeuille en monnaie est
  reconnu et refusé (ses achats figurent déjà dans l'autre). Le fichier lui-même n'est pas gardé.
- Les cryptos reconnues par leur symbole passent des cinq cents aux mille mieux capitalisées.

À savoir : comme pour la 1.40.0, les connecteurs d'exchange sont écrits d'après les documentations et le code
d'outils libres qui les lisent déjà ; chacun refuse bien une fausse clé, aucun n'a encore été lu sur un vrai compte.
Pour l'appli Crypto.com, le calcul a été rejoué sur de vrais exports : il s'accorde avec un autre outil pour une
partie des cryptos et s'en écarte pour d'autres, sans qu'on sache encore lequel a raison — compare les soldes à
ceux de l'appli après un dépôt.

Pour celui qui héberge : migration `0038_mouvements_crypto_par_fichier` (une table). Aucun réglage nouveau, aucun
paquet nouveau. Le serveur interroge l'API de chaque exchange relié, et rien d'autre de nouveau.

## 1.40.0

Un compte chez un exchange se relie par une clé d'API en lecture seule : Kraken, Binance, Coinbase, Bitpanda.

- **« Ajouter un portefeuille » a un second onglet, « Compte d'exchange »** (téléphone et ordinateur) : on choisit
  l'exchange, Pécule dit en trois étapes où créer la clé et quoi cocher, lit le compte tout de suite, puis chaque
  jour, sans intermédiaire. Chaque membre relie les siens ; ils n'apparaissent que chez lui.
- **Lecture seule, et contrôlée** : la clé montre les soldes, elle ne peut ni vendre ni retirer. Binance, Coinbase et
  Bitpanda disent les droits d'une clé : Pécule refuse celle qui peut faire plus que lire. Kraken ne les dit pas : le
  guide fait cocher la seule consultation des fonds. La clé est gardée chiffrée, n'est plus jamais affichée, et
  n'entre ni dans le journal ni dans un message d'erreur.
- **Ce qui est lu** : Kraken — les soldes, staking et récompenses compris ; Binance — compte spot, portefeuille de
  financement, épargne souple et bloquée ; Coinbase — tous les comptes de l'appli ; Bitpanda — cryptos et monnaie,
  par sa nouvelle API (l'ancienne ferme le 31 janvier 2027). Les contrats à terme ne sont pas lus.
- **Valorisation** : une crypto reconnue par son symbole suit le cours CoinGecko ; le cours de l'exchange lui-même
  vaut pour ce que CoinGecko ne suit pas, et dément la table quand deux cryptos portent le même symbole ; l'euro ou
  le dollar laissés sur le compte comptent à leur cours de change.
- **Clé refusée** : si l'exchange n'accepte plus la clé (expirée — une clé Bitpanda vaut un an —, retirée, droits
  changés), le compte le dit et garde ses quantités ; on le retire et on le relie avec une nouvelle clé.
- Comme pour une adresse : « déjà suivi dans CoinStats » évite le double compte, et la ligne saisie à la main du
  même symbole est signalée.

À savoir : les quatre connecteurs sont écrits d'après les documentations officielles. Les signatures sont
vérifiées contre les exemples chiffrés de Kraken et de Binance, le jeton de Coinbase par sa clé publique, les
réponses contre les exemples publiés, et chaque exchange refuse bien une fausse clé ; aucun n'a encore été lu sur
un vrai compte. Un écart se signale sur le dépôt.

Pour celui qui héberge : aucune migration, aucun réglage nouveau, aucun paquet nouveau. Le serveur interroge
api.kraken.com, api.binance.com, api.coinbase.com et api.public.bitpanda.com pour les seuls comptes reliés. Binance
ne répond pas aux serveurs de certains pays (États-Unis notamment).

## 1.39.1

Correctif de confidentialité, à installer si la 1.39.0 l'a été.

- **L'adresse collée à l'ajout d'un portefeuille crypto n'entre plus au journal des écritures.** La 1.39.0 l'y
  inscrivait telle quelle — y compris la clé publique étendue d'un compte Bitcoin, que Pécule garde par ailleurs
  chiffrée. Ce journal ne quitte pas l'installation et se lit dans Réglages → Suivi technique (chacun ses écritures,
  l'administrateur celles du foyer) : la clé d'un membre pouvait donc y être lue par l'administrateur. L'ajout
  s'y inscrit désormais par son genre et son nom seulement.
- Ce que la 1.39.0 a pu y écrire est effacé au démarrage (migration `0037_journal_sans_adresse_crypto`). Une clé
  étendue ne permet pas de dépenser : elle montre les adresses et les soldes d'un compte.
- Le nombre de lignes annoncé après une synchro ne compte plus celles d'un portefeuille CoinStats en double.

Aucun réglage nouveau.

## 1.39.0

Un portefeuille crypto se suit par son adresse publique : plus besoin d'un compte CoinStats, ni d'aucune clé.

- **Ajouter un portefeuille** (écran Crypto, téléphone et ordinateur) : on colle l'adresse, Pécule reconnaît la
  blockchain, montre ce qu'il a trouvé, puis relit le portefeuille chaque jour, sans intermédiaire. Chaque membre
  ajoute les siens ; ils n'apparaissent que chez lui.
- **Ce qui est lu** : Bitcoin par une adresse ou par la clé publique étendue d'un compte (xpub, ypub, zpub — un
  Ledger ou un Trezor change d'adresse à chaque réception, la clé les couvre toutes, dans les quatre formes
  d'adresse) ; Ethereum et huit chaînes compatibles par une seule adresse (Base, Arbitrum, Optimism, Polygon, BNB
  Chain, Avalanche, Gnosis, Linea : la monnaie de chaque chaîne et les jetons les plus courants) ; Solana
  (portefeuille, staking, jetons courants) ; et, comme avant mais désormais à l'écran, les EGLD délégués sur
  MultiversX et un validateur Ethereum.
- **Garde-fous** : une adresse publique ne permet que de lire ; une phrase de récupération ou une clé privée collée
  par erreur est reconnue et refusée avant tout envoi ; une adresse mal recopiée est refusée par sa somme de
  contrôle ; si la blockchain ne répond pas un jour, les quantités de la veille sont gardées.
- **Pas de double compte** : à l'ajout, on peut dire que le portefeuille est déjà suivi dans CoinStats (ses cryptos
  n'y sont plus comptées), et Pécule signale la ligne saisie à la main qui ferait doublon, à archiver d'un geste.
- Un portefeuille ajouté se décoche ou se retire ; « Relire les portefeuilles » les relit sans attendre. CoinStats
  reste possible à côté et rien ne change pour une installation qui s'en sert. Un exchange ne se lit pas par une
  adresse : CoinStats ou la saisie à la main, comme avant.
- Ce qui n'est pas lu : les jetons rares (hors des quelque 680 contrats les mieux capitalisés), les NFT et les
  dépôts dans un protocole.

Pour celui qui héberge : aucune clé ni réglage nouveau. Le serveur interroge des services publics, en lecture, par
des adresses écrites dans le code : blockchain.info (Bitcoin ; blockstream.info et mempool.space en secours), des
nœuds publics pour Ethereum et ses chaînes (publicnode, 1rpc, nœuds officiels) et le nœud public de Solana. Ils
reçoivent les adresses publiques ajoutées, rien d'autre. Migration `0036_sources_crypto_directes` (une colonne :
la clé étendue d'un compte Bitcoin, gardée chiffrée). Quatre paquets nouveaux à l'exécution, pour dériver les
adresses d'un compte : `@scure/bip32`, `@scure/base`, `@noble/curves`, `@noble/hashes`.

## 1.38.3

Mise à jour des dépendances et des outils de fabrication. Rien ne change dans l'usage ; aucune migration, aucun
réglage nouveau.

- **Lecture des PDF** (unpdf 2.2, moteur PDF.js 6.5) : des mots que l'ancienne version coupait par une espace en
  trop sont recollés (« 4, 5 » redevient « 4,5 ») ; le texte gardé au coffre, celui de la recherche et celui que lit
  l'IA sont un peu plus justes pour les documents déposés désormais. Le reste est inchangé : mêmes pages, même
  durée, mêmes refus (PDF abîmé, au-delà de 400 pages).
- **IA** (SDK Anthropic 1.11, que le client Foundry partage) : une demande d'outil dont le contenu n'est pas du
  JSON valide est refusée au lieu d'être « réparée » en silence — l'ancienne version pouvait lire 123 là où le
  modèle avait écrit « 12 3 ». Les réponses se lisent comme avant.
- **Écran** (React Router 8.5.2, TanStack Query 5.108, Recharts 3.11, Lucide 1.77, tailwind-merge 3.7.1) : l'icône
  de l'échéancier est légèrement redessinée ; rien d'autre ne bouge.
- Côté dépôt : les actions des flux GitHub passent à leurs versions majeures courantes (checkout 7, setup-node 7,
  pnpm/action-setup 6, actions Docker 4, 6 et 7, attestation de provenance 4), toujours épinglées par l'empreinte de
  leur commit. Le flux de publication garde ses permissions et reste sans cache : il refuse en toutes lettres le
  cache de dépendances et l'inscription aux « artefacts liés » que ces versions font d'office.

## 1.38.2

Une commande pour installer Pécule sans Docker. Rien ne change dans l'appli ; aucune migration, aucun réglage
nouveau.

- **`npm create pecule`** télécharge l'archive prête à l'emploi de la dernière version, contrôle son empreinte et la
  déplie dans `./pecule`, puis affiche les trois commandes qui suivent (réglages, serveur, lien du premier
  démarrage). Il faut Node.js 24 et une base MariaDB ou MySQL vide. Le paquet npm `create-pecule` ne contient que cet
  installateur : l'appli vient toujours de la version publiée sur GitHub.
- Les README, le guide d'installation, la marche à suivre des agents (`AGENTS.md`), la compétence et le tableau
  « Installer ou mettre à jour » des notes de version annoncent cette commande. L'archive se prend toujours à la
  main (`pecule.tar.gz`, `pecule.zip`) pour qui n'a pas npm.

## 1.38.1

Pécule est public. Rien ne change dans l'appli ; aucune migration, aucun réglage nouveau.

- **Le dépôt est ouvert**, sous licence AGPL-3.0 : le code, les versions et leurs fichiers se lisent et se
  téléchargent sans compte — la marche à suivre des agents (`AGENTS.md`), le fichier `compose.yaml`, l'archive prête
  à l'emploi et leurs empreintes.
- **La provenance d'une version se vérifie.** À partir de celle-ci, l'archive, `compose.yaml` et l'image portent une
  attestation signée : elle prouve qu'ils ont été fabriqués par le flux de publication du projet, à partir du commit
  de la version (`gh attestation verify`, guide de mise à jour). Les versions d'avant n'en ont pas.
- Les captures du README sont celles de la version en service.
- Côté dépôt : recherche de secrets et blocage à l'envoi, signalement privé des failles, branches `main` et `stable`
  sans poussée forcée ni suppression, étiquettes de version qui ne se déplacent pas.

## 1.38.0

Dans un foyer où chacun garde ses comptes hors des statistiques de l'autre, les dépenses du compte commun étaient
comptées, mais pas l'argent que l'autre y verse : le foyer semblait dépenser plus qu'il ne gagne. Les virements entre
comptes comptent désormais quand ils franchissent ce que tu regardes. Une migration (une table) ; aucun réglage
nouveau, rien à activer.

- **« Apports de … » parmi les revenus.** Un virement reçu d'un compte que ta vue ne compte pas — le compte d'un
  autre membre que tu as sorti de tes statistiques — compte comme un revenu, sur sa propre ligne, au nom de son
  titulaire. Exemple : Camille vire 900 € sur le compte commun depuis son compte, qu'Alex a sorti de ses
  statistiques ; Alex voit « Apports de Camille : 900 € » dans ses revenus, en face des dépenses du compte commun.
  Le salaire de Camille et ses dépenses personnelles restent hors de sa vue.
- **« Versements à … » parmi les dépenses.** Le même principe dans l'autre sens : un virement parti vers un compte
  que ta vue ne compte pas fait son propre poste de dépense. Dans « Moi », ce que tu vires au compte commun apparaît
  ainsi en « Versements au compte commun » — jusqu'ici, il ne comptait nulle part.
- **Rien ne change** pour un virement entre deux comptes comptés dans ta vue (il reste neutre), pour le total d'une
  carte à débit différé, ni pour un foyer qui compte tous ses comptes. L'opération garde sa catégorie : compter de
  nouveau le compte d'en face rend le virement neutre.
- **Les mêmes chiffres partout** : accueil, Mois, Analyse (répartition, flux, frise, comparaison), tendances,
  prévision — un apport qui revient chaque mois y est attendu comme un salaire —, budget, Opérations, assistant et
  serveur MCP. Les mois passés sont recalculés : l'historique des revenus et des dépenses change pour qui est
  concerné.
- **Dit en clair à l'écran** : la ligne compte des « virements » et non des opérations, une phrase sous la
  répartition dit ce qu'est un apport ou un versement, le détail d'une opération dit pourquoi elle compte, la
  pastille « i » de Revenus et de Dépenses le rappelle, et le réglage « Hors statistiques » d'un compte prévient.
  Nouvel article du manuel : « Apports et versements entre comptes ».

Comment Pécule retrouve les deux bouts d'un virement : deux opérations classées en mouvement interne, du même
montant, de sens opposé, sur deux comptes, à cinq jours d'écart au plus ; chacune n'a qu'un pendant, le plus proche
dans le temps. Si le compte d'en face n'est pas dans Pécule, le virement reste neutre.

Migration `0035_virements_entre_comptes` : la table `transfer_peers` (le compte d'en face de chaque virement
rapproché). Elle se déduit des opérations : Pécule la remplit à la première lecture et la tient à jour seul.

Pour qui écrit du code ou se sert de l'API : `LINE_KIND` et `IS_EXPENSE` deviennent `lineKind(comptes)` et
`isExpense(comptes)` (`src/server/stats.ts`) ; une répartition par catégorie rend ces lignes sous un identifiant
`virement:recu:<titulaire>` ou `virement:verse:<titulaire>`, que la liste des opérations accepte comme filtre
`category` ; une opération de la liste porte `transfer` quand elle compte ainsi, `counted_as` dans
`search_transactions`.

Essais : règles pures testées (rapprochement, noms, répartition) ; 771 tests ; sur une copie d'une base en service,
écart avant / après égal aux seuls virements qui franchissent la vue, pour deux membres et les deux périmètres ;
écrans vus sur téléphone et sur ordinateur (Mois, répartition, flux, détail d'une opération), en français, en anglais
et en allemand ; outils de l'assistant rejoués par le serveur MCP local, aux mêmes totaux que l'écran ; schéma de
départ régénéré et comparé.

## 1.37.5

L'installateur npm s'appelle « create-pecule ». Rien ne change pour une installation en service ; aucune migration,
aucun réglage nouveau.

- **`npm create pecule`.** Le registre npm refuse le nom « pecule », qu'il juge trop proche d'un paquet existant —
  pour tout le monde, si bien que personne d'autre ne peut le prendre non plus. L'installateur se publiera donc sous
  « create-pecule », dont la commande est `npm create pecule [dossier]` (ou `npx create-pecule [dossier] [options]`).
  Sans argument, il installe dans `./pecule` ; le mot « installer », que demandait la première forme de la commande,
  reste admis en tête ; `--version` seul rend la version de l'installateur, suivi d'un numéro il choisit la version
  de Pécule à installer.
- Le nom est réservé sur npm par un paquet d'attente. Le vrai installateur y sera publié à l'ouverture du dépôt :
  d'ici là, aucun guide n'annonce la commande.

Essais : tests de l'installateur (archive dépliée, empreinte refusée, version absente, dossier occupé), paquet
empaqueté puis installé hors du dépôt.

## 1.37.4

Plus rien dans le code ne nomme l'outil d'où une installation en particulier avait repris son historique. Rien ne
change à l'écran ; une migration, sans changement de structure ; aucun réglage nouveau.

- **Ce qu'une reprise d'historique écrit porte la valeur « reprise »**, la même pour tout foyer : origine et
  provenance du classement d'une opération, provenance d'un compte, d'un instantané du patrimoine, d'un document,
  d'une tâche de l'échéancier et d'un engagement. Ces valeurs ne s'affichent nulle part ; l'assistant, lui, les lit.
- La consigne de l'assistant ne renvoie plus à des fiches propres à une installation ; les commentaires du code
  décrivent une reprise « depuis un autre outil ».

Migration `0034_reprise_source` : elle renomme la valeur dans les lignes déjà en base (sept mises à jour, aucune
structure touchée, rejouable sans effet ; la date de modification des opérations est gardée). Une base qui n'a jamais
rien repris n'a aucune ligne concernée.

Pour celui qui pilote une reprise par l'API d'administration : la route des règles de classement s'appelle désormais
`POST /api/admin/import/merchant-rules`, et un document repris sans provenance indiquée reçoit « reprise ».

Essais : migration appliquée à une copie d'une base en service (2 180 lignes renommées dans six colonnes, aucune
laissée, second passage sans effet) ; schéma de départ régénéré et comparé.

## 1.37.3

Deux suites de la revue de sécurité. Aucune migration, aucun réglage nouveau.

- **Un secret de l'installation ne se remplace plus en silence (Docker).** Docker Compose lit les variables du
  terminal comme celles du fichier `.env` : un `API_TOKEN` exporté pour un autre projet devenait, sans un mot, le
  jeton d'administration de Pécule. Le service « reglages » refuse désormais de démarrer quand un secret reçu de
  l'environnement n'est pas celui que l'installation garde (jeton d'administration, jeton de synchronisation, code
  d'installation, mot de passe d'une base déjà créée) ; le message dit quelle variable retirer, et comment changer
  le secret exprès (`docker compose run --rm -e FORCE_SETTINGS=1 reglages`). Au premier démarrage, il nomme les
  secrets qu'il a repris de l'environnement plutôt que tirés. Le secret de chiffrement avait déjà son garde-fou.
  **Si tu changes un de ces secrets dans `.env`, il faut maintenant le demander exprès** (guide d'installation).
- **Marques reconnues** : les réseaux de transport et de vélos des grandes agglomérations rejoignent le référentiel
  (RATP, Île-de-France Mobilités, Vélib', RTM, Tisséo, TBM, Ilévia, Naolib, Irigo, STAR, CTS, Lignes d'Azur, TaM),
  avec Eau de Paris et Eaux de Marseille, et les abréviations d'autres caisses régionales de banque. Le
  référentiel ne penche plus vers une seule ville ; une marque qui n'était là que pour un foyer en est retirée (un
  foyer ajoute ses propres enseignes dans Réglages → Classement).

Essais : 760 tests ; garde-fou rejoué sur une installation Docker neuve (jeton exporté à l'installation : nommé ;
autre jeton ensuite : refusé, avec ou sans `SECRET_KEY` ; changement demandé exprès : pris).

## 1.37.2

Deux textes disaient d'où venaient les données d'une installation en particulier ; ils valent maintenant pour tout
foyer. Aucune migration, aucun réglage nouveau.

- **Patrimoine → Répartition** : devant un relevé ancien sans détail, la note dit seulement « Ce relevé ne détaille
  pas les poches. », sans nommer l'outil d'où il avait été repris.
- **Projections** : la note sous les hypothèses est la même partout, « Hypothèses à revoir chaque semestre. » ; elle
  ne promet plus une tâche de rappel que Pécule ne crée pas lui-même.
- L'assistant ne cite plus cet outil quand il décrit ce que range le coffre (consigne, `search_documents`, état des
  données).

## 1.37.1

Le plafond du mois pour l'IA peut désormais tout arrêter, assistant compris. Rien ne change tant que la nouvelle case
n'est pas cochée ; aucune migration, aucun réglage d'hébergement nouveau.

- **« Au plafond, tout mettre en pause, l'assistant compris ».** Réglages → Coût de l'IA, sous le plafond du mois :
  jusqu'ici, le plafond prévenait l'administrateur et pouvait mettre en pause les lectures de fond, mais l'assistant
  répondait toujours — une session laissée ouverte pouvait donc dépenser sans borne. Avec cette case, l'assistant,
  le mode vocal, le classement par l'IA et la lecture des fichiers déposés attendent eux aussi le mois suivant, ou
  un plafond relevé. Un fichier déposé pendant la pause est gardé (privé à celui qui le dépose), sans être lu ; une
  action que l'assistant avait déjà proposée se confirme encore. L'assistant répond alors que l'IA est en pause, et
  l'administrateur relève le plafond à l'écran.
- **En mode démo, l'assistant s'arrête toujours au plafond**, que la case soit cochée ou non : une démonstration ne
  dépense pas au-delà de ce que le foyer s'est fixé.
- La notification « plafond atteint » dit ce qui attend ; l'assistant et le serveur MCP lisent et règlent ce choix
  (`pause_everything_when_reached`, `ai_pause_all`).

Pour celui qui publie : les versions du dépôt sont désormais immuables (réglage de GitHub) — relancer la publication
d'une version déjà publiée ne remplace plus ses pièces jointes, et le flux le dit au lieu d'échouer.

Essais : règle pure testée (`budgetStops`) ; 13 scénarios rejoués contre une instance locale avec un fournisseur d'IA
factice (aucun appel sortant tenté pendant la pause) ; écran contrôlé sur téléphone et ordinateur.

## 1.37.0

Une visite guidée fait le tour de l'appli dans l'appli elle-même, et les thèmes de l'année ne s'activent plus
d'eux-mêmes. Aucune migration, aucun réglage nouveau.

- **Visite guidée.** Une entrée « Visite guidée », en bas du menu sous l'assistant (sur téléphone : dans « Tout
  Pécule »), pose un voile sur l'écran, éclaire tour à tour les vrais éléments de l'appli et dit en deux phrases à
  quoi chacun sert. Sur ordinateur : le tableau de bord, chaque famille du menu — son écran s'ouvre derrière la
  bulle —, puis la recherche, Foyer / Moi, le mode discret, le « ? » et l'assistant. Sur téléphone : les onglets,
  l'assistant, puis les boutons du haut. Elle ne passe que par les écrans que le foyer a gardés, ne modifie rien,
  ramène à l'écran d'où l'on est parti, et se rejoue autant qu'on veut — en mode démo aussi, pour montrer Pécule.
- Au clavier : → ou Entrée pour la suite, ← pour revenir, Échap pour quitter ; toucher l'endroit éclairé passe aussi
  à la suite. La recherche (« visite ») la lance, comme la dernière étape de la présentation de bienvenue, qui la
  propose à chaque nouveau membre.
- **Les thèmes de l'année sont sur « Aucun » au départ.** Fêtes et saisons ne changent plus l'allure de l'appli
  d'elles-mêmes : chacun les active sur son appareil (Réglages → Apparence → Thèmes de l'année). Un appareil où ce
  réglage n'avait jamais été touché revient donc à l'allure de tous les jours ; un appareil qui avait choisi « Fêtes
  et saisons » ou « Fêtes seulement » garde son choix. Les anniversaires suivent le même réglage : Réglages le
  rappelle quand les thèmes sont coupés sur l'appareil.
- **Le coffre « Sable » partout au départ.** Sans thème, le logo affiché est le coffre de tous les jours sur son fond
  d'origine : à la connexion, dans la présentation de bienvenue, en haut du menu et dans l'onglet du navigateur.
- L'assistant ne cite plus l'unité amusante du thème du moment qu'à qui affiche ce thème : l'écran dit au serveur le
  réglage de l'appareil à chaque requête.
- **Sur téléphone, « tirer pour actualiser » aboutit de nouveau.** Le geste s'arrêtait au premier mouvement du doigt :
  la pastille apparaissait, puis rien. Tirer l'écran d'un onglet principal vers le bas relit les banques, comme le
  bouton de synchronisation.
- Réglages → Comptes et connexions : les pastilles « Gratuit » et « Abonnement payant » de l'encart « Quelle source
  choisir ? » ont le contraste voulu.
- En anglais, la présentation de bienvenue s'appelle désormais « introduction », pour ne pas la confondre avec la
  visite guidée (« guided tour »).
- Pour qui développe : les étapes et la place de la bulle sont des règles pures et testées (`src/lib/tour.ts`) ; un
  repère de la coquille se marque `data-tour` (un test vérifie que chaque étape a le sien) ; le composant est
  `src/client/components/Tour.tsx`, chargé à la demande. Le réglage d'origine des thèmes est `DEFAULT_SEASON_MODE`
  (`src/lib/seasons.ts`), lu de la même façon par `public/theme-init.js` (un test compare) ; l'écran l'envoie au
  serveur dans l'en-tête `X-Themes` (`src/server/themes.ts`), à côté de `X-Langue` et `X-Perimetre`.

## 1.36.1

Version de sécurité, issue d'une revue complète avant diffusion : aucune faille joignable sans être membre du foyer,
mais plusieurs défauts entre membres, dans l'assistant et dans la chaîne de publication. Aucune migration ; un seul
changement de valeur par défaut (`NODE_ENV`, ci-dessous).

- **La déclaration d'impôt d'un membre reste la sienne.** À la relecture d'un avis dans l'import massif, le choix
  « Déclaration » proposait tous les membres : un membre pouvait ainsi lire les chiffres de la déclaration
  personnelle d'un autre (dans les écarts affichés), puis l'écraser en validant. Celui qui relit ne retient plus que
  la déclaration commune ou la sienne ; un avis au nom d'un autre membre lui est renvoyé.
- **Un document que l'IA n'a pas reconnu reste privé.** Déposé alors que l'IA est absente ou en panne, un bulletin de
  paie devenait commun au foyer. Il appartient désormais à celui qui le dépose, qui le partage depuis sa fiche.
- **Couper d'un coup les accès d'un membre.** Réglages → Compte et sécurité : sur la ligne d'un autre membre,
  l'administrateur a « Couper ses accès » (appareil perdu, départ du foyer). Retirer ses clés d'accès fermait ses
  sessions, mais son lien de calendrier, ses jetons de dépôt et ses applications connectées restaient valides.
- **La mémoire de l'assistant passe par « Confirmer ».** Il retenait un fait sans rien demander : un texte venu
  d'ailleurs — le libellé d'un virement, un document déposé — pouvait s'y faire inscrire et orienter toutes les
  conversations suivantes. Il propose maintenant la phrase exacte, que tu confirmes ; oublier un fait aussi.
- **Une confirmation montre tout ce qu'elle écrit.** Notes, résumé, hypothèses : tout texte libre d'une action
  s'affiche dans sa confirmation (au lieu de « notes réécrites »), et un objectif modifié y est nommé, statut et
  placement lié compris.
- **Entre membres, ce qui est privé le reste aussi par les détours** : libellés d'articles d'une facture privée
  (outil `get_transaction`), nom et montants d'un engagement privé (prélèvements, import d'un contrat), valeur d'un
  placement privé rattaché à un bien ou à un objectif commun, facture privée reliée à une opération par le dépôt du
  même fichier, résultat de la synchro crypto (rendu au seul titulaire), comptages de l'assistant.
- **Mode démo** : il ne lit plus les connexions bancaires réelles (Finta), ne ferme plus les vraies sessions par
  « Déconnecter mes autres appareils », ne fait plus chercher le logo d'une crypto inventée, et une annulation
  enregistrée en démo ne se rejoue plus sur la vraie base.
- **Applications connectées (OAuth) et serveur MCP** : une application ne reçoit jamais plus que ce qu'elle demande
  (les actions ne se proposent que si elle les demande, et l'écran dit qu'elles comprennent des suppressions et des
  réglages) ; un programme de l'ordinateur ne s'affiche plus sous le nom d'un assistant reconnu ; les lots de
  messages sont bornés (20, exécutés un à un) et le débit limité par accès ; deux renouvellements simultanés d'un
  jeton n'aboutissent plus tous deux ; l'enregistrement ouvert ne peut plus remplir la base ; la version en service
  n'est dite qu'à l'administrateur ; une erreur inattendue d'un outil ne cite plus la requête.
- **Restauration d'une sauvegarde** : la session ouverte avec le code d'installation se ferme dès qu'un foyer existe
  (elle valait six heures, et pouvait encore faire passer le service en maintenance) ; les tailles qu'annonce une
  archive sont bornées avant toute réservation de mémoire ; les instructions d'une archive n'admettent que des
  valeurs écrites en clair et une structure qui ne lit aucune autre base. Ne restaure que tes propres archives : une
  sauvegarde porte aussi les accès (clés, jetons, applications connectées).
- **Requêtes sortantes** : le stockage extérieur n'admet `http://` que vers un appareil du réseau du serveur (un
  NAS), jamais d'identifiants dans l'adresse ; l'adresse d'un fournisseur d'IA saisie à la main est recontrôlée à
  chaque appel, sans suivre de redirection ; celle d'un abonnement aux notifications avant chaque envoi ; les
  téléchargements de logos s'arrêtent à leur taille maximale ; la lecture Finta a un délai.
- **Un motif de libellé que la base refuse** n'est plus enregistré (il faisait échouer chaque enregistrement
  d'engagement suivant).

Pour celui qui héberge :

- **`NODE_ENV` vaut « production » sans rien dire** (c'était « development ») : une installation dont le `.env`,
  écrit à la main, n'avait pas cette ligne ne tourne plus en mode développement. Rien ne change pour une
  installation réglée par `setup.mjs` ou par Docker ; le développement (`pnpm dev`) le demande déjà.
- **Docker** : conteneurs sans droits superflus (`no-new-privileges` partout, aucune capacité pour le serveur, trois
  pour le service « reglages »), administrateur de la base joignable depuis son seul conteneur (installations
  neuves), image de base épinglée par son empreinte. Essayé sur une installation neuve, puis à un second démarrage.
- **Publication** : actions des flux épinglées par l'empreinte de leur commit et suivies par Dependabot ;
  `latest`, `1` et `1.36` ne reculent plus quand une ancienne version est republiée ; attestation de provenance de
  l'archive et de l'image dès que le dépôt est public (`gh attestation verify`, guide de mise à jour) ; plus de cache
  partagé ni de jeton laissé dans le dépôt cloné pendant le build.
- **Installation** : `setup.mjs` lit l'adresse de la base dans `PECULE_BASE` (hors des arguments de la commande) et
  écrit `.env` d'un seul geste, déjà fermé ; l'installateur refuse un miroir en `http://` ; le guide dit de fermer le
  port du serveur au pare-feu hors Docker ; `AGENTS.md` ne fait plus lire le `.env` à l'agent.

Essais : 739 tests ; 34 scénarios rejoués contre une instance locale (membre contre membre, démo, OAuth, serveur
MCP, restauration) ; installation Docker neuve ; écrans contrôlés sur téléphone et ordinateur.

## 1.36.0

Une présentation de bienvenue accueille chaque nouveau membre à sa première connexion, et le mène jusqu'à sa banque
reliée. Rien ne change pour les membres déjà inscrits ; aucune migration, aucun réglage nouveau.

- **Une présentation à la première connexion.** Sa clé d'accès à peine créée, le nouveau membre voit Pécule s'ouvrir
  sur quelques étapes courtes, en plein écran : l'accueil, les repères pour ne pas se perdre — le menu, la recherche,
  le « ? » de chaque écran, l'assistant, montrés sur une maquette de l'appli telle qu'il l'a sous les yeux, ordinateur
  ou téléphone —, ses comptes, puis ce qu'il peut faire ensuite. Elle se passe d'un geste, se reprend à l'étape où on
  l'a laissée, d'un appareil à l'autre, et ne revient plus une fois finie. La langue se choisit dès le premier écran.
- **Le foyer se règle en chemin.** Celui qui installe Pécule y choisit le pays, la devise et les écrans à suivre. Sur
  une installation neuve, pays, devise et fuseau horaire sont proposés d'après son appareil (le fuseau s'affiche
  quand il n'est pas celui, habituel, du pays) ; hors de France, les écrans Impôts et Retraite, qui lisent des
  documents français, sont décochés d'avance. Le menu se dessine à mesure qu'il coche. Rien n'est enregistré avant
  « Continuer ». Un membre invité ne voit pas cette étape, et un foyer qui a déjà des comptes garde son pays et sa
  devise.
- **Relier sa banque, pas à pas.** À l'étape « Tes comptes », on choisit : relier sa banque, importer un fichier, ou
  plus tard. Relier ouvre un guide d'Enable Banking en quatre temps — créer son application, y relier ses comptes,
  donner sa clé à Pécule, autoriser la lecture — qui suit ce que Pécule constate : chaque temps franchi se coche,
  l'adresse de retour se copie d'un geste, et le fichier de clé téléchargé chez Enable Banking se dépose tel quel
  (Pécule y lit l'identifiant de l'application et la clé). Au retour de la banque, la présentation reprend où elle en
  était et guette l'arrivée des comptes.
- **Le même guide dans les Réglages.** Réglages → Comptes et connexions, bloc « Enable Banking », montre ce guide tant
  qu'aucune banque n'est reliée — aussi pour un membre qui relie des comptes à son seul nom, tant que sa propre
  application n'a rien relié. Ce qu'Enable Banking répond de travers s'affiche en tête du guide. Rien ne change pour
  un foyer déjà relié.
- **À revoir quand on veut** : par la recherche (« Présentation de Pécule »), par la carte « Bien démarrer » de
  l'accueil ou par l'article « La présentation de bienvenue » du manuel. Elle n'existe pas en mode démo.
- Des mouvements sobres : le coffre de l'écran de connexion glisse jusqu'à la présentation, puis va se ranger dans le
  menu ; rien ne bouge pour qui a demandé moins d'animations à son appareil. Au clavier, Entrée continue, les flèches
  changent de choix et le focus suit l'étape du guide qui s'ouvre. La sortie n'attend pas le serveur : un réseau lent
  ne laisse personne devant un écran vide.
- Les membres déjà inscrits ne la voient pas s'ouvrir : elle n'attend que ceux qui créent leur première clé d'accès
  à partir de cette version.
- Pour qui développe : les règles (étapes, réglages proposés, avancement du guide) sont pures et testées dans
  `src/lib/onboarding.ts` ; l'état « à accueillir » est gardé par membre dans `app_kv` (`src/server/welcome.ts`),
  toujours dans la vraie base ; l'écran est `src/client/pages/Onboarding.tsx`, le guide
  `src/client/components/BankGuide.tsx`. L'état d'Enable Banking dit désormais avec quelle application chaque accord
  a été donné (`own` : celle du membre, sinon celle du foyer).

## 1.35.0

D'autres assistants que Claude se connectent à Pécule, chacun pour la vue d'un membre. Rien ne change pour les accès
déjà accordés ; aucune migration.

- **ChatGPT, Mistral Le Chat et Perplexity** ouvrent le même écran d'accord que Claude — lecture seule, ou lecture
  et actions — au lieu de demander un jeton d'administration, qui donnait tous les droits. Il suffit d'ajouter
  l'adresse du serveur MCP dans l'assistant (Réglages → Comptes et connexions → Applications connectées la donne).
- **Tout assistant installé sur l'ordinateur** se connecte aussi : Codex, Cursor, Visual Studio Code, Gemini CLI,
  Zed, Goose, ou n'importe quel client relié par `mcp-remote`. Pécule l'annonce comme « un programme de cet
  ordinateur » et cite le nom qu'il se donne, sans pouvoir le vérifier. Essayé pour de vrai avec Codex et avec
  `mcp-remote`.
- **Le nom affiché vient de l'adresse où tu retournes**, plus de ce que le client dit de lui-même : un client qui se
  dirait « Claude » mais reviendrait ailleurs ne peut pas s'afficher comme Claude. L'écran rappelle de n'accepter
  qu'une connexion que tu viens de lancer toi-même.
- Toute autre adresse de retour reste refusée, y compris les adresses relais que certains éditeurs publient (elles
  renvoient le code vers une cible nommée dans le lien). Un assistant auto-hébergé (LibreChat, Open WebUI, n8n) passe
  encore par un jeton d'administration.
- Sécurité des requêtes sortantes : une adresse IPv4 écrite sous forme IPv6 (« ::ffff:7f00:1 ») est reconnue comme
  privée, où qu'elle serve (logos, notifications, fournisseur d'IA réglé à la main).
- Pour qui développe : un assistant s'ajoute d'une ligne dans `src/lib/mcp-clients.ts`, avec l'adresse de retour
  qu'il publie. Le document d'identité d'un client (`client_id` = URL) se lit sur tout hôte public, à l'adresse
  contrôlée, sans suivre de redirection, dans une taille et un délai bornés ; un enregistrement dynamique ne garde
  que les adresses admises.
- Paquet npm « pecule » : l'installateur est écrit (`scripts/pecule.mjs`, fabriqué par
  `node scripts/paquet.mjs --npm`). Il télécharge l'archive de la dernière version, contrôle son empreinte et la
  déplie ; il sera annoncé dans les guides quand le nom sera publié sur npm.

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
