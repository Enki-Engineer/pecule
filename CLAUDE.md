# CLAUDE.md — règles du code de Pécule

Pour qui modifie le code, humain ou agent. Pour installer ou exploiter une instance : `AGENTS.md`.
Organisation du projet : `docs/ARCHITECTURE.md`.

## Socle

Express 5, React 19 + Vite, Tailwind CSS 4, TypeScript, pnpm, Drizzle ORM sur MySQL / MariaDB. Le code, ses
commentaires, les messages de commit et les textes d'origine sont **en français**. Avant d'envoyer quoi que ce soit :

```sh
pnpm lint && pnpm test && pnpm build
```

## Règles qui ne se discutent pas

- **Aucune donnée réelle** dans le dépôt : ni nom, ni lieu, ni employeur, ni libellé bancaire, ni montant tiré d'une
  vraie vie. Exemples, tests, consignes de l'IA et captures prennent la famille de la démo (Alex, Camille, Léo ;
  Nantes, Angers). Aucun secret en clair : les réglages sont dans `.env`, les clés saisies dans l'appli sont
  chiffrées en base (`src/server/secret.ts`).
- **Le code vaut pour un foyer quelconque** : aucun prénom, bien ou banque dans la logique. Les membres sont la table
  `users`, le foyer se décrit par `householdSummary()`.
- **Un chiffre = une définition** : tout agrégat passe par `src/server/stats.ts` et lit la vue `tx_lines`
  (une opération ventilée = ses lignes). L'accueil, l'analyse, les tendances et l'assistant donnent les mêmes valeurs.
  Le jour d'une opération est `tx_lines.date` — le jour d'achat ou le jour d'écriture de la banque, selon le réglage
  du foyer — ; une requête qui lit `transactions` pour un total ou une liste datée prend `statDate()` et
  `STAT_DATE_JOIN`, jamais `transactions.date` seul (réservé aux synchronisations et aux rapprochements).
  Ce qu'une ligne vaut dépend de la vue du membre : `lineKind(comptes)` et `isExpense(comptes)`, jamais `c.kind` seul
  pour un total — un virement entre comptes du foyer qui vient d'un compte hors de la vue, ou qui y part, compte en
  revenu (« Apports de … ») ou en dépense (« Versements à … ») (`src/lib/transfers.ts`, table `transfer_peers`).
- **Toute requête sur les opérations passe par les comptes du membre** (`userAccounts(req)`) : masquer un compte ou le
  sortir des statistiques est un réglage par membre.
- **Le mode démo ne touche jamais la vraie base** : `src/server/demo-context.ts` aiguille chaque requête ; toute route
  qui appelle un service extérieur ou donne un accès s'ajoute à `BLOCKED` (`src/server/demo.ts`) ou se garde par
  `isDemo()`.
- **Rien n'est écrit sans confirmation par l'IA** : les actions de l'assistant attendent « Confirmer » — sa mémoire
  comprise, aucun outil n'écrit hors d'un `writeTool` —, les propositions de l'import massif attendent la validation,
  et tout ce qu'une validation écrit passe par un journal annulable (`src/server/imports/track.ts`). Une confirmation
  montre ce qu'elle écrit : tout texte libre d'une action y figure (`unshownTexts`, `src/server/tools/registry.ts`).
  Ce que Pécule déduit de lui-même se propose de même : un mouvement du journal crypto repéré dans la banque ou à
  une synchronisation attend « Noter » (`src/server/crypto-proposals.ts`).
- **Privé veut dire privé par tous les chemins** : une donnée qui porte `owner_user_id` se lit et s'écrit avec
  `(owner_user_id IS NULL OR owner_user_id = ?)` partout où elle passe — écran, outil de l'assistant, extracteur de
  l'import massif (lecture de l'existant comme écriture), jointure depuis un objet commun. Un extracteur ne retient
  comme propriétaire que « commun » ou le membre qui relit (`ctx.userId`), jamais un autre membre.
