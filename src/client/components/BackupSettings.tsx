import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { Card } from "./ui.tsx";
import { cn } from "../cn.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

type Info = {
  tables: number;
  octets: number;
  operations: number;
  factures: number;
  documents: number;
  running: boolean;
  /** `at` : instant de la dernière sauvegarde (millisecondes). */
  last: { at: number; by: string | null; octets: number | null } | null;
};

const n = (v: number) => v.toLocaleString(locale());
const mo = (octets: number) => t("{n} Mo", { n: n(Math.max(1, Math.round(octets / 1_048_576))) });

/**
 * Réglages → Compte et sécurité (administrateur seulement) : téléchargement de la sauvegarde complète.
 * Le navigateur télécharge lui-même l'archive (lien simple : rien ne passe par la mémoire de la page) ;
 * la fin se lit dans le journal, où le serveur note chaque sauvegarde aboutie.
 */
export function BackupSettings() {
  // Dernière sauvegarde connue au moment du clic : tant qu'elle n'a pas changé, le téléchargement est en cours.
  const [since, setSince] = useState<number | null | undefined>(undefined);
  const waiting = since !== undefined;
  const info = useQuery({ queryKey: ["backup-info"], queryFn: () => api<Info>("/backup/info"), refetchInterval: waiting ? 4000 : false });
  const d = info.data;
  const lastAt = d?.last?.at ?? null;

  useEffect(() => {
    if (!waiting || !d || lastAt === since) return;
    setSince(undefined);
    toast.success(t("Sauvegarde terminée"));
  }, [waiting, d, lastAt, since]);

  const busy = waiting || d?.running === true;
  return (
    <Card className="p-4">
      <p className="text-sm">
        {t("Télécharge une archive zip de tout Pécule : la base entière (opérations, catégories, patrimoine, réglages, conversations avec l'assistant) et tous les fichiers gardés — factures, documents du coffre, logos.")}
      </p>
      {d && (
        <p className="tnum mt-2 text-sm text-muted">
          {[
            tn("{n} opération", "{n} opérations", d.operations, { n: n(d.operations) }),
            tn("{n} facture", "{n} factures", d.factures, { n: n(d.factures) }),
            tn("{n} document", "{n} documents", d.documents, { n: n(d.documents) }),
            t("environ {taille}", { taille: mo(d.octets) }),
          ].join(" · ")}
        </p>
      )}
      <a
        href="/api/backup"
        download
        aria-disabled={busy}
        onClick={(e) => {
          if (busy || !d) return e.preventDefault();
          setSince(lastAt);
        }}
        className={cn("press mt-3 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white", (busy || !d) && "pointer-events-none opacity-60")}
      >
        <Download size={16} />
        {busy ? t("Sauvegarde en cours…") : t("Télécharger la sauvegarde")}
      </a>
      {waiting && <p className="mt-2 text-sm">{t("Le téléchargement a démarré dans ton navigateur. Il peut prendre quelques minutes : garde Pécule ouvert jusqu'à la fin.")}</p>}
      <p className="mt-3 text-xs text-muted">
        {d?.last
          ? `${t("Dernière sauvegarde : le {date} à {heure}", {
              date: new Date(d.last.at).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" }),
              heure: new Date(d.last.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }),
            })}${d.last.octets ? ` (${mo(d.last.octets)})` : ""}.`
          : d
            ? t("Aucune sauvegarde téléchargée pour l'instant.")
            : null}{" "}
        {t("L'archive contient les données privées de tous les membres, en clair : range-la dans un endroit sûr. Tu es le seul à voir ce réglage.")}
      </p>
    </Card>
  );
}
