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
| `scripts/` | `setup`, `doctor`, `maj` (mise à jour), `importer`, sauvegarde et restauration, notes de version, base locale, outils de traduction |
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
  instantané par membre et par jour).
- **Situation** — `properties`, `commitments` (engagements récurrents), `payslips`, `tax_returns`, `property_taxes`,
  `retirement_simulations`, `career_periods`, `projections`. Les indicateurs sont recalculés, jamais stockés.
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
  d'extracteurs (schéma pour l'IA, contrôles arithmétiques, écriture), journal d'écritures annulable.

## Membres, accès, vie privée

- Connexion par **clés d'accès** (WebAuthn) ; sessions en base ; le premier membre, créé avec le code d'installation,
  est l'administrateur. Le jeton d'administration (`API_TOKEN`) agit en son nom.
- Chaque donnée est **commune** (`owner_user_id` nul) ou **privée** à un membre. Un compte est commun, personnel,
  professionnel ou à une personne sans connexion ; chaque membre règle ce qu'il masque.
- **Mode démo** : une seconde base, remplie d'une famille fictive, vers laquelle sont aiguillées toutes les requêtes
  d'une session de démo. Les services extérieurs et les accès y sont fermés.
- **Sauvegarde complète** : une archive de toute la base et de tous les fichiers (`src/server/backup.ts`), restaurable
  dans une base vide (`pnpm restaurer`) ou, depuis l'écran de premier démarrage, dans une installation neuve
  (`src/server/restore.ts` : archive envoyée par morceaux, relue avant d'écrire, témoin `_restauration_en_cours` qui
  fait repartir de neuf une restauration coupée par l'arrêt du serveur). Le serveur en garde dans son dossier
  (`src/server/archives.ts`) : celles d'avant migration, et les automatiques quand l'administrateur les demande
  (`src/server/auto-backup.ts`, règles pures dans `src/lib/backup-plan.ts` : une par nuit ou par semaine, relue,
  rotation ; un échec ou un mois sans sauvegarde est notifié à l'administrateur).
- Écritures tracées dans `audit_log`, erreurs dans `alerts` (Réglages → Suivi technique).

## L'IA

Facultative, et toujours avec la clé du foyer (`src/lib/ai-providers.ts`, réglages chiffrés en base). Trois usages :
lire un document (sortie JSON structurée), l'assistant (boucle d'outils : les lectures s'exécutent, les écritures
attendent une confirmation), et les traductions des noms de catégories. Les outils sont déclarés une fois
(`src/server/tools/`) et servent à l'assistant comme au **serveur MCP** (`POST /api/mcp`, jeton d'administration ou
OAuth 2.1 pour un assistant extérieur).

Le coût de chaque appel est enregistré (`ai_usage`, une ligne par appel : `recordUsage` pour un appel compté en
jetons, `recordCost` pour le mode vocal, compté au caractère lu et à l'audio transcrit), en dollars et en euros au
cours du jour. Les tarifs, le rangement d'un appel dans son usage et les calculs (projection du mois, économie du
cache, état du plafond) sont purs, dans `src/lib/ai-usage.ts` ; `src/server/ai-usage.ts` en tire le rapport que
lisent l'écran Réglages → Coût de l'IA (`GET /api/assistant/usage`) et l'outil `get_ai_usage`. Le plafond du mois et
le tarif saisi pour un modèle inconnu vivent dans `app_kv` (`ai:budget`, `ai:prices`, `src/server/ai-cost.ts`) :
au plafond, l'administrateur est prévenu (notification « ia ») et, si le foyer l'a choisi, les lectures de fond —
file de l'import massif, traduction des noms — attendent (`backgroundPaused()`). Ce qu'un membre demande lui-même
n'est jamais coupé.

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

## Démarrage

Le port s'ouvre tout de suite ; les migrations suivent, sous verrou (une base vide reçoit le schéma de départ en une
étape, puis le jeu de catégories de départ). `GET /api/health` rend `{ ok, phase }`. Une synchronisation bancaire
planifiée tourne dans le processus quand une source est reliée.

## Versions et mises à jour

- **La version en service** est inscrite dans `dist/server.mjs` au build (`scripts/build-server.mjs`,
  `src/server/version.ts`), avec `pecule.depuis` de `package.json` : la plus ancienne version depuis laquelle
  celle-ci se met à jour directement. Les comparaisons de versions sont des fonctions pures (`src/lib/version.ts`).
- **Publication** : une étiquette `vX.Y.Z` lance `.github/workflows/publication.yml` — image Docker pour amd64 et
  arm64 sur `ghcr.io`, version GitHub dont les notes sont la section de `CHANGELOG.md`
  (`scripts/notes-de-version.mjs`), branche `stable` avancée jusqu'à elle.
- **Annonce** : une fois par jour, `src/server/updates.ts` demande à GitHub la dernière version publiée et la garde
  (`app_kv`, « maj:etat »). `GET /api/updates` (administrateur, fermé en démo) la donne à Réglages → Suivi technique
  (`components/UpdateSettings.tsx`), à `doctor` et à `maj` ; l'administrateur reçoit une notification (type `maj`)
  et l'assistant lit la version par `get_settings`. Les notes de version, écrites hors de l'installation, ne sont
  jamais données à lire à l'IA.
- **Installation** : `scripts/maj.mjs`, sur le serveur — sauvegarde complète téléchargée, image publiée ou
  `git pull` et build, attente de la nouvelle version, `doctor`. Le serveur ne remplace jamais son propre code.
- **Garde-fous** : avant d'appliquer une migration à une base déjà en service, le serveur écrit une sauvegarde
  complète dans `data/sauvegardes` (`src/server/pre-migration.ts`, trois gardées, sous le verrou des migrations) ;
  une migration interrompue reprend (`src/server/migrate-rules.ts`) ; une base trop ancienne pour les migrations
  repliées est refusée sans être modifiée, et le message nomme la version palier.
