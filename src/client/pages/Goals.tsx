import { PageHeader } from "../components/ui.tsx";
import { GoalsList } from "../components/Planning.tsx";
import { t } from "../../lib/i18n.ts";

/** Objectifs d'épargne : projets, montant visé, échéance, avancement, versement mensuel conseillé. */
export function Goals() {
  return (
    <>
      <PageHeader title={t("Objectifs")} subtitle={t("Projets d'épargne : avancement et versement mensuel pour tenir la date")} />
      <GoalsList />
    </>
  );
}