- **Un montant vit dans la devise du foyer** : `transactions.amount`, `accounts.balance`, les historiques et tout
  agrégat sont dans la devise du foyer (`householdCurrency()`, `src/server/region.ts`), jamais « en euros ». Ce qu'une
  banque écrit dans une autre devise passe par `fxConverter` (`src/server/fx.ts`) à l'arrivée, qui garde l'original
  (`original_amount`, `original_currency`, `balance_original`). Ni « € » ni « EUR » écrits en dur : `money()` (écran :
  `src/client/format.ts` ; serveur : `src/server/region.ts`). Deux exceptions : les cours (`prices`, en euros, le
  pivot) et le coût de l'IA. Le jour qu'il est se demande à `today()` (fuseau du foyer) ; ce qui est propre à la France
  (calendrier fiscal, fêtes locales) se garde par `isFrance(region().country)`.
- **L'adresse décide de la connexion** : une clé d'accès ne se crée qu'en https sur un nom de domaine, ou sur
  `http://localhost` ; ailleurs, le mot de passe. Ce que permet une adresse se demande à `addressInfo()`
  (`src/lib/address.ts` ; son jumeau `scripts/lib/adresse.mjs` pour les scripts, un test compare), jamais à un test
  du nom d'hôte écrit sur place. La clé d'accès reste proposée d'abord ; un écran qui la demande dit avant le geste
  pourquoi elle ne peut pas servir (`pageBlock`, `withPasskey`, `src/client/access.ts`), et ne laisse jamais la
  personne sans moyen d'entrer. Une route d'identification appelée sans session contrôle d'où vient la demande
  (`fromApp`, `src/server/auth.ts`).
- **Serveur en un seul fichier** (`dist/server.mjs`) : jamais d'`import()` dynamique d'un module local côté serveur
  (le serveur ne retrouverait plus ses migrations). Les paquets de `node_modules` peuvent l'être.

## Textes et langues

Le texte français est la clé (`src/lib/i18n.ts`) : `t("Je t'écoute")`, `t("Connecté : {nom}", { nom })`,
`tn("{n} opération", "{n} opérations", n)`, `t("Mois##menu")` pour un homonyme (ce qui suit `##` ne s'affiche pas),
`tk("…")` pour un texte de module traduit plus tard par `t(variable)`.

- **Tout texte affiché passe par `t()`**, écran et serveur, et ses traductions (anglais, allemand, italien, espagnol)
  sont ajoutées dans le même commit. `pnpm i18n:manquants --json` liste ce qui manque ; on écrit un lot JSON
  (`["français", "anglais", "allemand", "italien", "espagnol"]` par ligne, des couples pour un pluriel), contrôlé par
  `scripts/i18n/verifier-lot.py` et fusionné par `scripts/i18n/ecrire.py`. Un test échoue si une traduction manque,
  ne sert plus ou n'a pas les mêmes variables. Les textes qui ne servent qu'au manuel sont rangés à part par
  `ecrire.py` (`src/i18n/manual/<langue>.ts`, chargé avec le manuel) : rien à faire à la main.
- Côté serveur, `t()` n'est juste que pendant une requête (jamais au chargement d'un module : `tk`). Une tâche de fond
  écrit dans la langue du membre : `runInLang(await memberLang(id), …)`.
- On ne traduit ni « Pécule », ni une valeur comparée ou envoyée au serveur, ni ce que lit l'IA (consignes, outils,
  résultats restent en français ; `languagePrompt()` lui fait répondre dans la langue du membre). Seule exception :
  le manuel, que l'assistant lit dans la langue du membre pour nommer les boutons comme son écran.
- **Le manuel suit l'appli** (`src/lib/manual/`, `/manuel`) : une fonction ajoutée, déplacée ou renommée se reporte
  dans son article, dans le même commit. Le nom d'un bouton, d'un menu ou d'un écran s'y écrit `[[texte passé à t()]]`,
  jamais en toutes lettres : il est rendu dans la langue du membre, et un test échoue s'il n'existe plus.
- Registre familier partout (tu, you, du, tú). Les noms de catégories sont des données : traduits à l'affichage par
  `td(nom)`, jamais dans les comparaisons.

## Base de données

- Schéma par domaine dans `src/server/db/schema/` (clés camelCase, colonnes snake_case). Le SQL écrit à la main
  (`q`, `one`, `exec` de `src/server/db.ts`) sert aux statistiques et aux écritures simples.
