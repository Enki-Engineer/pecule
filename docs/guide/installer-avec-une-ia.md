# Installer Pécule avec l'aide d'une IA

Un assistant de programmation (Claude Code, ou un autre agent capable de lancer des commandes) peut mener
l'installation à votre place. Le dépôt lui parle directement : `AGENTS.md` lui dit quoi faire et quoi vous demander,
`scripts/setup.mjs` et `scripts/doctor.mjs` lui rendent des résultats qu'il sait lire.

## La consigne à lui donner

Ouvrez votre assistant dans le dossier du dépôt et dites-lui :

> Installe Pécule sur cette machine en suivant AGENTS.md. Je veux y accéder à l'adresse `https://…` (ou : en local
> pour un essai). Vérifie chaque étape avec `scripts/doctor.mjs`, et arrête-toi quand il ne reste que la création de
> mon compte.

Avec Claude Code, la compétence `pecule` livrée dans le dépôt (`.claude/skills/pecule`) se charge d'elle-même pour
ce genre de demande.

## Ce que l'agent fait, et ce qui reste à vous

| L'agent | Vous |
| --- | --- |
| Vérifie Docker ou Node, écrit les réglages, démarre Pécule, contrôle que tout répond | Choisir l'adresse ; donner votre accord avant qu'il démarre ou arrête quoi que ce soit |
| Vous remet l'adresse et le code d'installation | Créer le premier membre et votre clé d'accès (Face ID, Touch ID) |
| Vous guide pour relier une banque | Créer votre compte Enable Banking et donner l'accord à votre banque |
| Charge un dossier de documents et vous présente ce qu'il y a lu | Relire et valider ce qui n'est pas « sûr » |

L'agent n'a jamais besoin de vos identifiants bancaires, et les secrets de l'installation restent dans le fichier
`.env` de la machine.

## Après l'installation

- **Brancher votre assistant sur Pécule** : Pécule expose un serveur MCP (`https://votre-adresse/api/mcp`). Dans
  l'appli Claude, ajoutez-le comme connecteur personnalisé : la connexion se fait par votre clé d'accès, en lecture
  seule ou en lecture et actions. Avec un agent en ligne de commande, le jeton d'administration fait office de clé.
- **Charger vos papiers** : « Importe le dossier `~/Documents/Papiers` dans Pécule » — voir
  [`importer-des-documents.md`](importer-des-documents.md).
- **Mettre à jour** : « Mets à jour Pécule » — l'agent prend d'abord une sauvegarde complète.
