import { Link } from "react-router";
import { AppLogo } from "../components/AppLogo.tsx";
import { t } from "../../lib/i18n.ts";

/*
 * Pages publiques « Confidentialité » et « Conditions d'utilisation » d'une instance de Pécule : lisibles sans
 * connexion (les prestataires d'accès aux comptes bancaires demandent leur adresse). Elles décrivent ce qu'est
 * toute instance — l'appli privée d'un foyer, hébergée par lui — et ne contiennent aucune donnée du foyer.
 */

type Section = { title: string; text: string };

const PRIVACY: Section[] = [
  {
    title: t("Qui y a accès"),
    text: t("Seuls les membres du foyer, invités par son administrateur, peuvent se connecter, avec une clé d'accès. Il n'y a ni inscription publique, ni utilisateur extérieur au foyer."),
  },
  {
    title: t("Données traitées"),
    text: t(
      "Les comptes, soldes et opérations bancaires des membres, leurs factures et leurs documents, et ce qu'ils saisissent eux-mêmes. Les données bancaires sont lues auprès de la banque avec l'accord du titulaire du compte, par un prestataire d'accès aux comptes agréé. Pécule ne fait que les lire : aucun paiement n'est initié.",
    ),
  },
  {
    title: t("Où elles sont gardées"),
    text: t("Dans la base de données de cette instance, chez l'hébergeur choisi par le foyer. Elles ne sont ni vendues, ni partagées, ni utilisées à des fins publicitaires."),
  },
  {
    title: t("Services extérieurs"),
    text: t(
      "Selon les réglages du foyer : un prestataire d'accès aux comptes bancaires, un fournisseur d'intelligence artificielle (qui reçoit alors les questions posées à l'assistant et les documents à lire) et des services de cours de bourse et de cryptomonnaies. Aucun n'est utilisé sans une décision du foyer.",
    ),
  },
  {
    title: t("Durée et suppression"),
    text: t("Les données restent tant que le foyer utilise cette instance. Un membre peut demander à l'administrateur la suppression de ses données, et retirer à tout moment, auprès de sa banque, l'accord donné pour la lecture de ses comptes."),
  },
  { title: t("Contact##page légale"), text: t("Pour toute question, s'adresser à l'administrateur de cette instance.") },
];

const TERMS: Section[] = [
  { title: t("Accès"), text: t("L'accès est réservé aux membres du foyer invités par son administrateur. Toute autre utilisation est interdite.") },
  {
    title: t("Usage##page légale"),
    text: t("Cette instance sert au suivi des finances du foyer : comptes, classement des opérations, budget, patrimoine, documents. Elle ne propose aucun service à des tiers et n'a aucune activité commerciale."),
  },
  {
    title: t("Données bancaires"),
    text: t("Chaque titulaire relie lui-même ses comptes et peut retirer son accord à tout moment. Pécule lit les comptes : il n'exécute aucune opération bancaire."),
  },
  {
    title: t("Ni conseil, ni garantie"),
    text: t("Les chiffres, les projections et les réponses de l'assistant sont des aides à la décision, pas des conseils financiers, fiscaux ou juridiques. Le logiciel est fourni tel quel, sans garantie."),
  },
  { title: t("Contact##page légale"), text: t("Pour toute question, s'adresser à l'administrateur de cette instance.") },
];

function LegalPage({ title, intro, sections, other }: { title: string; intro: string; sections: Section[]; other: { to: string; label: string } }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <Link to="/" aria-label="Pécule" className="inline-block">
        <AppLogo className="mb-6 size-12 rounded-[14px]" />
      </Link>
      <h1 className="page-title text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed">{intro}</p>
      {sections.map((s) => (
        <section key={s.title} className="mt-6">
          <h2 className="text-[15px] font-semibold text-ink">{s.title}</h2>
          <p className="mt-1.5 text-[15px] leading-relaxed">{s.text}</p>
        </section>
      ))}
      <p className="mt-10 flex gap-5 text-sm">
        <Link to={other.to} className="text-accent underline-offset-2 hover:underline">
          {other.label}
        </Link>
        <Link to="/" className="text-muted underline-offset-2 hover:underline">
          {t("Ouvrir Pécule")}
        </Link>
      </p>
    </main>
  );
}

const INTRO = t("Pécule est une application de suivi des finances d'un foyer. Cette instance est privée : elle est installée et utilisée par un seul foyer, pour son propre usage, sans but commercial.");

export function Privacy() {
  return <LegalPage title={t("Confidentialité")} intro={INTRO} sections={PRIVACY} other={{ to: "/conditions", label: t("Conditions d'utilisation") }} />;
}

export function Terms() {
  return <LegalPage title={t("Conditions d'utilisation")} intro={INTRO} sections={TERMS} other={{ to: "/confidentialite", label: t("Confidentialité") }} />;
}