- Après une modification du schéma : `pnpm db:generate --name <nom>`, relire la migration, puis
  `pnpm local base && pnpm db:initial` (le schéma de départ d'une installation neuve ; un test vérifie qu'il est à
  jour). Les migrations s'appliquent au démarrage, sous verrou. Une migration ne se modifie plus une fois publiée.
- Rien de propre à un moteur dans la structure : une installation neuve démarre sur MariaDB 10.6 comme sur MySQL 8
  (les contrôles automatiques l'essaient). Une table créée par une migration reçoit le jeu de caractères et la
  collation de Pécule (`withTableOptions`, `src/server/migrate-rules.ts`), jamais ceux du serveur ; un test refuse un
  schéma de départ qui en porterait d'autres.
- Ni dans les requêtes : MySQL 8 refuse ce que MariaDB laisse passer — un `GROUP BY` par un alias qui porte le nom
  d'une colonne prend la colonne (regrouper par position, ou par un alias qui n'est le nom d'aucune colonne). Les
  contrôles automatiques appellent chaque lecture sur les deux moteurs (`scripts/sonde-lectures.mjs`) : une route de
  lecture ajoutée s'inscrit dans `scripts/sonde/lectures.mjs` avec les réglages qui changent sa requête (un test
  compare) ; un outil de lecture y est appelé de lui-même.
- Toute colonne `LONGBLOB` se déclare dans `FILE_TABLES` (`src/server/backup-format.ts`) : la sauvegarde complète en
  dépend (un test compare au schéma).
- Le dossier des sauvegardes du serveur se demande à `backupDir()` (`src/server/archives.ts`), jamais à un chemin
  écrit en dur : il est choisi pour survivre à une mise à jour chez tout hébergeur (`src/server/backup-dir.ts`), sans
  que celui qui installe ait un réglage à faire. Un dossier créé pour des archives l'est par `ensurePrivateDir`.
- Une migration se rejoue sans dégât : un démarrage coupé la reprend (`src/server/migrate-rules.ts`), et une base
  déjà en service est sauvegardée sur le serveur juste avant (`src/server/pre-migration.ts`). Replier d'anciennes
  migrations dans le schéma de départ ne se fait qu'à une version majeure, en portant `pecule.depuis`
  (`package.json`) à la dernière version qui les contenait encore : c'est la version palier que Pécule annonce.

## Versions et publication

- Une version = `version` de `package.json`, sa section `## x.y.z` dans `CHANGELOG.md` (elle devient les notes de la
  version : ce qui change pour le foyer d'abord, puis les migrations et les réglages nouveaux) et le titre du
  commit. Versionnage sémantique : une version majeure pour ce qui demande un geste à celui qui héberge (réglage
  obligatoire, version de Node, migrations repliées).
- Publier : pousser l'étiquette `vX.Y.Z` sur le commit de la version (`git tag v1.22.0 && git push origin v1.22.0`).
  `.github/workflows/publication.yml` refuse une étiquette qui n'est pas la version du paquet, publie l'image
  (`ghcr.io/enki-engineer/pecule`), joint à la version ses formats (`compose.yaml`, `pecule.tar.gz`, `pecule.zip`,
  `SHA256SUMS`, fabriqués par `scripts/paquet.mjs`), crée la version sur GitHub et avance la branche `stable`. Une
  étiquette publiée ne se déplace pas : un correctif est une nouvelle version. Dans un flux, une action s'écrit par
  l'empreinte de son commit (version en commentaire, Dependabot la suit), jamais par une étiquette ; le flux de
  publication n'a ni cache partagé, ni jeton laissé dans le dépôt cloné.
- Le serveur ne s'installe jamais lui-même une mise à jour : il annonce la version publiée (`src/server/updates.ts`,
  réservé à l'administrateur, fermé en démo) et affiche la commande de son installation (`src/lib/install.ts` :
  `docker compose pull && docker compose up -d`, ou `scripts/maj.mjs`). La version en service ne se lit que par une
  route d'administration (`GET /api/updates`), jamais par `/api/health`, ouverte à tous.
