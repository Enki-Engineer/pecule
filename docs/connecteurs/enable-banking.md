# Relier ses banques avec Enable Banking

Enable Banking est un prestataire finlandais d'accès aux comptes bancaires (agréé, supervisé par l'autorité
financière finlandaise). Il lit tes comptes auprès de ta banque, avec ton accord, par l'interface officielle
que la réglementation européenne impose aux banques. Pécule s'en sert pour récupérer comptes, soldes et
opérations.

> État au 12/11/2026 : parcours fait de bout en bout avec une banque française, connecteur en service
> (lecture des comptes, des soldes, des opérations et de l'encours des cartes à débit différé).

## Ce que ça coûte

Rien pour un usage personnel : les conditions d'Enable Banking le prévoient (« Personal usage, Sandbox and
evaluation usage continue to be free of charge »). En échange, l'accès est **restreint** :

- seuls les comptes que tu as reliés toi-même sont lisibles ;
- ces comptes doivent être les tiens (les comptes joints en font partie). Un autre adulte du foyer qui a des
  comptes personnels crée sa propre application et ajoute sa clé au même Pécule ;
- pas d'usage commercial, pas d'appli ouverte au public ; chaque foyer crée sa propre application (Pécule ne
  peut pas livrer de clé commune) ;
- Enable Banking peut plafonner le nombre de comptes reliés, et changer ses conditions.

## Ce que ça apporte

Mesuré sur une banque en ligne française ; d'une banque à l'autre, les détails changent.

| | |
|---|---|
| Comptes courants, soldes, opérations | Oui |
| Cartes à débit différé | Oui : un compte par carte, son **encours** (solde `OTHR`), et **chaque achat pas encore prélevé** avec sa date d'achat et la date du prochain prélèvement |
| Achats du jour | Oui, avant même leur comptabilisation |
| Historique à la première connexion | Au moins 900 jours (c'est ce qui a été demandé) |
| Catégories, code d'activité du marchand | Non : le classement reste celui de Pécule |
| Paiements | Non, et Pécule n'en demande pas : lecture seule |
| Durée de l'accord | 180 jours, puis une nouvelle validation auprès de la banque |
| Lectures en arrière-plan | Beaucoup de banques n'en acceptent que 4 par jour |

## Avant de commencer

- Ton Pécule doit être servi en **https**, à une adresse stable. Dans **l'appli pour Mac**, l'adresse de retour que
  Pécule affiche est de la forme `https://localhost:<port>/reglages/comptes` : déclare-la telle quelle. Personne ne
  la sert — l'appli la reconnaît au retour de la banque et reprend la main, sans certificat.
- La console d'Enable Banking propose de renseigner l'adresse d'une page de confidentialité et d'une page de
  conditions d'utilisation (facultatives tant que l'application n'accède qu'à tes propres comptes). Pécule les
  fournit : `https://<ton-pecule>/confidentialite` et `https://<ton-pecule>/conditions` (lisibles sans connexion,
  elles ne contiennent aucune donnée du foyer).

**L'appli guide ces étapes.** La présentation de bienvenue (à la première connexion) et le bloc « Enable Banking »
de Réglages → Comptes et connexions les déroulent en quatre temps — créer l'application, y relier ses comptes,
donner la clé à Pécule, autoriser la lecture — en disant où tu en es : clé reconnue, application active, adresse de
retour déclarée, banque reliée. On peut quitter le guide et y revenir. Cette page en est la version détaillée.

## 1. Créer ton compte

Sur <https://enablebanking.com/sign-in/>, saisis ton adresse mail. Tu reçois un lien à usage unique : le
compte est créé quand tu le suis (pas de mot de passe). Ouvre le lien **dans le même navigateur**.

## 2. Enregistrer l'application

Dans la console, **API applications** → *Add a new application* :

