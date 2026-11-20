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
- **Toute requête sur les opérations passe par les comptes du membre** (`userAccounts(req)`) : masquer un compte ou le
  sortir des statistiques est un réglage par membre.
- **Le mode démo ne touche jamais la vraie base** : `src/server/demo-context.ts` aiguille chaque requête ; toute route
  qui appelle un service extérieur ou donne un accès s'ajoute à `BLOCKED` (`src/server/demo.ts`) ou se garde par
  `isDemo()`.
- **Rien n'est écrit sans confirmation par l'IA** : les actions de l'assistant attendent « Confirmer », les
  propositions de l'import massif attendent la validation, et tout ce qu'une validation écrit passe par un journal
  annulable (`src/server/imports/track.ts`).
- **Un montant vit dans la devise du foyer** : `transactions.amount`, `accounts.balance`, les historiques et tout
  agrégat sont dans la devise du foyer (`householdCurrency()`, `src/server/region.ts`), jamais « en euros ». Ce qu'une
  banque écrit dans une autre devise passe par `fxConverter` (`src/server/fx.ts`) à l'arrivée, qui garde l'original
  (`original_amount`, `original_currency`, `balance_original`). Ni « € » ni « EUR » écrits en dur : `money()` (écran :
  `src/client/format.ts` ; serveur : `src/server/region.ts`). Deux exceptions : les cours (`prices`, en euros, le
  pivot) et le coût de l'IA. Le jour qu'il est se demande à `today()` (fuseau du foyer) ; ce qui est propre à la France
  (calendrier fiscal, fêtes locales) se garde par `isFrance(region().country)`.
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
  étiquette publiée ne se déplace pas : un correctif est une nouvelle version.
- Le serveur ne s'installe jamais lui-même une mise à jour : il annonce la version publiée (`src/server/updates.ts`,
  réservé à l'administrateur, fermé en démo) et affiche la commande de son installation (`src/lib/install.ts` :
  `docker compose pull && docker compose up -d`, ou `scripts/maj.mjs`). La version en service ne se lit que par une
  route d'administration (`GET /api/updates`), jamais par `/api/health`, ouverte à tous.
- Un réglage nouveau a une valeur par défaut qui ne change rien pour une installation existante, se décrit dans
  `.env.example` et dans les notes de la version, et s'ajoute à l'environnement du service « pecule » de
  `compose.yaml` (par son seul nom : il est lu dans `.env` s'il y est ; un test compare au schéma).

## Installation

- **Trois formats, une seule façon de faire** : `compose.yaml` seul (Docker), l'archive prête à l'emploi
  (`scripts/paquet.mjs`), les sources. Une étape ajoutée à l'installation se reporte dans `AGENTS.md` (la marche à
  suivre des agents IA, lisible par son adresse sans cloner le dépôt), `docs/guide/installation.md` et la compétence
  `skills/pecule/SKILL.md`, recopiée dans `.claude/skills/pecule/` (un test compare).
- **Le paquet npm « pecule » n'est que l'installateur** (`scripts/pecule.mjs`, fabriqué par
  `node scripts/paquet.mjs --npm`) : il télécharge l'archive de la dernière version et contrôle son empreinte, par
  les mêmes fonctions que `maj.mjs` (`scripts/lib/archive.mjs`). Rien de l'appli n'est sur npm, et il ne se republie
  que lorsqu'il change. Aucun guide n'annonce « npx pecule » tant que le nom n'est pas publié par le projet.
- **Avec Docker, rien à écrire** : les secrets sont tirés par le service « reglages » et gardés dans un volume
  (`src/lib/settings-file.ts`). Ce que donne l'environnement l'emporte toujours ; on ne tire jamais un secret à la
  place d'un secret que l'installation a déjà.
- **`dependencies` = ce que le serveur charge en service**, rien d'autre : l'image et l'archive n'installent
  qu'elles. Ce qui ne sert qu'à construire l'écran va dans `devDependencies` (le build refuse un paquet mal rangé).
- **Les scripts de l'installation tournent avec Node seul** (`doctor`, `lien`, `importer` : aucun fichier TypeScript
  importé), lisent les réglages par `scripts/lib/reglages.mjs`, ont un `--help` et un `--json`, et n'affichent
  jamais un secret — sauf le lien du premier démarrage, qui est fait pour être remis.

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
| Une devise (cotée par la BCE) ou un pays | `CURRENCIES` (`src/lib/currencies.ts`), `COUNTRIES` (`src/lib/countries.ts`) |
| Un article du manuel | `src/lib/manual/<thème>.ts` : identifiant, titre, résumé, blocs, écrans à ouvrir, mots de recherche ; l'assistant et la recherche le trouvent seuls |
| Une option de la mise à jour | `scripts/maj.mjs` (Node seul, sans dépendance) et `docs/guide/mise-a-jour.md` |
| Une commande de l'installation | `scripts/<nom>.mjs` (Node seul, `--help`, `--json`) ; pour qu'elle existe avec Docker et dans l'archive : la ligne `COPY` du `Dockerfile` et `SCRIPTS` de `scripts/paquet.mjs` |
| Une commande que l'appli affiche à celui qui l'héberge | `src/lib/install.ts` (une par façon d'installer), jamais écrite en dur dans un écran |
| Un réglage que l'assistant peut changer | `src/server/tools/reglages.ts` ; s'il est gardé par l'appareil : `DeviceSettings` (`src/lib/device-settings.ts`) et `applyDeviceSettings` (`src/client/deviceSettings.ts`) |

La logique qui peut être pure va dans `src/lib/` avec son test à côté (`*.test.ts`).
