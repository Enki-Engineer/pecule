import { Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../cn.ts";
import { t } from "../../lib/i18n.ts";

/** Une commande à lancer dans un terminal (sur le serveur, ou pour brancher un assistant), avec son bouton de copie. */
export function ServerCommand({ text, className }: { text: string; className?: string }) {
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(t("Commande copiée")),
      () => toast.error(t("Copie impossible : sélectionne la commande à la main.")),
    );
  return (
    <div className={cn("mt-2 flex items-center gap-2 rounded-xl bg-bg px-3 py-2 text-left", className)}>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[13px]">{text}</code>
      <button type="button" onClick={copy} title={t("Copier la commande")} aria-label={t("Copier la commande")} className="press shrink-0 rounded-lg p-1.5 text-muted hover:text-ink">
        <Copy size={15} />
      </button>
    </div>
  );
}
