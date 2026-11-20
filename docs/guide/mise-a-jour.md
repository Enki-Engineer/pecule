# Mettre Pécule à jour

Pécule ne se met pas à jour tout seul : il vous prévient qu'une version est publiée, et vous lancez la mise à jour
sur le serveur. Une commande fait tout — sauvegarde, nouvelle version, redémarrage, contrôle :

```sh
node scripts/maj.mjs
```

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/) et sont décrites dans le
[journal des versions](../../CHANGELOG.md).

## Savoir qu'une version est publiée

- **Dans l'appli** : Réglages → Suivi technique → « Version et mises à jour » montre la version en service et, s'il y
  en a une plus récente, ses notes et la commande à lancer. Réservé à l'administrateur, qui peut aussi recevoir une
  notification (Réglages → Notifications, « Nouvelle version de Pécule publiée »).
- **En ligne de commande** : `node scripts/maj.mjs --verifier`, ou `node scripts/doctor.mjs`.
- **Sur GitHub** : « Watch » → « Custom » → « Releases » sur le dépôt.

Une fois par jour, le serveur demande à GitHub quelle est la dernière version publiée. Rien d'autre ne part : ni
donnée du foyer, ni adresse de l'installation (GitHub voit l'adresse IP du serveur, comme tout site consulté).
`UPDATE_CHECK=0` dans `.env` coupe cette question ; `UPDATE_REPO=proprietaire/depot` suit les versions d'une copie du
projet.

## Ce que fait `node scripts/maj.mjs`

