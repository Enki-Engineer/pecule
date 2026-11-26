# Sécurité

[Read in English](SECURITY.md)

Pécule garde des données bancaires et des documents personnels. Merci de signaler toute faille **en privé** :
onglet « Security » du dépôt → « Report a vulnerability » (signalement privé de GitHub). N'ouvre pas de ticket
public, et ne joins aucune donnée réelle.

Indique la version (ou le commit), les étapes pour reproduire et l'effet constaté. Le projet est tenu sur du temps
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
- Le mode démo est une commodité pour montrer l'appli, pas une barrière de sécurité entre deux personnes : ne prête
  pas un appareil où une session est ouverte.

## Ce qui protège une installation

- **Https sur Internet, toujours.** En http, Pécule ne s'installe que sur la machine elle-même (`localhost`) ou sur
  le réseau de la maison (une adresse privée), où tout circule en clair sur ce réseau.
- **Connexion par clés d'accès (WebAuthn) d'abord.** Un membre peut choisir un **mot de passe** — le seul moyen
  d'entrer là où une clé d'accès ne se crée pas (http du réseau de la maison, adresse IP) : douze caractères au
  moins, gardé en empreinte scrypt, essais freinés par membre (cinq faux de suite ferment sa connexion par mot de
  passe une minute, puis jusqu'à quinze) et par adresse. Sur une installation en https où chacun a sa clé,
  l'administrateur peut **exiger la clé d'accès** : plus aucun mot de passe n'est accepté (Réglages → Compte et
  sécurité). Connaître un prénom permet de fermer un temps la connexion par mot de passe de ce membre, pas sa clé ;
  `node scripts/lien.mjs --membre <prénom>`, sur le serveur, redonne un accès à qui a perdu le sien.
- **`API_TOKEN`** donne tous les droits sur l'API : garde-le hors du dépôt et ne le partage pas. **`SECRET_KEY`**
  chiffre les secrets gardés en base (clé de la banque, clé d'IA, clé des notifications) : le perdre ou le changer
  les rend illisibles. Une installation sans `SECRET_KEY` chiffre avec `API_TOKEN`.
- La **sauvegarde complète** téléchargée ou gardée sur le serveur n'est pas chiffrée : range l'archive comme un
  document sensible. Ce qui part vers un stockage extérieur l'est toujours (format age, destinataire X25519) : le
  serveur ne garde que la clé publique, et ne peut pas relire ce qu'il a envoyé. La clé de récupération n'est montrée
  qu'une fois à l'administrateur.
- L'adresse du **stockage extérieur** est donnée par l'administrateur et peut désigner un appareil du réseau du
  serveur (un NAS) : seul l'administrateur la règle, jamais en mode démo.
- La **restauration depuis l'appli** n'existe que sur une installation sans membre ni donnée, et demande le code
  d'installation (`SETUP_CODE`, à défaut `API_TOKEN`) : une installation en service ne peut pas être écrasée par là.
  Ne restaure que tes propres archives : une sauvegarde est la base tout entière, accès compris (clés d'accès,
  empreintes des mots de passe, jetons d'administration, applications connectées) — restaurer celle d'un tiers lui donne l'installation.
- L'administrateur **coupe d'un coup tous les accès d'un membre** (appareil perdu, départ du foyer) : clés d'accès,
  mot de passe, sessions, lien de calendrier, jetons de dépôt, applications connectées (Réglages → Compte et sécurité).
- Rien de ce que l'assistant écrit ne l'est sans confirmation, **sa mémoire comprise** : un texte venu d'ailleurs
  (libellé d'un virement, document déposé) ne peut pas s'y inscrire seul. Un assistant extérieur connecté par OAuth
  lit en revanche les libellés et les documents tels quels : n'y connecte qu'un assistant auquel tu confies ces
  données, et garde-le en lecture seule si tu n'as pas besoin des actions.
- Chaque version publiée porte une **attestation de provenance** (voir `docs/guide/mise-a-jour.md`) : `SHA256SUMS`,
  téléchargé au même endroit que l'archive, ne protège que d'un téléchargement abîmé.
- Les documents envoyés à la lecture partent chez le **fournisseur d'IA que tu as choisi**, et nulle part ailleurs.
- Derrière plus d'un proxy (ou aucun), règle `TRUST_PROXY` : la limite de tentatives de connexion se compte par
  adresse de visiteur. Sans Docker, ferme au pare-feu le port du serveur : seul ton proxy https doit l'atteindre.
- Ne publie pas ton instance sans https — ni derrière un certificat autosigné, que le navigateur refuse pour les
  clés d'accès —, et laisse `X-Robots-Tag` en place : rien ne doit être indexé.

## L'appli pour Mac

L'appli de bureau (`docs/guide/appli-mac.md`) fait tourner Pécule et sa base sur l'ordinateur de celui qui s'en sert.
Son modèle n'est pas celui d'un serveur :

- **Le compte du Mac est la seule frontière.** Les données, la base et les réglages — dont le secret qui chiffre les
  clés gardées en base — sont dans `~/Library/Application Support/Pecule`, fermé aux autres comptes. Qui ouvre la
  session du Mac a tout : verrouille-la, et active FileVault. Une sauvegarde du Mac (Time Machine) emporte ce
  dossier entier : protège-la de même.
- **Sur un compte du Mac partagé par plusieurs personnes, « privé » ne protège de personne.** Le menu Aide →
  « Mot de passe oublié… » donne à qui tient la fenêtre un accès à n'importe quel membre, administrateur compris —
  c'est l'équivalent de `scripts/lien.mjs` sur un serveur. Un mot de passe n'y arrête qu'un regard de passage. Pour
  des membres qui se cachent des choses : un compte du Mac chacun, ou une installation sur un serveur.
- **Rien ne sort de la machine.** Le serveur n'écoute que sur `127.0.0.1` et ne répond qu'à ce nom (une page d'un
  autre site qui ferait pointer le sien vers la machine est refusée) ; la base n'a aucun port, seulement un socket
  dans le dossier des données.
- **Le témoin de session vaut pour tous les ports de `127.0.0.1`** : un navigateur l'enverrait à un autre programme
  qui prendrait le port de Pécule quand il est arrêté. La fenêtre de l'appli ne va à ce port qu'après que son propre
  serveur a prouvé qu'il le tient, et la fenêtre où se donne l'accord d'une banque n'a jamais ce témoin. Sur un Mac
  où d'autres comptes sont ouverts en même temps, n'ouvre pas Pécule dans un navigateur ordinaire.
- **L'appli n'est pas signée par un compte Apple** (signature « ad hoc ») : macOS ne peut pas dire de qui elle
  vient. Installe-la par la commande du guide, qui contrôle son empreinte, et vérifie au besoin l'attestation de
  provenance de la version. Les mises à jour faites par l'appli sont, elles, **signées** : elle refuse une archive
  qui ne porte pas la signature du projet, d'où qu'elle vienne. Node.js et MySQL y sont ceux de leurs éditeurs,
  épinglés par leur empreinte (`bureau/pieces.json`), avec leur signature d'origine.
- La page de Pécule ne reçoit aucun pouvoir de l'appli : ni commande, ni accès aux fichiers. L'appli ne fait que
  regarder où la fenêtre veut aller — tout lien extérieur part dans le navigateur.
