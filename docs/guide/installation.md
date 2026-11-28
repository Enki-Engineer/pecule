# Installer Pécule

Pécule est une application web que l'on héberge soi-même : un serveur Node.js et une base MariaDB ou MySQL. Une
installation sert un foyer. Rien d'autre n'est obligatoire : ni service bancaire, ni fournisseur d'IA — ils se
branchent ensuite, depuis l'appli.

Vous préférez ne rien taper ? [Un assistant IA peut mener l'installation](installer-avec-une-ia.md) : une phrase à
lui donner suffit.

## Choisir son format

Chaque version publiée de Pécule est livrée sous ces formats, joints à
[sa page sur GitHub](https://github.com/Enki-Engineer/pecule/releases/latest) :

| Format | Pour qui | Ce qu'il faut sur la machine |
| --- | --- | --- |
| **Docker** — le fichier `compose.yaml` | Un ordinateur, un serveur, un NAS. Le plus simple : l'appli et sa base ensemble. | Docker avec Compose 2 (essayé de la version 2.9 à la 5.5) |
| **Archive prête à l'emploi** — `npm create pecule`, ou `pecule.tar.gz` / `pecule.zip` à la main | Un hébergement Node.js (offre mutualisée, serveur sans Docker). Le serveur est déjà construit. | Node.js 24, une base MariaDB 10.6+ ou MySQL 8+ |
| **Sources** — le dépôt git, branche `stable` | Contribuer, modifier le code, ou un hébergeur qui construit depuis GitHub. | Node.js 24, pnpm, une base |
| **Appli pour Mac** — une commande, ou `Pecule-mac.zip` | Suivre ses finances depuis un seul Mac, sans serveur ni Docker : l'appli porte sa propre base. Ni téléphone, ni autre machine. | Un Mac à puce Apple, macOS 14 — [son guide](appli-mac.md) |

Une fois le serveur en place, Pécule s'installe sur chaque appareil comme une appli : « Sur l'écran d'accueil » du
téléphone, « Ajouter au Dock » sur un Mac (le manuel intégré à l'appli le détaille).

Deux choses à savoir avant de commencer :

- **L'adresse décide de la façon de se connecter.** C'est celle que vous taperez dans votre navigateur, exactement.
  En **https sur un nom de domaine**, on se connecte par une clé d'accès (Face ID, Touch ID, code de l'appareil),
  téléphone compris. Sur `http://localhost`, aussi — mais seulement depuis la machine où Pécule tourne. Sur **le
  réseau de la maison, en http** (`http://192.168.1.20:3000`), par un mot de passe : aucun navigateur ne crée de
  clé d'accès en http, ni sur une adresse IP, ni avec un certificat qu'il ne reconnaît pas (autosigné). Voir
  [Quelle adresse choisir](#quelle-adresse-choisir).
- **Les versions** : la branche `stable` et l'image `latest` ne bougent qu'à chaque version publiée ; `main` reçoit
  le travail en cours.

## Docker

Dans un dossier que vous garderez (`pecule`, par exemple) :

```sh
curl -fsSLO https://github.com/Enki-Engineer/pecule/releases/latest/download/compose.yaml
docker compose up -d                                   # http://localhost:3000
docker compose exec pecule node scripts/lien.mjs       # le lien à ouvrir pour créer votre foyer
```

C'est tout : ni dépôt à cloner, ni Node à installer, ni fichier de réglages à écrire. Au premier démarrage, le
service `reglages` tire les secrets de l'installation et les garde dans le volume `pecule-reglages` (il s'arrête
aussitôt : le voir « Exited (0) » est normal). La commande `lien` attend que Pécule soit prêt, puis affiche le lien
du [premier démarrage](#premier-démarrage). Sous Windows, tapez `curl.exe` au lieu de `curl` ; sur un NAS dont
Docker est ancien, la commande peut s'écrire `docker-compose`, avec un tiret.

Deux précautions, qui tiennent à Docker Compose :

- **Le projet s'appelle toujours `pecule`**, où que soit rangé `compose.yaml` : relancé d'un autre dossier, il
  retrouve la même installation et ses données. `docker compose ls -a` dit si Pécule est déjà installé sur la
  machine, et dans quel dossier. Si l'adresse de ce nouveau démarrage n'est pas celle de l'installation (le fichier
  `.env` de son dossier manque), Pécule refuse de démarrer plutôt que de changer d'adresse en silence.
- **Compose lit aussi les variables du terminal** : une variable exportée pour un autre projet sous le nom d'un
  réglage de Pécule (`APP_URL`, `API_TOKEN`, `SECRET_KEY`…) entrerait dans l'installation. Pécule refuse un secret
  trop court pour être le sien, ne laisse jamais changer celui qui chiffre les clés gardées en base, et ne remplace
  aucun secret qu'il garde déjà — jeton d'administration compris — sans qu'on le lui demande exprès. Au premier
  démarrage, il nomme les secrets qu'il a repris de l'environnement plutôt que tirés (`docker compose logs reglages`).

### Quelle adresse choisir

| Où est le navigateur ? | Adresse | Connexion |
| --- | --- | --- |
| Sur la machine où Pécule tourne | `http://localhost:3000` (rien à régler) | clé d'accès, ou mot de passe |
| Sur une autre machine de la maison | `http://192.168.1.20:3000` — l'adresse de la machine sur le réseau | mot de passe |
| Sur une autre machine, pour un essai | `http://localhost:3000`, par un tunnel SSH : `ssh -L 3000:127.0.0.1:3000 utilisateur@machine` | clé d'accès, ou mot de passe |
| Partout, téléphone compris | `https://pecule.exemple.fr` — un nom de domaine, ou celui d'un tunnel (Tailscale Serve, Cloudflare Tunnel) | clé d'accès, ou mot de passe |

En http sur le réseau de la maison, tout circule en clair sur ce réseau, mot de passe compris : c'est le chemin d'un
essai ou d'un usage à la maison. En http sur une adresse publique, Pécule ne s'installe pas (`setup` le refuse).
L'écran dit lui-même quand une clé d'accès ne peut pas servir, et pourquoi.

### Sur le réseau de la maison, en http

Pécule tourne sur une machine (un serveur de la maison, un NAS, un mini-PC) et s'ouvre depuis une autre. Posez un
fichier `.env` à côté de `compose.yaml` avant de démarrer, avec l'adresse de la machine sur le réseau :

```sh
APP_URL=http://192.168.1.20:3000
PECULE_BIND=0.0.0.0
```

`PECULE_BIND` publie le port sur le réseau (sans lui, il n'est ouvert qu'à la machine elle-même). Si la machine a
un pare-feu, ouvrez-y ce port au réseau de la maison — jamais à Internet. On se connecte par mot de passe ; le jour
où Pécule passe en https, chacun peut y créer sa clé d'accès, et l'administrateur exiger qu'il n'y ait plus qu'elle.

### Sur un serveur, en https

Avec un nom de domaine qui pointe vers le serveur (ports 80 et 443 ouverts), posez un fichier `.env` à côté de
`compose.yaml` avant de démarrer :

```sh
APP_URL=https://pecule.exemple.fr
COMPOSE_PROFILES=https
```

`docker compose up -d` lance alors aussi Caddy, qui obtient et renouvelle le certificat. Si vous avez déjà un proxy
https (Nginx, Traefik, celui d'un NAS), ne mettez pas `COMPOSE_PROFILES` : faites pointer votre proxy vers
`127.0.0.1:3000` et gardez la même adresse dans `APP_URL`.

### Ce qui se règle dans `.env`

Le fichier est facultatif ; ce qu'il donne l'emporte sur ce que l'installation garde elle-même. Une exception : un
secret déjà gardé (`API_TOKEN`, `SYNC_TOKEN`, `SETUP_CODE`, mot de passe de la base) ne se remplace pas par une
simple ligne de `.env` — Pécule ne saurait pas la distinguer d'une variable oubliée dans le terminal. Pour changer
l'un d'eux exprès : écrivez la nouvelle valeur dans `.env`, puis `docker compose run --rm -e FORCE_SETTINGS=1 reglages`
et `docker compose up -d`.

| Réglage | Effet |
| --- | --- |
| `APP_URL` | Adresse où Pécule est servi, telle qu'on l'ouvre dans le navigateur. Sans lui : `http://localhost:<port>`. |
| `PECULE_BIND` | `0.0.0.0` publie le port sur le réseau de la maison ; sans lui, sur la machine seule (`127.0.0.1`). |
| `COMPOSE_PROFILES=https` | Lance Caddy pour servir `APP_URL` en https. |
| `PECULE_PORT` | Port publié sur la machine, si 3000 est pris. |
| `PECULE_IMAGE` | Une version précise plutôt que la dernière : `ghcr.io/enki-engineer/pecule:1.34.0`, ou `:1.34`, ou `:1`. |
| `COMPOSE_PROJECT_NAME` | Nom du projet Compose (`pecule` d'origine) : pour une seconde installation sur la même machine. |

Les autres réglages du serveur (`.env.example` les décrit) s'y écrivent de la même façon. Un autre fichier que
`.env` : `docker compose --env-file autre.env up -d`.

`node scripts/setup.mjs --docker [--url https://…] [--port …] [--proxy]`, depuis le dépôt, écrit un `.env` complet
avec ses secrets : utile si vous préférez les tenir dans un fichier plutôt que dans le volume. Les deux façons
donnent la même installation.

### Où sont les données

| Volume | Contenu |
| --- | --- |
| `pecule_pecule-base` | La base : tout ce que le foyer a saisi, importé ou reçu de sa banque. |
| `pecule_pecule-reglages` | Les secrets de l'installation, dont `SECRET_KEY`, qui chiffre les clés gardées en base (banque, IA). |
| `pecule_pecule-sauvegardes` | Les sauvegardes que le serveur écrit lui-même. |
| `pecule_pecule-base-init` | Ce que MariaDB a lu une fois, à la création de sa base. |
| `pecule_pecule-caddy` | Les certificats, avec le profil `https`. |

Les volumes portent ce nom où que soit rangé `compose.yaml`. **Pour changer de serveur**, emportez une sauvegarde
complète et les réglages gardés :

```sh
docker compose cp pecule:/app/data/reglages/pecule.env ./pecule-reglages.env   # à ranger comme un secret
```

Sur le nouveau serveur, ce fichier renommé `.env` à côté de `compose.yaml` redonne les mêmes secrets : les clés
enregistrées dans l'appli restent lisibles après la restauration.

## Archive prête à l'emploi

Le serveur est livré construit, avec ses dépendances : ni build, ni gestionnaire de paquets. Il faut Node.js 24 ou
plus récent, et une base MariaDB ou MySQL **vide** avec son utilisateur.

```sh
npm create pecule && cd pecule
node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@127.0.0.1:3306/pecule" --url https://pecule.exemple.fr
node dist/server.mjs
```

`npm create pecule` télécharge l'archive de la dernière version, contrôle son empreinte et la déplie dans `./pecule`
(`npm create pecule mon-dossier` pour un autre dossier ; `npx create-pecule --help` pour ses options). Sans npm, la
même archive se prend à la main :
`curl -fsSLO https://github.com/Enki-Engineer/pecule/releases/latest/download/pecule.tar.gz && tar -xzf pecule.tar.gz`.

`setup.mjs` essaie la base, écrit le fichier `.env` (jetons tirés au hasard, `SECRET_KEY` qui chiffre les clés
gardées en base) et affiche le lien du premier démarrage ; `node scripts/lien.mjs` le redonne. Si la base ne répond
pas, il le dit et donne la raison : corrigez l'adresse (`--base`, avec `--force`) avant de démarrer. Sur une
machine partagée, donnez-la par la variable `PECULE_BASE` plutôt qu'en argument (les arguments d'une commande, mot
de passe compris, se lisent depuis un autre compte par `ps`). Sans `--url`,
l'adresse est `http://localhost:<port>` (essai sur sa propre machine) ; `--port 3322` choisit le port, 3000 sinon.
Pour un essai, `nohup node dist/server.mjs > pecule.log 2>&1 &` laisse le serveur tourner en tâche de fond jusqu'à
l'arrêt de la machine. La même archive existe en
`pecule.zip`, pour un gestionnaire de fichiers qui ne déplie que ce format ; `SHA256SUMS` donne leurs empreintes.

Au démarrage, le serveur crée la structure de la base (une base vide reçoit le schéma complet en une étape), puis
un jeu de catégories de départ. Tant que cela dure, `GET /api/health` répond `{"ok":false,"phase":"…"}`. Le mode
démo demande une seconde base vide (`--base-demo "mysql://…"`), facultative.

**Chez un hébergeur Node.js** (offre mutualisée) : déposez le contenu de l'archive, fichier d'entrée
`dist/server.mjs`, **aucune commande de build** et **aucun répertoire de sortie** (le serveur sert lui-même
l'interface). Si l'hébergeur règle les variables d'environnement dans son interface, recopiez-y le contenu du `.env`
produit plutôt que de déposer le fichier.

**Sur un serveur tenu à la main**, le serveur doit rester en marche et repartir avec la machine. Un modèle de
service systemd, à adapter (compte, dossier) et à poser dans `/etc/systemd/system/pecule.service` :

```ini
[Unit]
Description=Pécule
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
User=alex
WorkingDirectory=/home/alex/pecule
ExecStart=/usr/bin/node dist/server.mjs
Restart=on-failure
RestartSec=5
# Le service ne peut ni gagner de droits, ni écrire dans le système, ni lire le /tmp des autres.
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Puis `sudo systemctl enable --now pecule`. Devant lui, un proxy https (Caddy, Nginx) renvoie l'adresse de Pécule
vers `127.0.0.1:3000`.

Sans Docker, le serveur écoute son port sur toutes les interfaces de la machine : **fermez ce port au pare-feu**
(`ufw deny 3000`, ou la règle de votre hébergeur), pour que seul le proxy l'atteigne. Joint directement, il serait
servi en clair, et la limite des tentatives de connexion — comptée par adresse de visiteur, lue dans l'en-tête que
pose le proxy — pourrait être contournée. Avec Docker, le port n'est publié que sur `127.0.0.1`.

## Sources

Pour modifier le code, ou pour un hébergeur qui construit depuis GitHub :

```sh
git clone -b stable https://github.com/Enki-Engineer/pecule.git && cd pecule
node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@127.0.0.1:3306/pecule" --url https://pecule.exemple.fr
pnpm install --frozen-lockfile && pnpm build
node dist/server.mjs
```

Réglages d'un hébergeur relié à GitHub : branche **`stable`**, gestionnaire de paquets **pnpm**, commande de build
`pnpm build`, fichier d'entrée `dist/server.mjs`, aucun répertoire de sortie. Le dépôt porte aussi `compose.yaml` :
`docker compose up -d --build` y construit l'image depuis le code du dossier. Pour contribuer :
[`CONTRIBUTING.fr.md`](../../CONTRIBUTING.fr.md).

## Premier démarrage

Ouvrez le **lien du premier démarrage** : l'écran « Bienvenue dans Pécule » propose la langue, puis ne demande que
votre prénom. Vous devenez l'administrateur du foyer, et vous êtes aussitôt connecté. L'écran suivant propose de
protéger votre accès : une clé d'accès ou, là où elle ne peut pas servir, un mot de passe (douze caractères au
moins). Ce choix peut attendre — rien ne vous barre l'entrée — et se fait ensuite dans Réglages → Compte et sécurité.

Le lien porte le code d'installation, qui ne sert qu'une fois. Vous avez ouvert l'adresse sans lui ? L'écran demande
ce code et affiche la commande qui redonne le lien :

```sh
docker compose exec pecule node scripts/lien.mjs      # Docker
node scripts/lien.mjs                                 # archive ou sources
```

La même commande dépanne si votre session s'est perdue avant que vous ayez choisi une clé d'accès ou un mot de
passe : elle redonne alors le lien d'inscription du premier membre.

Pécule vous accueille alors par une **présentation** de quelques étapes : le pays, la devise et les écrans du foyer
(ce qu'indique votre navigateur est proposé, rien n'est enregistré sans votre geste), les repères pour s'y retrouver,
puis vos comptes — avec un guide pas à pas pour relier votre banque. On peut la passer, la quitter et la reprendre ;
elle se revoit ensuite depuis le manuel de l'appli.

Tant que le foyer n'a aucun compte, l'accueil affiche aussi « Bien démarrer » :

- **relier une banque** par Enable Banking (lecture seule, gratuit pour un usage personnel) : l'appli guide pas à
  pas ; le détail est dans [`docs/connecteurs/enable-banking.md`](../connecteurs/enable-banking.md) ;
- **importer un fichier de la banque** (OFX, QIF, CSV) ou tenir un compte à la main ;
- **régler le foyer** (Réglages → Foyer) : son pays, sa devise et son fuseau horaire — la France et l'euro par défaut ;
  si votre navigateur en indique d'autres, « Bien démarrer » propose de les adopter — puis les écrans utiles. Un
  compte peut être tenu dans une autre devise que celle du foyer : ses montants sont convertis au cours de référence
  de la Banque centrale européenne et gardent leur valeur d'origine ;
- **brancher l'assistant** (Réglages → Comptes et connexions → Intelligence artificielle), facultatif : Claude
  (Microsoft Foundry, API d'Anthropic, passerelle compatible), OpenAI, OpenRouter, des modèles ouverts servis par
  Ollama, ou tout service compatible OpenAI — voir [Le fournisseur d'IA](#le-fournisseur-dia) ;
- **importer vos documents** (Documents → Coffre, zone de dépôt) : voir [`importer-des-documents.md`](importer-des-documents.md).

Les autres membres du foyer s'ajoutent dans Réglages → Compte et sécurité : chacun reçoit un lien d'inscription,
crée sa propre clé d'accès (ou choisit son mot de passe), et voit la présentation à sa première connexion. Un mot de
passe oublié se remplace par un nouveau lien d'inscription, que l'administrateur donne dans les réglages — ou, pour
l'administrateur lui-même, le serveur : `node scripts/lien.mjs --membre <prénom>` (avec Docker :
`docker compose exec pecule node scripts/lien.mjs --membre <prénom>`). Sur une installation en https où chacun a sa clé,
l'administrateur peut cocher « Exiger une clé d'accès de tous les membres » : plus aucun mot de passe n'est accepté.

## Vérifier, arrêter, repartir de zéro

```sh
docker compose exec pecule node scripts/doctor.mjs    # Docker
node scripts/doctor.mjs                               # archive ou sources ; --json pour un outil
```

`doctor` contrôle les réglages, le serveur, son démarrage, le premier membre, la version et les sauvegardes, et dit
quoi faire pour chaque ligne en défaut.

```sh
docker compose down          # arrête Pécule ; la base, les réglages et les sauvegardes restent dans leurs volumes
docker compose down -v       # arrête ET efface tout cela (irréversible : téléchargez d'abord une sauvegarde)
```

Pour tout retirer après un `down -v` : `docker rmi ghcr.io/enki-engineer/pecule`, puis le dossier.

## Sauvegarder, restaurer, mettre à jour

- **Sauvegarde** : Réglages → Compte et sécurité → Sauvegarde complète télécharge une archive de toute la base et de
  tous les fichiers (réservée à l'administrateur). Les secrets de l'installation n'y figurent pas : gardez à part le
  fichier `.env`, ou avec Docker les réglages gardés (voir « Où sont les données ») — sans `SECRET_KEY`, les clés
  enregistrées dans l'appli (banque, IA) sont illisibles.
- **Sauvegardes automatiques** : éteintes au départ. Dans Réglages → Compte et sécurité, l'administrateur peut demander
  au serveur d'écrire une sauvegarde complète chaque nuit (ou chaque semaine) dans son dossier de sauvegardes (voir
  « Où le serveur garde ses sauvegardes », plus bas : il n'y a rien à régler), relue en entier, les plus récentes
  seules étant gardées. Elles sont sur le même serveur que la base : elles protègent d'une erreur, pas de la perte du
  serveur. `doctor` dit de quand date la dernière sauvegarde, et l'administrateur est prévenu après un mois sans
  aucune.
- **Copie hors du serveur** : dans la même page, l'administrateur crée une clé de chiffrement (Pécule n'en garde que
  la clé publique et lui montre une fois la clé de récupération, à ranger), puis règle un stockage extérieur —
  compatible S3 (Amazon S3, Backblaze B2, Scaleway, OVH, Cloudflare R2, MinIO…) ou WebDAV (Nextcloud, kDrive, un
  NAS…). Le stockage est essayé avant d'être enregistré. Chaque sauvegarde automatique y est alors déposée, chiffrée
  au format [age](https://age-encryption.org) ; on choisit ce qui y reste (les dernières, puis une par semaine et
  par mois). Une copie se déchiffre sans Pécule (`age -d -i cle.txt archive.zip.age > archive.zip`) ou, depuis les
  sources, avec lui (`pnpm sauvegarde --dechiffrer archive.zip.age --cle cle.txt`). **Sans la clé de récupération,
  une copie est perdue.** Le secret du stockage est gardé chiffré en base, avec `SECRET_KEY`.
- **Restauration** : dans une installation neuve (nouveau serveur, base perdue), l'écran « Bienvenue dans Pécule »
  propose « J'ai une sauvegarde : la restaurer ». On envoie l'archive — ou on en choisit une du dossier des
  sauvegardes du serveur : réinstallé sur le même compte et à la même adresse, Pécule y retrouve seul ses anciennes
  archives — et Pécule la recharge, applique les migrations plus récentes, puis dit ce qu'il reste à faire : une clé
  d'accès à recréer si l'adresse a changé, des clés à ressaisir si `SECRET_KEY` n'est pas celui de l'ancien serveur.
  Une copie chiffrée (`.zip.age`) demande la clé de récupération. Les sauvegardes automatiques de l'installation
  restaurée sont mises en pause, pour qu'une copie d'essai n'écrive pas à la place de l'installation d'origine :
  l'administrateur les réactive. Rien n'est possible sur une installation qui a déjà des données. **Ne restaurez que
  vos propres archives** : une sauvegarde est la base tout entière, clés d'accès, jetons d'administration et
  applications connectées compris — celui qui a fabriqué l'archive garde donc ses accès à l'installation restaurée. En ligne de
  commande, depuis les sources et dans une base sans aucune table :
  `pnpm restaurer <archive.zip> --base "mysql://…"`.
- **Mise à jour** : l'appli prévient l'administrateur quand une version est publiée (Réglages → Suivi technique) et
  affiche la commande de son installation — `docker compose pull && docker compose up -d` avec Docker,
  `node scripts/maj.mjs` sinon. Tout le détail est dans [`mise-a-jour.md`](mise-a-jour.md).

## Où le serveur garde ses sauvegardes

Le serveur écrit lui-même des sauvegardes complètes : avant chaque mise à jour qui change la base, et chaque nuit si
l'administrateur le demande. **Vous n'avez aucun dossier à créer ni à régler** : Pécule en choisit un qui survit à
une mise à jour.

| Installation | Dossier | Pourquoi |
| --- | --- | --- |
| Hébergement Node.js | `~/pecule-sauvegardes/<adresse de l'appli>`, dans le dossier personnel du compte qui fait tourner Pécule — par exemple `/home/alex/pecule-sauvegardes/pecule.exemple.fr` | Hors de l'installation : beaucoup d'hébergeurs installent chaque nouvelle version dans un dossier neuf, et des archives rangées dedans disparaîtraient à la mise en ligne suivante. |
| Docker | le volume `pecule-sauvegardes` (`/app/data/sauvegardes` dans le conteneur) | Le conteneur est remplacé à chaque mise à jour, le volume reste. `compose.yaml` le règle lui-même. |

La règle tient en une ligne : **le dossier du compte, sauf si `BACKUP_DIR` en donne un autre** — et c'est par
`BACKUP_DIR` que `compose.yaml` désigne le volume. Seul repli : si le compte du serveur n'a pas de dossier personnel
où écrire, les archives vont dans `data/sauvegardes`, dans l'installation ; `doctor` le signale, donnez alors un
dossier fixe par `BACKUP_DIR`.

Ce qu'il faut savoir :

- **Le dossier utilisé est toujours affiché** : Réglages → Compte et sécurité → Sauvegardes automatiques
  (« Dossier du serveur »), `doctor`, et la première ligne `[sauvegardes]` du journal du serveur.
- **Le sous-dossier porte l'adresse de l'appli** (`APP_URL`, avec son port s'il y en a un : `localhost-3000`). Deux
  installations hébergées sur le même compte ne mélangent pas leurs archives. Si l'adresse change, le dossier change
  aussi : déplacez-y les anciennes archives si vous voulez les voir dans l'appli.
- **`BACKUP_DIR=/chemin/absolu` dans `.env` l'emporte** — pour ranger les archives sur un autre disque, par exemple.
  Le compte du serveur doit pouvoir y écrire. Avec Docker, ce réglage de `.env` est sans effet : pour ranger les
  archives ailleurs, changez dans `compose.yaml` ce qui est monté sur `/app/data/sauvegardes`.
- **Pécule crée ce dossier fermé aux autres comptes de la machine**, et chaque archive n'est lisible que par le
  compte du serveur : elles contiennent les données privées de tous les membres, en clair. Le dossier n'est pas
  servi par le web.
- **Ce dossier est sur le même serveur que la base.** Pour survivre à la perte du serveur, réglez la copie hors du
  serveur (plus haut), ou téléchargez une archive de temps en temps.
- La commande de mise à jour (`node scripts/maj.mjs`) dépose sa propre sauvegarde dans ce même dossier quand le
  serveur tourne sur la même machine sans Docker ; sinon dans `data/sauvegardes` du dossier de l'installation.
- Pour sortir les archives du volume de Docker : `docker compose cp pecule:/app/data/sauvegardes ./sauvegardes-du-serveur`.

## En cas de souci

`doctor` d'abord : il nomme ce qui bloque et la commande qui le règle.

| Symptôme | Piste |
| --- | --- |
| « Pécule démarre ou est en maintenance » qui dure | La base refuse la connexion ou une migration a échoué : journal du serveur (`docker compose logs pecule --tail 100`). |
| `docker compose up` : `port is already allocated` | Le port 3000 est pris : `PECULE_PORT=3322` dans `.env`, puis `docker compose up -d`. |
| `docker compose up` : l'image ne peut pas être récupérée | Réseau ou registre injoignable : `docker compose pull` dit pourquoi. Depuis le dépôt, `docker compose up -d --build` la construit sur place. |
| Le service `reglages` reste en erreur (`didn't complete successfully`) | Son journal dit pourquoi (`docker compose logs reglages`). « Cette installation est servie à … » : le démarrage est lancé hors du dossier de l'installation, sans son `.env` — relancez-le depuis ce dossier. « … trop court », « le secret qui chiffre les clés … » ou « … n'est pas celui que cette installation garde » : une variable du terminal porte le nom d'un réglage de Pécule (`unset API_TOKEN`, par exemple) ; si le changement est voulu, le message dit comment passer outre. Pécule reste arrêté tant que ce démarrage n'aboutit pas ; rien n'a été modifié. |
| La clé d'accès ne se crée pas | L'écran dit pourquoi. La page n'est pas ouverte à l'adresse d'`APP_URL` (`127.0.0.1` au lieu de `localhost`, une adresse IP) : il donne le lien de la bonne. L'adresse est une IP, ou en http hors de `localhost` : il propose un mot de passe. « Le navigateur ne fait pas confiance au certificat » : un certificat autosigné ne convient pas, il faut celui d'un nom de domaine. Voir [Quelle adresse choisir](#quelle-adresse-choisir). |
| La page ne s'ouvre pas depuis une autre machine de la maison | Avec Docker, `PECULE_BIND=0.0.0.0` manque dans `.env` ; sinon, le pare-feu de la machine ferme le port. |
| « Ouvre Pécule à son adresse » | La page est ouverte à une autre adresse que celle d'`APP_URL` : on ne se connecte qu'à celle-ci. |
| Mot de passe oublié, ou appareil perdu avec sa seule clé d'accès | L'administrateur donne un lien d'inscription dans Réglages → Compte et sécurité. S'il s'agit de lui : `lien --membre <prénom>`, sur le serveur. |
| « Code d'installation incorrect » | Le lien a déjà servi, ou vient d'une autre installation : `lien` redonne le bon. |
| Le prénom est donné, mais la session s'est perdue avant le choix d'une clé d'accès ou d'un mot de passe | `lien` redonne le lien d'inscription du premier membre. |
| MariaDB affiche `io_uring_queue_init() failed` ou « Aborted connection » au démarrage | Sans effet : seul `GET /api/health` fait foi. |
| L'API répond 409 « pas encore de membre » avec le bon jeton | Normal sur une installation neuve : le jeton agit au nom du premier membre, créez-le d'abord dans l'appli. |
| L'hébergeur ne publie rien | Un répertoire de sortie est renseigné : il n'en faut pas ; l'entrée est `dist/server.mjs`. |
| Les clés enregistrées ne fonctionnent plus | `SECRET_KEY` a changé (ou `API_TOKEN`, sur une installation sans `SECRET_KEY`) : ressaisissez-les dans les réglages. |
| Après une mise à jour de `compose.yaml`, la base semble vide | Le projet Compose a changé de nom (il s'appelle `pecule` depuis la 1.34.0) : `COMPOSE_PROJECT_NAME=<nom de votre dossier>` dans `.env` retrouve vos volumes. |

## Le fournisseur d'IA

L'assistant et la lecture des documents passent par le fournisseur que l'administrateur du foyer choisit dans
Réglages → Comptes et connexions → Intelligence artificielle. Rien à écrire dans `.env` : l'adresse, le modèle et la
clé se saisissent à l'écran, la clé est gardée chiffrée, et un fournisseur est essayé avant d'être choisi.

| Fournisseur | Ce qu'il demande |
| --- | --- |
| Microsoft Foundry, API Claude d'Anthropic, passerelle compatible | une clé, et l'adresse ou la ressource s'il y a lieu |
| OpenAI | une clé |
| OpenRouter | une clé, et le modèle choisi dans son catalogue |
| Ollama | son adresse, et un modèle installé — pas de clé |
| Compatible OpenAI (LM Studio, Mistral, Groq, vLLM…) | son adresse de base (« /v1 » compris), un modèle, une clé s'il en faut une |

Pécule a été mis au point avec Claude. Avec un autre modèle, l'assistant demande qu'il sache appeler des outils, et
la lecture d'une photo ou d'un scan qu'il lise les images : l'essai du fournisseur le signale.

### Ollama

Ollama sert des modèles ouverts sur votre machine ou votre réseau : rien ne part chez un fournisseur, et rien n'est
facturé à l'appel. Installez-le, téléchargez un modèle (`ollama pull <modèle>`), puis donnez son adresse à Pécule.

- **Pécule installé sans Docker, ou l'appli pour Mac** : `http://localhost:11434`.
- **Pécule dans Docker, Ollama sur la même machine** : `http://host.docker.internal:11434` (« localhost » ne désigne
  que le conteneur de Pécule). Ollama doit écouter au-delà de sa propre machine : lancez-le avec
  `OLLAMA_HOST=0.0.0.0`. Sous Linux, le nom `host.docker.internal` n'existe que si le service « pecule » de
  `compose.yaml` le déclare :

  ```yaml
      extra_hosts:
        - "host.docker.internal:host-gateway"
  ```

  À défaut, donnez l'adresse de la machine sur le réseau local (`http://192.168.1.20:11434`, par exemple).
- **Ollama dans le même `compose.yaml`** : le nom de son service, `http://ollama:11434`.

En http, Pécule n'accepte qu'une adresse qui mène à la machine ou à un réseau local (le nom d'un réseau privé virtuel
convient) ; ailleurs, il faut du https.

La **fenêtre de contexte** (ce que le modèle lit d'un coup) se règle dans le même écran, et Pécule la demande à
chaque appel : les consignes et les outils de l'assistant prennent à eux seuls près de 27 000 jetons, bien plus que ce
qu'Ollama accorde de lui-même sur une machine modeste. Une fenêtre plus grande demande plus de mémoire. Une demande
qui n'y tient pas est refusée avec un message, jamais raccourcie en silence.

Ollama et les services compatibles reçoivent un PDF par son texte : un PDF scanné, sans texte, ne peut pas leur être
lu — déposez-le en photo, avec un modèle qui lit les images.
