import { ServerCommand } from "./ServerCommand.tsx";
import { t } from "../../lib/i18n.ts";

/**
 * Où trouver le code d'installation, sous son champ : la commande qui, sur le serveur, donne le lien du premier
 * démarrage. Elle dépend de la façon dont Pécule est installé : c'est le serveur qui la dit (`setupCommand`).
 */
export function SetupCodeHelp({ command }: { command?: string }) {
  return (
    <div className="mt-2 w-full max-w-xs">
      <p className="text-xs text-muted">{t("Le code d'installation vient du serveur : cette commande, lancée dans le dossier de Pécule, donne un lien qui le porte.")}</p>
      {command && <ServerCommand text={command} className="card" />}
    </div>
  );
}
