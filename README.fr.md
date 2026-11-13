# Pécule

**Le suivi des finances de votre foyer, hébergé chez vous** — comptes, opérations, catégories, patrimoine, factures,
documents, impôts et retraite, sur ordinateur et sur téléphone. Une installation sert un foyer ; vos données restent
sur votre serveur.

[Read in English](README.md)

![Tableau de bord](docs/images/tableau-de-bord.png)

Pécule est pensé d'abord pour la France et l'euro (banques françaises, avis d'impôt, bulletins de paie, relevés de
carrière), et parle français, anglais, allemand, italien et espagnol. Le code et ses commentaires sont en français.

## Ce qu'il fait

- **Au quotidien** — les opérations de tous vos comptes au même endroit, classées par des règles que vous lui
  apprenez, l'analyse du mois, des enveloppes de budget, les factures reliées aux opérations qui les ont payées.
- **Patrimoine** — épargne, placements, immobilier, crédits et leurs échéanciers, crypto, projections.
- **Situation** — bulletins de paie, impôt sur le revenu et taxe foncière, carrière et estimations de retraite.
- **Coffre** — chaque document gardé, retrouvable, avec ses faits clés et l'échéancier de ce qui arrive.
- **Import massif de documents** — déposez un dossier entier ; Pécule range chaque document, lit ceux qu'il connaît
  (bulletins, avis d'impôt, tableaux d'amortissement, relevés, actes, baux…), vérifie les comptes et propose les
  données. Rien n'est écrit avant votre validation, et tout import s'annule.
- **Assistant** (facultatif) — posez vos questions, à la voix si vous voulez ; il peut agir, avec votre confirmation.
  Pécule expose aussi un serveur MCP : votre propre assistant IA peut le lire et le tenir à jour.
- **Dans votre devise** — le foyer choisit son pays, sa devise et son fuseau horaire ; un compte tenu dans une autre
  devise est converti au cours de référence de la Banque centrale européenne du jour de chaque opération, et garde ses
  montants d'origine.
- **Pour un foyer** — chaque membre a sa vue ; des comptes communs et des comptes privés ; des clés d'accès à la
  place des mots de passe ; un mode démo avec une famille fictive, pour montrer l'appli sans montrer vos comptes.

| | |
| --- | --- |
| ![Analyse](docs/images/analyse.png) | ![Opérations](docs/images/operations.png) |
| ![Téléphone](docs/images/iphone.png) | ![Patrimoine](docs/images/patrimoine.png) |

## D'où viennent les données

Rien n'est obligatoire : prenez ce qui vous convient.

| Source | Comment |
| --- | --- |
| Votre banque, en lecture seule | [Enable Banking](docs/connecteurs/enable-banking.md) (DSP2, gratuit pour un usage personnel) |
| Fichiers de la banque | exports OFX, QIF ou CSV, réimportables sans doublon |
| À la main | comptes et opérations que vous tenez vous-même |
| Documents | l'import massif, ou un fichier à la fois |

Les fonctions d'IA (lecture des factures et des documents, assistant) passent par **votre** clé de fournisseur —
Claude par l'API d'Anthropic, Microsoft Foundry, ou une passerelle compatible. Sans clé, tout le reste fonctionne.

## Installer

Avec Docker :

```sh
git clone https://github.com/Enki-Engineer/pecule.git && cd pecule
node scripts/setup.mjs --docker          # écrit .env et affiche votre code d'installation
docker compose up -d --build             # http://localhost:3000
```

Serveur en https, hébergement Node.js sans Docker, sauvegardes et mises à jour :
[docs/guide/installation.md](docs/guide/installation.md). Un agent IA peut mener l'installation à votre place :
[docs/guide/installer-avec-une-ia.md](docs/guide/installer-avec-une-ia.md).

## Documentation

- [Installation](docs/guide/installation.md) · [Installer avec une IA](docs/guide/installer-avec-une-ia.md)
- [Relier ses banques avec Enable Banking](docs/connecteurs/enable-banking.md)
- [Importer ses documents](docs/guide/importer-des-documents.md) · [Où récupérer ses documents](docs/guide/recuperer-ses-documents.md)
- [Architecture](docs/ARCHITECTURE.md) · [Contribuer](CONTRIBUTING.md) · [Sécurité](SECURITY.md)

## Socle technique

Node.js 24, Express 5, React 19, Vite, Tailwind CSS 4, TypeScript, Drizzle ORM, MySQL ou MariaDB. Aucun compte chez
nous, aucune télémétrie, aucun service extérieur obligatoire.

## Licence

[AGPL-3.0-only](LICENSE). Si vous faites tourner un Pécule modifié pour d'autres, vous devez leur en offrir le code.

Pécule est un projet personnel partagé tel quel. Ce n'est ni un conseil financier, ni fiscal, ni juridique.
