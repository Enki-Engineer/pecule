# AGENTS.md — installer et tenir Pécule pour quelqu'un

*This file is written in French. Follow it as it is and answer the person in their own language: the commands are
the same in every language.*

Tu es un agent IA à qui une personne demande d'**installer, vérifier, mettre à jour** Pécule, ou d'**y charger ses
documents**. Ce fichier est ta marche à suivre ; il se suffit, que tu sois dans le dépôt ou dans un dossier vide.
Pour modifier le code de Pécule, les règles sont dans `CLAUDE.md`.

> Tu lis cette page par un outil qui résume les pages web ? Relis le fichier brut, en entier — un résumé perd des
> options : `curl -fsSL https://raw.githubusercontent.com/Enki-Engineer/pecule/stable/AGENTS.md`

Pécule est une application web de suivi des finances d'un foyer (comptes, opérations, budget, patrimoine, factures,
documents, impôts, retraite), que chaque foyer héberge lui-même : un serveur Node.js et une base MariaDB ou MySQL.
Une installation sert un foyer. On s'y connecte par une clé d'accès (Face ID, Touch ID, code de l'appareil), qui ne
se crée qu'en **https sur un nom de domaine** ou sur `http://localhost` ; ailleurs (réseau de la maison), par un mot de passe.

## Règles

- **Sans rien demander** : lire, télécharger `compose.yaml` ou l'archive, lancer `doctor`, `lien`, `maj --verifier`,
  `importer --a-blanc`.
- **Avec l'accord de la personne** : démarrer, arrêter ou mettre à jour Pécule ; remplacer un fichier `.env` qui
  existe ; installer un logiciel sur sa machine ; tout ce qui écrit dans une instance en service ; envoyer des
  documents (ils partent chez son fournisseur d'IA, et leur lecture a un coût). « Installe Pécule » vaut accord pour
  écrire les fichiers d'une installation neuve dans son dossier, pas pour la démarrer : demande-le si elle ne l'a pas dit.
- **Jamais** : `docker compose down -v` ou supprimer une base sans son accord explicite et une sauvegarde ; lui
  demander un secret dans la conversation ; afficher le contenu de `.env` ou des réglages gardés.
- **Un seul secret passe par toi** : le lien du premier démarrage. Il porte le code d'installation, ne sert qu'une
  fois, et c'est à la personne de le recevoir.
- **Tu ne peux pas lancer de commandes** (assistant de conversation) ? Guide la personne : une commande à la fois,
  demande-lui ce qu'elle affiche, puis continue.
- Chaque commande a son `--help` ; `--json` rend un résultat à lire par programme. Sous Windows : `curl.exe`.
- Les guides cités (`docs/…`) sont dans le dépôt et dans l'archive. Depuis un dossier vide, ils se lisent à
  `https://raw.githubusercontent.com/Enki-Engineer/pecule/stable/<chemin>`.
- Un réglage à ajouter (`.env.example` les décrit) : une ligne `CLÉ=valeur` ajoutée à `.env`, sans afficher le
  fichier, puis un redémarrage.
- L'appli parle la langue de la personne, choisie sur le premier écran ; les écrans sont nommés ici en français. En
  anglais : « Bienvenue dans Pécule » = *Welcome to Pécule*, Réglages = *Settings*, Compte et sécurité = *Account and
  security*, Comptes et connexions = *Accounts and connections*, Suivi technique = *Technical monitoring*.

## 1. Choisir le chemin

Demande à la personne, si elle ne l'a pas dit : **où veut-elle Pécule, et sur quelle machine l'ouvrira-t-elle ?**
L'adresse de l'installation est celle qu'elle tapera dans son navigateur, exactement : elle décide de la connexion.

| Où est son navigateur ? | Adresse | Connexion |
| --- | --- | --- |
| Sur cette machine (« sur cet ordinateur, pour essayer ») | `http://localhost:3000` (ou un autre port, si elle en donne un), rien d'autre à régler ; son téléphone ne pourra pas s'y connecter | clé d'accès |
| Sur une autre machine de la maison : tu tournes sur un serveur, un NAS, une machine virtuelle, par SSH — son `localhost` n'est pas le tien (un doute sur « cet ordinateur » ? demande-le) | `http://<adresse de cette machine sur le réseau>:3000`, par exemple `http://192.168.1.20:3000` (`hostname -I` la donne sous Linux) ; tout y circule en clair sur ce réseau | **mot de passe** |
| Idem, pour un essai avec clé d'accès | `http://localhost:3000`, par un tunnel SSH qu'elle lance sur son ordinateur et laisse ouvert : `ssh -L 3000:127.0.0.1:3000 utilisateur@machine` ; rien à régler dans Pécule | clé d'accès |
| Partout, téléphone compris (« sur un serveur, à cette adresse ») | une adresse en https sur un nom de domaine qui pointe vers la machine, ou celui d'un tunnel (Tailscale Serve, Cloudflare Tunnel) ; demande s'il y a déjà un proxy https devant (Nginx, Traefik, Caddy, celui d'un NAS) | clé d'accès |

**Ne bricole jamais l'adresse** : ni certificat autosigné (le navigateur refuse alors la clé d'accès, sans dire pourquoi), ni adresse IP ou `127.0.0.1` en espérant une clé d'accès, ni port ouvert sur Internet en http (`setup` le refuse). Aucun chemin ne convient ? Dis-le à la personne plutôt que d'improviser.

Puis regarde la machine :

| Ce que tu trouves | Chemin |
| --- | --- |
| `docker compose version` répond (version 2 ou plus récente) | **Docker**, section 2 — le plus simple, à préférer |
| Pas de Docker, mais `node --version` ≥ 24 et une base MariaDB ou MySQL vide | **Archive**, section 3 |
| Elle veut Pécule sur son Mac (puce Apple, macOS 14+), pour elle seule : ni serveur, ni téléphone | **Appli pour Mac**, qui porte sa base : `curl -fsSL https://github.com/Enki-Engineer/pecule/releases/latest/download/pecule-mac.sh \| sh`, puis l'appli demande son prénom. Rien d'autre de ce fichier ne s'y applique : `docs/guide/appli-mac.md` |
| Ni l'un ni l'autre | Propose d'installer Docker (https://docs.docker.com/get-docker/), avec son accord |

## 2. Docker

Un fichier suffit : ni dépôt, ni Node, ni réglage à écrire pour un essai.

**Avant tout**, `docker compose ls -a` : si un projet `pecule` y figure, Pécule est déjà installé sur cette machine.
Son dossier est celui de la colonne « CONFIG FILES » : c'est là qu'on le met à jour ou qu'on le dépanne — ne le
réinstalle pas ailleurs. Sinon, dans un dossier que la personne gardera (il ne portera que `compose.yaml` et, s'il y
en a un, `.env` : c'est de là que se lancent les commandes ; les données sont dans des volumes Docker) :

| Étape | Commande | Réussite |
| --- | --- | --- |
| Fichier | `mkdir -p pecule && cd pecule && curl -fsSLO https://github.com/Enki-Engineer/pecule/releases/latest/download/compose.yaml` | `compose.yaml` existe |
| Réglages, s'il en faut | écrire `.env` à côté (voir ci-dessous) : un serveur, le réseau de la maison, ou un autre port que 3000 | — |
| Démarrage | `docker compose up -d` | code 0 ; le service `reglages` s'arrête aussitôt (« Exited », code 0 dans `docker compose ps -a`) : c'est normal |
| Lien | `docker compose exec -T pecule node scripts/lien.mjs --json` | attend que Pécule soit prêt, puis `{"ok":true,"setup":true,"url":"…","link":"…","code":"…"}` : c'est `link` qu'il faut remettre |
| Contrôle | `docker compose exec -T pecule node scripts/doctor.mjs --json` | `"ok": true` ; la ligne `installe` donne la version |

`-T` : tu n'as pas de terminal interactif. La personne, dans le sien, tape les mêmes commandes sans lui.

Pour un essai sur la machine, aucun fichier `.env` — sauf si le port 3000 est pris ou qu'elle en veut un autre :

```sh
PECULE_PORT=3322                      # l'adresse suit d'elle-même : http://localhost:3322, rien d'autre à régler
```

Sur un serveur, `.env` tient en deux lignes :

```sh
APP_URL=https://pecule.exemple.fr     # l'adresse exacte, sans barre finale
COMPOSE_PROFILES=https                # Caddy obtient le certificat (ports 80 et 443) — à omettre s'il y a déjà un proxy
```

Avec un proxy déjà là : pas de `COMPOSE_PROFILES`, et le proxy renvoie l'adresse vers `127.0.0.1:3000`.
Sur le réseau de la maison : `APP_URL=http://192.168.1.20:3000` (son adresse sur ce réseau) et `PECULE_BIND=0.0.0.0`, qui y publie le port ; un pare-feu (ufw, firewalld) doit le laisser passer — avec l'accord de la personne, jamais vers Internet.

Les secrets de l'installation sont tirés au premier démarrage et gardés dans le volume `pecule-reglages` : tu n'as
rien à produire ni à recopier. Si un contrôle de `doctor` porte `"ok": false`, applique son champ `fix`.

| Piège | Remède |
| --- | --- |
| `port is already allocated` | `PECULE_PORT=3322` dans `.env`, puis `docker compose up -d` (l'adresse locale devient `http://localhost:3322`, `APP_URL` compris) |
| l'image ne se télécharge pas | réseau, ou registre injoignable : `docker compose pull` dit pourquoi |
| `service "reglages" didn't complete successfully` | `docker compose logs reglages` dit pourquoi : le plus souvent une variable du terminal qui porte le nom d'un réglage de Pécule (`APP_URL`, `API_TOKEN`, `SECRET_KEY`… : `unset`), ou un démarrage lancé hors du dossier de l'installation |
| Pécule ne devient pas prêt | `docker compose logs pecule --tail 100` |
| la clé d'accès ne se crée pas | l'écran dit pourquoi : page ouverte ailleurs qu'à `APP_URL` (donne le `link` de `lien`, pas `127.0.0.1` ni une IP), adresse IP ou http hors de `localhost`, certificat non reconnu. Ne force rien (ni certificat, ni `APP_URL`) : l'écran propose un mot de passe, et la section 1 dit quelle adresse permet la clé |
| la page ne s'ouvre pas depuis l'autre machine | `PECULE_BIND=0.0.0.0` manque dans `.env`, ou le pare-feu de la machine ferme le port |

## 3. Archive (Node.js, sans Docker)

Le serveur est livré construit, avec ses dépendances : ni build, ni gestionnaire de paquets. Il faut Node 24 ou
plus récent et une base MariaDB 10.6+ ou MySQL 8+ **vide**, que la personne crée (ou dont elle te donne l'adresse).

| Étape | Commande | Réussite |
| --- | --- | --- |
| Archive | `npm create pecule && cd pecule` (empreinte contrôlée) ; sans npm : `curl -fsSLO https://github.com/Enki-Engineer/pecule/releases/latest/download/pecule.tar.gz && tar -xzf pecule.tar.gz && cd pecule` | `dist/server.mjs` existe |
| Réglages | `node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@127.0.0.1:3306/pecule" --url https://pecule.exemple.fr --json` | `"ok":true` et `"database":{"reachable":true,…}` (la base est essayée) ; `portBusy: true` → ajoute `--port <autre> --force` |
| Démarrage | sur un serveur : un service (systemd, pm2, gestionnaire de l'hébergeur) qui lance `node dist/server.mjs` ; pour un essai : `nohup node dist/server.mjs > pecule.log 2>&1 &` | la commande rend la main ; l'étape suivante dit si le serveur est prêt |
| Lien | `node scripts/lien.mjs --json` | attend que Pécule soit prêt, puis `{"ok":true,"setup":true,"link":"…"}` |
| Contrôle | `node scripts/doctor.mjs --json` | `"ok": true` |

Toutes ces commandes se lancent dans le dossier `pecule`. Sans `--url`, l'adresse est `http://localhost:<port>`
(essai sur la machine) ; `--port` choisit le port, 3000 sinon ; réseau de la maison : `--url http://192.168.1.20:3000`. Le résultat dit la connexion à cette adresse (`"signIn"` : `cle` ou `mot-de-passe`). Lancé par `nohup`, le serveur ne repart pas avec la
machine : dis-le à la personne. Chez un hébergeur Node.js qui règle les variables dans son interface : c'est à la
personne d'y recopier le contenu du `.env` produit — il porte tous les secrets, ne le lis pas et ne l'affiche pas —,
fichier d'entrée `dist/server.mjs`, aucune commande de build, aucun répertoire de sortie. Sur une machine partagée,
donne l'adresse de la base par la variable `PECULE_BASE` plutôt que par `--base` : les arguments d'une commande se
lisent depuis un autre compte.
Un modèle de service systemd est dans `docs/guide/installation.md`.

## 4. Remettre la main à la personne

Donne-lui le **lien** rendu par `lien` (pas une variante de l'adresse) et dis-lui ce qui l'attend :

1. elle ouvre le lien : l'écran « Bienvenue dans Pécule » ne demande que son prénom, et elle est aussitôt connectée ;
2. elle protège son accès : une clé d'accès ou, là où elle ne peut pas servir, un mot de passe — le seul geste que tu ne peux pas faire à sa place ; elle peut le remettre à plus tard, rien ne lui barre l'entrée ;
3. Pécule l'accueille par une présentation : le pays, la devise et les écrans du foyer, les repères de l'appli, puis
   un guide pas à pas pour relier sa banque. Elle peut la suivre, la passer, ou la reprendre plus tard.

Le lien a déjà servi, ou sa session s'est perdue sans clé d'accès ni mot de passe ? Relance `lien` : il donne ce qu'il faut ouvrir. Mot de passe oublié ou appareil perdu : `lien --membre <prénom>` donne à ce membre un lien d'inscription.

## 5. Ensuite, dans l'appli

Tout le reste se règle à l'écran, par la personne ou avec elle. Rien n'est obligatoire.

- **Découvrir sans rien saisir** : Réglages → Mode démo ouvre Pécule sur une famille fictive ; on en sort en se
  reconnectant.
- **Banques** : Réglages → Comptes et connexions. Enable Banking (lecture seule, gratuit pour un usage personnel)
  demande un compte à son nom et son accord auprès de sa banque : le bloc « Enable Banking » la guide pas à pas,
  comme la présentation de bienvenue (détail : `docs/connecteurs/enable-banking.md`). Sinon : un fichier de la banque
  (OFX, QIF, CSV), ou un compte tenu à la main.
- **IA** (assistant, lecture des documents) : même écran, bloc « Intelligence artificielle », avec sa propre clé.
- **Ton accès à Pécule** : son serveur MCP est à `<adresse>/api/mcp` (Réglages → Comptes et connexions →
  Applications connectées donne l'adresse). Ajoute-le comme serveur MCP distant (`claude mcp add --transport http
  pecule <adresse>/api/mcp`, `codex mcp add pecule --url <adresse>/api/mcp`…) : la personne s'identifie par sa clé
  d'accès et choisit lecture seule ou lecture et actions. Un client qui ne sait pas faire cette connexion (OAuth)
  envoie l'en-tête `Authorization: Bearer <jeton>` avec un jeton d'administration qu'elle crée au même écran.
- **Ses documents** (bulletins, avis d'impôt, relevés, actes) : `node scripts/importer.mjs <dossier> --a-blanc --json`
  montre ce qui serait envoyé ; sans `--a-blanc`, le lot est lu, puis **rien n'est écrit sans validation**. Avec
  Docker, la commande se lance dans le conteneur : `docker compose cp <dossier> pecule:/tmp/documents`, puis
  `docker compose exec -T -u 0 pecule node scripts/importer.mjs /tmp/documents --a-blanc --json` (et
  `docker compose exec -T -u 0 pecule rm -rf /tmp/documents` à la fin). Détail : `docs/guide/importer-des-documents.md`.

## 6. Mettre à jour

Pécule prévient son administrateur (Réglages → Suivi technique) et affiche la commande de son installation.
Mettre à jour redémarre Pécule : c'est avec l'accord de la personne.

| Installation | Où en est-on | Mettre à jour |
| --- | --- | --- |
| Docker | `docker compose exec -T pecule node scripts/doctor.mjs --json` (contrôle `version`, une fois le premier membre créé) | `docker compose pull && docker compose up -d` |
| Archive ou dépôt | `node scripts/maj.mjs --verifier --json` | `node scripts/maj.mjs --oui --redemarrer "<commande qui relance le serveur>"` |

Ce sont tes commandes. À la personne, donne celle qu'elle tapera elle-même : la même avec Docker ; `node scripts/maj.mjs`
sinon, qui demande confirmation puis dit à quel moment redémarrer le serveur.

Avant de modifier sa base, le serveur en écrit lui-même une sauvegarde complète ; `maj.mjs` en télécharge une en
plus, et s'arrête sans rien toucher si elle échoue. Si `state` vaut `palier`, installe d'abord la version nommée
(`--version <palier>`). En cas d'échec : lis le journal avant toute autre tentative, et ne restaure une sauvegarde
qu'avec l'accord de la personne. Détail : `docs/guide/mise-a-jour.md`.

## 7. Diagnostiquer, arrêter, désinstaller

- `doctor` d'abord (`--json`), puis le journal : `docker compose logs pecule --tail 100`, celui de l'hébergeur ou du
  service, ou le fichier que tu as donné au serveur (`pecule.log`). Dans l'appli : Réglages → Suivi technique. Les
  pannes connues sont à la fin de `docs/guide/installation.md`.
- `docker compose down` arrête Pécule et garde tout. `docker compose down -v` **efface la base, les réglages et les
  sauvegardes du serveur** : jamais sans l'accord de la personne et une sauvegarde téléchargée (Réglages → Compte et
  sécurité → Sauvegarde complète).

## Quand tu as fini

Dis à la personne, en quelques lignes : l'adresse de Pécule, le lien à ouvrir, le dossier où il est installé (à
garder), la commande qui le met à jour (section 6), comment le serveur est tenu en marche s'il n'est pas dans Docker,
qu'une sauvegarde hors du serveur se règle dans Réglages → Compte et sécurité — et, pour un essai sur sa machine, que
son téléphone ne pourra pas s'y connecter.
