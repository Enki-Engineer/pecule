# AGENTS.md — Pécule pour un agent

Pécule est une application web de suivi des finances d'un foyer (comptes, opérations, catégories, patrimoine,
factures, documents, impôts, retraite), que chaque foyer héberge lui-même. Ce fichier s'adresse à un agent IA à qui
l'on demande d'**installer, configurer, vérifier, mettre à jour** une instance, ou d'**y charger des documents**.
Pour contribuer au code, les règles sont dans `CLAUDE.md`.

## Ce que tu peux faire sans rien demander

Lire le dépôt, lancer `node scripts/doctor.mjs`, `node scripts/importer.mjs <dossier> --a-blanc`, `pnpm lint`,
`pnpm test`, `pnpm build`, et lire l'API d'une instance avec son jeton (il n'ouvre rien tant qu'aucun membre n'existe :
l'API répond alors 409). Les scripts se lancent depuis la racine du dépôt ; chacun a son `--help`.

## Ce qui demande l'accord de la personne

- Écrire ou remplacer un fichier `.env` (`setup.mjs` refuse d'écraser un fichier existant sans `--force`).
- Démarrer, arrêter ou reconstruire des conteneurs ; supprimer un volume (`docker compose down -v` efface la base).
- Tout ce qui écrit dans une instance en service : valider un import, restaurer une sauvegarde, changer un réglage.
- Envoyer des documents à l'instance quand un fournisseur d'IA y est réglé : ils lui seront transmis, et la lecture a
  un coût (annonce l'estimation rendue à l'ouverture du lot).

Ne demande jamais à la personne de te dicter un secret dans la conversation : les secrets sont produits par
`setup.mjs` et restent dans `.env`. Une exception, voulue : le **code d'installation** (rendu par `setup.mjs`, et lisible
dans `.env` à la clé `SETUP_CODE`) se remet une fois à la personne, qui le saisit au premier démarrage.

## Installer

Suis `docs/guide/installation.md`. En résumé, chaque étape se vérifie :

| Étape | Commande | Réussite |
| --- | --- | --- |
| Réglages | `node scripts/setup.mjs --docker [--port 3000] --json` (ou `--base "mysql://…" --url https://…`) | `{"ok":true,…,"portBusy":false,"installationCode":"…"}` ; si `portBusy`, recommence avec un autre `--port` et `--force` |
| Démarrage | `docker compose up -d --build` (ou `pnpm install --frozen-lockfile && pnpm build && node dist/server.mjs`) | `GET /api/health` → `{"ok":true,"phase":"pret"}` |
| Contrôle | `node scripts/doctor.mjs --json` | `ok: true` ; la ligne `premier_demarrage` porte `todo: true` tant qu'aucun membre n'existe |
| Premier membre | la personne ouvre l'adresse, donne son prénom et le code d'installation, crée sa clé d'accès | `doctor` : « Le foyer a ses membres » |

La création de la clé d'accès (Face ID, Touch ID) est le seul geste que tu ne peux pas faire à sa place.

Pièges connus : port 3000 souvent pris (`--port`) ; une image Docker `pecule` déjà présente sur la machine est
réécrite par le build (`PECULE_IMAGE=autre-nom` dans `.env` pour l'éviter) ; https obligatoire hors `localhost` ; l'adresse ouverte dans le navigateur doit être exactement
`APP_URL` ; sur un hébergeur Node, gestionnaire **pnpm**, entrée `dist/server.mjs`, aucun répertoire de sortie ;
changer `SECRET_KEY` (ou `API_TOKEN` sur une installation sans `SECRET_KEY`) rend illisibles les clés enregistrées
dans l'appli.

## Configurer

Tout le reste se règle dans l'appli, par la personne ou avec elle :

- **Banques** : Réglages → Comptes et connexions. Enable Banking demande un compte et une application à son nom, puis un
  accord donné auprès de sa banque : guide `docs/connecteurs/enable-banking.md`. Sans cela : import d'un fichier
  (OFX, QIF, CSV) ou compte tenu à la main.
- **IA** : Réglages → Comptes et connexions → Intelligence artificielle (clé chiffrée en base). Facultatif.
- **Écrans** : Réglages → Foyer.

## Charger des documents

```sh
node scripts/importer.mjs <dossier> --a-blanc --json      # ce qui serait envoyé
node scripts/importer.mjs <dossier> --plafond 5 --json    # ouvre un lot, envoie, attend la lecture
```

`--a-blanc` trie d'après le type et la taille, sans contacter l'instance ; une option inconnue arrête la commande.
Un import réel demande qu'un membre existe déjà.

Puis relis le lot : une proposition n'est jamais écrite sans validation. Valide d'un coup ce qui est « sûr »
(`--lot <n> --valider-surs`), et présente le reste à la personne (champs lus, contrôles en échec, écarts avec ce que
Pécule contient déjà) avant de valider fichier par fichier. Détail : `docs/guide/importer-des-documents.md`.

Par le serveur MCP de l'instance (`POST /api/mcp`, jeton d'administration ou connexion OAuth) : `list_imports`,
`get_import_item`, `review_import_item`, `validate_safe_imports`, et tous les outils de lecture et d'action de
Pécule (`tools/list`).

## Arrêter, désinstaller

`docker compose down` arrête Pécule et garde la base. `docker compose down -v` **efface la base** : jamais sans
l'accord de la personne et une sauvegarde. Pour tout retirer ensuite : `docker rmi pecule`, puis `.env`.

## Mettre à jour

1. Sauvegarde complète : `pnpm sauvegarde` (archive dans `data/sauvegardes/`, relue en entier après téléchargement).
2. `git pull`, puis `docker compose up -d --build` — ou `pnpm install --frozen-lockfile && pnpm build` et redémarrage.
3. `node scripts/doctor.mjs` : les migrations de la base se sont appliquées au démarrage.

## Diagnostiquer

`node scripts/doctor.mjs --json` d'abord. Puis le journal du serveur (`docker compose logs pecule --tail 100`), et dans
l'appli Réglages → Suivi technique (alertes, synchronisations, journal des modifications).
