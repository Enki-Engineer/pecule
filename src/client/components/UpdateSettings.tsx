import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { Card } from "./ui.tsx";
import { Markdown } from "./Markdown.tsx";
import { Section } from "./SettingsSection.tsx";
import { cn } from "../cn.ts";
import { timeAgo } from "../format.ts";
import { locale, t } from "../../lib/i18n.ts";
import type { UpdateState } from "../../lib/version.ts";

type Status = {
  version: string;
  enabled: boolean;
  repo: string;
  checkedAt: string | null;
  error: "injoignable" | "refus" | "illisible" | null;
  state: UpdateState;
  latest: { version: string; url: string; notes: string; publishedAt: string | null } | null;
  docker: boolean;
  backups: { name: string; octets: number; at: number }[];
  backupDir: string;
  backupBeforeMigration: boolean;
};

const day = (at: number | string) => new Date(at).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" });
const hour = (at: number) => new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
const mo = (octets: number) => t("{n} Mo", { n: Math.max(1, Math.round(octets / 1_048_576)).toLocaleString(locale()) });

/** Une commande à lancer sur le serveur, avec son bouton de copie. */
function Command({ text }: { text: string }) {
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(t("Commande copiée")),
      () => toast.error(t("Copie impossible : sélectionne la commande à la main.")),
    );
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl bg-bg px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[13px]">{text}</code>
      <button type="button" onClick={copy} title={t("Copier la commande")} aria-label={t("Copier la commande")} className="press shrink-0 rounded-lg p-1.5 text-muted hover:text-ink">
        <Copy size={15} />
      </button>
    </div>
  );
}

/**
 * Réglages → Suivi technique (administrateur seulement) : la version de Pécule en service, celle qui est publiée si
 * elle est plus récente, et la commande qui l'installe. Rien ne s'installe depuis l'appli : la mise à jour se lance
 * sur le serveur, qui sauvegarde d'abord.
 */
export function UpdateSettings() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["updates"], queryFn: () => api<Status>("/updates"), staleTime: 60_000 });
  const check = useMutation({
    mutationFn: () => api<Status>("/updates/check", { method: "POST" }),
    onSuccess: (d) => {
      qc.setQueryData(["updates"], d);
      void qc.invalidateQueries({ queryKey: ["nav-counts"] });
      if (d.error) toast.error(t("GitHub n'a pas répondu : réessaie plus tard."));
      else if (d.state.kind === "a-jour") toast.success(t("Pécule est à jour"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Vérification impossible")),
  });
  const d = status.data;
  if (!d) return null;
  const newer = d.state.kind === "a-jour" ? null : d.state;
  const last = d.backups[0];

  return (
    <Section id="version" title={t("Version et mises à jour")}>
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <div className="figure text-xl font-semibold text-ink">{`Pécule ${d.version}`}</div>
            <p className="mt-0.5 text-sm text-muted">
              {!d.enabled
                ? t("La recherche de nouvelles versions est coupée sur ce serveur.")
                : newer
                  ? t("Une version plus récente est publiée.")
                  : d.error
                    ? t("La dernière vérification n'a pas abouti : GitHub n'a pas répondu.")
                    : d.checkedAt
                      ? t("À jour. Dernière vérification {quand}.", { quand: timeAgo(d.checkedAt) })
                      : t("Pas encore vérifié : Pécule regarde une fois par jour si une version plus récente est publiée.")}
            </p>
          </div>
          {d.enabled && (
            <button type="button" onClick={() => check.mutate()} disabled={check.isPending} className={cn("press inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink", check.isPending && "opacity-60")}>
              <RefreshCw size={15} className={cn(check.isPending && "animate-spin")} />
              {check.isPending ? t("Vérification…") : t("Vérifier maintenant")}
            </button>
          )}
        </div>

        {newer && (
          <div className="mt-4 border-t border-line pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-[15px] font-semibold text-ink">{t("Pécule {version} est disponible", { version: newer.version })}</h3>
              {d.latest?.publishedAt && <span className="text-xs text-muted">{t("publiée le {date}", { date: day(d.latest.publishedAt) })}</span>}
            </div>
            {d.latest?.notes && (
              <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-line px-3 py-2 text-sm">
                <Markdown text={d.latest.notes} />
              </div>
            )}
            {newer.kind === "palier" ? (
              <>
                <p className="mt-3 text-sm">
                  {t("Ta version est trop ancienne pour y passer d'un coup : installe d'abord la version {palier}, puis relance la mise à jour. Sur le serveur, dans le dossier de Pécule :", { palier: newer.palier })}
                </p>
                <Command text={`node scripts/maj.mjs --version ${newer.palier}`} />
              </>
            ) : (
              <>
                <p className="mt-3 text-sm">{t("Pour l'installer, lance cette commande sur le serveur, dans le dossier de Pécule :")}</p>
                <Command text="node scripts/maj.mjs" />
              </>
            )}
            <p className="mt-2 text-xs text-muted">
              {t("Elle télécharge une sauvegarde complète, installe la version, attend que Pécule ait redémarré et contrôle le résultat. Rien ne s'installe depuis l'appli.")}{" "}
              {d.latest && (
                <a href={d.latest.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent">
                  {t("Voir cette version sur GitHub")}
                  <ExternalLink size={12} />
                </a>
              )}
            </p>
          </div>
        )}

        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          {!d.backupBeforeMigration
            ? t("La sauvegarde automatique d'avant mise à jour est coupée sur ce serveur : fais-en une toi-même avant chaque mise à jour.")
            : last
              ? t("Avant une mise à jour qui change la base, le serveur en garde une sauvegarde complète. La dernière : le {date} à {heure} ({taille}), dans {dossier}.", { date: day(last.at), heure: hour(last.at), taille: mo(last.octets), dossier: d.backupDir })
              : t("Avant une mise à jour qui change la base, le serveur en garde une sauvegarde complète, dans {dossier}. Aucune pour l'instant.", { dossier: d.backupDir })}
        </p>
      </Card>
    </Section>
  );
}
