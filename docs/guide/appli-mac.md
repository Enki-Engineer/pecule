# L'appli pour Mac

Pécule sur votre Mac, sans serveur à tenir ni Docker : une appli qui s'ouvre comme les autres, avec sa propre base.
Tout reste sur l'ordinateur. Elle convient à qui veut suivre ses finances depuis **un seul Mac** ; pour ouvrir
Pécule aussi sur un téléphone ou depuis une autre machine, il faut une installation sur un serveur
([Installer Pécule](installation.md)).

| | |
| --- | --- |
| Il faut | un Mac à **puce Apple** (M1 ou plus récent), macOS 14 ou plus récent, 600 Mo de disque |
| Elle embarque | Pécule, Node.js et MySQL (son serveur seul) — rien d'autre à installer |
| Vos données | `~/Library/Application Support/Pecule` |
| Elle n'a pas | les notifications, l'accès depuis le téléphone, la clé d'accès (on y entre par un mot de passe, si l'on en choisit un) |

## Installer

Dans le Terminal (Applications → Utilitaires) :

```sh
curl -fsSL https://github.com/Enki-Engineer/pecule/releases/latest/download/pecule-mac.sh | sh
```

Le script télécharge l'appli de la dernière version, contrôle son empreinte, la pose dans Applications (à défaut,
dans `~/Applications`) et l'ouvre. Relancé plus tard, il la remplace par la dernière version sans toucher aux
données. `PECULE_VERSION=1.50.0` installe une version précise, `PECULE_DOSSIER=…` choisit le dossier.

**Pourquoi une commande ?** L'appli n'est pas signée par un compte Apple payant. Installée ainsi, elle se lance sans
que macOS ne s'y oppose. Téléchargée par un navigateur (`Pecule-mac.zip`, sur la page de la version), macOS la
refuse au premier lancement : il faut alors l'autoriser dans Réglages Système → Confidentialité et sécurité →
« Ouvrir quand même ». L'appli est la même dans les deux cas ; son empreinte est dans `SHA256SUMS-mac`, et son
origine se vérifie par l'attestation de provenance de la version ([Mettre à jour](mise-a-jour.md)).

## Première ouverture

L'appli crée sa base (quelques secondes, une seule fois), puis demande votre prénom : vous êtes le premier membre
du foyer, et son administrateur. Elle propose ensuite de **protéger votre accès par un mot de passe**. Sans mot de
passe, Pécule s'ouvre sur cet ordinateur sans rien demander — ce qui convient à un Mac que vous êtes seul à
utiliser, avec sa session verrouillée. Le mot de passe se choisit aussi plus tard, dans Réglages → Compte et
sécurité.

**Plusieurs membres** partagent la même appli, sur le même compte du Mac : l'administrateur les ajoute dans
Réglages → Compte et sécurité, et « Choisir son mot de passe », sur la ligne d'un membre, lui fait choisir le sien
dans la fenêtre. Chacun se connecte ensuite avec son prénom et son mot de passe, après « Se déconnecter ».

Fermer la fenêtre ne quitte pas l'appli : elle reste dans le Dock et continue de synchroniser. « Quitter Pécule »
(⌘Q) arrête tout, base comprise. **Pécule ne synchronise que lorsqu'il est ouvert.**

## Relier sa banque

Comme sur un serveur, par Enable Banking ([le guide](../connecteurs/enable-banking.md)), avec une différence :
l'adresse de retour à déclarer chez Enable Banking est celle que l'appli affiche, de la forme
`https://localhost:<port>/reglages/comptes`. Personne ne sert cette adresse : l'appli la reconnaît au retour de la
banque et reprend la main. L'accord se donne dans une fenêtre à part, dont le titre dit toujours chez qui vous
êtes ; elle se referme d'elle-même.

L'import d'un fichier de la banque (OFX, QIF, CSV), l'assistant et tout le reste marchent comme ailleurs.

## Mot de passe oublié

Menu Aide → « Mot de passe oublié… » : l'appli ouvre l'écran où choisir un nouveau mot de passe (s'il y a plusieurs
membres, elle demande lequel). Il n'y a pas de code à recevoir : avoir la main sur ce Mac suffit — voir
[ce que cela veut dire pour la sécurité](../../SECURITY.fr.md).

## Sauvegarder

