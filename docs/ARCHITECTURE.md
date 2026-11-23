# Architecture

Pécule est une application web monolithique : un serveur Node.js qui sert une API et une interface React, sur une
base MySQL ou MariaDB. Une installation sert un foyer.

```
navigateur (React)  ──  /api  ──  serveur Express  ──  MySQL / MariaDB
                                       │
                 banques (Enable Banking) · fournisseur d'IA · cours (facultatifs)
```

## Arborescence

| Dossier | Contenu |
| --- | --- |
| `src/client/` | Interface : `pages/` (écrans), `components/`, `api.ts` (requêtes), `i18n.ts`, `theme.ts` |
| `src/server/` | Serveur : `routes/` (API), `db/schema/` (tables), services par domaine, `tools/` (outils de l'IA), `imports/` (import massif), `demo/` (famille fictive) |
| `src/lib/` | Règles pures partagées par l'écran et le serveur, avec leurs tests |
| `src/i18n/` | Dictionnaires (le texte français est la clé) |
| `drizzle/` | Migrations et schéma de départ d'une installation neuve (`initial/schema.sql`) |
| `scripts/` | `setup`, `lien` (lien du premier démarrage), `doctor`, `maj` (mise à jour), `importer`, `paquet` (pièces jointes d'une version), sauvegarde et restauration, notes de version, base locale, outils de traduction |
| `skills/` | La compétence « pecule » pour un agent IA (installer, vérifier, mettre à jour), telle que la distribuent `npx skills`, `gh skill` et le catalogue de plugins de Claude Code ; `.claude/skills/pecule` en est la copie lue dans le dépôt |
| `public/` | Fichiers statiques : icônes, service worker, script de thème |
| `docs/` | Guides d'installation, d'import et de connexion des banques |

Le build produit `dist/client` (interface) et `dist/server.mjs` (serveur en un seul fichier, migrations à côté).

## Les domaines

- **Banque** — `accounts`, `transactions`, `categories`, `rules`. Une opération arrive d'Enable Banking
  (`src/server/enable-banking.ts`), d'un fichier (`bank-files.ts`) ou d'une saisie. Elle porte une référence stable ;
  une lecture retrouve sa ligne, ou la rapproche d'une ligne déjà là (`src/lib/bank-reconcile.ts`). Le classement suit
  l'ordre : choix manuel, règle, même libellé déjà classé (`guess.ts`). Les doublons de carte sont marqués, jamais
  supprimés.
- **Devises** — le foyer a un pays, une devise et un fuseau horaire (Réglages → Foyer ; `src/lib/countries.ts`,
  `src/server/region.ts`). Tous les montants gardés (`amount`, `balance`, historiques) sont dans la devise du foyer :
  aucune statistique ne convertit. Un compte tenu dans une autre devise est converti à l'arrivée, au cours de référence
  de la Banque centrale européenne du jour de l'opération (`src/server/fx.ts`, table `fx_rates`, pivot euro), et garde
  son montant d'origine (`original_amount`, `original_currency`, `balance_original`). Chaque jour, les soldes en devise
  sont ramenés au cours du jour. Changer la devise du foyer recalcule opérations, soldes et historiques à partir des
  montants d'origine (`src/server/currency-change.ts`) ; les montants saisis à la main gardent leur chiffre.
- **Statistiques** — `src/server/stats.ts` définit une fois ce qu'est une dépense, un revenu, un mouvement interne ;
  la vue `tx_lines` éclate les opérations ventilées. Tout écran et tout outil de l'IA passent par là. Une période
  d'analyse est un mois (`2026-11`) ou une année entière (`2026`) : `src/lib/periods.ts`.
- **Virements entre comptes** — un mouvement interne est neutre tant que ses deux comptes sont comptés dans la vue du
  membre ; si le compte d'en face ne l'est pas (sorti de ses statistiques, ou compte commun dans le périmètre
  « Moi »), la ligne compte en revenu (« Apports de … ») ou en dépense (« Versements à … »). `src/lib/transfers.ts`
  rapproche les deux bouts d'un virement (même montant, sens opposé, cinq jours d'écart au plus, un seul pendant par
  ligne) et nomme ce qu'il devient ; la table `transfer_peers` garde le compte d'en face, recalculée par
  `src/server/transfers.ts` dès que l'empreinte des mouvements internes change (contrôlée avant toute lecture : une
  requête légère, aucun chemin d'écriture à accrocher) ; `lineKind`, `isExpense`, `peerOwner` et `transferKey`
  (`src/server/stats.ts`) en font la définition commune, et `nameTransfers` donne à ces lignes leur nom dans une
  répartition. L'opération garde sa catégorie : rien n'est réécrit, et chaque membre a sa lecture.
- **Jour d'une opération** — `transactions.date` est le jour d'écriture de la banque (pour une carte à débit
  différé : le jour du prélèvement, le mois suivant) ; `purchase_date` est le jour de l'achat, donné par la banque
  ou lu dans le libellé (`src/server/stat-dates.ts`). Le foyer choisit lequel compte (Réglages → Foyer, ligne
  `stats:date_basis` d'`app_kv`) : la vue `tx_lines` rend le jour retenu dans sa colonne `date`, et une lecture
  directe de `transactions` le calcule par `statDate()` (`src/server/stats.ts`). Changer de réglage ne réécrit rien.
- **Prévision** — ce qui revient chaque mois (prélèvements, abonnements, salaire) est reconnu dans l'historique
  (`src/lib/recurring.ts`) : au même libellé, d'un montant stable, ou à défaut au même montant au centime (une
  mensualité dont le libellé a changé). C'est attendu sur le mois en cours et les trois suivants (`forecast`,
  `src/server/flows.ts`).
