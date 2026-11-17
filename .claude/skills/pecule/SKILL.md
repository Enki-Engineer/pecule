---
name: pecule
description: Installer, vérifier, mettre à jour une instance de Pécule (suivi des finances d'un foyer, auto-hébergé) et y charger un dossier de documents. À utiliser quand on demande d'installer Pécule, de diagnostiquer une instance qui ne répond pas, de la mettre à jour, ou d'importer des papiers (bulletins, avis d'impôt, relevés, actes).
---

# Pécule : installer, vérifier, mettre à jour, importer

Lis d'abord `AGENTS.md` à la racine du dépôt : il dit ce qui se fait sans demander et ce qui demande un accord.
Les guides complets sont dans `docs/guide/`.

## Installer

1. Demande où Pécule sera servi : essai sur cette machine (`http://localhost:3000`), ou une adresse en https.
   Vérifie que le port est libre (`lsof -i :3000`) ; sinon choisis-en un autre avec `--port`.
2. Docker présent (`docker info`) ? Alors `node scripts/setup.mjs --docker [--url https://…] --json`, puis
   `docker compose up -d` (ajoute `--profile https` si Pécule doit obtenir lui-même son certificat ; l'image publiée
   est récupérée, ou construite depuis le dépôt si elle ne peut pas l'être).
   Sinon, il faut Node 24 et une base MySQL ou MariaDB vide : `node scripts/setup.mjs --base "mysql://…" --url … --json`,
   `pnpm install --frozen-lockfile && pnpm build`, puis `node dist/server.mjs`.
3. Attends `{"ok":true,"phase":"pret"}` sur `/api/health` (quelques secondes ; une minute au plus) :
   `until curl -sf http://localhost:3000/api/health | grep -q pret; do sleep 2; done`.
4. `node scripts/doctor.mjs --json`. Corrige ce qui porte `ok: false` en suivant son champ `fix`.
5. Donne à la personne l'adresse exacte (celle d'`APP_URL`, pas une variante) et le code d'installation (rendu par
   `setup.mjs`, ou clé `SETUP_CODE` de `.env`) : elle crée le premier membre et sa clé d'accès elle-même.
6. Propose la suite : relier une banque, importer un fichier, choisir les écrans, brancher l'IA, importer ses documents.

## Diagnostiquer

`node scripts/doctor.mjs --json`, puis le journal (`docker compose logs pecule --tail 100`). Les causes fréquentes sont
listées à la fin de `docs/guide/installation.md`.

## Arrêter, désinstaller

`docker compose down` garde la base ; `docker compose down -v` l'efface (accord et sauvegarde d'abord).

## Mettre à jour

1. `node scripts/maj.mjs --verifier --json` : version en service, dernière publiée, et `state` (`a-jour`,
   `disponible`, `palier`, ou `inconnu` si GitHub ne répond pas).
2. Avec l'accord de la personne (Pécule redémarre) : `node scripts/maj.mjs --oui`. La commande télécharge une
   sauvegarde complète, récupère la version (image Docker publiée, ou `git pull` et build), attend la nouvelle
   version sur `/api/health` puis lance `doctor`. Sur un serveur Node, donne-lui `--redemarrer "<commande>"` ou
   redémarre le serveur quand elle le demande. `state: palier` : d'abord `--version <palier>`, puis la dernière.
3. Échec : lis le journal (`docker compose logs pecule --tail 100`) avant de retenter. Ne saute jamais la
   sauvegarde ; n'en restaure une (dans une base vide) qu'avec l'accord de la personne. Détail :
   `docs/guide/mise-a-jour.md`.

## Importer un dossier de documents

1. `node scripts/importer.mjs <dossier> --a-blanc --json` : montre ce qui serait envoyé.
2. Avec l'accord de la personne (les documents partent chez son fournisseur d'IA, s'il est réglé) :
   `node scripts/importer.mjs <dossier> --plafond 5 --json`.
3. Résume le lot : ce qui est sûr, ce qui demande un regard (contrôles en échec, écarts avec l'existant, champs à
   renseigner comme le bien concerné ou la date de première échéance d'un prêt).
4. `node scripts/importer.mjs --lot <n> --valider-surs --json`, puis le reste un par un avec la personne
   (dans l'appli : Documents → Importer, ou par l'outil MCP `review_import_item`).
