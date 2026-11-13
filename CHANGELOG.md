# Journal des versions

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/). Avant toute mise à jour : une
sauvegarde complète (`pnpm sauvegarde`). Les migrations de la base s'appliquent seules au démarrage.

## 1.2.0

- **Un seul endroit pour les documents** : l'écran « Importer » rejoint le **Coffre**. En haut, une zone de dépôt (un
  fichier, plusieurs, un dossier entier, glissés n'importe où dans la page) ; chaque fichier est rangé, lu quand
  Pécule le reconnaît, et ses données sont proposées à la relecture. En dessous, la liste des documents et l'onglet
  « Imports ». Un lot se relit à l'adresse `/documents?lot=…` ; l'ancienne adresse `/importer` y renvoie.
- **Analyse → Frise** : les paiements du mois posés sur le calendrier, un couloir par moyen de paiement, une bulle
  par opération (l'aire suit le montant), le reste du mois cumulé jour après jour et, pour le mois en cours, les
  prélèvements habituels encore attendus. Survol : le détail du jour ; clic : ses opérations ; vue en tableau.
- **Diagramme de flux** : ce qui s'ouvre au clic se reconnaît (chevron, halo à l'arrivée, survol et clavier).
- **Menu** : un clic sur un compteur ouvre l'écran déjà filtré (opérations à classer, factures à rapprocher, tâches
  en retard, alertes). **Foyer / Moi** est grisé sur les écrans qui ne dépendent pas des comptes.
- **Réglages → Comptes et connexions** : encart « Quelle source choisir ? » (Enable Banking gratuit pour un usage
  personnel, Finta sur abonnement, fichiers de la banque).
- **Logos** : près de deux cents enseignes de plus dans le référentiel des marques.

## 1.1.0

- **Pays, devise et fuseau horaire du foyer** (Réglages → Foyer) : tous les totaux s'expriment dans la devise du
  foyer, l'euro par défaut. Trente devises, celles dont la Banque centrale européenne publie un cours de référence.
- **Comptes en devise** : un compte peut être tenu dans une autre devise que celle du foyer (Enable Banking, fichier
  OFX / QIF / CSV, relevé importé, saisie à la main). Ses montants sont convertis au cours du jour de chaque opération
  et gardent leur valeur d'origine, affichée sous le montant ; son solde suit le cours du jour.
- Changer la devise du foyer recalcule opérations, soldes et historiques ; les montants saisis à la main (budgets,
  objectifs, placements, biens, crédits) gardent leur chiffre.
- Titres cotés dans une autre devise que l'euro acceptés (convertis au cours du jour) ; cours et crypto valorisés dans
  la devise du foyer.
- Hors de France : pas de calendrier fiscal français ni de fêtes locales ; les écrans Impôts et Retraite sont retirés
  d'office (on peut les remettre). Hémisphère sud : pas de thème de saison.
- Les unités amusantes des thèmes, dont le prix est fixé en euros, ne s'affichent que pour un foyer en euros. Le coût
  de l'IA reste compté en euros.
- Migrations `0026_devises` et `0027_evenement_crypto_valeur` (appliquées au démarrage). Un foyer en euros ne voit
  aucun changement.

## 1.0.0

Première version publique.

- Comptes, opérations, catégories et règles, analyse du mois, enveloppes et objectifs, factures et rapprochement.
- Patrimoine : épargne, placements, immobilier, crédits et échéanciers, crypto, projections.
- Situation : revenus et bulletins de paie, impôts, retraite. Coffre de documents et échéancier.
- Sources bancaires : Enable Banking, fichiers OFX / QIF / CSV, comptes tenus à la main.
- Import massif de documents avec contrôles, relecture et annulation.
- Assistant facultatif (fournisseur d'IA au choix), mode vocal, serveur MCP et connexion OAuth.
- Foyer à plusieurs membres, clés d'accès, mode démo, sauvegarde complète et restauration.
- Cinq langues : français, anglais, allemand, italien, espagnol.
- Installation par Docker ou sur un hébergement Node.js, `setup` et `doctor`, guide pour un agent IA.
