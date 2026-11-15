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
- Toute colonne `LONGBLOB` se déclare dans `FILE_TABLES` (`src/server/backup-format.ts`) : la sauvegarde complète en
  dépend (un test compare au schéma).

## Interface

- Un écran passe par `PageHeader` (il porte le titre, le retour et la zone sûre du téléphone). Ajouter un écran =
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
| Un type de document lu par l'import massif | `src/server/imports/extractors/` + une ligne dans `EXTRACTORS` |
| Une marque (logo, reconnaissance d'un libellé) | une ligne dans `src/lib/brands.ts` |
| Un fournisseur d'IA qui parle l'API Messages | `src/lib/ai-providers.ts` et `buildClient` (`src/server/ai.ts`) |
| Un écran facultatif | `MODULE_INFO` dans `src/lib/modules.ts` |
| Un bloc du tableau de bord ou de l'accueil du téléphone | `DASH_CARDS` et `blocks` (`pages/Dashboard.tsx`), `HOME_CARDS` (`pages/Home.tsx`) : il devient déplaçable et masquable (`components/CardLayout.tsx`) |
| Une fête ou un thème | `src/lib/seasons.ts`, recopié dans `public/theme-init.js` (un test compare) |
| Une couleur proposée dans Réglages | `ACCENTS` (`src/lib/seasons.ts`) et son bloc `[data-accent="…"]`, clair et sombre (`src/styles/index.css`) |
| Une devise (cotée par la BCE) ou un pays | `CURRENCIES` (`src/lib/currencies.ts`), `COUNTRIES` (`src/lib/countries.ts`) |
| Un article du manuel | `src/lib/manual/<thème>.ts` : identifiant, titre, résumé, blocs, écrans à ouvrir, mots de recherche ; l'assistant et la recherche le trouvent seuls |
| Un réglage que l'assistant peut changer | `src/server/tools/reglages.ts` ; s'il est gardé par l'appareil : `DeviceSettings` (`src/lib/device-settings.ts`) et `applyDeviceSettings` (`src/client/deviceSettings.ts`) |

La logique qui peut être pure va dans `src/lib/` avec son test à côté (`*.test.ts`).