1. Environnement : **Production** (le bac à sable ne connaît pas les vraies banques).
2. Clé. La clé privée signe les demandes de Pécule ; elle ne doit jamais être publiée. Deux façons de la créer :
   - **Generate in the browser (using SubtleCrypto) and export private key** — le plus simple. Ton navigateur
     fabrique la clé et la télécharge à l'enregistrement, dans un fichier qui porte l'identifiant de l'application
     (`<identifiant>.pem`). Elle n'est pas envoyée à Enable Banking, qui ne garde que son certificat public.
   - **Generate outside the browser and import public certificate** — tu la fabriques toi-même, avec `openssl`
     (présent sur macOS et Linux) :

     ```sh
     openssl genrsa -out private.key 4096
     openssl req -new -x509 -days 1825 -key private.key -out public.crt -subj "/C=FR/O=Pecule/CN=pecule"
     ```

     `private.key` reste chez toi ; tu colles dans la console le contenu de `public.crt` (le certificat public,
     valable cinq ans).
3. Informations :
   - *Application name* : le nom que ta banque t'affichera au moment de l'accord, par exemple « Pécule » ;
   - *Allowed redirect URLs* : `https://<ton-pecule>/reglages/comptes` (Pécule l'affiche, avec un bouton pour la
     copier) ;
   - *Application description* : une phrase honnête, par exemple « Personal finance tracker, self-hosted by
     a single household for its own private, non-commercial use. It only reads account information of my own
     bank accounts. No payment initiation. » ;
   - *Email for data protection matters* : ton adresse ;
   - *Privacy URL* et *Terms URL* : les deux pages de ton Pécule (voir plus haut).
4. **Register**.

L'application apparaît avec son identifiant (un UUID) et l'état *Inactive*.

## 3. Relier tes comptes

Toujours dans la console : **Activate by linking accounts** → pays, banque, *personal* → **Link**.

