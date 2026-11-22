# Pécule

Self-hosted household finance tracker: bank accounts, transactions, budget, net worth, invoices and documents, with
an AI assistant and an MCP server. *Suivi des finances d'un foyer, auto-hébergé.*

This package is the **installer**. It downloads the ready-to-run archive of the latest Pécule release from GitHub,
checks its SHA-256 and unpacks it into a folder. The app itself is not on npm.

## Install

```sh
npm create pecule               # → ./pecule
cd pecule
node scripts/setup.mjs --base "mysql://user:password@127.0.0.1:3306/pecule" --url https://pecule.example.com
node dist/server.mjs            # run it as a service: systemd, pm2, your host's process manager
node scripts/lien.mjs           # prints the link to open to create the first household member
```

You need Node.js 24 or later and an empty MariaDB 10.6+ or MySQL 8+ database. Nothing to build, no package manager
on the server.

| Option | |
| --- | --- |
| `npm create pecule <folder>` | Another folder than `./pecule` (it must be empty or not exist yet). |
| `npx create-pecule <folder> [options]` | The same installer, with options (with `npm create`, put them after `--`). |
| `--base "mysql://…"` | Also runs the settings step (`node scripts/setup.mjs --base …`); `--url` and `--port` go with it. |
| `--version 1.34.1` | That release instead of the latest one. |
| `--archive <file>` | An archive you already downloaded: no network access. |
| `--json` | Machine-readable result, for a script or an AI agent. |

Afterwards, inside the folder: `node scripts/maj.mjs` updates Pécule, `node scripts/doctor.mjs` checks the
installation.

**With Docker** you do not need this package: download `compose.yaml` from the latest release and run
`docker compose up -d`.

Guides, source code and releases: <https://github.com/Enki-Engineer/pecule>. Licence: AGPL-3.0.

## En français

Ce paquet est l'**installateur** de Pécule : il télécharge l'archive prête à l'emploi de la dernière version, contrôle
son empreinte et la déplie dans un dossier. L'appli elle-même n'est pas sur npm.

```sh
npm create pecule               # → ./pecule
cd pecule
node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@127.0.0.1:3306/pecule" --url https://pecule.exemple.fr
node dist/server.mjs            # à confier à un service : systemd, pm2, le gestionnaire de ton hébergeur
node scripts/lien.mjs           # donne le lien à ouvrir pour créer le premier membre du foyer
```

Il faut Node.js 24 ou plus récent et une base MariaDB 10.6+ ou MySQL 8+ vide. `npx create-pecule --help` dit le
reste. Avec Docker, ce paquet ne sert pas : le fichier `compose.yaml` de la dernière version suffit.