- Un réglage nouveau a une valeur par défaut qui ne change rien pour une installation existante, se décrit dans
  `.env.example` et dans les notes de la version, et s'ajoute à l'environnement du service « pecule » de
  `compose.yaml` (par son seul nom : il est lu dans `.env` s'il y est ; un test compare au schéma).

## Installation

- **Trois formats, une seule façon de faire** : `compose.yaml` seul (Docker), l'archive prête à l'emploi
  (`scripts/paquet.mjs`), les sources — et l'appli pour Mac (`bureau/`), qui est l'archive avec Node et MySQL
  fournis (`docs/guide/appli-mac.md`). Une étape ajoutée à l'installation se reporte dans `AGENTS.md` (la marche à
  suivre des agents IA, lisible par son adresse sans cloner le dépôt), `docs/guide/installation.md` et la compétence
  `skills/pecule/SKILL.md`, recopiée dans `.claude/skills/pecule/` (un test compare).
- **Le paquet npm « create-pecule » n'est que l'installateur** (`scripts/pecule.mjs`, fabriqué par
  `node scripts/paquet.mjs --npm` ; commande `npm create pecule` — npm refuse le nom « pecule », trop proche d'un
  autre paquet) : il télécharge l'archive de la dernière version et contrôle son empreinte, par les mêmes fonctions
  que `maj.mjs` (`scripts/lib/archive.mjs`). Rien de l'appli n'est sur npm, et il ne se republie que lorsqu'il
  change (`npm publish dist/paquet/npm --access public`, que le titulaire du compte npm valide dans son navigateur).
- **Avec Docker, rien à écrire** : les secrets sont tirés par le service « reglages » et gardés dans un volume
  (`src/lib/settings-file.ts`). Ce que donne l'environnement l'emporte ; on ne tire jamais un secret à la
  place d'un secret que l'installation a déjà, et l'environnement n'en remplace aucun en silence (`refusals` : une
  variable du terminal ne se distingue pas d'une ligne de `.env` — le changement se demande par `FORCE_SETTINGS=1`).
- **`dependencies` = ce que le serveur charge en service**, rien d'autre : l'image et l'archive n'installent
  qu'elles. Ce qui ne sert qu'à construire l'écran va dans `devDependencies` (le build refuse un paquet mal rangé).
- **Les scripts de l'installation tournent avec Node seul** (`doctor`, `lien`, `importer` : aucun fichier TypeScript
  importé), lisent les réglages par `scripts/lib/reglages.mjs`, ont un `--help` et un `--json`, et n'affichent
  jamais un secret — sauf le lien du premier démarrage, qui est fait pour être remis.
- **L'appli de bureau ne change rien pour un serveur** : ce qui lui est propre se garde par
  `installKind() === "bureau"` côté serveur, par `useDesktop()` (ou `access.desktop`) à l'écran — où elle a ses
  mots : « cet ordinateur », jamais « le serveur », ni commande à lancer. La fenêtre n'est qu'une fenêtre : la page
  ne reçoit aucune API de la coque, tout ce qui peut se décider hors d'elle vit dans le superviseur
  (`scripts/bureau.mjs`, règles pures dans `src/lib/desktop.ts`), et chaque comportement de la coque a son essai
  rejouable (`bureau/essais/`). Un texte de la coque se déclare dans `src/lib/desktop-texts.ts` et se traduit comme
  les autres (`pnpm exec tsx scripts/bureau-textes.ts` refait son fichier ; un test compare).

## Interface

- Un écran passe par `PageHeader` (il porte le titre, le retour et la zone sûre du téléphone ; `sticky` : ce qui
  reste sous la barre au défilement sur téléphone, comme le choix du mois). Ajouter un écran =
  sa route (`src/client/app.tsx`), `ROUTES` (`components/MobileShell.tsx`), `NAV` (`src/client/nav.ts`) et sa page
  d'aide (`HELP_RULES`, `src/lib/manual-help.ts` : le « ? » de la barre du haut y mène ; un test le vérifie).
- Mise en page différente sur ordinateur : un composant `…Desktop` choisi par `useMedia("(min-width: 768px)")`
  **après** tous les hooks. Ne jamais définir un composant à l'intérieur d'un autre.
