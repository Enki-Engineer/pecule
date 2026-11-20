---
name: pecule
description: Installer, vérifier, dépanner et mettre à jour Pécule (suivi des finances d'un foyer, auto-hébergé avec Docker ou avec Node.js et MariaDB), et y charger un dossier de documents (bulletins, avis d'impôt, relevés, actes). À utiliser quand on demande d'installer Pécule, de voir pourquoi une instance ne répond pas, de la mettre à jour ou d'y importer des papiers. Install, check, troubleshoot and update Pécule, a self-hosted household finance tracker, and import a folder of documents into it.
license: AGPL-3.0-only
---

# Pécule : installer, vérifier, mettre à jour, importer

La marche à suivre complète est le fichier `AGENTS.md` du projet : ce qui se fait sans demander, ce qui demande
l'accord de la personne, et chaque étape avec sa commande et son résultat attendu. **Lis-le en entier avant
d'agir** : dans le dépôt, il est à la racine ; ailleurs, récupère le fichier brut (pas un résumé de la page) :

```sh
curl -fsSL https://raw.githubusercontent.com/Enki-Engineer/pecule/stable/AGENTS.md
```

Réponds à la personne dans sa langue. Ce qui suit est l'essentiel, si le fichier est injoignable.

## Installer

1. Demande où la personne veut Pécule : sur cet ordinateur pour essayer (`http://localhost:3000`), ou sur un serveur
   à une adresse en https (les clés d'accès l'exigent). Démarrer quoi que ce soit se fait avec son accord.
2. Docker répond (`docker compose version`) ? D'abord `docker compose ls -a` : si un projet `pecule` y figure, Pécule
   est déjà installé (son dossier est dans la colonne « CONFIG FILES ») — on le met à jour ou on le dépanne là, on ne
   le réinstalle pas ailleurs. Sinon, dans un dossier à garder :
   ```sh
   mkdir -p pecule && cd pecule
   curl -fsSLO https://github.com/Enki-Engineer/pecule/releases/latest/download/compose.yaml
   docker compose up -d
   docker compose exec -T pecule node scripts/lien.mjs --json
   docker compose exec -T pecule node scripts/doctor.mjs --json
   ```
   Un fichier `.env` à côté de `compose.yaml`, avant de démarrer, seulement s'il faut régler quelque chose. Un autre
   port que 3000 : `PECULE_PORT=3322` (l'adresse suit d'elle-même). Sur un serveur : `APP_URL=https://…`, et
   `COMPOSE_PROFILES=https` pour que Caddy obtienne le certificat (à omettre s'il y a déjà un proxy https).
3. Pas de Docker, mais Node 24 et une base MariaDB ou MySQL vide : l'archive prête à l'emploi.
   ```sh
   curl -fsSLO https://github.com/Enki-Engineer/pecule/releases/latest/download/pecule.tar.gz
   tar -xzf pecule.tar.gz && cd pecule
   node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@127.0.0.1:3306/pecule" --url https://… --json
   nohup node dist/server.mjs > pecule.log 2>&1 &      # essai ; sur un serveur : un service (systemd, pm2, hébergeur)
   node scripts/lien.mjs --json
   ```
   `setup` essaie la base (`"database":{"reachable":true,…}`) ; sans `--url`, l'adresse est `http://localhost:<port>`
   (`--port`, 3000 sinon).
4. Remets à la personne le `link` rendu par `lien` : elle l'ouvre, donne son prénom et crée sa clé d'accès (Face ID,
   Touch ID) — le seul geste que tu ne peux pas faire à sa place. Ne lui demande aucun secret, et n'affiche pas le
   contenu des réglages : les secrets sont tirés par l'installation.
5. Dis-lui ce qui suit : Pécule l'accueille par une présentation (son foyer, les repères de l'appli, puis un guide
   pas à pas pour relier sa banque). Le reste se règle aussi dans l'appli : brancher l'IA, importer ses documents.

## Diagnostiquer

`doctor` d'abord (`docker compose exec -T pecule node scripts/doctor.mjs --json`, ou `node scripts/doctor.mjs --json`) :
chaque contrôle en défaut porte un champ `fix`. Puis le journal : `docker compose logs pecule --tail 100`.

## Mettre à jour

Avec l'accord de la personne (Pécule redémarre). Docker : `docker compose pull && docker compose up -d`. Archive
ou dépôt : `node scripts/maj.mjs --verifier --json`, puis
`node scripts/maj.mjs --oui --redemarrer "<commande qui relance le serveur>"`. La base est sauvegardée avant d'être
modifiée. En cas d'échec, lis le journal avant de retenter, et ne restaure rien sans son accord.

## Importer un dossier de documents

`node scripts/importer.mjs <dossier> --a-blanc --json` montre ce qui serait envoyé ; sans `--a-blanc`, avec son
accord (les documents partent chez son fournisseur d'IA, et leur lecture a un coût), le lot est lu. Rien n'est écrit
sans validation : valide ce qui est « sûr » (`--lot <n> --valider-surs`) et présente le reste à la personne. Avec
Docker : `docker compose cp <dossier> pecule:/tmp/documents`, puis
`docker compose exec -T -u 0 pecule node scripts/importer.mjs /tmp/documents --a-blanc --json`.

## Ne jamais faire sans accord explicite

`docker compose down -v`, supprimer une base ou un volume, restaurer une sauvegarde, remplacer un fichier `.env`.
