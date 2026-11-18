# Importer ses documents

Pécule sait lire un dossier entier de papiers — bulletins de paie, avis d'impôt, taxes foncières, tableaux
d'amortissement, relevés de carrière, actes, baux, relevés de compte, exports de la banque, factures — et ranger leurs
données dans les bons écrans. Trois principes :

1. **Tout fichier est rangé au coffre**, lisible ou non.
2. **Rien n'est écrit dans les écrans sans relecture** : chaque document lu donne une *proposition*, avec ses
   contrôles (un bulletin dont le net ne retombe pas sur ses pieds, un échéancier dont le capital remboursé ne fait pas
   le capital emprunté sont signalés).
3. **Tout import s'annule**, fichier par fichier ou en entier.

Où trouver chaque document : [récupérer ses documents](recuperer-ses-documents.md).

## Depuis l'appli

Documents → **Coffre** : glissez un dossier ou des fichiers dans la zone de dépôt, en haut de l'écran (ou choisissez-les).
Le lot s'ouvre aussitôt pour la relecture ; on le retrouve ensuite dans l'onglet « Imports » du coffre. Pécule calcule l'empreinte de chaque fichier
sur votre appareil : un fichier déjà connu n'est pas renvoyé. Les fichiers non pris en charge (autres que PDF, photos,
texte, OFX, QIF, CSV, ou de plus de 20 Mo) sont listés dans le rapport « Fichiers non importés ».

Chaque ligne du lot porte son état :

| État | Ce que cela veut dire |
| --- | --- |
| En attente, Lecture | Le serveur n'a pas fini. Vous pouvez fermer la page : le lot se retrouve dans « Imports précédents ». |
| À relire | Une proposition est prête. « Sûr » : tous les contrôles passent, la lecture est sans doute, et rien de ce que Pécule contient déjà ne changerait. |
| Validé | Les données sont dans les écrans ; « Annuler la validation » les en retire. |
| Rangé | Le document est au coffre (ou aux factures) : il n'y avait rien d'autre à en tirer. |
| Déjà connu, Non importé, Erreur, Écarté | Rien n'a été ajouté ; la raison est écrite sur la ligne. |

