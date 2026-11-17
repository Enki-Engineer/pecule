import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, HardDriveDownload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { Card, Segmented } from "./ui.tsx";
import { cn } from "../cn.ts";
import { locale, t, tn } from "../../lib/i18n.ts";
import type { BackupFrequency, BackupSettings as AutoSettings } from "../../lib/backup-plan.ts";

type Archive = { name: string; octets: number; at: number; kind: "auto" | "migration" | "autre" };

type Info = {
  tables: number;
  octets: number;
  operations: number;
  factures: number;
  documents: number;
  running: boolean;
  /** `at` : instant de la dernière sauvegarde (millisecondes). */
  last: { at: number; by: string | null; octets: number | null } | null;
  /** Sauvegardes automatiques : réglage, dernier résultat, écriture en cours, dossier et archives du serveur. */
  auto: AutoSettings;
  state: { ok: { at: string; name: string; octets: number } | null; echec: { at: string; raison: string } | null };
  autoRunning: boolean;
  dir: string;
  archives: Archive[];
};

const n = (v: number) => v.toLocaleString(locale());
const mo = (octets: number) => t("{n} Mo", { n: n(Math.max(1, Math.round(octets / 1_048_576))) });
const day = (at: number | string) => new Date(at).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" });
const hour = (at: number | string) => new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
const KEEP_CHOICES = [3, 7, 14, 30, 60];

function kindLabel(kind: Archive["kind"]): string {
  if (kind === "auto") return t("Automatique");
  if (kind === "migration") return t("Avant une mise à jour");
  return t("Déposée sur le serveur");
}

/**
 * Réglages → Compte et sécurité (administrateur seulement) : les sauvegardes que le serveur écrit lui-même, chaque
 * nuit ou chaque semaine, et les archives qu'il garde dans son dossier — à télécharger ou à retirer. Éteint tant
 * qu'on ne l'a pas demandé.
 */
export function AutoBackupSettings() {
  const qc = useQueryClient();
  // L'écriture se suit en relisant l'état : elle peut durer plusieurs minutes.
  const [asked, setAsked] = useState(false);
  const info = useQuery({ queryKey: ["backup-info"], queryFn: () => api<Info>("/backup/info"), refetchInterval: (q) => (asked || q.state.data?.autoRunning ? 3000 : false) });
  const d = info.data;
  const running = d?.autoRunning === true;

  useEffect(() => {
    if (!asked || !d || running) return;
    setAsked(false);
    if (d.state.echec) toast.error(t("La sauvegarde n'a pas abouti : {raison}", { raison: d.state.echec.raison }));
    else toast.success(t("Sauvegarde terminée"));
  }, [asked, d, running]);

  const save = useMutation({
    mutationFn: (patch: Partial<AutoSettings>) => api<AutoSettings>("/backup/settings", { method: "PUT", json: patch }),
    onSuccess: (auto) => qc.setQueryData<Info>(["backup-info"], (old) => (old ? { ...old, auto } : old)),
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Réglage non enregistré")),
  });
  const run = useMutation({
    mutationFn: () => api("/backup/run", { method: "POST" }),
    onSuccess: () => {
      setAsked(true);
      void qc.invalidateQueries({ queryKey: ["backup-info"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Sauvegarde impossible")),
  });
  const remove = useMutation({
    mutationFn: (name: string) => api(`/backup/archives/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backup-info"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Suppression impossible")),
  });

  if (!d) return null;
  const busy = running || asked || run.isPending;
  const total = d.archives.reduce((sum, a) => sum + a.octets, 0);
  return (
    <Card className="p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={d.auto.auto} disabled={save.isPending} onChange={(e) => save.mutate({ auto: e.target.checked })} className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]" />
        <span className="min-w-0">
          <span className="block text-[15px] font-medium text-ink">{t("Écrire une sauvegarde sur le serveur, sans que j'aie à y penser")}</span>
          <span className="mt-0.5 block text-sm text-muted">{t("Pécule écrit une sauvegarde complète dans un dossier du serveur, la relit en entier, et ne garde que les plus récentes.")}</span>
        </span>
      </label>

      {d.auto.auto && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4">
          <Segmented<BackupFrequency>
            value={d.auto.frequence}
            onChange={(frequence) => save.mutate({ frequence })}
            options={[
              { value: "jour", label: t("Chaque nuit") },
              { value: "semaine", label: t("Chaque semaine") },
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            {t("Sauvegardes gardées")}
            <select value={d.auto.garder} onChange={(e) => save.mutate({ garder: Number(e.target.value) })} className="card px-3 py-1.5 text-sm">
              {[...new Set([...KEEP_CHOICES, d.auto.garder])]
                .sort((a, b) => a - b)
                .map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}

      {d.auto.auto && d.state.echec && <p className="mt-3 text-sm text-warn">{t("Dernier essai en échec, le {date} à {heure} : {raison}", { date: day(d.state.echec.at), heure: hour(d.state.echec.at), raison: d.state.echec.raison })}</p>}
      {d.auto.auto && !d.state.echec && (
        <p className="mt-3 text-sm text-muted">
          {d.state.ok
            ? t("Dernière sauvegarde automatique : le {date} à {heure} ({taille}).", { date: day(d.state.ok.at), heure: hour(d.state.ok.at), taille: mo(d.state.ok.octets) })
            : t("Aucune pour l'instant : la première part dans les minutes qui viennent, les suivantes dans la nuit.")}
        </p>
      )}

      <button
        type="button"
        onClick={() => run.mutate()}
        disabled={busy}
        className={cn("press mt-3 inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink", busy && "opacity-60")}
      >
        <HardDriveDownload size={16} />
        {busy ? t("Sauvegarde en cours…") : t("Écrire une sauvegarde maintenant")}
      </button>

      {d.archives.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="tnum mb-1 text-sm text-muted">{`${tn("{n} archive sur le serveur", "{n} archives sur le serveur", d.archives.length, { n: n(d.archives.length) })} · ${mo(total)}`}</p>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {d.archives.map((a) => (
              <li key={a.name} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="tnum text-sm text-ink">{t("le {date} à {heure} ({taille})", { date: day(a.at), heure: hour(a.at), taille: mo(a.octets) })}</div>
                  <div className="truncate text-xs text-muted" title={a.name}>{`${kindLabel(a.kind)} · ${a.name}`}</div>
                </div>
                <a href={`/api/backup/archives/${encodeURIComponent(a.name)}`} download title={t("Télécharger")} aria-label={t("Télécharger")} className="press grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:text-ink">
                  <Download size={16} />
                </a>
                <button
                  type="button"
                  title={t("Supprimer")}
                  aria-label={t("Supprimer")}
                  disabled={remove.isPending}
                  onClick={() => confirm(t("Retirer cette archive du serveur ? Elle ne pourra pas être retrouvée.")) && remove.mutate(a.name)}
                  className="press grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:text-ink"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-muted">
        {t("Dossier du serveur : {dossier}. Ces archives sont sur le même serveur que la base : elles protègent d'une erreur ou d'une mise à jour qui tourne mal, pas de la perte du serveur. Télécharges-en une de temps en temps.", { dossier: d.dir })}
      </p>
    </Card>
  );
}

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