Vos données ne sont que sur ce Mac. Trois protections, de la plus simple à la plus sûre :

- **Time Machine**, ou toute sauvegarde du Mac, qui emporte `~/Library/Application Support/Pecule` — réglages
  compris (ils portent le secret qui chiffre les clés gardées en base : sans eux, une copie de la base ne suffit
  pas). À copier de préférence quand l'appli est quittée.
- **Les sauvegardes de Pécule** : Réglages → Compte et sécurité → Sauvegardes. Une archive complète se télécharge
  à la demande, et Pécule peut en écrire une de lui-même, chaque jour ou chaque semaine, quand il est ouvert, dans
  `~/Library/Application Support/Pecule/sauvegardes`.
- **La copie hors de l'ordinateur** : chaque sauvegarde automatique part, chiffrée, sur un stockage à vous. C'est
  la seule qui protège de la perte ou de la panne du Mac.

Une archive de sauvegarde se restaure dans n'importe quelle installation de Pécule — une autre appli pour Mac, ou
un serveur : à l'écran « Bienvenue dans Pécule » d'une installation neuve, « J'ai une sauvegarde : la restaurer ».
C'est aussi le chemin pour passer d'un serveur à l'appli, ou l'inverse.

## Mettre à jour

Menu Pécule → « Rechercher une mise à jour… ». S'il y en a une, l'appli la télécharge, vérifie sa signature, se
remplace et se rouvre ; avant de modifier la base, Pécule en garde lui-même une sauvegarde complète. Réglages →
Suivi technique dit quand une version plus récente est publiée, avec ce qui change.

## Où sont les choses

| | |
| --- | --- |
| `~/Library/Application Support/Pecule/base` | la base MySQL |
| `…/Pecule/reglages/pecule.env` | les secrets de l'installation, tirés à la première ouverture — à ne jamais publier |
| `…/Pecule/sauvegardes` | les sauvegardes écrites par Pécule |
| `…/Pecule/journaux` | ce que disent l'appli, le serveur et la base (menu Aide → « Ouvrir les journaux ») |

Rien ne sort de la machine : Pécule n'écoute que sur `127.0.0.1`, et sa base n'a aucun port. Un assistant installé
sur le même Mac (Claude Code, Cursor…) peut se brancher au serveur MCP de Pécule, à l'adresse que donne Réglages →
Comptes et connexions, tant que l'appli est ouverte — l'accord se donne dans le navigateur, où l'on se connecte par
son mot de passe : il en faut donc un. Un assistant en ligne, lui, ne peut pas joindre un Pécule qui ne sort pas
du Mac.

## En cas de souci

- **L'appli dit qu'elle n'a pas pu démarrer** : l'écran donne la raison et ouvre les journaux. Le plus souvent, un
  autre programme tient son port : le fermer, puis « Réessayer ».
- **« Pécule » est endommagé, ou ne peut pas être ouvert** : l'appli a été téléchargée par un navigateur. Réglages
  Système → Confidentialité et sécurité → « Ouvrir quand même », ou réinstaller par la commande ci-dessus.
- **Tout arrêter à la main** : quitter l'appli suffit. Si un processus restait après un plantage, rouvrir l'appli
  l'arrête d'abord.

## Désinstaller

Mettre l'appli à la corbeille. Vos données restent dans `~/Library/Application Support/Pecule` : les supprimer
efface le foyer, ses documents et ses sauvegardes locales — téléchargez d'abord une sauvegarde complète si vous
pourriez y revenir.

## Pour qui tient l'appli à la main

L'appli lance un superviseur, `scripts/bureau.mjs`, qui fait tout sauf la fenêtre. Il se lance aussi seul, depuis
l'archive prête à l'emploi ou le dépôt, avec un MySQL 8.4 déplié — Pécule s'ouvre alors dans le navigateur (la
banque ne s'y relie pas : il lui faut la fenêtre de l'appli, ou une adresse en https) :

```sh
node scripts/bureau.mjs --mysql <dossier de MySQL> --ouvrir     # Ctrl-C arrête tout proprement
node scripts/bureau.mjs --etat                                  # tourne-t-il, à quelle adresse ?
node scripts/bureau.mjs --arreter
```

Fabriquer l'appli depuis les sources : `node bureau/fabriquer.mjs` (il faut pnpm et Rust) ; ses essais sont dans
`bureau/essais/`.