- **Solde bas** — chaque membre a sa règle (seuil, délai de prévenance, comptes surveillés ; ligne
  `solde:regle:<membre>` d'`app_kv`, `src/lib/balance.ts`). La prévision d'un compte (`src/server/balance.ts`) part de
  son solde et y ajoute ce qui est attendu sur ce compte-là : ses récurrences des cinq derniers mois, mouvements entre
  comptes compris, et le relevé d'une carte à débit différé lu à la banque. Elle nourrit la notification « Solde bas »,
  l'écran « Soldes à venir » (`pages/Balances.tsx`), le bandeau du calendrier du mois et de l'accueil, Réglages →
  Notifications et appareil, et deux outils de
  l'assistant (`get_balance_alert`, `set_balance_alert`).
- **Marques et logos** — `src/lib/brands.ts` reconnaît une marque dans un libellé : les enseignes que le foyer a
  ajoutées (table `custom_brands`, Réglages → Classement, `src/server/brands.ts`), puis le référentiel commun. Un logo
  est téléchargé une fois par le serveur et gardé en base (`logos`, `src/server/logos.ts`) : icône du site d'une
  marque du référentiel ou d'une enseigne du foyer, logo d'une banque reliée par Enable Banking quand l'icône de son
  site ne fait pas mieux (`src/lib/bank-logos.ts`), image d'une crypto. Jamais un domaine venu d'ailleurs ; en démo,
  rien hors du référentiel.
- **Factures** — `invoices`, `invoice_items` ; lecture par l'IA, rapprochement avec l'opération qui l'a payée
  (`src/lib/invoices.ts`), ventilation de l'opération d'après les articles.
- **Patrimoine** — `assets`, `loans` et `loan_schedule`, `crypto_positions`, `prices`, `wealth_snapshots` (un
  instantané par membre et par jour). Les quantités crypto viennent de sources par membre (`crypto_sources`,
  `src/server/crypto.ts`) : un portefeuille lu par son adresse publique, sans intermédiaire ni clé
  (`src/server/chains/` : Bitcoin, Ethereum et chaînes compatibles, Solana ; genres et reconnaissance d'une adresse
  dans `src/lib/crypto-chains.ts`, jetons lus dans `src/lib/crypto-tokens.ts`), un compte d'exchange relié par une
  clé d'API en lecture seule, gardée chiffrée (`src/server/exchanges/` : onze exchanges ; une
  liste blanche de chemins de lecture par exchange, et le refus d'une clé qui peut faire plus que lire quand
  l'exchange dit ses droits ; guides et codes d'actifs dans `src/lib/crypto-exchanges.ts`), les exports d'une appli sans clé d'API (appli
  Crypto.com : mouvements gardés dans `crypto_file_moves`, lus par `src/lib/crypto-files.ts`), le compte CoinStats du
  foyer s'il en a un, ou la saisie à la main. Le capital restant dû d'un crédit est celui de la dernière échéance passée
  de son échéancier (`src/lib/loans.ts`). Un placement peut suivre les versements qu'il rapporte
  (`assets.payout_match`, `src/server/payouts.ts`, `src/lib/payouts.ts`) : ce sont les entrées d'argent dont le
  libellé porte son texte, lues dans les opérations ; avec `valuation = 'versements'`, sa valeur est le dernier
  versement reçu, relue après chaque synchronisation.
