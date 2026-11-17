# Sécurité

Pécule garde des données bancaires et des documents personnels. Merci de signaler toute faille **en privé** :
onglet « Security » du dépôt → « Report a vulnerability » (signalement privé de GitHub). N'ouvrez pas de ticket
public, et ne joignez aucune donnée réelle.

Indiquez la version (ou le commit), les étapes pour reproduire et l'effet constaté. Le projet est tenu sur du temps
libre : une réponse arrive en général sous une semaine. Seule la dernière version publiée reçoit des correctifs.

## Ce qu'il faut savoir du modèle

- Une installation sert **un foyer dont les membres se font confiance** : les comptes bancaires et leurs opérations sont
  visibles de tous les membres (chacun règle seulement ce qu'il masque). Sont privés, quand ils sont rattachés à un
  membre : bulletins de paie, retraite, documents et factures personnels, placements, crédits et biens à son nom.
- L'**administrateur** (le premier membre) ajoute les membres, règle le fournisseur d'IA, voit le journal complet et
  peut télécharger la sauvegarde de tout le foyer.
- Le mode démo est une commodité pour montrer l'appli, pas une barrière de sécurité entre deux personnes : ne prêtez
  pas un appareil où une session est ouverte.

## Ce qui protège une installation

- **Https obligatoire** hors `localhost` ; connexion par clés d'accès (WebAuthn), jamais de mot de passe.
- **`API_TOKEN`** donne tous les droits sur l'API : gardez-le hors du dépôt et ne le partagez pas. **`SECRET_KEY`**
  chiffre les secrets gardés en base (clé de la banque, clé d'IA, clé des notifications) : le perdre ou le changer
  les rend illisibles. Une installation sans `SECRET_KEY` chiffre avec `API_TOKEN`.
- La **sauvegarde complète** n'est pas chiffrée : rangez l'archive comme un document sensible.
- La **restauration depuis l'appli** n'existe que sur une installation sans membre ni donnée, et demande le code
  d'installation (`SETUP_CODE`, à défaut `API_TOKEN`) : une installation en service ne peut pas être écrasée par là.
- Les documents envoyés à la lecture partent chez le **fournisseur d'IA que vous avez choisi**, et nulle part ailleurs.
- Derrière plus d'un proxy (ou aucun), réglez `TRUST_PROXY` : la limite de tentatives de connexion se compte par
  adresse de visiteur.
- Ne publiez pas votre instance sans https, et laissez `X-Robots-Tag` en place : rien ne doit être indexé.
