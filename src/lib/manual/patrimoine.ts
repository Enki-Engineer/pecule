import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const patrimoine: ManualTheme = {
  id: "patrimoine",
  title: tk("Patrimoine"),
  hint: tk("Épargne, placements, immobilier, crédits, crypto, projections"),
  articles: [
    {
      id: "patrimoine-vue-ensemble",
      title: tk("Lire son patrimoine"),
      summary: tk("Ce que tu possèdes, ce que tu dois, et comment cela évolue."),
      body: [
        tk("L'écran [[Patrimoine]] montre ta part : un compte, un bien ou un crédit commun y compte pour la quote-part enregistrée."),
        {
          list: [
            tk("[[Patrimoine net]] : ce que tu possèdes moins ce que tu dois encore."),
            tk("[[Actifs bruts]] : tout ce que tu possèdes, avant de retirer les crédits."),
            tk("[[Crédits restants]] : le capital qu'il te reste à rembourser."),
            tk("[[Disponible]] : comptes courants et épargne, ce qui se mobilise sans rien vendre."),
          ],
        },
        tk("Le patrimoine se range en six poches : immobilier, crypto, placements, épargne, comptes et autres. Sur ordinateur, clique sur une poche pour filtrer le tableau des actifs, et sur une date de la courbe pour voir la répartition ce jour-là et l'écart depuis."),
        tk("Les soldes des comptes viennent de la banque ; la crypto et les placements cotés suivent les cours du marché ; les autres valeurs se mettent à jour à la main. Un relevé du patrimoine est gardé chaque jour : c'est ce qui dessine la courbe."),
      ],
      links: [{ to: "/patrimoine", label: ["Patrimoine"] }],
      words: tk("fortune richesse valeur nette actifs passifs évolution répartition combien je possède"),
    },
    {
      id: "placements",
      title: tk("Ajouter ou mettre à jour un placement"),
      summary: tk("Livret, assurance vie, PEA, bien : saisir une valeur et la tenir à jour."),
      body: [
        {
          steps: [
            tk("Sur [[Patrimoine]], touche [[Ajouter un placement]]."),
            tk("Donne son nom, sa poche (épargne, placements, immobilier ou autres), sa valeur actuelle et, si tu veux, l'établissement."),
            tk("Touche [[Ajouter]]."),
          ],
        },
        tk("Pour mettre une valeur à jour, touche la ligne du placement, saisis la nouvelle valeur et touche [[Enregistrer]]. Pour un placement coté, on saisit le nombre de parts et les espèces du compte : la valeur suit le cours."),
        {
          list: [
            tk("Une valeur saisie il y a plus de trois mois est rappelée dans [[À traiter]], sur le tableau de bord."),
            tk("Un relevé de placement déposé au coffre propose la nouvelle valeur, à valider."),
            tk("L'assistant peut le faire : « mets mon livret A à 12 000 »."),
          ],
        },
        { note: tk("Un placement ajouté ici t'est propre. Les comptes bancaires, eux, arrivent avec leur banque.") },
      ],
      links: [{ to: "/patrimoine", label: ["Patrimoine"] }],
      words: tk("livret assurance vie pea compte titres actions épargne salariale valeur mettre à jour ajouter un actif"),
    },
    {
      id: "versements-recus",
      title: tk("Suivre les versements d'un placement"),
      summary: tk("Coupons, intérêts, ce qu'une plateforme reverse : leur historique, le total par année et le rendement."),
      body: [
        tk("Un placement qui te verse de l'argent — les coupons d'une obligation, des intérêts, ce qu'une plateforme te reverse — peut suivre ces versements : Pécule les retrouve dans tes opérations, sans rien recopier."),
        {
          steps: [
            tk("Sur [[Patrimoine]], touche la ligne du placement, puis [[Suivre les versements reçus]]."),
            tk("Dans [[Texte du libellé]], écris un texte présent dans le libellé de ces entrées d'argent : le nom de l'émetteur ou de la plateforme, tel que la banque l'écrit."),
            tk("Choisis ce que devient la valeur, puis touche [[Suivre ces versements]]."),
          ],
        },
        {
          list: [
            tk("[[Valeur saisie]] : la valeur reste celle que tu saisis, les versements sont ce que le placement rapporte. C'est le cas d'une obligation ou de parts."),
            tk("[[Valeur = dernier versement]] : la valeur devient le dernier versement reçu et se met à jour seule après chaque synchronisation. C'est fait pour un portefeuille vidé à chaque versement ; entre deux versements, c'est une estimation de ce qu'il contient."),
          ],
        },
        tk("La fiche du placement montre alors le dernier versement, ce qui a été reçu sur douze mois, le total de chaque année et, quand les versements remontent à un an, le rendement : ce qui a été reçu sur douze mois, rapporté à la valeur. [[Voir ces opérations]] ouvre la liste des versements."),
        { note: tk("Seules les entrées d'argent de tes comptes sont lues. [[Modifier]] change le texte, [[Ne plus suivre]] arrête le suivi : la valeur redevient une valeur saisie. L'assistant peut le régler : « suis les coupons de mes obligations ».") },
      ],
      links: [{ to: "/patrimoine", label: ["Patrimoine"] }],
      words: tk("coupon obligation intérêts dividende versement rendement plateforme portefeuille reversé suivi automatique"),
    },
    {
      id: "immobilier",
      title: tk("Suivre un bien immobilier"),
      summary: tk("Valeur, crédits, équité, loyers et documents de chaque bien."),
      module: "immobilier",
      body: [
        tk("L'écran [[Immobilier]] liste les biens du foyer. La fiche d'un bien réunit sa valeur estimée, le capital restant dû sur ses crédits, l'équité (la valeur moins ce qui reste dû), et, pour un bien loué, le loyer, le rendement brut et ce qu'il laisse chaque mois une fois le crédit et les charges payés."),
        tk("Elle rattache aussi ce qui concerne le bien : ses crédits, son bail, sa taxe foncière, ses frais (les engagements du budget), ses documents et ses tâches."),
        {
          list: [
            tk("Créer un bien : dépose son acte, son compromis ou son bail dans le coffre ; Pécule en lit les données et te les propose."),
            tk("Mettre à jour sa valeur : sur [[Patrimoine]], touche sa ligne dans la poche immobilier."),
            tk("Loyer, charges, bail, valeur : l'assistant peut les corriger — « passe le loyer de l'appartement d'Angers à 720 »."),
            tk("Faits clés : l'assistant les tient à jour — « note que le diagnostic de l'appartement d'Angers est passé en C », « retire l'ancienne assurance de sa fiche »."),
          ],
        },
        { note: tk("Un bien commun est compté pour ta part dans ton patrimoine.") },
      ],
      links: [{ to: "/immobilier", label: ["Immobilier"] }],
      words: tk("maison appartement résidence principale locatif loyer sci équité rendement bien immobilier valeur"),
    },
    {
      id: "credits",
      title: tk("Suivre un crédit"),
      summary: tk("Capital restant dû, prochaine échéance, coût du crédit et tableau d'amortissement."),
      body: [
        tk("Les crédits figurent en bas de l'écran [[Patrimoine]]. La fiche d'un crédit montre le capital restant dû, ce qui est déjà remboursé, la mensualité, la date de fin, et le détail de la prochaine échéance : capital, intérêts, assurance."),
        tk("Sur ordinateur s'y ajoutent ce que coûte chaque année, les conditions du prêt, le coût total du crédit et le tableau d'amortissement, année par année."),
        {
          list: [
            tk("Ajouter un crédit : dépose son tableau d'amortissement ou son offre de prêt dans le coffre ; Pécule le lit et te propose le crédit, à valider."),
            tk("Le capital restant dû est celui du tableau de la banque, à la dernière échéance passée."),
            tk("La prochaine mensualité et la fin du crédit figurent dans l'échéancier."),
          ],
        },
        { note: tk("Un prêt renégocié ou remboursé en partie se met à jour en déposant le nouveau tableau d'amortissement.") },
      ],
      links: [{ to: "/patrimoine", label: ["Patrimoine"] }],
      words: tk("prêt emprunt immobilier mensualité amortissement capital restant dû intérêts assurance emprunteur"),
    },
    {
      id: "crypto",
      title: tk("Suivre ses cryptomonnaies"),
      summary: tk("Portefeuilles lus par leur adresse, exchanges reliés par une clé en lecture seule, compte CoinStats ou positions saisies à la main."),
      module: "crypto",
      body: [
        tk("L'écran [[Crypto]] donne la valeur totale, la variation sur 24 heures, les positions par crypto et par portefeuille, et le journal des mouvements. [[Ajouter un portefeuille]] propose plusieurs façons de relier ce que tu as ; elles se combinent, et [[Synchroniser]] relit tout sans attendre le lendemain."),
        {
          list: [
            tk("[[Un portefeuille, par son adresse publique]] : colle l'adresse, Pécule reconnaît la blockchain, montre ce qu'il a trouvé, puis relit le portefeuille chaque jour. Aucun compte à ouvrir, aucune clé à créer ; chaque membre ajoute les siens."),
            tk("[[Un exchange, par une clé en lecture seule]] : Kraken, Binance, Coinbase, Bitpanda, Bitvavo, OKX, Bybit, KuCoin, Bitget, Bitfinex ou Crypto.com Exchange. Choisis l'exchange et suis ses trois étapes ; Pécule lit le compte tout de suite, puis chaque jour ; chaque membre relie les siens."),
            tk("[[Une appli, par son export]] : l'appli Crypto.com (historique « Crypto Wallet », au format CSV) et SwissBorg (relevé « Account Statement », au format Excel) n'ont pas de clé d'API. Dépose leur fichier ; Pécule en tire le solde de chaque crypto, et un mouvement déjà connu n'est jamais compté deux fois. À refaire de temps en temps, avec l'export de la période écoulée."),
            tk("[[Un compte CoinStats]] : un agrégateur, utile pour ce que Pécule ne lit pas lui-même (une blockchain ou un exchange absents de la liste, un jeton rare, un dépôt dans un protocole). Un compte par foyer ; l'administrateur saisit sa clé dans [[Réglages]] → [[Comptes et connexions]]."),
            tk("À la main : demande à l'assistant d'ajouter une position, puis touche une crypto pour corriger sa quantité."),
          ],
        },
        tk("Ce que Pécule lit à une adresse :"),
        {
          list: [
            tk("Bitcoin : une adresse, ou mieux la clé publique étendue du compte (elle commence par xpub, ypub ou zpub). Un Ledger ou un Trezor change d'adresse à chaque réception : la clé étendue les couvre toutes. Elle se trouve dans les détails avancés du compte, dans l'appli du portefeuille."),
            tk("Ethereum et les chaînes compatibles (Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis, Linea) : une seule adresse 0x… pour toutes. Pécule lit la monnaie de chaque chaîne et les jetons les plus courants ; sur Ethereum et Optimism, il trouve aussi un jeton plus rare, pourvu qu'il ait un cours connu et vaille plus d'un centime. Un NFT ou un dépôt dans un protocole ne sont pas lus."),
            tk("Solana : les SOL du portefeuille, ceux mis en staking et les jetons les plus courants."),
            tk("Cardano : une adresse du portefeuille suffit (addr1… ou stake1…) ; Pécule lit le solde de tout le portefeuille, récompenses de staking comprises, pas ses jetons natifs."),
            tk("MultiversX : les EGLD du portefeuille, les EGLD délégués et les jetons que MultiversX sait valoriser."),
            tk("VeChain : ses adresses ont la forme de celles d'Ethereum ; la même adresse 0x… y est lue aussi (VET et VTHO)."),
            tk("Un validateur Ethereum, par son numéro ou sa clé publique."),
          ],
        },
        { warning: tk("Une adresse publique permet de lire, jamais de dépenser. Ne saisis jamais ta phrase de récupération ni une clé privée : Pécule ne les demande pas, et te le dit si tu en colles une.") },
        { warning: tk("La clé d'un exchange doit être en lecture seule : elle montre les soldes, elle ne peut ni vendre ni retirer. Quand l'exchange dit les droits d'une clé (Binance, Coinbase, Bitpanda, Bybit, Bitfinex), Pécule refuse celle qui peut faire plus ; chez les autres, suis le guide et ne coche que la lecture. La clé est gardée chiffrée et n'est plus jamais affichée.") },
        {
          list: [
            tk("Un exchange ne se lit pas par une adresse : ses comptes ne sont pas sur une adresse à toi. Relie-le par sa clé ; pour un exchange que Pécule ne connaît pas, passe par CoinStats ou saisis la position à la main."),
            tk("Chez un exchange, Pécule lit les soldes du compte, épargne et staking compris quand l'exchange les donne. Les contrats à terme ne sont pas lus, ni les actions et métaux de Bitpanda."),
            tk("Si l'exchange n'accepte plus la clé (une clé Bitpanda vaut un an au plus, une clé peut être retirée), le compte est marqué « [[clé refusée]] » et garde ses quantités : retire-le, puis relie-le avec une nouvelle clé."),
            tk("Un compte tenu par ses exports ne se relit pas seul : il se met à jour quand tu déposes un nouveau fichier. Ce qui est immobilisé dans l'appli (staking, carte) reste compté ; compare les soldes à ceux de l'appli après un dépôt. Si l'appli en affiche un autre (son export a parfois un trou, des récompenses anciennes par exemple), le crayon du portefeuille ([[Corriger un solde]]) enregistre le solde affiché : Pécule part de lui, et les mouvements des exports suivants s'y ajoutent."),
            tk("Les cours viennent de CoinGecko et se rafraîchissent d'eux-mêmes."),
            tk("La liste des portefeuilles est rangée par provenance — [[Par leur adresse]], [[Exchanges]], [[Par leurs exports]], [[Via CoinStats]], [[Saisis à la main]] — avec le total de chacune : on voit d'un coup d'œil ce qui dépend de quoi. Les portefeuilles qui ne comptent rien se replient. Touche un portefeuille pour faire ressortir ses cryptos dans [[Par crypto]], avec ce qu'il porte de chacune ; [[Tout afficher]] revient à la liste entière."),
            tk("Décoche un portefeuille pour l'écarter du total. Un portefeuille que tu as ajouté toi-même se retire par la corbeille ([[Retirer ce portefeuille]])."),
            tk("Un même portefeuille suivi par deux voies compterait double. Quand une source que tu as reliée toi-même et une source venue d'un autre outil portent les mêmes avoirs, Pécule le signale ([[Compté deux fois ?]]) : [[Ne compter qu'une fois]] garde ta lecture directe, crypto par crypto, et laisse à l'autre ce qu'elle est seule à voir. Il signale de même la ligne saisie à la main qui ferait doublon ([[Archiver la ligne saisie à la main]])."),
            tk("Si une blockchain ou un exchange ne répond pas un jour, Pécule garde les quantités de la veille et réessaie."),
            tk("Un portefeuille que CoinStats rend vide, ou bien plus bas qu'à la lecture d'avant, est marqué « [[à vérifier]] » et garde ses positions : sa connexion est peut-être cassée. S'il a vraiment été vidé ou vendu, [[C'est exact]] confirme la nouvelle valeur."),
          ],
        },
        { note: tk("Une ligne saisie à la main que CoinStats couvre ensuite est archivée d'elle-même, pour ne pas compter deux fois. Une ligne archivée se remet en compte ([[Remettre en compte]]) ou se supprime pour de bon par sa corbeille ([[Supprimer la ligne archivée]]).") },
      ],
      links: [
        { to: "/patrimoine/crypto", label: ["Crypto"] },
        { to: "/reglages/connexions?c=coinstats", label: ["Réglages", "Comptes et connexions"] },
      ],
      words: tk("bitcoin ethereum solana cryptomonnaie wallet portefeuille adresse publique xpub ledger trezor metamask phantom coinstats coingecko cardano vechain multiversx exchange kraken binance coinbase bitpanda bitvavo okx bybit kucoin bitget bitfinex crypto.com swissborg export csv excel xlsx relevé fichier clé api lecture seule staking blockchain"),
    },
    {
      id: "projections",
      title: tk("Projections de patrimoine"),
      summary: tk("Ce que deviendrait ton patrimoine dans quelques années, selon trois scénarios."),
      module: "projections",
      body: [
        tk("L'écran [[Projections]] montre ton patrimoine à un horizon de plusieurs années, poche par poche, selon trois scénarios : prudent, central et favorable. Chaque poche affiche son point de départ et les hypothèses de chaque scénario."),
        tk("L'écran se lit ; les projections se construisent avec l'assistant, qui crée, modifie ou supprime une poche après ta confirmation : « ajoute aux projections 2031 une poche PEA : 45 000 en prudent, 60 000 en central, 75 000 en favorable »."),
        { note: tk("Ce sont des hypothèses, pas des prévisions : revois-les de temps en temps. Une projection t'est propre, sauf si tu demandes qu'elle soit commune au foyer.") },
      ],
      links: [{ to: "/projections", label: ["Projections"] }],
      words: tk("simulation futur scénario prévision horizon long terme hypothèses rendement"),
    },
  ],
};
