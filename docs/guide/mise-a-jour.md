# Mettre Pécule à jour

Pécule ne se met pas à jour tout seul : il vous prévient qu'une version est publiée, et vous lancez la mise à jour
sur le serveur. La commande dépend de la façon dont Pécule est installé — l'appli affiche la vôtre :

| Installation | Commande, dans le dossier de Pécule |
| --- | --- |
| Docker | `docker compose pull && docker compose up -d` |
| Archive prête à l'emploi | `node scripts/maj.mjs` |
| Sources (dépôt git) | `node scripts/maj.mjs` |

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/) et sont décrites dans le
[journal des versions](../../CHANGELOG.md).

## Savoir qu'une version est publiée

- **Dans l'appli** : Réglages → Suivi technique → « Version et mises à jour » montre la version en service et, s'il y
  en a une plus récente, ses notes et la commande à lancer. Réservé à l'administrateur, qui peut aussi recevoir une
  notification (Réglages → Notifications, « Nouvelle version de Pécule publiée »).
- **En ligne de commande** : `doctor` (`docker compose exec pecule node scripts/doctor.mjs`, ou
  `node scripts/doctor.mjs`), ou `node scripts/maj.mjs --verifier`.
- **Sur GitHub** : « Watch » → « Custom » → « Releases » sur le dépôt.

Une fois par jour, le serveur demande à GitHub quelle est la dernière version publiée. Rien d'autre ne part : ni
donnée du foyer, ni adresse de l'installation (GitHub voit l'adresse IP du serveur, comme tout site consulté).
`UPDATE_CHECK=0` dans `.env` coupe cette question ; `UPDATE_REPO=proprietaire/depot` suit les versions d'une copie du
projet.

## Avec Docker

```sh
docker compose pull && docker compose up -d
```

La nouvelle image est récupérée et le conteneur remplacé ; la base, les réglages et les sauvegardes restent dans
leurs volumes. Avant d'appliquer une migration, le serveur écrit lui-même une sauvegarde complète de la base
(volume `pecule-sauvegardes`). Pour en avoir une sous la main avant de commencer : Réglages → Compte et sécurité →
Sauvegarde complète.

- **Rester sur une version précise** plutôt que sur la dernière : `PECULE_IMAGE=ghcr.io/enki-engineer/pecule:1.34.0`
  dans `.env` (ou `:1.34` pour ne recevoir que ses correctifs, `:1` pour toute la série 1).
- **`compose.yaml` change rarement.** Quand les notes d'une version le demandent, retéléchargez-le à la place de
  l'ancien avant `docker compose up -d` : vos volumes ne dépendent pas de lui.
- Installé depuis le dépôt, avec Node sur la machine ? `node scripts/maj.mjs` fait la même chose en téléchargeant
  d'abord une sauvegarde complète, et contrôle le résultat.

## Avec l'archive ou les sources : `node scripts/maj.mjs`

