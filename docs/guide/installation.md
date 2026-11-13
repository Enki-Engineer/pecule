# Installer Pécule

Pécule est une application web que l'on héberge soi-même : un serveur Node.js et une base MySQL ou MariaDB. Une
installation sert un foyer. Ce guide décrit deux chemins : **Docker** (le plus simple, l'appli et sa base ensemble) et
**un hébergement Node.js** (offre mutualisée ou serveur, avec une base que l'on crée soi-même).

Ce qu'il faut dans tous les cas :

- une adresse en **https** (les clés d'accès — Face ID, Touch ID, code de l'appareil — l'exigent). Pour un simple essai
  sur sa propre machine, `http://localhost` suffit ;
- Node.js 24 ou plus récent (inutile pour faire tourner Pécule avec Docker, mais les scripts `setup` et `doctor` s'en
  servent) ;
- un accès au réseau pendant la construction (paquets npm, images Docker) ;
- une base MySQL 8 ou MariaDB 10.6 et plus, vide (créée pour vous avec Docker).

Rien d'autre n'est obligatoire : ni service bancaire, ni fournisseur d'IA. Ils se branchent ensuite, depuis l'appli.

## Chemin 1 — Docker

```sh
git clone <adresse du dépôt> pecule && cd pecule
node scripts/setup.mjs --docker                      # essai local : http://localhost:3000
docker compose up -d --build
```

Sur un serveur, avec un nom de domaine qui pointe vers lui (ports 80 et 443 ouverts) :

```sh
node scripts/setup.mjs --docker --url https://pecule.exemple.fr
docker compose --profile https up -d --build         # Caddy obtient et renouvelle le certificat
```

`setup.mjs` écrit le fichier `.env` (jetons tirés au hasard, mots de passe de la base, `SECRET_KEY` qui chiffre les
clés gardées en base) et affiche le **code d'installation**. Le port 3000 est pris ? `node scripts/setup.mjs --docker --port 3322` : l'adresse devient
`http://localhost:3322` (le script prévient si le port choisi est occupé ; `--help` liste les options). Les commandes
se lancent depuis la racine du dépôt. Si vous avez déjà un proxy https, n'activez pas le profil `https` : faites-le pointer vers
`127.0.0.1:3000` et gardez la même adresse dans `APP_URL`.

Les données vivent dans un volume Docker nommé d'après le dossier (`pecule_pecule-base` si le dépôt est dans
`pecule`). La base de démonstration (`pecule_demo`) est créée avec la
base principale : le mode démo fonctionne d'emblée.

## Chemin 2 — Hébergement Node.js

1. Créez une base MySQL ou MariaDB vide et son utilisateur.
2. Préparez les réglages :
   ```sh
   node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@127.0.0.1:3306/pecule" --url https://pecule.exemple.fr
   ```
   Sur un hébergeur qui gère les variables d'environnement dans son interface, recopiez-y le contenu du `.env` produit
   plutôt que de déposer le fichier.
3. Construisez et démarrez :
   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   node dist/server.mjs
   ```

Réglages de l'hébergeur : gestionnaire de paquets **pnpm**, commande de build `pnpm build`, fichier d'entrée
`dist/server.mjs`, **aucun répertoire de sortie** à publier (le serveur sert lui-même l'interface). Le mode démo demande
une seconde base vide (`DEMO_DATABASE_URL`), facultative.

Au démarrage, le serveur crée la structure de la base (une base vide reçoit le schéma complet en une étape), puis
charge un jeu de catégories de départ. Tant que cela dure, `GET /api/health` répond `{"ok":false,"phase":"…"}`.

## Premier démarrage

Ouvrez l'adresse de Pécule : l'écran « Bienvenue dans Pécule » propose la langue, puis demande votre prénom et le
**code d'installation** (la valeur de `SETUP_CODE` dans `.env` ; il ne sert qu'une fois). Vous devenez l'administrateur du foyer et créez votre
clé d'accès. L'accueil affiche ensuite « Bien démarrer » :

- **relier une banque** par Enable Banking (lecture seule, gratuit pour un usage personnel) : voir
  [`docs/connecteurs/enable-banking.md`](../connecteurs/enable-banking.md) ;
- **importer un fichier de la banque** (OFX, QIF, CSV) ou tenir un compte à la main ;
- **régler le foyer** (Réglages → Foyer) : son pays, sa devise et son fuseau horaire — la France et l'euro par défaut ;
  si votre navigateur en indique d'autres, « Bien démarrer » propose de les adopter — puis les écrans utiles. Un
  compte peut être tenu dans une autre devise que celle du foyer : ses montants sont convertis au cours de référence
  de la Banque centrale européenne et gardent leur valeur d'origine ;
- **brancher l'assistant** (Réglages → Assistant → Fournisseur d'IA), facultatif ;
- **importer vos documents** (Documents → Coffre, zone de dépôt) : voir [`importer-des-documents.md`](importer-des-documents.md).

Les autres membres du foyer s'ajoutent dans Réglages → Compte et sécurité : chacun reçoit un lien d'inscription et
crée sa propre clé d'accès.

## Arrêter, repartir de zéro

```sh
docker compose down          # arrête Pécule ; la base reste dans son volume
docker compose down -v       # arrête ET efface la base (irréversible : prenez d'abord une sauvegarde)
```

Pour tout retirer après un `down -v` : `docker rmi pecule` et supprimez `.env` (un nouveau `setup.mjs` refuse d'écraser
un `.env` existant sans `--force`).

## Vérifier, sauvegarder, mettre à jour

```sh
node scripts/doctor.mjs            # réglages, serveur, démarrage, premier membre ; --json pour un outil
```

- **Sauvegarde** : Réglages → Compte et sécurité → Sauvegarde complète télécharge une archive de toute la base et de
  tous les fichiers (réservée à l'administrateur). En ligne de commande : `pnpm sauvegarde`. Pour restaurer dans une
  base vide : `pnpm restaurer <archive.zip> --base "mysql://…"`. Les variables d'environnement n'y figurent pas :
  gardez `.env` à part — sans `SECRET_KEY` (ou, sur une installation qui n'en a pas, `API_TOKEN`), les clés enregistrées
  dans l'appli (banque, IA) sont illisibles.
- **Mise à jour** : prenez une sauvegarde, récupérez la nouvelle version (`git pull`), puis `docker compose up -d
  --build` (Docker) ou `pnpm install --frozen-lockfile && pnpm build` et redémarrage (Node). Les migrations de la base
  s'appliquent seules au démarrage.

## En cas de souci

| Symptôme | Piste |
| --- | --- |
| « Pécule démarre ou est en maintenance » qui dure | La base refuse la connexion ou une migration a échoué : journal du serveur (`docker compose logs pecule`). |
| La clé d'accès ne se crée pas | L'adresse ouverte dans le navigateur n'est pas celle d'`APP_URL`, ou elle n'est pas en https. |
| « Code d'installation incorrect » | C'est la valeur de `SETUP_CODE` (à défaut `API_TOKEN`) du fichier de réglages réellement lu par le serveur. |
| Le port est déjà pris | `node scripts/setup.mjs --docker --port <autre> --force`, puis `docker compose up -d`. |
| MariaDB affiche `io_uring_queue_init() failed` ou « Aborted connection » au démarrage | Sans effet : seul `GET /api/health` fait foi. |
| L'API répond 409 « pas encore de membre » avec le bon jeton | Normal sur une installation neuve : le jeton agit au nom du premier membre, créez-le d'abord dans l'appli. |
| L'hébergeur ne publie rien | Un répertoire de sortie est renseigné : il n'en faut pas ; l'entrée est `dist/server.mjs`. |
| Les clés enregistrées ne fonctionnent plus | `SECRET_KEY` a changé (ou `API_TOKEN`, sur une installation sans `SECRET_KEY`) : ressaisissez-les dans les réglages. |
