import { tk } from "../i18n.ts";
import type { ManualTheme } from "../manual.ts";

export const foyer: ManualTheme = {
  id: "foyer",
  title: tk("Foyer et membres"),
  hint: tk("Qui voit quoi, pays et devise, écrans affichés"),
  articles: [
    {
      id: "membres",
      title: tk("Ajouter un membre au foyer"),
      summary: tk("Inviter son conjoint ou un proche : il crée sa clé d'accès avec un lien."),
      body: [
        tk("Une installation de Pécule sert un foyer. Le premier membre créé en est l'administrateur ; c'est lui qui ajoute les autres."),
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Compte et sécurité]]."),
            tk("Sous [[Membres et clés d'accès]], saisis le prénom du nouveau membre et touche [[Ajouter un membre]]."),
            tk("Sur sa ligne, touche [[Lien d'inscription]], puis copie le lien et envoie-le lui."),
            tk("Il ouvre le lien sur son appareil et touche [[Créer ma clé d'accès]]."),
          ],
        },
        tk("Le lien est valable sept jours. Un prénom ne peut servir qu'une fois dans le foyer."),
        { note: tk("Réservé à l'administrateur, à l'écran seulement. Pour une personne qui ne se connecte pas — un enfant —, voir [Enfants et comptes professionnels](/manuel/personnes-et-banques-pro).") },
      ],
      links: [{ to: "/reglages/compte#membres", label: ["Réglages", "Compte et sécurité"] }],
      words: tk("inviter conjoint partenaire famille utilisateur compte partagé nouveau membre invitation"),
    },
    {
      id: "vues-et-vie-privee",
      title: tk("Ce que chaque membre voit"),
      summary: tk("Le commun, le personnel et le privé dans un foyer."),
      body: [
        tk("Chaque membre a sa vue de Pécule."),
        {
          list: [
            tk("Comptes : chacun voit les comptes du foyer, et règle pour lui seul ceux qu'il masque ou sort de ses statistiques. [[Moi]] ne garde que ses propres comptes."),
            tk("Patrimoine : chacun voit sa part — un bien ou un crédit commun compte pour sa quote-part, un compte commun pour moitié."),
            tk("Toujours privés : la retraite, les conversations avec l'assistant et ce qu'il retient, l'alerte de solde bas, les imports en cours."),
            tk("Privés tant que tu ne les partages pas : tes bulletins de paie et tes déclarations d'impôt personnelles. Avec [[Partager mes revenus avec le foyer]] ([[Réglages]] → [[Compte et sécurité]]), les autres membres en lisent les montants dans la vue [[Foyer]] de [[Revenus]] et d'[[Impôts]] — jamais les documents eux-mêmes."),
            tk("Privés au choix : une facture, un document, une tâche de l'échéancier, avec la case [[Visible par moi seul]]."),
            tk("Communs au foyer : les catégories, les règles de classement, les enseignes, le budget, et les réglages du foyer."),
          ],
        },
        tk("Les réglages de l'appareil (apparence, mode discret, notifications) ne concernent que l'appareil où ils sont faits."),
        { note: tk("La sauvegarde complète contient les données de tous les membres : seul l'administrateur peut la télécharger.") },
      ],
      links: [{ to: "/reglages/compte", label: ["Réglages", "Compte et sécurité"] }],
      words: tk("confidentialité privé partagé commun qui voit mes données conjoint vie privée séparé"),
    },
    {
      id: "pays-devise",
      title: tk("Pays, devise et fuseau horaire"),
      summary: tk("Les réglages qui disent où vit le foyer et dans quelle devise il compte."),
      body: [
        tk("Dans [[Réglages]] → [[Foyer]], section [[Pays et devise]] :"),
        {
          list: [
            tk("[[Pays]] : il règle aussi le fuseau horaire. Hors de France, les écrans [[Impôts]] et [[Retraite]], qui lisent des documents français, sont retirés ; tu peux les remettre."),
            tk("[[Devise du foyer]] : celle de tous les totaux, des budgets et du patrimoine."),
            tk("[[Fuseau horaire]] : il dit quel jour on est, pour les échéances, les notifications et le résumé du lundi."),
          ],
        },
        tk("Changer de devise recalcule les opérations et les soldes d'après la devise de chaque compte, au cours du jour de chaque opération. Pécule annonce d'abord ce qui sera recalculé et attend ta confirmation."),
        { warning: tk("Les montants saisis à la main — budgets, objectifs, placements, biens, crédits, bulletins — gardent leur chiffre après un changement de devise : ils sont à revoir.") },
        { note: tk("Réglages réservés à l'administrateur, à l'écran seulement.") },
      ],
      links: [{ to: "/reglages/foyer#pays", label: ["Réglages", "Foyer"] }],
      words: tk("monnaie euro dollar franc pays étranger expatrié fuseau heure changer la devise"),
    },
    {
      id: "ecrans-affiches",
      title: tk("Retirer ou remettre un écran"),
      summary: tk("Un foyer sans bien immobilier ou sans crypto n'a pas à voir ces écrans."),
      body: [
        tk("Six écrans sont facultatifs : [[Immobilier]], [[Crypto]], [[Projections]], [[Revenus]], [[Impôts]] et [[Retraite]]."),
        {
          steps: [
            tk("Ouvre [[Réglages]] → [[Foyer]], section [[Écrans affichés]]."),
            tk("Décoche un écran pour le retirer, coche-le pour le remettre."),
          ],
        },
        tk("Un écran retiré sort du menu, de la recherche et des raccourcis, pour tout le foyer. Ses données restent en place : le remettre les retrouve telles quelles."),
        { note: tk("Réservé à l'administrateur. L'assistant peut le faire pour lui : « retire l'écran Crypto ».") },
      ],
      links: [{ to: "/reglages/foyer#ecrans", label: ["Réglages", "Foyer"] }],
      words: tk("modules masquer un écran menu cacher désactiver une fonction enlever simplifier"),
    },
    {
      id: "personnes-et-banques-pro",
      title: tk("Enfants et comptes professionnels"),
      summary: tk("Dire à Pécule à qui attribuer un compte qui arrive."),
      body: [
        tk("Dans [[Réglages]] → [[Foyer]], section [[Personnes et banques]] :"),
        {
          list: [
            tk("[[Personnes sans connexion]] : un enfant, par exemple. Les comptes qui portent son prénom lui sont attribués."),
            tk("[[Banques des comptes professionnels]] : les comptes de ces banques sont rangés à part, comme professionnels."),
          ],
        },
        tk("Sépare les noms par une virgule, puis touche [[Enregistrer]]. Ces listes servent quand un nouveau compte arrive, pour lui donner son titulaire d'après son intitulé."),
        { note: tk("Réservé à l'administrateur.") },
      ],
      links: [{ to: "/reglages/foyer#personnes", label: ["Réglages", "Foyer"] }],
      words: tk("enfant mineur livret jeune compte pro professionnel entreprise titulaire attribuer"),
    },
    {
      id: "administrateur",
      title: tk("Ce qui est réservé à l'administrateur"),
      summary: tk("Les réglages que seul l'administrateur du foyer peut changer."),
      body: [
        tk("L'administrateur est le premier membre créé à l'installation. Lui seul peut :"),
        {
          list: [
            tk("ajouter un membre et créer son lien d'inscription ;"),
            tk("régler le foyer : pays, devise, fuseau horaire, jour retenu pour les achats par carte, écrans affichés, personnes et banques ;"),
            tk("enregistrer la clé d'Enable Banking du foyer, le fournisseur d'IA, les clés de CoinStats et de CoinGecko ;"),
            tk("créer des jetons d'administration ;"),
            tk("télécharger la sauvegarde complète ;"),
            tk("voir la version de Pécule en service et celle qui est publiée ;"),
            tk("voir les alertes techniques et le journal de tous les membres."),
          ],
        },
        tk("Tout le reste est ouvert à chaque membre : classer, ajouter des factures et des documents, tenir le budget, régler ses comptes et son appareil."),
        { note: tk("En mode démo, personne n'est administrateur : ces réglages sont verrouillés, sauf le jour retenu pour les achats par carte, que chacun peut essayer.") },
      ],
      links: [{ to: "/reglages/foyer", label: ["Réglages", "Foyer"] }],
      words: tk("admin droits permissions rôle réservé interdit grisé pas le droit"),
    },
  ],
};
