# Sécurité

Pécule garde des données bancaires et des documents personnels. Merci de signaler toute faille **en privé** :
onglet « Security » du dépôt → « Report a vulnerability » (signalement privé de GitHub). N'ouvrez pas de ticket
public, et ne joignez aucune donnée réelle.

Indiquez la version (ou le commit), les étapes pour reproduire et l'effet constaté. Le projet est tenu sur du temps
libre : une réponse arrive en général sous une semaine. Seule la dernière version publiée reçoit des correctifs.

## Ce qu'il faut savoir du modèle

- Une installation sert **un foyer dont les membres se font confiance** : les comptes bancaires et leurs opérations sont
  visibles de tous les membres (chacun règle seulement ce qu'il masque). Sont privés, quand ils sont rattachés à un
  membre : bulletins de paie, déclarations d'impôt personnelles, retraite, documents et factures personnels,
  placements, crédits et biens à son nom. Un membre peut choisir de partager ses revenus avec le foyer (Réglages →
  Compte et sécurité) : les autres lisent alors les montants de ses bulletins et ses déclarations personnelles,
  jamais les documents. Ce réglage ne se change qu'à l'écran, par le membre lui-même.
- L'**administrateur** (le premier membre) ajoute les membres, règle le fournisseur d'IA, voit le journal complet et
  peut télécharger la sauvegarde de tout le foyer. « Privé » protège donc un membre des autres membres, pas de
  l'administrateur : la sauvegarde contient tout, et son jeton d'administration lit la vue de chacun (ces lectures
  sont tracées dans le journal).
- Le mode démo est une commodité pour montrer l'appli, pas une barrière de sécurité entre deux personnes : ne prêtez
  pas un appareil où une session est ouverte.

## Ce qui protège une installation

- **Https obligatoire** hors `localhost` ; connexion par clés d'accès (WebAuthn), jamais de mot de passe.
- **`API_TOKEN`** donne tous les droits sur l'API : gardez-le hors du dépôt et ne le partagez pas. **`SECRET_KEY`**
  chiffre les secrets gardés en base (clé de la banque, clé d'IA, clé des notifications) : le perdre ou le changer
  les rend illisibles. Une installation sans `SECRET_KEY` chiffre avec `API_TOKEN`.
- La **sauvegarde complète** téléchargée ou gardée sur le serveur n'est pas chiffrée : rangez l'archive comme un
  document sensible. Ce qui part vers un stockage extérieur l'est toujours (format age, destinataire X25519) : le
  serveur ne garde que la clé publique, et ne peut pas relire ce qu'il a envoyé. La clé de récupération n'est montrée
  qu'une fois à l'administrateur.
- L'adresse du **stockage extérieur** est donnée par l'administrateur et peut désigner un appareil du réseau du
  serveur (un NAS) : seul l'administrateur la règle, jamais en mode démo.
- La **restauration depuis l'appli** n'existe que sur une installation sans membre ni donnée, et demande le code
  d'installation (`SETUP_CODE`, à défaut `API_TOKEN`) : une installation en service ne peut pas être écrasée par là.
  Ne restaurez que vos propres archives : une sauvegarde est la base tout entière, accès compris (clés d'accès,
  jetons d'administration, applications connectées) — restaurer celle d'un tiers lui donne l'installation.
- L'administrateur **coupe d'un coup tous les accès d'un membre** (appareil perdu, départ du foyer) : clés d'accès,
  sessions, lien de calendrier, jetons de dépôt, applications connectées (Réglages → Compte et sécurité).
- Rien de ce que l'assistant écrit ne l'est sans confirmation, **sa mémoire comprise** : un texte venu d'ailleurs
  (libellé d'un virement, document déposé) ne peut pas s'y inscrire seul. Un assistant extérieur connecté par OAuth
  lit en revanche les libellés et les documents tels quels : n'y connectez qu'un assistant auquel vous confiez ces
  données, et gardez-le en lecture seule si vous n'avez pas besoin des actions.
- Chaque version publiée porte une **attestation de provenance** (voir `docs/guide/mise-a-jour.md`) : `SHA256SUMS`,
  téléchargé au même endroit que l'archive, ne protège que d'un téléchargement abîmé.
- Les documents envoyés à la lecture partent chez le **fournisseur d'IA que vous avez choisi**, et nulle part ailleurs.
- Derrière plus d'un proxy (ou aucun), réglez `TRUST_PROXY` : la limite de tentatives de connexion se compte par
  adresse de visiteur. Sans Docker, fermez au pare-feu le port du serveur : seul votre proxy https doit l'atteindre.
- Ne publiez pas votre instance sans https, et laissez `X-Robots-Tag` en place : rien ne doit être indexé.