1. Lit la version en service et la dernière publiée ; s'arrête là si l'installation est à jour.
2. Demande confirmation (`--oui` pour s'en passer).
3. Télécharge une **sauvegarde complète** et la contrôle (elle va dans le dossier des sauvegardes du serveur, ou dans
   `data/sauvegardes/` du dépôt avec Docker : la commande dit où). Sans sauvegarde, rien n'est modifié.
4. Récupère la version :
   - **Docker** : `git pull` (pour `compose.yaml` et les scripts), puis l'image publiée
     (`ghcr.io/enki-engineer/pecule`) et un nouveau conteneur. Si l'image ne peut pas être récupérée, elle est
     construite depuis le dépôt ; `--source` la construit toujours depuis le dépôt.
   - **Node** : `git pull`, `pnpm install --frozen-lockfile`, `pnpm build`. Le serveur est ensuite à redémarrer :
     faites-le à la main quand la commande le demande, ou donnez-lui la commande
     (`--redemarrer "systemctl restart pecule"`).
5. Attend que `/api/health` réponde `"phase":"pret"` **et** que la version en service soit la nouvelle ; s'arrête
   si le démarrage échoue.
6. Lance `node scripts/doctor.mjs`.

Les migrations de la base s'appliquent seules au démarrage de la nouvelle version, sous verrou. Pendant ce temps,
l'appli affiche « Pécule démarre… ».

| Option | Effet |
| --- | --- |
| `--verifier` | Dit où en est l'installation et s'arrête (`--json` pour un outil). |
| `--version 1.22.0` | Installe cette version au lieu de la dernière. |
| `--oui` | Ne demande pas de confirmation. |
| `--sans-sauvegarde` | Ne télécharge pas de sauvegarde (à réserver au cas où vous venez d'en faire une). |
| `--source` | Docker : construit l'image depuis le dépôt. |
| `--redemarrer "<commande>"` | Node : redémarre le serveur après le build. |

## Sans la commande

**Docker**

```sh
pnpm sauvegarde                 # ou Réglages → Compte et sécurité → Sauvegarde complète
git pull
docker compose pull pecule && docker compose up -d pecule
node scripts/doctor.mjs
```

Pour rester sur une version précise plutôt que sur la dernière, fixez l'image dans `.env` :
`PECULE_IMAGE=ghcr.io/enki-engineer/pecule:1.22.0` (ou `:1.22` pour ne recevoir que ses correctifs, `:1` pour toute
la série 1).

**Hébergement Node relié à GitHub** (l'hébergeur reconstruit à chaque envoi sur une branche) : faites-lui suivre la
branche **`stable`**, qui n'avance qu'à chaque version publiée — `main` reçoit le travail en cours. Si vous déployez
votre propre copie du dépôt, mettez-la à jour depuis `stable` (« Sync fork » sur GitHub, ou
`git pull https://github.com/Enki-Engineer/pecule.git stable`) : l'hébergeur fait le reste. Prenez la sauvegarde
avant, depuis l'appli.

**Serveur Node tenu à la main** : sauvegarde, `git pull` (ou `git checkout v1.22.0`),
`pnpm install --frozen-lockfile && pnpm build`, redémarrage, `node scripts/doctor.mjs`.

## Les sauvegardes d'une mise à jour

Deux sauvegardes complètes (toute la base, les factures, les documents du coffre, les logos) protègent une mise à
jour :

- celle que **`maj.mjs` télécharge** avant de commencer : dans le dossier des sauvegardes du serveur quand il tourne
  sur la même machine sans Docker, sinon dans `data/sauvegardes/` du dépôt ;
- celle que **le serveur écrit lui-même** juste avant d'appliquer une migration à une base déjà en service
  (`pecule-avant-migration-….zip`). Elle protège aussi une mise à jour faite sans la commande. Les trois dernières
  sont gardées ; Réglages → Suivi technique dit où est la dernière.
  - Docker : dans le volume `pecule-sauvegardes` — pour en sortir une,
    `docker compose cp pecule:/app/data/sauvegardes ./sauvegardes-du-serveur`.
  - Node : dans `~/pecule-sauvegardes/<adresse de l'appli>`, hors de l'installation, pour survivre à la mise en
    ligne d'une nouvelle version (rien à régler : voir « Où le serveur garde ses sauvegardes » dans
    [`installation.md`](installation.md) ; `BACKUP_DIR` pour un autre dossier).
  - `BACKUP_BEFORE_MIGRATION=0` la coupe. Si elle ne peut pas être écrite (disque plein, dossier protégé), une
    alerte le dit dans le Suivi technique et la migration se poursuit : ce n'est qu'un filet de sécurité.

Ces archives contiennent les données privées de tous les membres, en clair. Les variables d'environnement n'y
figurent pas : gardez `.env` à part — sans `SECRET_KEY`, les clés enregistrées dans l'appli (banque, IA) sont
illisibles.

## Revenir à la version précédente

Une migration ne se défait pas. Deux cas :

- **La nouvelle version n'a pas touché à la base** (pas de migration dans ses notes) : relancez l'ancienne.
  `node scripts/maj.mjs --version 1.22.0 --sans-sauvegarde` (la version voulue), ou avec Docker
  `PECULE_IMAGE=ghcr.io/enki-engineer/pecule:1.22.0` dans `.env` puis `docker compose up -d pecule`.
- **Une migration a été appliquée** : l'ancienne version ne sait pas lire la nouvelle base. Restaurez la sauvegarde
  d'avant dans une base **vide**, puis relancez l'ancienne version sur cette base :
  ```sh
  pnpm restaurer <dossier des sauvegardes>/<archive>.zip --base "mysql://utilisateur:motdepasse@hote:3306/base_vide"
  ```
  Ce qui a été saisi entre la sauvegarde et la restauration est perdu : d'où la sauvegarde prise juste avant.

## Sauter plusieurs versions

On passe en général directement à la dernière version : toutes les migrations manquantes s'appliquent dans l'ordre.
De loin en loin, une version majeure replie les anciennes migrations dans son schéma de départ ; une installation
restée en deçà doit alors **passer d'abord par une version palier**. Pécule le dit partout où il annonce la mise à
jour (écran, `maj.mjs`, `doctor`), et la commande est donnée :

```sh
node scripts/maj.mjs --version <palier>     # met la base à niveau
node scripts/maj.mjs                        # puis la dernière version
```

Si vous démarrez tout de même la dernière version sur une base trop ancienne, elle refuse de démarrer sans rien
modifier, et son journal nomme la version à installer d'abord.

## En cas de souci

| Symptôme | Piste |
| --- | --- |
| `maj.mjs` : « Sauvegarde impossible » | `API_TOKEN` du `.env` n'est pas celui du serveur, ou six sauvegardes ont déjà été prises dans l'heure. Rien n'a été modifié. |
| « La version en service est toujours … » | Le serveur n'a pas été redémarré (Node), ou le conteneur n'a pas été recréé : `docker compose ps`, `docker compose logs pecule --tail 100`. |
| « Le démarrage a échoué » | Une migration ou la base : le journal du serveur dit laquelle. Une migration interrompue reprend au démarrage suivant. |
| « Cette base est trop ancienne pour Pécule … » | Version palier à installer d'abord : voir « Sauter plusieurs versions ». |
| L'écran ne voit jamais de nouvelle version | `UPDATE_CHECK=0`, ou le serveur ne peut pas joindre `api.github.com` : « Vérifier maintenant » dit ce qu'il en est. |

## Mises à jour automatiques

Rien n'empêche de brancher un outil qui surveille l'image Docker — [Diun](https://crazymax.dev/diun/) ou
[What's Up Docker](https://getwud.github.io/wud/) pour être prévenu, un outil de la famille de Watchtower pour
l'appliquer. Si vous laissez un outil mettre à jour sans vous, gardez la sauvegarde d'avant migration activée et
fixez l'image sur une série (`:1`) : une version majeure peut demander un geste de votre part.
