# Installer Pécule avec l'aide d'une IA

N'importe quel assistant capable de lancer des commandes sur votre machine peut installer Pécule à votre place :
Claude Code, Codex, Gemini CLI, Cursor, GitHub Copilot, OpenCode… Le projet lui parle directement : le fichier
[`AGENTS.md`](../../AGENTS.md) est sa marche à suivre — quoi lancer, quoi vérifier, quoi vous demander — et les
commandes de Pécule lui rendent des résultats qu'il sait lire.

## La consigne à lui donner

Ouvrez votre assistant dans un dossier vide et collez :

> Installe Pécule pour moi en suivant les consignes de
> https://raw.githubusercontent.com/Enki-Engineer/pecule/stable/AGENTS.md — lis ce fichier en entier avec curl.
> Je veux l'essayer sur cet ordinateur.

Pour un serveur, changez la dernière phrase : « Je veux y accéder à l'adresse `https://pecule.exemple.fr`, depuis ce
serveur. » La même consigne en anglais :

> Install Pécule for me by following the instructions at
> https://raw.githubusercontent.com/Enki-Engineer/pecule/stable/AGENTS.md — read the whole file with curl.
> I want to try it on this computer.

Écrivez-la dans votre langue : l'assistant vous répond dans la vôtre, quelle que soit celle des consignes.

**Un assistant de conversation** (ChatGPT, Claude, Gemini, Le Chat… dans un navigateur) ne peut pas lancer de
commandes : donnez-lui la même consigne, il vous guidera pas à pas — vous tapez, vous lui montrez ce qui s'affiche.

## Ce que l'assistant fait, et ce qui reste à vous

| L'assistant | Vous |
| --- | --- |
| Regarde ce que la machine a (Docker, sinon Node et une base) et choisit le chemin | Dire où vous voulez Pécule : sur cet ordinateur pour essayer, ou à une adresse en https |
| Télécharge le fichier de la version, démarre Pécule, contrôle que tout répond | Donner votre accord avant qu'il démarre, arrête ou installe quoi que ce soit |
| Vous remet le lien du premier démarrage | L'ouvrir, donner votre prénom, créer votre clé d'accès (Face ID, Touch ID) |
| Vous guide pour relier une banque | Créer votre compte Enable Banking et donner l'accord à votre banque |
| Charge un dossier de documents et vous présente ce qu'il y a lu | Relire et valider ce qui n'est pas « sûr » |

Avec Docker, l'installation tient en trois commandes et il n'y a aucun secret à produire ni à recopier : ils sont
tirés au premier démarrage et gardés par l'installation. L'assistant n'a jamais besoin de vos identifiants
bancaires.

## Lui donner la compétence « pecule » une fois pour toutes

Facultatif. Une compétence (`SKILL.md`, [norme ouverte](https://agentskills.io)) apprend à votre assistant à
installer, contrôler et mettre à jour Pécule, sans que vous ayez à lui redonner l'adresse des consignes.

| Outil | Commande |
| --- | --- |
| La plupart des assistants | `npx skills add Enki-Engineer/pecule` |
| GitHub CLI | `gh skill install Enki-Engineer/pecule pecule` |
| Claude Code | `/plugin install pecule --marketplace Enki-Engineer/pecule` |

Dans le dépôt cloné, rien à installer : `AGENTS.md` est lu d'office par la plupart des assistants, et Claude Code y
trouve la même compétence (`.claude/skills/pecule`).

## Après l'installation

- **Brancher votre assistant sur Pécule** : Pécule expose un serveur MCP (`https://votre-adresse/api/mcp`), par
  lequel un assistant lit vos finances et, si vous le permettez, agit. Réglages → Comptes et connexions →
  « Applications connectées » donne l'adresse. Pécule reconnaît Claude, ChatGPT, Mistral Le Chat et Perplexity, ainsi
  que tout assistant de votre ordinateur (Claude Code, Codex, Cursor, Visual Studio Code, Gemini CLI…) : ils s'y
  connectent par votre clé d'accès, en lecture seule ou en lecture et actions. Un outil qui ne sait pas faire cette
  connexion envoie un jeton d'administration, créé au même écran.
- **Charger vos papiers** : « Importe le dossier `~/Documents/Papiers` dans Pécule » — voir
  [`importer-des-documents.md`](importer-des-documents.md).
- **Mettre à jour** : « Mets à jour Pécule » — l'assistant lance la commande de votre installation ; la base est
  sauvegardée avant d'être modifiée (voir [`mise-a-jour.md`](mise-a-jour.md)).
- **Un souci** : « Pécule ne répond plus, regarde pourquoi » — il lance `doctor`, lit le journal, et vous dit ce
  qu'il propose avant d'agir.