- **Situation** — `properties`, `commitments` (engagements récurrents), `payslips`, `tax_returns`, `property_taxes`,
  `retirement_simulations`, `career_periods`, `projections`. Les indicateurs sont recalculés, jamais stockés.
- **Revenus et impôts du foyer** — Foyer / Moi (`scopeKind`, `src/lib/scope.ts`) vaut aussi pour Revenus et Impôts,
  où il compte les membres. Une déclaration (`tax_returns`) est commune (`owner_user_id` = 0) ou celle d'un membre,
  plusieurs par année de revenus ; les totaux par année viennent de `taxYears` (`src/lib/taxes.ts`), ceux des
  bulletins de `payslipYears` (`src/lib/payslips.ts`). Bulletins et déclarations personnelles d'un membre ne
  comptent dans la vue du foyer des autres que s'il partage ses revenus (`src/server/sharing.ts`, app_kv
  « partage:revenus:<id> », éteint par défaut) : montants seuls, jamais le document.
- **Documents** — `documents` (coffre, texte indexé, identifiants masqués par `src/lib/redact.ts`) et `agenda_items` ;
  les échéances des crédits, garanties et contrats sont calculées à la volée.
- **Nature d'un contrat** — `documents.topic` (`TOPICS`, `src/lib/contracts.ts`) : assurance auto, habitation,
  emprunteur, santé, énergie, box, mobile, véhicule. Lue par l'IA au rangement, devinée au titre et au résumé sinon
  (`guessTopic`, qui a aussi étiqueté une fois les documents déjà là : `fillDocumentTopics`), corrigible dans la fiche.
  Le coffre en fait ses étiquettes (`GET /api/documents/topics`), la comparaison s'en sert pour proposer le contrat en
  cours.
- **Comparaison de contrats** — rien n'est gardé : l'outil `compare_contracts` (`src/server/contracts.ts`) réunit le
  texte des offres et du contrat en cours (coffre), l'engagement du budget et ce qui a été prélevé sur douze mois
  (`tx_lines`, motif de libellé de l'engagement) ; échéance, préavis et partage du texte entre documents sont des règles
  pures (`src/lib/contracts.ts`). La méthode (périmètre égal, coût sur douze mois, verdict puis tableau) est dans les
  consignes de l'assistant ; ce qui est propre à la France (résiliation à tout moment) n'y figure que pour un foyer
  français.
- **Import massif** — `import_batches`, `import_items` ; `src/server/imports/` : file de lecture, registre
  d'extracteurs (schéma pour l'IA, contrôles arithmétiques, écriture), journal d'écritures annulable. La lecture
  arrive en flux (`read.ts`). Un extracteur peut déclarer une liste de lignes (`rows` : lue en plusieurs réponses
  quand elle est longue, montrée en entier et corrigeable ligne à ligne à la relecture), les autres parties d'un même
  fichier (`parts` : une ligne `import_items` par partie, colonne `part`), un choix partagé entre les fichiers d'un
  lot (`shared`) et une vue d'ensemble du lot (`overview`).