Ouvrez une ligne « À relire » pour voir les valeurs lues, les corriger (un champ corrigé est marqué, la lecture
d'origine est gardée), consulter les contrôles et, s'il y a déjà une donnée pour la même clé (même mois de paie, même
année de revenus, même crédit), ce qui changerait. **Valider les fichiers sûrs** écrit d'un coup tout ce qui ne demande
pas de regard ; le reste se valide un par un.

## Ce que Pécule sait lire

| Document | Où vont les données | Contrôles |
| --- | --- | --- |
| Bulletin de paie | Revenus | net avant impôt − impôt = net payé ; impôt = net imposable × taux |
| Avis d'impôt sur le revenu | Impôts | impôt + prélèvements sociaux = total ; année de l'avis |
| Avis de taxe foncière | Impôts (par bien) | cotisations + ordures ménagères + frais = montant de l'avis |
| Tableau d'amortissement, offre de prêt | Crédit et son échéancier | capital remboursé = capital emprunté ; restant dû décroissant et nul à la fin ; chaque ligne tombe juste |
| Relevé de carrière, estimation de retraite | Retraite | 4 trimestres au plus par an ; total proche du total enregistré |
| Acte de vente, compromis, bail | Fiche du bien | prix et date, ou loyer et début du bail |
| Relevé de compte (PDF) | Opérations du compte | solde de départ + opérations = solde d'arrivée ; la série des relevés d'un compte s'enchaîne |
| Export de la banque (OFX, QIF, CSV) | Opérations du compte | lu sans IA ; une opération déjà connue n'est pas recréée |
| Facture d'achat | Factures | articles, rapprochement avec l'opération |

Un document d'un autre type reste simplement au coffre, avec son titre, son résumé et ses faits clés.

## Reprendre l'historique d'un compte avec ses relevés

Une banque ne donne souvent que quelques mois d'opérations ; ses relevés en PDF remontent à l'ouverture du compte.
Déposez le dossier des relevés comme n'importe quel autre :

- **Un relevé de plusieurs comptes** (compte courant et livrets) donne une proposition par compte.
- **Le compte se choisit une fois** : sur le premier relevé d'un compte, choisissez le compte de Pécule qui reçoit
  ses opérations, ou « Nouveau compte… » ; le choix vaut pour les autres relevés du même compte dans le lot, qui
  deviennent « sûrs » et se valident d'un coup.
- **Chaque relevé doit tomber juste.** Sinon sa fiche liste toutes ses opérations avec le solde après chacune, et
  désigne la ligne dont le signe ou la présence expliquerait l'écart : on la corrige, on la retire, ou on ajoute
  l'opération oubliée. Quand le relevé imprime ses totaux, ils disent de quel côté chercher (débits ou crédits).
- **La série se vérifie d'elle-même** : en haut du lot, l'encadré des relevés de compte donne la période couverte
  pour chaque compte et signale un relevé manquant (le solde d'arrivée d'un relevé doit être le solde de départ du
  suivant).
- **Rien n'est ajouté deux fois** : une opération déjà connue du compte, par un relevé précédent ou par la banque
  elle-même, n'est pas recréée. Redéposer un relevé ne change rien.

Un relevé de plusieurs centaines d'opérations est lu en plusieurs fois. Jusqu'à 40 pages, l'IA lit les pages telles
qu'elles sont imprimées ; au-delà, seulement leur texte, où débits et crédits se distinguent moins bien. Si la banque
propose un export (OFX, QIF, CSV), préférez-le : il est lu sans IA.

## Coût et confidentialité

La lecture passe par **votre** fournisseur d'IA (Réglages → Comptes et connexions → Intelligence artificielle) : les documents lui sont envoyés. Le coût est
estimé avant l'envoi, mesuré appel par appel et **plafonné par lot** (5 € par défaut ; la lecture se met en pause au
plafond et reprend si vous l'élevez). Ordres de grandeur : quelques centimes pour un bulletin, un avis ou un relevé
de compte mensuel, quelques dizaines de centimes pour un échéancier de 300 lignes ou un relevé de 300 opérations. Sans fournisseur d'IA, les fichiers sont rangés au coffre sans
être lus ; les exports de la banque, eux, sont toujours lus.

## En ligne de commande, ou par un agent

```sh
node scripts/importer.mjs ~/Documents/Papiers --a-blanc          # ce qui serait envoyé, sans rien envoyer
node scripts/importer.mjs ~/Documents/Papiers --plafond 10        # envoie, attend la lecture, affiche le lot
node scripts/importer.mjs --lot 12 --valider-surs                 # valide ce qui est sûr dans le lot 12
```

### Un dossier surveillé

```sh
node scripts/importer.mjs ~/Documents/A-importer --surveiller --toutes 15
```

La commande reste en marche : à chaque passage, les fichiers apparus dans le dossier partent dans un nouveau lot, que
vous relisez dans l'appli. Ce qui a été envoyé est noté dans le fichier caché `.pecule-importes.json` du dossier. À
lancer sur l'ordinateur ou le serveur qui porte le dossier (service système, session `tmux`, tâche au démarrage) ;
le dossier peut être celui où votre scanner ou votre messagerie dépose ses PDF.

L'adresse et le jeton d'administration viennent de `--url` et `--jeton`, sinon de `PECULE_URL` et `PECULE_API_TOKEN`,
sinon d'`APP_URL` et `API_TOKEN` du fichier `.env` du dossier courant (la racine du dépôt). `--json` rend un résultat
lisible par un outil ; `--help` liste les options, et une option inconnue arrête la commande.

- `--a-blanc` trie d'après le type et la taille seulement, sans contacter Pécule : un fichier déjà au coffre y est
  annoncé « à envoyer », mais ne sera pas renvoyé lors du vrai import.
- Types lus : pdf, jpg, jpeg, png, webp, gif, heic, heif, txt, md, csv, ofx, qfx, qif. Les fichiers et dossiers cachés,
  `node_modules` et `__MACOSX` sont laissés de côté.
- Un import réel demande qu'un membre existe : sur une installation neuve, créez d'abord le premier dans l'appli. Un assistant branché sur le serveur MCP de Pécule suit et relit les
lots avec `list_imports`, `get_import_item`, `review_import_item` et `validate_safe_imports`.
