import { ServerCommand } from "./ServerCommand.tsx";
import { useDesktop } from "../desktop.ts";
import { t } from "../../lib/i18n.ts";

/**
 * Où trouver le code d'installation, sous son champ : la commande qui, sur le serveur, donne le lien du premier
 * démarrage. Elle dépend de la façon dont Pécule est installé : c'est le serveur qui la dit (`setupCommand`). Dans
 * l'appli de bureau, il n'y a pas de commande : l'appli donne le code elle-même, à son ouverture.
 */
export function SetupCodeHelp({ command }: { command?: string }) {
  const desktop = useDesktop();
  if (desktop)
    return (
      <div className="mt-2 w-full max-w-xs">
        <p className="text-xs text-muted">{t("L'appli donne ce code elle-même à son ouverture : quitte Pécule, puis rouvre-le.")}</p>
      </div>
    );
  return (
    <div className="mt-2 w-full max-w-xs">
      <p className="text-xs text-muted">{t("Le code d'installation vient du serveur : cette commande, lancée dans le dossier de Pécule, donne un lien qui le porte.")}</p>
      {command && <ServerCommand text={command} className="card" />}
    </div>
  );
}