- **Reprise d'un historique par les relevés** — l'extracteur `releve` se sert des quatre : un relevé de plusieurs
  comptes donne une proposition par compte, ses opérations se corrigent une à une, le compte choisi pour un relevé
  vaut pour les autres relevés du même compte, et le lot dit si la série s'enchaîne (solde d'arrivée d'un relevé =
  solde de départ du suivant) ou s'il manque un relevé. Les règles sont pures (`src/lib/statements.ts` : même
  compte, écart de solde, ligne qui l'expliquerait, série). Une opération déjà connue n'est pas recréée : même jour
  et même montant, puis à trois jours près contre les seules opérations fournies par une banque.
  Carte à débit différé : un achat listé dans le compte garde son jour d'achat (`purchase_date`) ; un détail imprimé
  à part est un compte de carte (achats écrits le jour du prélèvement, total du compte prélevé rangé en mouvement
  interne, dans un ordre de validation comme dans l'autre). Un PDF trop long pour être montré d'une pièce est découpé
  en tranches de pages (`splitPdf`, `src/server/documents.ts`, dans un fil à part ; `mergeSegment`, `read.ts`).
- **Classement en lot par l'IA** — `src/server/classify-ai.ts` : les opérations sans catégorie du membre sont
  réunies par libellé (`src/lib/classify.ts`), l'IA propose une catégorie par libellé d'après le référentiel et ce
  que le foyer a classé lui-même, et rien n'est écrit avant que le membre applique ce qu'il a retenu (annulable,
  règle créée par libellé s'il le demande). Routes `POST /api/transactions/ai-classify` et `…/apply`, fermées en démo.

## Membres, accès, vie privée

- Connexion par **clés d'accès** (WebAuthn) ; sessions en base ; le premier membre, créé avec le code d'installation,
  est l'administrateur. Le jeton d'administration (`API_TOKEN`) agit en son nom.
- Chaque donnée est **commune** (`owner_user_id` nul) ou **privée** à un membre. Un compte est commun, personnel,
  professionnel ou à une personne sans connexion ; chaque membre règle ce qu'il masque.
- **Mode démo** : une seconde base, remplie d'une famille fictive, vers laquelle sont aiguillées toutes les requêtes
  d'une session de démo. Les services extérieurs et les accès y sont fermés.
- **Présentation de bienvenue** (`/bienvenue`, `src/client/pages/Onboarding.tsx`) : un membre qui crée sa première
  clé d'accès est « à accueillir » (`src/server/welcome.ts`, un état par membre dans `app_kv`) ; l'appli ouvre alors
  la présentation avant tout autre écran, jusqu'à ce qu'il l'ait finie ou passée — sur n'importe lequel de ses
  appareils. Quelques étapes, dont l'ordre et les réglages proposés sont des règles pures (`src/lib/onboarding.ts`) :
  l'accueil, le pays, la devise et les écrans du foyer (administrateur), les repères de l'appli, puis les comptes,
  dont l'étape mène au guide « Relier ta banque » (`src/client/components/BankGuide.tsx`), le même que dans
  Réglages → Comptes et connexions : il suit ce que le serveur sait lire d'Enable Banking (clé reconnue, application
  active, accord donné), et la banque ramène le membre là d'où il est parti. Un membre inscrit avant cette
  présentation n'est pas « à accueillir » ; elle se rejoue par son adresse. Jamais en démo.
- **Visite guidée** (`src/client/components/Tour.tsx`, lancée par `src/client/tour.ts`) : le tour de l'appli dans
  l'appli elle-même, depuis l'entrée « Visite guidée » du menu (ou l'adresse `?visite=1`). Un voile, une zone éclairée
  qui glisse d'un repère de la coquille au suivant (`data-tour`), une bulle qui l'explique ; chaque famille du menu
  ouvre son écran derrière la bulle. Les étapes — selon la coquille (ordinateur ou téléphone), les écrans que le foyer
  a gardés, le choix Foyer / Moi — et la place de la bulle sont des règles pures (`src/lib/tour.ts`). L'appli est
  figée le temps de la visite (`inert`), rien n'est écrit, et l'on revient à l'écran de départ.
- **Sauvegarde complète** : une archive de toute la base et de tous les fichiers (`src/server/backup.ts`), restaurable
  dans une base vide (`pnpm restaurer`) ou, depuis l'écran de premier démarrage, dans une installation neuve
  (`src/server/restore.ts` : archive envoyée par morceaux, relue avant d'écrire, témoin `_restauration_en_cours` qui
  fait repartir de neuf une restauration coupée par l'arrêt du serveur). Le serveur en garde dans son dossier
  (`src/server/archives.ts`) : celles d'avant migration, et les automatiques quand l'administrateur les demande
  (`src/server/auto-backup.ts`, règles pures dans `src/lib/backup-plan.ts` : une par nuit ou par semaine, relue,
  rotation ; un échec ou un mois sans sauvegarde est notifié à l'administrateur). Une copie chiffrée de chaque
  sauvegarde automatique peut partir hors du serveur (`src/server/offsite.ts`) : chiffrement au format age écrit sans
  dépendance (`src/server/age.ts`, le serveur ne garde que la clé publique), vers un stockage compatible S3 ou WebDAV
  (`src/server/remote.ts`), essayé avant d'être enregistré.
- Écritures tracées dans `audit_log`, erreurs dans `alerts` (Réglages → Suivi technique).

## L'IA

Facultative, et toujours avec la clé du foyer (`src/lib/ai-providers.ts`, réglages chiffrés en base). Trois usages :
lire un document (sortie JSON structurée), l'assistant (boucle d'outils : les lectures s'exécutent, les écritures
attendent une confirmation — sa mémoire comprise : un fait retenu est joint aux consignes de toutes les conversations
suivantes, il ne s'écrit donc pas sur la foi d'un texte lu dans un libellé ou un document), et les traductions des
noms de catégories. Les outils sont déclarés une fois
(`src/server/tools/`) et servent à l'assistant comme au **serveur MCP** (`POST /api/mcp`, jeton d'administration ou
OAuth 2.1 pour un assistant extérieur).

Le serveur MCP borne ce qu'un accès peut lui demander : vingt messages au plus par requête, exécutés l'un après
l'autre, et un débit par accès (`src/server/mcp.ts`).

Un assistant extérieur se connecte au nom d'un membre, pour sa vue seulement (`src/server/oauth.ts`, règles pures dans
`src/server/oauth-rules.ts`). Il fait revenir le membre soit à l'adresse d'un assistant reconnu
(`src/lib/mcp-clients.ts` : une ligne par assistant, adresse exacte, jamais une adresse relais), soit par une boucle
locale — un programme de l'ordinateur du membre, quels que soient son port et son chemin (RFC 8252) ; toute autre
adresse est refusée. Le client se présente par enregistrement dynamique ou par un document d'identité
(`client_id` = URL, sous sa forme canonique), lu par `publicDocument` (`src/server/net.ts`) : hôte public seulement,
connexion à l'adresse contrôlée, aucune redirection, taille et durée bornées. Ce qui protège le membre, ce sont les
adresses de retour, pas le nom qu'un client se donne : l'écran de consentement ne nomme dans son titre qu'un
assistant reconnu, et cite entre guillemets le nom que se donne un programme de l'ordinateur.

Le coût de chaque appel est enregistré (`ai_usage`, une ligne par appel : `recordUsage` pour un appel compté en
jetons, `recordCost` pour le mode vocal, compté au caractère lu et à l'audio transcrit), en dollars et en euros au
cours du jour. Les tarifs, le rangement d'un appel dans son usage et les calculs (projection du mois, économie du
cache, état du plafond) sont purs, dans `src/lib/ai-usage.ts` ; `src/server/ai-usage.ts` en tire le rapport que
lisent l'écran Réglages → Coût de l'IA (`GET /api/assistant/usage`) et l'outil `get_ai_usage`. Le plafond du mois et
le tarif saisi pour un modèle inconnu vivent dans `app_kv` (`ai:budget`, `ai:prices`, `src/server/ai-cost.ts`) :
au plafond, l'administrateur est prévenu (notification « ia ») et, si le foyer l'a choisi, les lectures de fond —
file de l'import massif, traduction des noms — attendent (`backgroundPaused()`). Ce qu'un membre demande lui-même
n'est jamais coupé — sauf si le foyer a choisi de tout arrêter au plafond (`pauseAll`) : `assertAiBudget()`
(`src/server/ai-cost.ts`) refuse alors chaque appel demandé par un membre (assistant, voix, classement en lot, lecture
d'un bulletin), et un fichier déposé est rangé sans être lu. Une session de démo s'arrête toujours au plafond. La
règle est pure (`budgetStops`, `src/lib/ai-usage.ts`) ; une action déjà proposée par l'assistant se confirme encore.

Une réponse de l'assistant est du Markdown, enrichi de trois marques que ses consignes lui apprennent : encadrés
(`> [!IMPORTANT]`, `[!WARNING]`, `[!TIP]`, `[!NOTE]`), surlignage (`==…==`) et couleur selon le sens pour le foyer
(`{+favorable+}`, `{-défavorable-}`). Le découpage est pur (`src/lib/markdown.ts`), l'écran le dessine
(`components/Markdown.tsx`, `styles/assistant.css`) ; la voix et les notifications lisent le texte sans ses marques.
Les conversations (`assistant_threads`) appartiennent à leur membre : lui seul les voit, les renomme, les épingle
ou les supprime. Sur ordinateur, le panneau et le plein écran (`/assistant`) sont un seul composant monté par la
coquille (`Layout`).

## Le manuel

Le manuel de l'appli (`/manuel`) est du contenu, pas du code d'écran : des thèmes et des articles écrits en français
dans `src/lib/manual/` (un fichier par thème), traduits comme le reste par les dictionnaires. Le moteur est pur
(`src/lib/manual.ts`) : rendu d'un article en Markdown, recherche (chaque mot pèse d'autant plus qu'il est rare dans le
manuel et qu'il est trouvé dans le titre), sommaire. Trois lecteurs s'en servent : l'écran (`pages/Manual.tsx`), la
palette de commandes, et l'assistant — son outil `read_manual` cherche et lit les articles, et le sommaire est joint à
ses consignes.

- **Un nom de bouton ne s'écrit pas, il se cite** : `[[Réglages]]` est le texte français que le code passe à `t()` ;
  l'article affiche à sa place ce que l'écran montre dans la langue du membre. Un test échoue si le nom n'existe plus
  dans le code, si un lien mène à une adresse inconnue (route, groupe de réglages, section, bloc de Connexions), ou si
  une traduction a perdu un nom ou une adresse. Renommer un bouton oblige donc à relire l'article qui en parle.
- **L'assistant lit le manuel dans la langue du membre** (exception à « ce que lit l'IA reste en français ») : les noms
  de menus qu'il recopie sont ainsi ceux de l'écran du membre.
- **Réglages par l'assistant** (`src/server/tools/reglages.ts`) : `get_settings`, `update_settings` (langue, équivalences,
  jour retenu pour les achats par carte, écrans affichés, plafond du mois de l'IA — les trois derniers pour
  l'administrateur), `update_account`, `set_notification_types`, et `get_ai_usage` pour lire le coût de l'IA.
  Un réglage gardé par l'appareil (clair ou sombre, couleur, thèmes, densité, mode discret, ouverture instantanée) n'est
  pas connu du serveur : `set_device_settings` ne fait que le décrire, et l'action confirmée revient à l'écran avec un
  « effet » (`ClientEffect`, `src/lib/device-settings.ts`) que `src/client/deviceSettings.ts` applique — une seule fois,
  l'effet n'étant jamais gardé dans la conversation. Cet outil n'existe pas pour le serveur MCP (`screenOnly`).
  Ce qui touche à la sécurité ou à un service extérieur ne se règle qu'à l'écran : l'assistant y renvoie.
- Une section de Réglages s'ouvre par son ancre (`/reglages/notifications#solde`) : l'écran y défile.
- **Aide de l'écran ouvert** (`src/lib/manual-help.ts`, sans le texte du manuel) : une table adresse → article ou
  thème. Le « ? » de la barre du haut y mène (`components/HelpLink.tsx`), et le contexte d'écran envoyé à l'assistant
  la nomme : « à quoi sert cet écran ? » se lit là. Un test vérifie que chaque route et chaque groupe de réglages a
  sa page.
- **Notifications par l'assistant** : `set_notification_types` coche ou décoche des types d'alerte sur les appareils
  du membre déjà abonnés (tous, ou ceux d'un nom donné) ; activer les notifications sur un appareil demande son accord
  et reste à l'écran.
- **Dictionnaires** : les traductions des textes qui ne servent qu'au manuel sont rangées à part
  (`src/i18n/manual/<langue>.ts`, près de la moitié du volume traduit) ; l'appareil ne les charge qu'avec l'écran
  Manuel ou la recherche dans la palette (`loadManualDict`, `src/client/i18n.ts`), le serveur les connaît toutes. Le
  rangement est fait par `scripts/i18n/ecrire.py` ; un test refuse qu'un texte employé ailleurs y soit rangé.

## Installation

Trois formats, fabriqués à chaque version (`docs/guide/installation.md`) :

- **Docker** — `compose.yaml` se suffit. Son service « reglages » (`node scripts/setup.mjs --conteneur`) passe une
  fois avant les autres : il tire les secrets qui manquent, ou reprend ceux que donne un fichier `.env`, et les garde
  dans le volume `pecule-reglages` ; il écrit aussi, dans `pecule-base-init`, ce que MariaDB lit à la création de sa
  base (ses mots de passe, la base du mode démo) — un volume que le serveur ne monte pas : il ne reçoit que l'adresse
  de ses deux bases, jamais le mot de passe de l'administrateur de la base. Le serveur complète son environnement par ces réglages gardés
  (`SETTINGS_DIR`, `src/server/env.ts`), sans jamais remplacer ce que l'environnement donne. Les règles sont pures et
  testées (`src/lib/settings-file.ts`) : rien n'est tiré à la place d'un secret déjà là, ni à côté d'un jeton
  d'administration donné sans `SECRET_KEY` (il chiffre alors les clés gardées en base). `compose.yaml` transmet au
  serveur chacun de ses réglages par son seul nom : lu dans `.env` s'il y est, absent sinon (un test compare la liste
  au schéma des réglages).
- **Archive prête à l'emploi** — `scripts/paquet.mjs` range dans `pecule.tar.gz` et `pecule.zip` le serveur construit,
  ses scripts, ses guides et ses dépendances d'exécution, à plat et sans lien symbolique. Le paquet npm « create-pecule »
  (`scripts/pecule.mjs`, `node scripts/paquet.mjs --npm`) n'en est que l'installateur : il télécharge l'archive de la
  dernière version, contrôle son empreinte et la déplie (`scripts/lib/archive.mjs`, partagé avec `maj.mjs`).
- **Sources** — le dépôt, branche `stable`.

Ce que le serveur charge en service est dans `dependencies` ; ce qui ne sert qu'à construire l'écran (React, icônes,
graphiques) est dans `devDependencies`. L'image et l'archive n'installent que les premières, et le build s'arrête si
le serveur charge un paquet qui n'y figure pas (`scripts/build-server.mjs`).

Les scripts de l'installation (`doctor`, `lien`, `maj`, `importer`) lisent les réglages où qu'ils soient
(`scripts/lib/reglages.mjs`) : le fichier `.env`, le volume quand ils tournent dans le conteneur, ou le conteneur
depuis la machine. Les commandes que l'appli affiche à celui qui l'héberge dépendent de son installation
(`src/lib/install.ts`, `src/server/install.ts`).

## Démarrage

Le port s'ouvre tout de suite ; les migrations suivent, sous verrou (une base vide reçoit le schéma de départ en une
étape, puis le jeu de catégories de départ). `GET /api/health` rend `{ ok, phase }`. Une synchronisation bancaire
planifiée tourne dans le processus quand une source est reliée.