1. Lit la version en service et la dernière publiée ; s'arrête là si l'installation est à jour.
2. Demande confirmation (`--oui` pour s'en passer).
3. Télécharge une **sauvegarde complète** et la contrôle (elle va dans le dossier des sauvegardes du serveur : la
   commande dit où). Sans sauvegarde, rien n'est modifié.
4. Récupère la version :
   - **Archive** : télécharge `pecule.tar.gz` de la version, contrôle son empreinte (`SHA256SUMS`), puis remplace le
     serveur, ses dépendances et ses scripts. Vos réglages (`.env`) et vos données ne sont pas touchés ; la version
     d'avant est gardée dans `.avant-maj` jusqu'à la mise à jour suivante.
   - **Sources** : `git pull`, `pnpm install --frozen-lockfile`, `pnpm build`.
   - **Docker, depuis le dépôt** : `git pull` (pour `compose.yaml` et les scripts), puis l'image publiée et un
     nouveau conteneur ; `--source` construit l'image depuis le dépôt.
5. Hors Docker, le serveur est à redémarrer : faites-le à la main quand la commande le demande, ou donnez-lui la
   commande (`--redemarrer "systemctl restart pecule"`).
6. Attend que `/api/health` réponde `"phase":"pret"` **et** que la version en service soit la nouvelle ; s'arrête
   si le démarrage échoue.
7. Lance `doctor`.

Les migrations de la base s'appliquent seules au démarrage de la nouvelle version, sous verrou. Pendant ce temps,
l'appli affiche « Pécule démarre… ».

| Option | Effet |
| --- | --- |
| `--verifier` | Dit où en est l'installation et s'arrête (`--json` pour un outil). |
| `--version 1.34.0` | Installe cette version au lieu de la dernière. |
| `--oui` | Ne demande pas de confirmation. |
| `--sans-sauvegarde` | Ne télécharge pas de sauvegarde (à réserver au cas où vous venez d'en faire une). |
| `--archive <fichier>` | Archive : prend ce `pecule.tar.gz` déjà téléchargé (serveur sans accès à GitHub, par exemple). Son empreinte est contrôlée si `SHA256SUMS` est à côté. |
| `--redemarrer "<commande>"` | Hors Docker : redémarre le serveur une fois la version en place. |
| `--source` | Docker depuis le dépôt : construit l'image sur place. |

**Hébergement Node relié à GitHub** (l'hébergeur reconstruit à chaque envoi sur une branche) : faites-lui suivre la
branche **`stable`**, qui n'avance qu'à chaque version publiée — `main` reçoit le travail en cours. Si vous déployez
votre propre copie du dépôt, mettez-la à jour depuis `stable` (« Sync fork » sur GitHub, ou
`git pull https://github.com/Enki-Engineer/pecule.git stable`) : l'hébergeur fait le reste. Prenez la sauvegarde
avant, depuis l'appli.

**Hébergement Node où l'on dépose les fichiers** : déposez le contenu de la nouvelle archive à la place de l'ancien
(en gardant vos réglages), puis redémarrez l'appli depuis l'interface de l'hébergeur.

## Les sauvegardes d'une mise à jour

Deux sauvegardes complètes (toute la base, les factures, les documents du coffre, les logos) protègent une mise à
jour :

- celle que **le serveur écrit lui-même** juste avant d'appliquer une migration à une base déjà en service
  (`pecule-avant-migration-….zip`). Elle protège toute mise à jour, quelle que soit la commande. Les trois dernières
  sont gardées ; Réglages → Suivi technique dit où est la dernière.
  - Docker : dans le volume `pecule-sauvegardes` — pour en sortir une,
    `docker compose cp pecule:/app/data/sauvegardes ./sauvegardes-du-serveur`.
  - Node : dans `~/pecule-sauvegardes/<adresse de l'appli>`, hors de l'installation, pour survivre à la mise en
    ligne d'une nouvelle version (rien à régler : voir « Où le serveur garde ses sauvegardes » dans
    [`installation.md`](installation.md) ; `BACKUP_DIR` pour un autre dossier).
  - `BACKUP_BEFORE_MIGRATION=0` la coupe. Si elle ne peut pas être écrite (disque plein, dossier protégé), une
    alerte le dit dans le Suivi technique et la migration se poursuit : ce n'est qu'un filet de sécurité.
- celle que **`maj.mjs` télécharge** avant de commencer : dans le dossier des sauvegardes du serveur quand il tourne
  sur la même machine sans Docker, sinon dans `data/sauvegardes/` du dossier de l'installation.

Ces archives contiennent les données privées de tous les membres, en clair. Les secrets de l'installation n'y
figurent pas : gardez-les à part (le fichier `.env`, ou avec Docker les réglages gardés dans le volume
`pecule-reglages`) — sans `SECRET_KEY`, les clés enregistrées dans l'appli (banque, IA) sont illisibles.

## Revenir à la version précédente

Une migration ne se défait pas. Deux cas :

- **La nouvelle version n'a pas touché à la base** (pas de migration dans ses notes) : relancez l'ancienne.
  - Docker : `PECULE_IMAGE=ghcr.io/enki-engineer/pecule:1.34.0` dans `.env` (la version voulue), puis
    `docker compose up -d`.
  - Archive ou sources : `node scripts/maj.mjs --version 1.34.0 --sans-sauvegarde`. Les archives existent depuis la
    1.34.0 ; juste après une mise à jour d'archive, la version d'avant est aussi dans `.avant-maj`.
- **Une migration a été appliquée** : l'ancienne version ne sait pas lire la nouvelle base. Restaurez la sauvegarde
  d'avant dans une installation neuve de l'ancienne version (écran « Bienvenue dans Pécule » → « J'ai une
  sauvegarde : la restaurer »), ou depuis les sources dans une base **vide** :
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
PECULE_IMAGE=ghcr.io/enki-engineer/pecule:<palier> docker compose up -d     # Docker : la base se met à niveau
docker compose pull && docker compose up -d                                 # puis la dernière version

node scripts/maj.mjs --version <palier>                                     # archive ou sources
node scripts/maj.mjs                                                        # puis la dernière version
```

Si vous démarrez tout de même la dernière version sur une base trop ancienne, elle refuse de démarrer sans rien
modifier, et son journal nomme la version à installer d'abord.

## En cas de souci

| Symptôme | Piste |
| --- | --- |
| `maj.mjs` : « Sauvegarde impossible » | Le jeton d'administration des réglages n'est pas celui du serveur, ou six sauvegardes ont déjà été prises dans l'heure. Rien n'a été modifié. |
| `maj.mjs` : « L'archive de la version n'a pas pu être téléchargée » | Le serveur ne joint pas GitHub : téléchargez `pecule.tar.gz` et `SHA256SUMS` ailleurs, puis `--archive <fichier>`. |
| `maj.mjs` : « L'empreinte de l'archive n'est pas celle de SHA256SUMS » | Téléchargement abîmé : recommencez-le. Rien n'a été remplacé. |
| « La version en service est toujours … » | Le serveur n'a pas été redémarré (Node), ou le conteneur n'a pas été recréé : `docker compose ps`, `docker compose logs pecule --tail 100`. |
| « Le démarrage a échoué » | Une migration ou la base : le journal du serveur dit laquelle. Une migration interrompue reprend au démarrage suivant. |
| « Cette base est trop ancienne pour Pécule … » | Version palier à installer d'abord : voir « Sauter plusieurs versions ». |
| L'écran ne voit jamais de nouvelle version | `UPDATE_CHECK=0`, ou le serveur ne peut pas joindre `api.github.com` : « Vérifier maintenant » dit ce qu'il en est. |

## Mises à jour automatiques

Rien n'empêche de brancher un outil qui surveille l'image Docker — [Diun](https://crazymax.dev/diun/) ou
[What's Up Docker](https://getwud.github.io/wud/) pour être prévenu, un outil de la famille de Watchtower pour
l'appliquer. Si vous laissez un outil mettre à jour sans vous, gardez la sauvegarde d'avant migration activée et
fixez l'image sur une série (`:1`) : une version majeure peut demander un geste de votre part.
