import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudUpload, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { Card, Segmented } from "./ui.tsx";
import { cn } from "../cn.ts";
import { locale, t, tn } from "../../lib/i18n.ts";
import { RETENTION_CHOICES, type BackupSettings as AutoSettings, type DestinationInput, type PublicDestination, type Retention } from "../../lib/backup-plan.ts";

type Failure = { at: string; raison: string };
type Info = {
  auto: AutoSettings;
  state: { dehors: { ok: { at: string; name: string; octets: number } | null; echec: Failure | null; attente: string | null } };
  key: { recipient: string; creeLe: string } | null;
  destination: PublicDestination | null;
};
type Copies = { copies: { name: string; octets: number; at: number | null }[] };
type Kind = DestinationInput["type"];

const n = (v: number) => v.toLocaleString(locale());
const mo = (octets: number) => t("{n} Mo", { n: n(Math.max(1, Math.round(octets / 1_048_576))) });
const day = (at: number | string) => new Date(at).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" });
const hour = (at: number | string) => new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
const errorText = (e: unknown) => (e instanceof Error ? e.message : t("Erreur inattendue"));
const sameRetention = (a: Retention, b: Retention) => a.jours === b.jours && a.semaines === b.semaines && a.mois === b.mois;

function retentionLabel(r: Retention): string {
  if (!r.semaines && !r.mois) return tn("La dernière copie", "Les {n} dernières copies", r.jours, { n: r.jours });
  if (!r.mois) return t("Les {jours} dernières, puis une par semaine pendant {semaines} semaines", { jours: r.jours, semaines: r.semaines });
  return t("Les {jours} dernières, puis une par semaine pendant {semaines} semaines et une par mois pendant {mois} mois", { jours: r.jours, semaines: r.semaines, mois: r.mois });
}

const EMPTY: Record<Kind, DestinationInput> = {
  s3: { type: "s3", endpoint: "", region: "", bucket: "", prefix: "pecule", accessKey: "", secret: "" },
  webdav: { type: "webdav", url: "", user: "", secret: "" },
};