**Premier démarrage** : tant qu'aucun membre n'existe, l'écran « Bienvenue dans Pécule » crée le premier —
l'administrateur — contre le code d'installation (`SETUP_CODE`). `scripts/lien.mjs` attend que le serveur soit prêt
et donne ce code dans un lien (`<adresse>/#code=…`) : le fragment n'est jamais envoyé au serveur, l'écran le lit à
l'ouverture puis le retire de l'adresse (`src/client/setup-code.ts`), et ne demande plus qu'un prénom. Sans lien,
l'écran affiche la commande qui le donne. Si le premier membre existe sans clé d'accès, `lien` redonne son lien
d'inscription.

## Versions et mises à jour

- **La version en service** est inscrite dans `dist/server.mjs` au build (`scripts/build-server.mjs`,
  `src/server/version.ts`), avec `pecule.depuis` de `package.json` : la plus ancienne version depuis laquelle
  celle-ci se met à jour directement. Les comparaisons de versions sont des fonctions pures (`src/lib/version.ts`).
- **Publication** : une étiquette `vX.Y.Z` lance `.github/workflows/publication.yml` — image Docker pour amd64 et
  arm64 sur `ghcr.io`, pièces jointes (`compose.yaml`, `pecule.tar.gz`, `pecule.zip`, `SHA256SUMS`, sous des noms
  qui ne changent pas d'une version à l'autre : la dernière se télécharge toujours à la même adresse), version GitHub
  dont les notes sont le tableau « Installer ou mettre à jour » puis la section de `CHANGELOG.md`
  (`scripts/notes-de-version.mjs`), branche `stable` avancée jusqu'à elle. Les actions du flux sont épinglées par
  l'empreinte de leur commit ; `latest`, `1` et `1.36` ne se posent que sur la version la plus haute de leur rang
  (elles ne reculent jamais) ; l'archive et l'image reçoivent une attestation de provenance dès que le dépôt est
  public — `SHA256SUMS`, téléchargé au même endroit que l'archive, ne dit que si elle est arrivée entière.