- Tu passes par une page d'accord d'Enable Banking (« Continuer l'authentification »), puis par la connexion
  habituelle à ta banque.
- Au retour, l'application est *Active* et la liste des comptes reliés s'affiche (comptes courants, cartes).
- Recommence pour chaque banque : Pécule ne pourra lire que les comptes reliés là.

Tant que cette étape n'est pas faite, l'API répond `403 Application is not active`.

## 4. Donner la clé à Pécule

Dans Pécule, connecté comme administrateur du foyer : **Réglages → Comptes et connexions → Enable Banking**, temps
« Donne sa clé à Pécule » (ou la dernière étape de la présentation de bienvenue).

- « Choisir le fichier de la clé » : avec le fichier `<identifiant>.pem` téléchargé à l'étape 2, Pécule lit
  l'identifiant de l'application dans son nom et la clé dans son contenu. Avec `private.key`, donne aussi
  l'identifiant. Le certificat public (`public.crt`) est refusé : ce n'est pas la clé.
- « Saisir la clé à la main » : pour coller l'identifiant et le contenu du fichier.

Pécule essaie la clé avant de l'enregistrer ; elle est ensuite gardée chiffrée dans la base de ton instance et
n'est plus jamais affichée. Tu peux alors supprimer le fichier téléchargé, ou le ranger en lieu sûr. Le guide dit
si l'application est active (« Vérifier » relit son état) et si l'adresse de retour est bien déclarée.

## 5. Autoriser l'accès

Au même endroit, temps « Autorise Pécule à lire tes comptes » : pays, banque, **Relier**. Pécule t'envoie vers la
page d'accord, puis vers ta banque, une seconde fois. C'est normal : la première validation (étape 3) dit à Enable
Banking quels comptes sont les tiens, la seconde autorise ton application à les lire pendant 180 jours.

**Fais cette validation sans attendre** : la page d'accord expire au bout d'un quart d'heure environ.

Au retour, Pécule affiche « Banque reliée » et lit tes comptes. Ensuite il les relit tout seul, au plus une
fois toutes les six heures (les banques limitent le nombre de lectures), et à la demande avec « Lire
maintenant ». L'encours de tes cartes à débit différé apparaît sur l'accueil et le tableau de bord ; les achats
pas encore prélevés figurent dans les opérations, « en attente », à la date du prochain prélèvement.

## Deux adultes, deux applications

L'usage gratuit ne couvre que les comptes de la personne inscrite. Dans un foyer de deux adultes :

- l'administrateur crée l'application du foyer (étapes 1 à 5) : elle lit ses comptes et les comptes joints ;
- l'autre adulte, s'il a des comptes à son seul nom, refait les étapes 1 à 3 avec sa propre adresse mail, puis
  ouvre **Réglages → Comptes et connexions → Enable Banking → Application et clé → « J'ai des comptes à mon seul nom »** :
  le même guide s'y déroule pour sa clé personnelle, qui sert alors à ses accords. Sa présentation de bienvenue le
  lui propose aussi.

Un compte joint relié par les deux n'existe qu'une fois dans Pécule et n'est lu qu'une fois.

## Cartes

- **Débit différé** : un compte par carte, avec son encours et ses achats en attente (voir plus haut).
- **Débit immédiat** : chaque achat est déjà écrit sur le compte courant. Pécule ne lit donc pas les opérations
  de la carte, seulement son solde — sinon tout serait compté deux fois.

## Si une autre source alimentait déjà Pécule

Quand des comptes existent déjà (venus d'une autre source), Pécule ne mélange rien d'office : les comptes lus
par Enable Banking sont d'abord créés **à part, masqués et hors statistiques**. C'est la période d'observation.

1. « Comparer avec mes comptes actuels » montre, compte par compte, le compte existant qui porte les mêmes
   opérations et ce qui diffère (opérations identiques, datées autrement, connues d'un seul côté).
2. La **bascule** rattache ensuite chaque compte lu à son compte existant : les opérations reconnues gardent
   leur identifiant, leur catégorie et leurs notes ; elles prennent la date et l'état donnés par la banque ; les
   opérations que seule la banque connaît sont ajoutées ; le compte d'observation disparaît. L'ancienne source
   n'écrit plus dans un compte rattaché.

La bascule se lance par l'API, avec le jeton d'administration — d'abord à blanc, puis pour de bon :

```sh
curl -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d '{}' https://<ton-pecule>/api/bank/enable-banking/adopt
curl -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d '{"apply":true}' https://<ton-pecule>/api/bank/enable-banking/adopt
```

Une carte à débit immédiat n'a pas d'opérations à comparer : sa cible se donne à la main, avec
`{"apply": true, "map": {"<compte lu, eb:…>": "<compte de Pécule>"}}`.

Prends une sauvegarde complète avant (Réglages → Compte et sécurité). Sur une installation neuve, rien de tout
cela : les comptes lus sont créés directement, visibles.

## Tous les six mois

L'accord donné à la banque dure 180 jours ; l'écran des connexions affiche sa date de fin. Il suffit de
cliquer « Renouveler » avant l'échéance. Rien n'est perdu entre-temps : les opérations déjà lues restent dans Pécule.

## En cas de souci

| Message | Cause | Que faire |
|---|---|---|
| `Application is not active` | Aucun compte relié | Étape 3 |
| « Erreur lors de la mise à jour du statut d'authentification » au retour de la banque (`Missing session id`) | La page d'accord a expiré avant ta validation | Relancer l'autorisation et valider tout de suite ; l'accord donné à la banque entre-temps est sans effet |
| Un compte manque | Il n'a pas été relié à l'étape 3, ou la banque ne l'expose pas (livrets, placements) | Relier le compte ; sinon, import de fichier ou saisie à la main |
| Le lien de connexion du mail ne marche pas | Ouvert dans un autre navigateur | Le rouvrir dans le navigateur d'où la demande est partie |

## Pour qui touche au code

Référence : <https://enablebanking.com/docs/api/reference/>. Ce qui suit a été vérifié sur l'API réelle.

- **Authentification** : jeton JWT signé en RS256 avec la clé privée. En-tête `{ typ: "JWT", alg: "RS256",
  kid: <identifiant de l'application> }`, contenu `{ iss: "enablebanking.com", aud: "api.enablebanking.com",
  iat, exp }` (une heure). Envoyé en `Authorization: Bearer …` à `https://api.enablebanking.com`.
- **Parcours** :
  1. `GET /application` : état de l'application (`active`, `environment`, `redirect_urls`).
  2. `GET /aspsps?country=FR` : banques, avec `maximum_consent_validity` (secondes) et `psu_types`.
  3. `POST /auth` `{ access: { valid_until }, aspsp: { name, country }, state, redirect_url, psu_type }` →
     `{ url }` où envoyer le titulaire.
  4. Retour sur `redirect_url?code=…&state=…`. **Le recevoir côté serveur** : un écran qui réécrit son
     adresse perd le code.
  5. `POST /sessions` `{ code }` → `{ session_id, access: { valid_until }, accounts: [...] }`.
  6. `GET /accounts/{uid}/balances`, `GET /accounts/{uid}/transactions?date_from=…` (suite par
     `continuation_key`).
- **Comptes** : `uid` ne vaut que pour la session ; `identification_hash` est stable d'une session à
  l'autre. `cash_account_type` : `CACC` (compte courant), `CARD` (carte). Une carte à débit différé porte
  `product: "Carte bancaire à débit différé"` et `details: "delayed_debit"`, et s'identifie par un numéro
  interne (`account_id.other`, schéma `BANK`) au lieu d'un IBAN.
- **Soldes** : `CLBD` (comptable) et `XPCD` (temps réel) pour un compte courant. Pour une carte à débit
  différé : `OTHR` = encours qui sera prélevé, `XPCD` = encours plus les achats du jour.
- **Opérations** : `entry_reference` (référence stable dans un compte), `transaction_amount`,
  `credit_debit_indicator` (`DBIT` / `CRDT`), `status`, `booking_date`, `value_date`, `transaction_date`,
  `remittance_information` (libellé). Rien d'autre n'est rempli par la banque essayée (pas de
  `merchant_category_code`, pas de `bank_transaction_code`).
  - Carte à débit différé, achat **déjà prélevé** : `status: BOOK`, `booking_date` = jour du prélèvement,
    `transaction_date` = jour de l'achat.
  - Carte à débit différé, achat **pas encore prélevé** : `status: OTHR`, `booking_date` = date du prochain
    prélèvement. La somme de ces opérations égale le solde `OTHR` de la carte, au centime.
  - Achat **du jour** : `status: OTHR` sans `booking_date`, sous une référence provisoire (« avis-… ») ; il
    apparaît à la fois sur le compte courant et sur la carte. Pécule ne le garde pas : il attend que la
    banque l'écrive (le solde `XPCD` en tient déjà compte).
  - **Lire l'encours sur une période courte.** Sur une demande de 900 jours, des achats en attente manquent
    (leur somme ne retombe plus sur le solde `OTHR`) ; sur 45 ou 120 jours, tout y est. La synchronisation
    courante lit donc une fenêtre courte ; la longue période ne sert qu'à reprendre l'historique, une fois,
    et seules ses opérations comptabilisées (`BOOK`) sont gardées.
  - Le libellé (`remittance_information`) est une **liste de lignes** : l'intitulé de la banque d'abord (« PRLV SEPA
    CRÉANCIER », « VIR SEPA DONNEUR D'ORDRE », « CARTE 05/11/26 ENSEIGNE »), puis ce que le créancier a écrit
    (« Votre abonnement mobile… », coupé toutes les 40 lettres) et les références (numéro de contrat, « RUM … »,
    « Réf … »). Pécule prend l'intitulé comme libellé de l'opération — le même d'un mois à l'autre, donc la même
    catégorie —, garde toutes les lignes dans `bank_label`, et affiche le texte du créancier sous le nom de
    l'opération (`bankMotif`, `src/lib/labels.ts`).
  - `transaction_date` (jour de l'achat ou de l'ordre) est gardé dans `purchase_date` quand il précède
    `booking_date` : c'est le jour retenu si le foyer compte ses achats au jour de l'achat.
- **Règles pures** : `src/lib/enable-banking.ts` (nature d'un compte, solde à garder, opération dans les
  termes de Pécule, encours d'une carte recoupé avec ses achats en attente, lecture du fichier de la clé), testées.
- **Guide à l'écran** : `src/client/components/BankGuide.tsx`, le même dans Réglages et dans la présentation de
  bienvenue. L'état de ses quatre temps vient de `bankGuide` (`src/lib/onboarding.ts`) : tant que Pécule n'a pas la
  clé, il croit ce que le membre déclare avoir fait dans la console ; ensuite c'est `GET /application` qui parle.
  Une demande d'accord porte l'écran d'où elle part (`from`, gardé avec la demande en attente) : le retour de la
  banque y ramène.
- **Limites** : accord de 180 jours pour la plupart des banques ; lectures sans le titulaire souvent limitées
  à 4 par jour et par compte ; après la première connexion, certaines banques ne donnent plus que 90 jours
  d'historique.