/** Un champ du formulaire du stockage. */
function Line({ label, value, onChange, placeholder, secret, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; secret?: boolean; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={secret ? "password" : "text"}
        autoComplete={secret ? "new-password" : "off"}
        spellCheck={false}
        autoCapitalize="none"
        className="card w-full px-3 py-2 text-[15px] placeholder:text-muted/60"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** La clé de récupération, montrée une seule fois, avec de quoi la copier. */
function Recovery({ identity, onStored }: { identity: string; onStored: () => void }) {
  const [stored, setStored] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(identity).then(
      () => toast.success(t("Clé copiée")),
      () => toast.error(t("Copie impossible : sélectionne la clé à la main.")),
    );
  return (
    <div className="mt-3 rounded-xl border border-accent/40 bg-accent-soft p-3">
      <p className="text-sm font-medium text-ink">{t("Ta clé de récupération — elle ne sera plus jamais montrée :")}</p>
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-card px-3 py-2">
        <code className="min-w-0 flex-1 select-all break-all text-[13px]">{identity}</code>
        <button type="button" onClick={copy} title={t("Copier la clé")} aria-label={t("Copier la clé")} className="press shrink-0 rounded-lg p-1.5 text-muted hover:text-ink">
          <Copy size={15} />
        </button>
      </div>
      <p className="mt-2 text-sm">{t("Range-la dans ton gestionnaire de mots de passe, ou imprime-la. Sans elle, aucune copie chiffrée ne pourra être relue : ni par toi, ni par Pécule, qui ne la garde pas.")}</p>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} className="size-5 shrink-0 accent-[var(--color-accent)]" />
        {t("Je l'ai rangée en lieu sûr")}
      </label>
      <button type="button" onClick={onStored} disabled={!stored} className="press mt-3 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {t("Continuer")}
      </button>
    </div>
  );
}

/**
 * Réglages → Compte et sécurité (administrateur seulement) : la copie des sauvegardes hors du serveur. D'abord la clé
 * de chiffrement — Pécule n'en garde que la moitié qui chiffre —, puis le stockage (compatible S3 ou WebDAV), essayé
 * avant d'être enregistré, et ce qu'on y garde.
 */
export function OffsiteBackupSettings() {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["backup-info"], queryFn: () => api<Info>("/backup/info") });
  const d = info.data;
  const [identity, setIdentity] = useState<string | null>(null);
  const [own, setOwn] = useState<string | null>(null);
  const [form, setForm] = useState<DestinationInput | null>(null);
  const [listing, setListing] = useState(false);
  const copies = useQuery({ queryKey: ["backup-remote"], queryFn: () => api<Copies>("/backup/remote"), enabled: listing && !!d?.destination, retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["backup-info"] });

  const key = useMutation({
    mutationFn: (recipient?: string) => api<{ recipient: string; identity: string | null }>("/backup/key", { method: "POST", json: recipient ? { recipient } : {} }),
    onSuccess: (r) => {
      setIdentity(r.identity);
      setOwn(null);
      void refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const saveDestination = useMutation({
    mutationFn: (input: DestinationInput) => api<PublicDestination>("/backup/destination", { method: "PUT", json: input }),
    onSuccess: () => {
      setForm(null);
      toast.success(t("Stockage essayé et enregistré"));
      void refresh();
      void qc.invalidateQueries({ queryKey: ["backup-remote"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const removeDestination = useMutation({
    mutationFn: () => api("/backup/destination", { method: "DELETE" }),
    onSuccess: () => {
      setForm(null);
      setListing(false);
      void refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const retention = useMutation({
    mutationFn: (dehors: Retention) => api<AutoSettings>("/backup/settings", { method: "PUT", json: { dehors } }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorText(e)),
  });

  if (!d) return null;
  const dest = d.destination;
  // Formulaire ouvert : celui qu'on modifie, sinon — tant qu'aucun stockage n'est réglé — un formulaire vide.
  const editing: DestinationInput | null = form ?? (dest ? null : EMPTY.s3);
  const set = (patch: Partial<DestinationInput>) => editing && setForm({ ...editing, ...patch } as DestinationInput);
  const edit = () => dest && setForm(dest.type === "s3" ? { type: "s3", endpoint: dest.endpoint, region: dest.region, bucket: dest.bucket, prefix: dest.prefix, accessKey: dest.accessKey, secret: "" } : { type: "webdav", url: dest.url, user: dest.user, secret: "" });
  const complete = editing && (editing.type === "s3" ? editing.endpoint.trim() && editing.bucket.trim() && editing.accessKey.trim() : editing.url.trim() && editing.user.trim()) && (editing.secret.trim() || dest?.type === editing.type);
  const choices = RETENTION_CHOICES.some((c) => sameRetention(c, d.auto.dehors)) ? RETENTION_CHOICES : [...RETENTION_CHOICES, d.auto.dehors];
  const out = d.state.dehors;

  return (
    <Card className="p-4">
      <p className="text-sm">{t("Une copie chiffrée de chaque sauvegarde automatique est déposée sur un stockage à toi, hors du serveur : c'est elle qui protège de la perte du serveur.")}</p>

      <div className="mt-4 border-t border-line pt-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <KeyRound size={16} /> {t("Clé de chiffrement")}
        </h3>
        {identity ? (
          <Recovery identity={identity} onStored={() => setIdentity(null)} />
        ) : d.key ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="min-w-0 text-sm text-muted">
              {t("Créée le {date}. Pécule ne garde que la clé publique : {cle}", { date: day(d.key.creeLe), cle: `${d.key.recipient.slice(0, 10)}…${d.key.recipient.slice(-6)}` })}
            </p>
            <button
              type="button"
              disabled={key.isPending}
              onClick={() => confirm(t("Changer de clé ? Les copies déjà déposées ne s'ouvrent qu'avec l'ancienne clé de récupération : garde-la.")) && key.mutate(undefined)}
              className="press text-sm font-medium text-accent disabled:opacity-60"
            >
              {t("Changer de clé")}
            </button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">{t("Rien ne quitte le serveur sans être chiffré. Pécule crée une clé, n'en garde que la moitié qui chiffre, et te montre une seule fois la clé de récupération.")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" onClick={() => key.mutate(undefined)} disabled={key.isPending} className="press rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {t("Créer la clé de chiffrement")}
              </button>
              {own === null && (
                <button type="button" onClick={() => setOwn("")} className="press text-sm text-muted underline">
                  {t("J'ai déjà une clé publique « age »")}
                </button>
              )}
            </div>
            {own !== null && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Line label={t("Clé publique (elle commence par age1)")} value={own} onChange={setOwn} placeholder="age1…" />
                </div>
                <button type="button" onClick={() => key.mutate(own.trim())} disabled={key.isPending || !own.trim()} className="press rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink disabled:opacity-60">
                  {t("Enregistrer")}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {d.key && !identity && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <CloudUpload size={16} /> {t("Stockage extérieur")}
          </h3>
          {dest && !editing && (
            <>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 break-all text-sm text-muted">{dest.type === "s3" ? t("Compatible S3 : {ou}", { ou: `${dest.endpoint} · ${dest.bucket}${dest.prefix ? `/${dest.prefix}` : ""}` }) : t("WebDAV : {ou}", { ou: dest.url })}</p>
                <span className="flex gap-4">
                  <button type="button" onClick={edit} className="press text-sm font-medium text-accent">
                    {t("Modifier")}
                  </button>
                  <button
                    type="button"
                    disabled={removeDestination.isPending}
                    onClick={() => confirm(t("Retirer ce stockage ? Les copies déjà déposées y restent, mais plus aucune n'y sera envoyée.")) && removeDestination.mutate()}
                    className="press text-sm text-muted underline disabled:opacity-60"
                  >
                    {t("Retirer")}
                  </button>
                </span>
              </div>
              {dest.unreadable && <p className="mt-2 text-sm text-warn">{t("Le secret de ce stockage ne se lit plus (le secret du serveur a changé) : modifie le stockage pour le ressaisir.")}</p>}
            </>
          )}

          {editing && (
            <div className="mt-3 grid gap-3">
              <Segmented<Kind>
                value={editing.type}
                onChange={(type) => setForm(dest?.type === type && form ? form : EMPTY[type])}
                options={[
                  { value: "s3", label: t("Compatible S3") },
                  { value: "webdav", label: "WebDAV" },
                ]}
              />
              {editing.type === "s3" ? (
                <>
                  <p className="text-xs text-muted">{t("Amazon S3, Backblaze B2, Scaleway, OVH, Cloudflare R2, Wasabi, MinIO… Le compartiment doit déjà exister ; la clé d'accès a besoin d'y écrire, d'y lire la liste et d'y supprimer.")}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Line label={t("Adresse du service")} value={editing.endpoint} onChange={(endpoint) => set({ endpoint })} placeholder="https://s3.fr-par.scw.cloud" />
                    <Line label={t("Région")} value={editing.region} onChange={(region) => set({ region })} placeholder="fr-par" />
                    <Line label={t("Compartiment (bucket)")} value={editing.bucket} onChange={(bucket) => set({ bucket })} />
                    <Line label={t("Dossier dans le compartiment")} value={editing.prefix} onChange={(prefix) => set({ prefix })} placeholder="pecule" />
                    <Line label={t("Identifiant de la clé d'accès")} value={editing.accessKey} onChange={(accessKey) => set({ accessKey })} />
                    <Line label={t("Clé secrète")} value={editing.secret} onChange={(secret) => set({ secret })} secret placeholder={dest?.type === "s3" ? t("Inchangée") : undefined} />
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted">{t("Nextcloud, kDrive, un NAS… Donne l'adresse WebDAV du dossier qui recevra les copies (Pécule le crée s'il manque), et de préférence un mot de passe d'application.")}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Line label={t("Adresse du dossier")} value={editing.url} onChange={(url) => set({ url })} placeholder="https://cloud.exemple.fr/remote.php/dav/files/alex/Pecule" />
                    </div>
                    <Line label={t("Identifiant")} value={editing.user} onChange={(user) => set({ user })} />
                    <Line label={t("Mot de passe")} value={editing.secret} onChange={(secret) => set({ secret })} secret placeholder={dest?.type === "webdav" ? t("Inchangé") : undefined} />
                  </div>
                </>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button type="button" onClick={() => editing && saveDestination.mutate(editing)} disabled={!complete || saveDestination.isPending} className={cn("press rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white", (!complete || saveDestination.isPending) && "opacity-60")}>
                  {saveDestination.isPending ? t("Essai du stockage…") : t("Essayer et enregistrer")}
                </button>
                {dest && (
                  <button type="button" onClick={() => setForm(null)} className="press text-sm text-muted underline">
                    {t("Annuler")}
                  </button>
                )}
              </div>
              <p className="text-xs text-muted">{t("Pécule y dépose un petit fichier d'essai, le retrouve et le retire : le stockage n'est enregistré que si tout passe.")}</p>
            </div>
          )}

          {dest && !editing && (
            <>
              <label className="mt-4 block text-sm">
                <span className="mb-1 block text-muted">{t("Copies gardées sur ce stockage")}</span>
                <select
                  value={choices.findIndex((c) => sameRetention(c, d.auto.dehors))}
                  onChange={(e) => retention.mutate(choices[Number(e.target.value)])}
                  disabled={retention.isPending}
                  className="card w-full max-w-full px-3 py-2 text-sm"
                >
                  {choices.map((c, i) => (
                    <option key={`${c.jours}-${c.semaines}-${c.mois}`} value={i}>
                      {retentionLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              {out.echec ? (
                <p className="mt-3 text-sm text-warn">
                  {t("Dernier envoi en échec, le {date} à {heure} : {raison}", { date: day(out.echec.at), heure: hour(out.echec.at), raison: out.echec.raison })}
                  {out.attente && ` ${t("L'archive attend sur le serveur : Pécule réessaie tout seul.")}`}
                </p>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  {out.ok
                    ? t("Dernière copie déposée : le {date} à {heure} ({taille}).", { date: day(out.ok.at), heure: hour(out.ok.at), taille: mo(out.ok.octets) })
                    : d.auto.auto
                      ? t("Aucune copie pour l'instant : la prochaine sauvegarde automatique y sera déposée.")
                      : t("Les copies partent avec les sauvegardes du serveur : active les sauvegardes automatiques, ou écris-en une maintenant.")}
                </p>
              )}
              <button type="button" onClick={() => (listing ? void copies.refetch() : setListing(true))} className="press mt-2 text-sm font-medium text-accent">
                {t("Voir les copies déposées")}
              </button>
              {listing && copies.isError && <p className="mt-2 text-sm text-warn">{errorText(copies.error)}</p>}
              {listing && copies.data && (
                <ul className="mt-2 max-h-60 divide-y divide-line overflow-y-auto">
                  {copies.data.copies.length === 0 && <li className="py-2 text-sm text-muted">{t("Aucune copie sur ce stockage.")}</li>}
                  {copies.data.copies.map((c) => (
                    <li key={c.name} className="py-2">
                      <div className="tnum text-sm text-ink">{c.at ? t("le {date} à {heure} ({taille})", { date: day(c.at), heure: hour(c.at), taille: mo(c.octets) }) : mo(c.octets)}</div>
                      <div className="truncate text-xs text-muted" title={c.name}>
                        {c.name}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
        {t("Une copie chiffrée se restaure dans une installation neuve de Pécule, avec ta clé de récupération. Elle se déchiffre aussi sans Pécule, avec l'outil libre « age ».")}
      </p>
    </Card>
  );
}