- **Annonce** : une fois par jour, `src/server/updates.ts` demande à GitHub la dernière version publiée et la garde
  (`app_kv`, « maj:etat »). `GET /api/updates` (administrateur, fermé en démo) la donne à Réglages → Suivi technique
  (`components/UpdateSettings.tsx`), à `doctor` et à `maj` ; l'administrateur reçoit une notification (type `maj`)
  et l'assistant lit la version par `get_settings`. Les notes de version, écrites hors de l'installation, ne sont
  jamais données à lire à l'IA.
- **Installation d'une version** : sur le serveur, par la commande de l'installation, que l'appli affiche. Docker :
  `docker compose pull && docker compose up -d`. Sinon `scripts/maj.mjs` — sauvegarde complète téléchargée, puis
  l'archive de la version (empreinte contrôlée, ancienne version gardée dans `.avant-maj`) ou `git pull` et build,
  attente de la nouvelle version, `doctor`. Le serveur ne remplace jamais son propre code.
- **Garde-fous** : avant d'appliquer une migration à une base déjà en service, le serveur écrit une sauvegarde
  complète dans son dossier de sauvegardes (`src/server/pre-migration.ts`, trois gardées, sous le verrou des
  migrations) ;
  une migration interrompue reprend (`src/server/migrate-rules.ts`) ; une base trop ancienne pour les migrations
  repliées est refusée sans être modifiée, et le message nomme la version palier.
- **Le dossier des sauvegardes du serveur** ne se règle pas : `src/server/backup-dir.ts` (règle pure, testée) le
  choisit pour qu'il survive à une mise à jour — `~/pecule-sauvegardes/<adresse de l'appli>` dans le compte du
  serveur (un hébergeur peut installer chaque version dans un dossier neuf), sauf si `BACKUP_DIR` en donne un autre
  (c'est ainsi que `compose.yaml` désigne le volume de Docker) ; `data/sauvegardes` de l'installation n'est qu'un
  repli, faute de dossier personnel inscriptible, et le dossier du développement. `backupDir()`
  (`src/server/archives.ts`) est le seul endroit qui le donne ; `doctor` et l'écran des sauvegardes l'affichent.