- Une requête dont la clé change avec un réglage de l'écran porte `placeholderData: keepPreviousData` ; l'écran ne
  montre le squelette qu'au premier chargement.
- Opérations et Factures forment une section (`components/OpsSection.tsx`) : les deux écrans restent montés, celui
  qu'on quitte est masqué. Ils lisent leur adresse par `useTabParams()` et `useTabState()`, jamais par
  `useSearchParams()` ni `useLocation()` (un écran masqué y lirait l'adresse de l'autre, et tous deux seraient rendus
  à chaque bascule).
- Couleurs : `var(--color-accent)` et les variables `--series-1…8` des graphiques, jamais de couleur en dur.
  Contraste de 4,5 au moins. Pas de script en ligne (la CSP l'interdit). Le vert et le rouge (`--color-pos`,
  `--color-neg`) sont réservés à l'argent : ce qui entre, ce qui sort, ce qui est mis de côté. La couleur choisie
  dans Réglages peut elle-même être verte : une série posée à côté d'un vert prend `--color-ink`, pas l'accent.
- Un chiffre mis en avant porte `.figure` ; un montant étiqueté porte `.chip` et son ton (`.chip-pos`, `.chip-neg`,
  `.chip-solid` pour l'épargne, `.chip-dashed` pour ce qui est attendu). Pas de titre en capitales.
- Infobulle : un `title` (ou `data-tip`) suffit, la bulle de l'appli le remplace partout (`components/Tooltip.tsx`) ;
  un raccourci écrit entre parenthèses à la fin (« Rechercher (⌘K) ») est rendu comme une touche. Pour expliquer un
  chiffre : une pastille `<span data-tip={…} tabIndex={0}>` (elle s'ouvre aussi au toucher).
- Un montant affiché passe par `money()`, `moneyIn()`, `kMoney()`, `unitMoney()` ou `kAxis()` (`src/client/format.ts`) :
  ce sont eux que le mode discret masque. Un montant qui quitte l'écran (question posée à l'assistant) prend
  `plainMoney()`. Un chiffre calculé s'explique par `info` sur `Stat` ou par `<InfoTip>`. Les marges et hauteurs
  restent en rem (classes Tailwind) : c'est ce que la densité « compacte » resserre.
- Un `useEffect(() => expr)` qui renvoie une valeur casse l'écran : toujours des accolades.
- Une réponse gardée sur l'appareil (requêtes de `KEEP`, `src/client/offline.tsx`) peut dater de la version d'avant :
  un champ ajouté à l'une d'elles se lit avec un repli (`data.history ?? []`) et se déclare facultatif — sans quoi
  l'écran ne s'ouvre plus chez qui avait l'ancienne réponse. « Recharger », sur l'écran d'erreur, oublie ces données.

## Étendre Pécule

| Ajouter | Où |
| --- | --- |
| Un outil de l'assistant et du serveur MCP | `src/server/tools/` : nom, description, schéma zod, `run` (et `describe` pour une action) |
| Un type de document lu par l'import massif | `src/server/imports/extractors/` + une ligne dans `EXTRACTORS` ; au besoin `rows` (longue liste lue en plusieurs réponses, corrigeable ligne à ligne), `parts` (plusieurs objets dans un fichier), `shared` (choix reporté aux fichiers du même objet), `overview` (ce que le lot dit d'ensemble) — voir `releve.ts` |
| Une marque (logo, reconnaissance d'un libellé) | une ligne dans `src/lib/brands.ts` |
| Un assistant qui se connecte au serveur MCP par OAuth | une ligne dans `src/lib/mcp-clients.ts` : son nom et ses adresses de retour exactes, prises dans le document qu'il publie ou dans sa documentation (un programme de l'ordinateur n'en a pas besoin : il revient par une boucle locale) |
| Un fournisseur d'IA qui parle l'API Messages | `src/lib/ai-providers.ts` et `buildClient` (`src/server/ai.ts`) |
| Un appel à l'IA d'un nouveau genre, ou le tarif d'un modèle | `recordUsage(nom, …)` après l'appel ; son usage dans `usageKind` et `KIND_GROUP`, le tarif dans `MODEL_PRICES` (`src/lib/ai-usage.ts`) ; son libellé dans `components/AiCost.tsx` |
| Un écran facultatif | `MODULE_INFO` dans `src/lib/modules.ts` |
| Une carte ou un chiffre clé du tableau de bord | `DASH_CARDS` ou `DASH_KPIS` (`src/lib/dashboard.ts` : libellé, largeur d'origine, largeur minimale, et `form` si la carte a deux formes) et son contenu dans `blocks` ou `kpis` (`pages/Dashboard.tsx`) : le mode construction la déplace, l'élargit, la retire et la propose dans « Ajouter ». Une carte dit d'abord l'essentiel — un graphique (`components/RingCard.tsx`, `Sparkline`), quelques lignes — et garde la liste pour sa forme « détail » ; un chiffre clé porte une mini-courbe ou une jauge plutôt qu'une phrase. Un modèle est une ligne de `DASH_TEMPLATES` : dix cartes au plus, rangées pleines (un test le vérifie) |
| Un bloc de l'accueil du téléphone | `HOME_CARDS` (`src/lib/home-layout.ts`) et son contenu dans `blocks` (`pages/Home.tsx`) : le mode construction le déplace, le retire et le propose dans « Ajouter » ; il entre dans un modèle par `HOME_TEMPLATES` — hors de « Vue d'ensemble », un appareil déjà réglé le reçoit retiré (réglage gardé par l'appareil, `src/lib/card-layout.ts`) |
| Une fête ou un thème | `src/lib/seasons.ts`, recopié dans `public/theme-init.js` (un test compare) |
| Une couleur proposée dans Réglages | `ACCENTS` (`src/lib/seasons.ts`) et son bloc `[data-accent="…"]`, clair et sombre (`src/styles/index.css`) |
| Une blockchain lue par une adresse publique | son genre et la forme de ses adresses dans `src/lib/crypto-chains.ts` (`WALLET_KINDS`, `detectWallet`), son lecteur dans `src/server/chains/` (lecture seule, services publics écrits dans le code, sans clé), une ligne dans `READERS` (`src/server/crypto.ts`) ; une chaîne compatible Ethereum : une ligne dans `EVM_CHAINS` et ses nœuds dans `RPC` (`src/server/chains/evm.ts`). Les jetons lus se refabriquent par `node scripts/jetons-crypto.mjs` (jamais retouchés à la main) |
| Un exchange crypto relié par une clé en lecture seule | une ligne dans `EXCHANGES` (`src/lib/crypto-exchanges.ts` : nom, champs de la clé, marche à suivre, ce qui est lu), son client dans `src/server/exchanges/` — liste blanche de chemins de lecture, signature vérifiée par un test contre l'exemple de sa documentation (à défaut, contre une empreinte calculée à part), refus d'une clé qui peut faire plus que lire quand l'exchange dit ses droits, `ExchangeError` (`refused` : la clé est en cause) — et une ligne dans `READERS` (`src/server/exchanges/index.ts`). La clé ne figure jamais dans une erreur, un journal ou une réponse |
| Une appli crypto suivie par ses exports | une ligne dans `FILE_APPS` (`src/lib/crypto-files.ts` : nom, format du fichier, marche à suivre, ce qui est lu), son lecteur pur à côté — un mouvement signé par ligne, une clé qui distingue chaque ligne, les genres de ligne inconnus rendus dans `unknown` plutôt que devinés —, essayé sur des lignes fictives, et une ligne dans `FILE_READERS` (`src/server/crypto.ts`) ; un classeur Excel se lit par `readXlsxRows` (`src/server/xlsx.ts`), sans paquet. Sa marque : une ligne dans `src/lib/brands.ts` |
| Un genre de mouvement du journal crypto | `EVENT_KINDS` et `EVENT_KIND_INFO` (`src/lib/crypto-events.ts` : libellé et explication, traduits) ; la correspondance avec les lignes d'un export dans `moveEventKind` (`src/lib/crypto-files.ts`) |
| Une plateforme crypto reconnue dans un libellé bancaire | une ligne dans `CRYPTO_PLATFORMS` (`src/lib/crypto-moves.ts`) : son nom, et les mots qui la désignent sur un relevé — sa marque, la société qui encaisse pour elle ; elle se propose alors au journal, jamais sans le membre |
| Le registre d'un exchange (date, cours et frais exacts d'un achat ou d'une vente) | son lecteur dans `src/server/exchanges/` — un seul chemin de lecture de plus sur la liste blanche, écritures rendues en `LedgerEntry` (`src/lib/crypto-ledger.ts`), `null` quand la clé n'en a pas le droit, essayé contre l'exemple de sa documentation — et une ligne dans `HISTORY` (`src/server/exchanges/index.ts`) ; le droit à cocher se dit dans son guide (`EXCHANGES`) |
| Une devise (cotée par la BCE) ou un pays | `CURRENCIES` (`src/lib/currencies.ts`), `COUNTRIES` (`src/lib/countries.ts`) |
| Un article du manuel | `src/lib/manual/<thème>.ts` : identifiant, titre, résumé, blocs, écrans à ouvrir, mots de recherche ; l'assistant et la recherche le trouvent seuls |
| Une étape de la présentation de bienvenue | `WELCOME_STEPS` et ses règles (`src/lib/onboarding.ts`), son contenu et son illustration dans `body` et `art` (`pages/Onboarding.tsx`, `components/WelcomeArt.tsx`), sa place sur téléphone dans `ART_PHONE` ; un temps du guide « Relier ta banque » : `BANK_GUIDE_STEPS` et `components/BankGuide.tsx` (le guide ne se fie qu'à ce que le serveur sait lire, et à ce que le membre dit avoir fait chez Enable Banking) |
| Une étape de la visite guidée | son identifiant et sa place dans `tourSteps` (`src/lib/tour.ts`), son repère `data-tour` dans la coquille (`components/Layout.tsx`, `MobileShell.tsx` : un test vérifie qu'il existe), son titre et son texte dans `words` (`components/Tour.tsx`) ; la visite ne fait que montrer : elle n'écrit rien et rend l'écran d'où l'on est parti |
| Une option de la mise à jour | `scripts/maj.mjs` (Node seul, sans dépendance) et `docs/guide/mise-a-jour.md` |
| Une commande de l'installation | `scripts/<nom>.mjs` (Node seul, `--help`, `--json`) ; pour qu'elle existe avec Docker et dans l'archive : la ligne `COPY` du `Dockerfile` et `SCRIPTS` de `scripts/paquet.mjs` |
| Une pièce de l'appli de bureau (Node, MySQL) ou sa version | `bureau/pieces.json` : adresse chez l'éditeur, empreinte SHA-256 du fichier, fichiers gardés ; puis `node bureau/fabriquer.mjs` et les cinq essais de `bureau/essais/` |
| Une chose que l'écran demande à la fenêtre de l'appli de bureau | son nom dans `shellAction` (`src/client/desktop.ts`, gardé par `useShell()`), son traitement sous « pecule-action » dans `naviguer_principale` (`bureau/src-tauri/src/main.rs` : seulement venue d'une page de Pécule, valeurs contrôlées), son essai dans `bureau/essais/fenetre.mjs` ; la page n'apprend rien de la fenêtre, sinon ce que celle-ci écrit sur elle (`data-pecule-zoom`) |
| Un élément du menu de l'appli de bureau | son texte dans `SHELL_TEXTS` (`src/lib/desktop-texts.ts`), l'élément dans `menu` et son geste dans `action_menu` (`bureau/src-tauri/src/main.rs`), son essai dans `bureau/essais/fenetre.mjs` |
| Une commande que l'appli affiche à celui qui l'héberge | `src/lib/install.ts` (une par façon d'installer), jamais écrite en dur dans un écran |
| Un réglage que l'assistant peut changer | `src/server/tools/reglages.ts` ; s'il est gardé par l'appareil : `DeviceSettings` (`src/lib/device-settings.ts`) et `applyDeviceSettings` (`src/client/deviceSettings.ts`) |

La logique qui peut être pure va dans `src/lib/` avec son test à côté (`*.test.ts`).
