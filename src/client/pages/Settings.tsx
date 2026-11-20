import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { Activity, Bell, ChevronRight, Coins, Copy, House, KeyRound, Plug, LogOut, Palette, Presentation, ScanFace, Search, Smartphone, Sparkles, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";
import { api, useMe } from "../api.ts";
import { enterDemo, leaveDemo } from "../demo.ts";
import { Card, PageHeader, Segmented } from "../components/ui.tsx";
import { useAppearance, useDensity, useTheme, type Density } from "../theme.ts";
import { clearOfflineCache, offlineCacheEnabled, setOfflineCache } from "../offline.tsx";
import { NotificationsSettings } from "../components/NotificationsSettings.tsx";
import { BalanceAlertSettings } from "../components/BalanceAlertSettings.tsx";
import { BankLabelsImport } from "../components/BankLabelsImport.tsx";
import { BrandSettings } from "../components/BrandSettings.tsx";
import { AddMember } from "../components/AddMember.tsx";
import { LogoSettings } from "../components/LogoSettings.tsx";
import { FunSettings } from "../components/FunSettings.tsx";
import { SharingSettings } from "../components/SharingSettings.tsx";
import { BirthdaySettings } from "../components/BirthdaySettings.tsx";
import { VoiceSettings } from "../components/VoiceSettings.tsx";
import { LanguageSettings } from "../components/LanguageSettings.tsx";
import { AutoBackupSettings, BackupSettings } from "../components/BackupSettings.tsx";
import { OffsiteBackupSettings } from "../components/BackupOffsite.tsx";
import { UpdateSettings } from "../components/UpdateSettings.tsx";
import { ServerCommand } from "../components/ServerCommand.tsx";
import { HouseholdSettings } from "../components/HouseholdSettings.tsx";
import { ConnectionsSettings } from "../components/ConnectionsSettings.tsx";
import { AiCostScreen, AiCostSummary } from "../components/AiCost.tsx";
import { Section } from "../components/SettingsSection.tsx";
import { region } from "../region.ts";
import { ACCENTS, SEASONS, SOUTHERN, seasonAt, upcomingSeasons, type Season, type SeasonMode } from "../../lib/seasons.ts";
import { dateFr, timeAgo } from "../format.ts";
import { useMedia } from "../useMedia.ts";
import { useCrumb } from "../shell.ts";
import { locale, t, td, tn } from "../../lib/i18n.ts";
import { MCP_CLIENTS } from "../../lib/mcp-clients.ts";

type Users = { users: { id: number; name: string; passkeys: { id_hash: string; device_name: string | null; created_at: string; last_used_at: string | null }[] }[] };
type Run = { id: number; started_at: string; finished_at: string | null; status: string; source: string; tx_seen: number; tx_new: number; tx_auto: number; error: string | null };

export function Settings() {
  const { groupe } = useParams();
  const desktop = useMedia("(min-width: 768px)");
  const current = GROUPS.find((g) => g.id === (GROUP_ALIASES[groupe ?? ""] ?? groupe)) ?? null;
  useCrumb(current?.label);
  const counts = useQuery({ queryKey: ["nav-counts"], queryFn: () => api<{ alerts: number; update?: boolean }>("/nav-counts"), staleTime: 60_000 });
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<Users>("/auth/users") });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<{ runs: Run[] }>("/sync/runs") });
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api<{ rules: { id: number; pattern: string; category_name: string }[] }>("/rules") });
  const [links, setLinks] = useState<Record<number, string>>({});
  const [ruleFilter, setRuleFilter] = useState("");
  const [theme, setTheme] = useTheme();
  // Lien vers une section précise (« /reglages/notifications#solde », depuis le manuel ou l'assistant) : on y défile.
  const { hash } = useLocation();
  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [hash, groupe, desktop]);

  const invite = useMutation({
    mutationFn: (id: number) => api<{ link: string }>(`/auth/users/${id}/enrollment`, { method: "POST" }),
    onSuccess: (r, id) => setLinks((l) => ({ ...l, [id]: r.link })),
  });

  async function addDevice() {
    try {
      const { options } = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/auth/register/options", { method: "POST", json: {} });
      const response = await startRegistration({ optionsJSON: options });
      const deviceName = /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Mac/.test(navigator.userAgent) ? "Mac" : t("Appareil");
      await api("/auth/register/verify", { method: "POST", json: { response, deviceName } });
      toast.success(t("Clé d'accès ajoutée"));
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Ajout impossible"));
    }
  }

  async function removeKey(idHash: string) {
    if (!confirm(t("Supprimer cette clé d'accès ?"))) return;
    try {
      await api(`/auth/passkeys/${idHash}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Suppression impossible"));
    }
  }

  async function logout() {
    // Se déconnecter arrête aussi les notifications de cet appareil : elles afficheraient les soldes d'un membre parti.
    try {
      const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
      if (sub) {
        await api("/push/unsubscribe", { method: "POST", json: { endpoint: sub.endpoint } }).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
      }
    } catch {
      // pas de service de notification sur cet appareil
    }
    await api("/auth/logout", { method: "POST" });
    qc.clear();
    clearOfflineCache();
    navigate("/connexion", { replace: true });
  }

  const demo = me.data?.user?.demo === true;
  const content: Record<GroupId, ReactNode> = {
    demo: <DemoSection />,
    foyer: <HouseholdSettings />,
    connexions: <ConnectionsSettings slots={{ apps: <ConnectedAppsSection />, shortcut: <ShortcutSection />, calendar: <CalendarSection /> }} />,
    compte: (
      <>
        <Section id="membres" title={t("Membres et clés d'accès")}>
          <Card className="divide-y divide-line">
            {users.data?.users.map((u) => (
              <div key={u.id} className="px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{u.name}</span>
                  {demo ? null : u.id === me.data?.user?.id ? (
                    <button type="button" onClick={addDevice} className="press flex items-center gap-1 text-sm font-medium text-accent">
                      <KeyRound size={15} /> {t("Ajouter cet appareil")}
                    </button>
                  ) : me.data?.user?.admin ? (
                    <button type="button" onClick={() => invite.mutate(u.id)} className="press text-sm font-medium text-accent">
                      {t("Lien d'inscription")}
                    </button>
                  ) : null}
                </div>
                {!demo && u.passkeys.length === 0 && <div className="mt-1 text-sm text-warn">{t("Aucune clé d'accès : envoie-lui un lien d'inscription.")}</div>}
                {u.passkeys.map((k) => (
                  <div key={k.id_hash} className="mt-1.5 flex items-center justify-between text-sm text-muted">
                    <span>
                      {k.device_name ?? t("Appareil")} · {t("créée le {date}", { date: dateFr(k.created_at) })}
                      {k.last_used_at && ` · ${t("utilisée {quand}", { quand: timeAgo(k.last_used_at) })}`}
                    </span>
                    {!demo && (u.id === me.data?.user?.id || me.data?.user?.admin) && (
                      <button type="button" onClick={() => removeKey(k.id_hash)} aria-label={t("Supprimer la clé")} className="ml-3 shrink-0 p-1">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
                {links[u.id] && (
                  <div className="mt-2 rounded-xl bg-bg p-3 text-xs">
                    <div className="break-all">{links[u.id]}</div>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(links[u.id]).then(() => toast.success(t("Lien copié")))}
                      className="mt-2 flex items-center gap-1 font-medium text-accent"
                    >
                      <Copy size={13} /> {t("Copier (valable 7 jours, à ouvrir sur son iPhone)")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </Card>
          {!demo && me.data?.user?.admin && <AddMember />}
        </Section>
        {/* Partage de ses revenus avec le foyer : chaque membre règle le sien (absent d'un foyer d'un seul membre). */}
        <SharingSettings />
        {!demo && me.data?.user?.admin && (
          <Section id="sauvegarde" title={t("Sauvegarde complète")}>
            <BackupSettings />
          </Section>
        )}
        {!demo && me.data?.user?.admin && (
          <Section id="sauvegardes-automatiques" title={t("Sauvegardes automatiques")}>
            <AutoBackupSettings />
          </Section>
        )}
        {!demo && me.data?.user?.admin && (
          <Section id="sauvegardes-dehors" title={t("Copie hors du serveur")}>
            <OffsiteBackupSettings />
          </Section>
        )}
        {!demo && (
          <button
            type="button"
            onClick={() =>
              confirm(t("Fermer toutes tes autres sessions ? Tes autres appareils devront se reconnecter avec leur clé d'accès.")) &&
              api<{ closed: number }>("/auth/logout-others", { method: "POST" })
                .then((r) => toast.success(tn("{n} session fermée", "{n} sessions fermées", r.closed, { n: r.closed })))
                .catch((e) => toast.error(e instanceof Error ? e.message : t("Action impossible")))
            }
            className="press card flex w-full items-center justify-center gap-2 py-3 text-sm font-medium"
          >
            <Smartphone size={16} /> {t("Déconnecter mes autres appareils")}
          </button>
        )}
        <button type="button" onClick={logout} className="press card flex w-full items-center justify-center gap-2 py-3.5 font-medium text-neg">
          <LogOut size={18} /> {t("Se déconnecter")}
        </button>
      </>
    ),
    classement: <>
        {!demo && (
          <Section id="libelles" title={t("Libellés de la banque")}>
            <BankLabelsImport />
          </Section>
        )}
        <Section id="enseignes" title={t("Mes enseignes")}>
          <BrandSettings />
        </Section>
        <Section id="regles" title={t("Règles de classement ({n})", { n: rules.data?.rules.length ?? 0 })}>
          <label className="card mb-2 flex items-center gap-2 px-4 py-2.5">
            <Search size={16} className="text-muted" />
            <input
              value={ruleFilter}
              onChange={(e) => setRuleFilter(e.target.value)}
              placeholder={t("Chercher un libellé ou une catégorie…")}
              className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted"
            />
          </label>
          <Card className="max-h-[28rem] divide-y divide-line overflow-y-auto">
            {rules.data?.rules
              .filter((r) => !ruleFilter.trim() || `${r.pattern} ${r.category_name} ${td(r.category_name)}`.toLowerCase().includes(ruleFilter.trim().toLowerCase()))
              .map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="truncate">{t("« {texte} »", { texte: r.pattern })}</span>
                <span className="flex shrink-0 items-center gap-2 text-muted">
                  {td(r.category_name)}
                  <button
                    type="button"
                    aria-label={t("Supprimer la règle")}
                    onClick={() => api(`/rules/${r.id}`, { method: "DELETE" }).then(() => qc.invalidateQueries({ queryKey: ["rules"] }))}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            ))}
          </Card>
        </Section>
    </>,
    apparence: <>
        <LanguageSettings />
        <Section id="apparence" title={t("Apparence")}>
          <Segmented
            value={theme}
            onChange={setTheme}
            options={[
              { value: "auto", label: t("Auto") },
              { value: "clair", label: t("Clair") },
              { value: "sombre", label: t("Sombre") },
            ]}
          />
          <p className="mt-2 px-1 text-xs text-muted">{t("« Auto » suit le réglage de l'appareil. Choix mémorisé sur cet appareil.")}</p>
          <DensitySetting />
          <AppearanceExtras />
        </Section>
    </>,
    notifications: demo ? (
      <>
        <Section id="solde" title={t("Solde bas")}>
          <BalanceAlertSettings />
        </Section>
        <DemoUnavailable what={t("Notifications")} />
        <Section id="hors-ligne" title={t("Ouverture instantanée")}>
          <OfflineSetting />
        </Section>
      </>
    ) : (
      <>
        <Section id="solde" title={t("Solde bas")}>
          <BalanceAlertSettings />
        </Section>
        <Section id="notifications" title={t("Notifications de cet appareil")}>
          <NotificationsSettings />
        </Section>
        <Section id="hors-ligne" title={t("Ouverture instantanée")}>
          <OfflineSetting />
        </Section>
      </>
    ),
    assistant: (
      <>
        <VoiceSettings />
        <MemorySection />
        <AiCostSummary />
        <p className="px-1 text-xs text-muted">
          {t("Le fournisseur d'IA (adresse, modèle, clé) se règle dans")}{" "}
          <Link to="/reglages/connexions?c=ia" className="font-medium text-accent">
            {t("Réglages → Comptes et connexions")}
          </Link>
          .
        </p>
      </>
    ),
    "cout-ia": <AiCostScreen />,
    suivi: <>
        {/* Version en service et mise à jour disponible : c'est l'administrateur qui met Pécule à jour. */}
        {!demo && me.data?.user?.admin && <UpdateSettings />}
        <AlertsSection />
        <Section id="synchro" title={t("Synchronisations bancaires")}>
          <Card className="divide-y divide-line">
            {runs.data?.runs.slice(0, 8).map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  {dateFr(r.started_at)} {r.started_at.slice(11, 16)} · {r.source}
                </span>
                <span className={clsx("tnum", r.status === "error" ? "text-neg" : "text-muted")} title={r.error ?? undefined}>
                  {r.status === "ok" ? t("{nouv} nouv. · {auto} auto", { nouv: r.tx_new, auto: r.tx_auto }) : r.status === "error" ? t("erreur") : t("en cours")}
                </span>
              </div>
            ))}
            {!runs.data?.runs.length && <div className="px-4 py-3 text-sm text-muted">{t("Aucune synchronisation pour l'instant.")}</div>}
          </Card>
        </Section>
        <AuditSection />
    </>,
  };

  // iPhone : liste des groupes, puis un écran par groupe (avec retour). Ordinateur : menu à gauche, groupe à droite.
  if (!desktop && !current)
    return (
      <>
        <PageHeader title={t("Réglages")} subtitle={me.data?.user ? t("Connecté : {nom}", { nom: me.data.user.name }) : undefined} />
        <div className="space-y-4">
          {demo && <DemoBanner />}
          {GROUP_SECTIONS.map((sec) => (
            <Card key={sec.title} className="divide-y divide-line overflow-hidden">
              {GROUPS.filter((g) => sec.ids.includes(g.id)).map((g) => (
                <Link key={g.id} to={`/reglages/${g.id}`} className="press flex items-center gap-3 px-4 py-3">
                  <span className={clsx("grid size-8 shrink-0 place-items-center rounded-lg text-white", g.tone)}>
                    <g.icon size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px]">{g.label}</span>
                    <span className="block truncate text-[12px] text-muted">{g.hint}</span>
                  </span>
                  {g.id === "suivi" && counts.data?.update && <span className="rounded-full bg-accent/10 px-2 text-[12px] font-semibold text-accent">{t("Mise à jour")}</span>}
                  {g.id === "suivi" && !!counts.data?.alerts && <span className="rounded-full bg-neg/10 px-2 text-[12px] font-semibold text-neg">{counts.data.alerts}</span>}
                  <ChevronRight size={17} className="text-muted" />
                </Link>
              ))}
            </Card>
          ))}
          <button type="button" onClick={logout} className="press card flex w-full items-center justify-center gap-2 py-3.5 font-medium text-neg">
            <LogOut size={18} /> {t("Se déconnecter")}
          </button>
        </div>
      </>
    );
  const g = current ?? GROUPS[0];
  if (!desktop)
    return (
      <>
        <PageHeader title={g.label} subtitle={g.hint} />
        <div className="space-y-6">{content[g.id]}</div>
      </>
    );
  return (
    <>
      <PageHeader title={t("Réglages")} subtitle={me.data?.user ? t("Connecté : {nom}", { nom: me.data.user.name }) : undefined} />
      <div className="grid grid-cols-[236px_minmax(0,1fr)] gap-8">
        <nav className="sticky top-20 self-start" aria-label={t("Groupes de réglages")}>
          {GROUP_SECTIONS.map((sec) => (
            <div key={sec.title} className="mb-3">
              <div className="px-3 pb-1 text-[12.5px] font-medium text-muted">{sec.title}</div>
              {GROUPS.filter((x) => sec.ids.includes(x.id)).map((x) => (
                <Link
                  key={x.id}
                  to={`/reglages/${x.id}`}
                  className={clsx("flex h-9 items-center gap-2.5 rounded-xl px-3 text-[14px] font-medium", x.id === g.id ? "bg-card font-semibold text-ink shadow-[0_1px_1px_rgb(20_20_19/0.04),0_6px_16px_-10px_rgb(20_20_19/0.18)]" : "text-muted hover:bg-card/70 hover:text-ink")}
                >
                  <x.icon size={15} className="shrink-0" />
                  <span className="flex-1 truncate">{x.label}</span>
                  {/* Menu étroit : un point suffit, la section dit le reste. */}
                  {x.id === "suivi" && counts.data?.update && <span title={t("Mise à jour")} aria-label={t("Mise à jour")} className="size-2 shrink-0 rounded-full bg-accent" />}
                  {x.id === "suivi" && !!counts.data?.alerts && <span className="rounded bg-neg/10 px-1.5 text-[11px] font-semibold text-neg">{counts.data.alerts}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 max-w-[880px] space-y-6">
          <div>
            <h2 className="text-[17px] font-semibold">{g.label}</h2>
            <p className="text-[13px] text-muted">{g.hint}</p>
          </div>
          {content[g.id]}
        </div>
      </div>
    </>
  );
}

type GroupId = "compte" | "foyer" | "connexions" | "demo" | "classement" | "apparence" | "notifications" | "assistant" | "cout-ia" | "suivi";
/** Anciennes adresses de groupes, gardées valides (liens déjà enregistrés, notifications). */
const GROUP_ALIASES: Record<string, GroupId> = { appareil: "notifications", comptes: "connexions" };
const GROUPS: { id: GroupId; label: string; hint: string; icon: typeof Bell; tone: string }[] = [
  { id: "compte", label: t("Compte et sécurité"), hint: t("Membres, clés d'accès, partage avec le foyer, déconnexion"), icon: KeyRound, tone: "bg-[#5e6a7c]" },
  { id: "foyer", label: t("Foyer"), hint: t("Pays et devise, écrans affichés, personnes sans connexion, banques professionnelles"), icon: House, tone: "bg-[#7a5c1f]" },
  { id: "demo", label: t("Mode démo"), hint: t("Montrer Pécule avec une famille fictive"), icon: Presentation, tone: "bg-[#0f766e]" },
  { id: "connexions", label: t("Comptes et connexions"), hint: t("Tes comptes et ce qui les alimente, IA, crypto, applications reliées"), icon: Plug, tone: "bg-[#1863c2]" },
  { id: "classement", label: t("Classement"), hint: t("Libellés de la banque, mes enseignes, règles de classement"), icon: Tags, tone: "bg-[#1f7a5c]" },
  { id: "apparence", label: t("Apparence"), hint: t("Langue, clair ou sombre, couleur, thèmes de l'année"), icon: Palette, tone: "bg-[#b83e33]" },
  { id: "notifications", label: t("Notifications et appareil"), hint: t("Solde bas, alertes de cet appareil, ouverture instantanée"), icon: Bell, tone: "bg-[#c2410c]" },
  { id: "assistant", label: t("Assistant"), hint: t("Mode vocal, mémoire, coût de l'IA"), icon: Sparkles, tone: "bg-accent" },
  { id: "cout-ia", label: t("Coût de l'IA"), hint: t("Dépense du mois, par usage, par membre et par modèle, plafond, tarifs"), icon: Coins, tone: "bg-[#6b4fa3]" },
  { id: "suivi", label: t("Suivi technique"), hint: t("Version, alertes, synchronisations, journal des modifications"), icon: Activity, tone: "bg-[#5e6a7c]" },
];
const GROUP_SECTIONS: { title: string; ids: GroupId[] }[] = [
  { title: t("Compte"), ids: ["compte", "foyer", "demo"] },
  { title: t("Données"), ids: ["connexions", "classement"] },
  { title: t("Affichage et alertes"), ids: ["apparence", "notifications"] },
  { title: t("Assistant et suivi"), ids: ["assistant", "cout-ia", "suivi"] },
];

type AlertRow = { id: number; at: string; lastAt: string; level: string; source: string; message: string; occurrences: number; resolvedAt: string | null };
const SOURCES: Record<string, string> = { serveur: t("Serveur"), synchro: t("Synchro"), cours: t("Cours##source d'alerte"), processus: t("Processus"), demarrage: t("Démarrage") };

/** Alertes techniques : erreurs serveur, synchro, cours, plantages (regroupées si elles se répètent). */
function AlertsSection() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["alerts"], queryFn: () => api<{ alerts: AlertRow[] }>("/alerts") });
  const open = list.data?.alerts.filter((a) => !a.resolvedAt) ?? [];
  const resolve = (id: number) => api(`/alerts/${id}/resolve`, { method: "POST" }).then(() => qc.invalidateQueries({ queryKey: ["alerts"] }));
  return (
    <Section id="alertes" title={open.length ? t("Alertes ({n})", { n: open.length }) : t("Alertes")}>
      <Card className="divide-y divide-line">
        {open.map((a) => (
          <div key={a.id} className="px-4 py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className={clsx("font-medium", a.level === "erreur" ? "text-neg" : "text-warn")}>{a.message}</span>
              <button type="button" onClick={() => resolve(a.id)} className="press shrink-0 text-xs font-medium text-accent">
                {t("Marquer comme lue")}
              </button>
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {SOURCES[a.source] ?? a.source} · {timeAgo(a.lastAt)}
              {a.occurrences > 1 && ` · ${t("{n} fois depuis le {date}", { n: a.occurrences, date: dateFr(a.at) })}`}
            </div>
          </div>
        ))}
        {!open.length && <div className="px-4 py-3 text-sm text-muted">{t("Aucune alerte en cours.")}</div>}
      </Card>
    </Section>
  );
}

type AuditRow = { id: number; at: string; via: string; action: string; target: string | null; details: string | null; user: string | null };
type DepotToken = { id: number; name: string; created_at: string; last_used_at: string | null };

/** `local` : un programme de l'ordinateur, dont `client` n'est que le nom qu'il s'est donné (ou rien). */
type Grant = { id: number; client: string | null; local?: boolean; actions: boolean; createdAt: string; lastUsedAt: string | null };
/** Nom d'un accès : celui d'un assistant reconnu tel quel, celui d'un programme de l'ordinateur entre guillemets, comme une citation. */
const grantName = (g: Grant) => (!g.local && g.client ? g.client : g.client ? t("« {nom} », programme de cet ordinateur", { nom: g.client }) : t("Programme de cet ordinateur"));
/** Les assistants reconnus autres que Claude, dont la marche à suivre est donnée à part. */
const OTHER_ASSISTANTS = MCP_CLIENTS.filter((c) => c.name !== "Claude")
  .map((c) => c.name)
  .join(", ");

/** Applications connectées : accès accordés à un assistant (serveur MCP), à retirer ici. */
function ConnectedAppsSection() {
  const qc = useQueryClient();
  const grants = useQuery({ queryKey: ["oauth-grants"], queryFn: () => api<{ grants: Grant[] }>("/oauth/grants") });
  const url = `${window.location.origin}/api/mcp`;
  async function revoke(g: Grant) {
    if (!confirm(t("Retirer l'accès de « {nom} » ? Il faudra refaire la connexion depuis cette application.", { nom: g.client ?? t("Programme de cet ordinateur") }))) return;
    try {
      await api(`/oauth/grants/${g.id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["oauth-grants"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Retrait impossible"));
    }
  }
  return (
    <Section id="applications" title={t("Applications connectées")}>
      <Card className="divide-y divide-line">
        <div className="px-4 py-3 text-sm text-muted">
          {t("Pour interroger Pécule depuis l'appli Claude (web, ordinateur, iPhone) : dans Claude, Personnaliser → Connecteurs → Ajouter un connecteur personnalisé, avec cette adresse. Pécule te demande alors de te connecter et de choisir entre lecture seule et lecture et actions.")}
          <button type="button" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success(t("Adresse copiée")))} className="press card mt-2 flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-mono text-xs text-ink">
            <span className="truncate">{url}</span>
            <Copy size={14} className="shrink-0 text-accent" />
          </button>
          <p className="mt-3">{t("Depuis Claude Code, lance cette commande, puis « /mcp » dans une session pour te connecter :")}</p>
          <ServerCommand text={`claude mcp add --transport http pecule ${url}`} className="card" />
          <p className="mt-3">
            {t("Un autre assistant se branche sur la même adresse et ouvre le même écran d'accord, pour ta vue seulement : {assistants}, ou un assistant installé sur ton ordinateur (Codex, un éditeur de code, un terminal).", { assistants: OTHER_ASSISTANTS })}
          </p>
          <p className="mt-3">{t("Un outil qui ne sait pas faire cette connexion envoie l'en-tête « Authorization: Bearer » suivi d'un jeton d'administration : il agit alors avec tous les droits de l'administrateur, qui crée ce jeton dans le bloc « Jetons d'administration ».")}</p>
        </div>
        {grants.data?.grants.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span>
              {grantName(g)} · {g.actions ? t("lecture et actions") : t("lecture seule")}
              <span className="block text-xs text-muted">
                {t("connecté le {date}", { date: dateFr(g.createdAt) })} · {g.lastUsedAt ? t("utilisé {quand}", { quand: timeAgo(g.lastUsedAt) }) : t("jamais utilisé")}
              </span>
            </span>
            <button type="button" onClick={() => revoke(g)} className="text-neg" aria-label={t("Retirer l'accès de {nom}", { nom: grantName(g) })}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {grants.data && !grants.data.grants.length && <div className="px-4 py-3 text-sm text-muted">{t("Aucune application connectée.")}</div>}
      </Card>
    </Section>
  );
}

/** Raccourci iPhone « Envoyer à Pécule » : jetons personnels limités au dépôt de fichiers. */
function ShortcutSection() {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<{ tokens: DepotToken[] }>("/tokens") });
  const [fresh, setFresh] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const url = `${window.location.origin}/api/inbox`;
  async function create() {
    try {
      const r = await api<{ token: string }>("/tokens", { method: "POST", json: { name: t("Raccourci iPhone") } });
      setFresh(r.token);
      setHelp(true);
      await qc.invalidateQueries({ queryKey: ["tokens"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Création impossible"));
    }
  }
  async function revoke(tok: DepotToken) {
    if (!confirm(t("Révoquer « {nom} » ? Le raccourci qui l'utilise ne fonctionnera plus.", { nom: tok.name }))) return;
    await api(`/tokens/${tok.id}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["tokens"] });
  }
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t("Copié")));
  return (
    <Section id="raccourci" title={t("Raccourci iPhone « Envoyer à Pécule »")}>
      <Card className="divide-y divide-line">
        <div className="px-4 py-3 text-sm text-muted">
          {t("Depuis la feuille de partage (Mail, Fichiers, Photos…), envoie un PDF ou une photo : Claude le reconnaît et le range dans Factures ou dans le coffre de documents.")}
        </div>
        {tokens.data?.tokens.map((tok) => (
          <div key={tok.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span>
              {tok.name}
              <span className="block text-xs text-muted">
                {t("créé le {date}", { date: dateFr(tok.created_at) })} · {tok.last_used_at ? t("utilisé {quand}", { quand: timeAgo(tok.last_used_at) }) : t("jamais utilisé")}
              </span>
            </span>
            <button type="button" onClick={() => revoke(tok)} className="text-neg" aria-label={t("Révoquer")}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {fresh && (
          <div className="space-y-2 px-4 py-3 text-sm">
            <div className="font-medium text-warn">{t("Copie ce jeton maintenant : il ne sera plus affiché.")}</div>
            <button type="button" onClick={() => copy(`Bearer ${fresh}`)} className="press card flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-mono text-xs">
              <span className="truncate">Bearer {fresh}</span>
              <Copy size={14} className="shrink-0 text-accent" />
            </button>
          </div>
        )}
        <div className="flex gap-2 px-4 py-3">
          <button type="button" onClick={create} className="press flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white">
            {t("Créer un jeton")}
          </button>
          <button type="button" onClick={() => setHelp((h) => !h)} className="press flex-1 rounded-xl bg-bg py-2.5 text-sm font-semibold text-accent">
            {help ? t("Masquer le mode d'emploi") : t("Mode d'emploi")}
          </button>
        </div>
        {help && (
          <ol className="list-decimal space-y-1.5 py-3 pl-9 pr-4 text-sm">
            <li>{t("App Raccourcis → « + » → nommez le raccourci « Envoyer à Pécule ».")}</li>
            <li>{t("Réglages du raccourci (ⓘ) : activez « Afficher dans la feuille de partage », types acceptés : Fichiers, PDF, Images.")}</li>
            <li>
              {t("Ajoute l'action « Obtenir le contenu de l'URL » :")}
              <button type="button" onClick={() => copy(`${url}?name=document`)} className="ml-1 font-mono text-xs text-accent underline">
                {url}?name=…
              </button>{" "}
              {t("(après « name= », insérez la variable « Entrée du raccourci → Nom »).")}
            </li>
            <li>{t("Méthode POST ; en-tête « Authorization » = le jeton copié (« Bearer pec_… ») ; corps de la requête : Fichier → « Entrée du raccourci ».")}</li>
            <li>{t("Ajoute « Afficher la notification » avec le résultat (titre du document rangé).")}</li>
          </ol>
        )}
      </Card>
    </Section>
  );
}

const VIA: Record<string, string> = { ecran: t("écran"), api: t("jeton admin"), assistant: t("assistant"), mcp: "Claude (MCP)", raccourci: t("Raccourci iPhone"), systeme: t("système") };

/** Journal des modifications : qui a changé quoi, depuis l'écran, l'assistant ou le jeton d'administration. */
function AuditSection() {
  const [show, setShow] = useState(false);
  const list = useQuery({ queryKey: ["audit"], queryFn: () => api<{ entries: AuditRow[] }>("/audit?limit=40"), enabled: show });
  return (
    <Section id="journal" title={t("Journal des modifications")}>
      {!show ? (
        <button type="button" onClick={() => setShow(true)} className="press card w-full py-3 text-sm font-medium text-accent">
          {t("Afficher les 40 dernières modifications")}
        </button>
      ) : (
        <Card className="max-h-[28rem] divide-y divide-line overflow-y-auto">
          {list.data?.entries.map((e) => (
            <div key={e.id} className="px-4 py-2.5 text-sm" title={e.details ?? undefined}>
              <div className="truncate font-medium">{e.action}</div>
              <div className="truncate text-xs text-muted">
                {e.user ?? t("Système")} · {VIA[e.via] ?? e.via} · {dateFr(e.at)} {e.at.slice(11, 16)}
                {e.target && ` · ${e.target}`}
              </div>
            </div>
          ))}
          {list.data && !list.data.entries.length && <div className="px-4 py-3 text-sm text-muted">{t("Aucune modification enregistrée pour l'instant.")}</div>}
        </Card>
      )}
    </Section>
  );
}

/** Ce que l'assistant a retenu des conversations (par membre) : consultable et effaçable. */
function MemorySection() {
  const qc = useQueryClient();
  const mem = useQuery({ queryKey: ["assistant-memories"], queryFn: () => api<{ memories: { id: number; content: string; created_at: string }[] }>("/assistant/memories") });
  const list = mem.data?.memories ?? [];
  const remove = (id: number) =>
    api(`/assistant/memories/${id}`, { method: "DELETE" })
      .then(() => qc.invalidateQueries({ queryKey: ["assistant-memories"] }))
      .then(() => toast.success(t("Fait oublié")))
      .catch((e) => toast.error(e instanceof Error ? e.message : t("Suppression impossible")));
  return (
    <Section id="memoire" title={t("Mémoire de l'assistant ({n})", { n: list.length })}>
      <Card className="divide-y divide-line">
        {list.map((m) => (
          <div key={m.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
            <span>
              {m.content}
              <span className="ml-2 text-xs text-muted">{dateFr(m.created_at.slice(0, 10))}</span>
            </span>
            <button type="button" aria-label={t("Oublier ce fait")} onClick={() => remove(m.id)} className="mt-0.5 shrink-0 text-muted hover:text-neg">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!list.length && <div className="px-4 py-3 text-sm text-muted">{t("Rien pour l'instant. Dis par exemple à l'assistant « souviens-toi que… » ; il retient aussi de lui-même ce que tu lui expliques (contexte, prélèvements, préférences).")}</div>}
      </Card>
      <p className="mt-2 px-1 text-xs text-muted">{t("Ces faits sont propres à chaque membre et joints aux consignes de l'assistant à chaque conversation.")}</p>
    </Section>
  );
}

/** Densité de l'affichage sur ordinateur (réglage de l'appareil). */
function DensitySetting() {
  const [density, setDensity] = useDensity();
  return (
    <div className="mt-4 hidden md:block">
      <div className="mb-2 px-1 text-[13px] font-medium">{t("Densité")}</div>
      <Segmented<Density>
        value={density}
        onChange={setDensity}
        options={[
          { value: "aeree", label: t("Aérée") },
          { value: "compacte", label: t("Compacte") },
        ]}
      />
      <p className="mt-2 px-1 text-xs text-muted">{t("« Compacte » resserre les marges et les lignes pour montrer plus d'opérations par écran, sans réduire le texte. Sur ordinateur seulement ; choix mémorisé sur cet appareil.")}</p>
    </div>
  );
}

/** Couleur d'accent, thèmes de l'année automatiques et aperçu (réglages de l'appareil). */
function AppearanceExtras() {
  const { accent, setAccent, seasons, setSeasons, previewing, setPreview } = useAppearance();
  const now = new Date();
  const current = seasonAt(now, seasons, [], region().country);
  const next = upcomingSeasons(now, 11, region().country); // toutes les fêtes de l'année, pour pouvoir les voir en aperçu
  const fmt = (d: Date) => d.toLocaleDateString(locale(), { day: "numeric", month: "long" });
  const preview = (x: Season) => {
    if (previewing === x) return setPreview(null);
    sessionStorage.setItem("pecule.decor.preview", x);
    setPreview(x);
  };
  const row = (x: Season, when: string) => (
    <div key={`${x}-${when}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span>
        {SEASONS[x].emoji} {SEASONS[x].label}
        <span className="ml-2 text-xs text-muted">
          {current === x ? `${t("en ce moment")} · ` : ""}
          {when}
        </span>
      </span>
      <button
        type="button"
        onClick={() => preview(x)}
        className={clsx("shrink-0 rounded-full px-3 py-1 text-xs font-medium ring-1", previewing === x ? "bg-accent text-white ring-accent" : "text-accent ring-line")}
      >
        {previewing === x ? t("Arrêter l'aperçu") : t("Aperçu")}
      </button>
    </div>
  );
  return (
    <div className="mt-4 space-y-4">
      <div>
        <div className="mb-2 px-1 text-[13px] font-medium">{t("Couleur")}</div>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAccent(a.id)}
              aria-pressed={accent === a.id}
              className={clsx("press flex items-center gap-2 rounded-full bg-card py-1.5 pl-1.5 pr-3 text-[14px] ring-1", accent === a.id ? "font-semibold ring-2 ring-ink" : "ring-line")}
            >
              <span className="size-6 rounded-full" style={{ background: `linear-gradient(135deg, ${a.light} 50%, ${a.dark} 50%)` }} />
              {a.label}
            </button>
          ))}
        </div>
        {current && <p className="mt-2 px-1 text-xs text-muted">{t("En ce moment, le thème {nom} remplace ta couleur.", { nom: SEASONS[current].label })}</p>}
      </div>
      <div>
        <div className="mb-2 px-1 text-[13px] font-medium">{t("Thèmes de l'année")}</div>
        <Segmented<SeasonMode>
          value={seasons}
          onChange={setSeasons}
          options={[
            { value: "tout", label: t("Fêtes et saisons") },
            { value: "fetes", label: t("Fêtes seulement") },
            { value: "aucun", label: t("Aucun##thème") },
          ]}
        />
        <p className="mt-2 px-1 text-xs text-muted">
          {t("L'appli change d'allure d'elle-même : fond, couleur, boutons, titres, motif et petit décor sur l'accueil. Les fêtes sont plus marquées ; les saisons habillent le reste de l'année. Les couleurs des graphiques ne changent jamais.")}
        </p>
      </div>
      <BirthdaySettings />
      <FunSettings />
      <LogoSettings />
      <Section id="fetes" title={t("Prochaines fêtes")}>
        <Card className="divide-y divide-line">{next.map((x) => row(x.season, t("du {debut} au {fin}", { debut: fmt(x.start), fin: fmt(x.end) })))}</Card>
      </Section>
      {/* Hémisphère sud : les saisons y sont inversées, aucun thème de saison ne s'y applique. */}
      {!SOUTHERN.has(region().country) && (
        <Section id="saisons" title={t("Saisons")}>
          <Card className="divide-y divide-line">{(["hiver", "printemps", "ete", "automne"] as const).map((x) => row(x, SEASONS[x].dates))}</Card>
        </Section>
      )}
      {previewing && <p className="px-1 text-xs text-muted">{t("Aperçu de {nom} jusqu'à la fermeture de l'appli ; le décor s'affiche sur l'accueil.", { nom: SEASONS[previewing].label })}</p>}
    </div>
  );
}

/** Données gardées sur l'appareil pour une ouverture instantanée, même sans réseau. */
function OfflineSetting() {
  const [on, setOn] = useState(offlineCacheEnabled);
  return (
    <Card className="mt-4">
      <label className="flex items-center justify-between gap-3 px-4 py-3">
        <span>
          <span className="block text-[15px] font-medium">{t("Ouverture instantanée")}</span>
          <span className="block text-xs text-muted">
            {t("Garde sur cet appareil les dernières données de synthèse (soldes, mois, patrimoine, budget, opérations récentes) 7 jours au plus : l'appli s'ouvre tout de suite, même sans réseau. Effacées à la déconnexion ; jamais les factures, documents ni conversations.")}
          </span>
        </span>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOfflineCache(e.target.checked);
            setOn(e.target.checked);
            if (!e.target.checked) toast.success(t("Données effacées de cet appareil"));
            else toast.success(t("Actif au prochain lancement de l'appli"));
          }}
          className="size-5 shrink-0 accent-[var(--color-accent)]"
        />
      </label>
    </Card>
  );
}

/** Abonnement iCal : l'échéancier dans Calendrier Apple (lien privé, montré une seule fois). */
function CalendarSection() {
  const qc = useQueryClient();
  const link = useQuery({ queryKey: ["calendar-link"], queryFn: () => api<{ link: { created_at: string; last_used_at: string | null } | null }>("/calendar-link") });
  const [url, setUrl] = useState<string | null>(null);
  async function create() {
    if (link.data?.link && !confirm(t("Un nouveau lien remplace l'ancien : les agendas abonnés à l'ancien ne se mettront plus à jour. Continuer ?"))) return;
    try {
      const r = await api<{ url: string }>("/calendar-link", { method: "POST" });
      setUrl(r.url);
      await qc.invalidateQueries({ queryKey: ["calendar-link"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Création impossible"));
    }
  }
  async function revoke() {
    if (!confirm(t("Couper l'abonnement ? Les agendas abonnés ne recevront plus l'échéancier."))) return;
    await api("/calendar-link", { method: "DELETE" });
    setUrl(null);
    await qc.invalidateQueries({ queryKey: ["calendar-link"] });
  }
  const webcal = url?.replace(/^https?:/, "webcal:");
  return (
    <Section id="calendrier" title={t("Échéancier dans Calendrier")}>
      <Card className="divide-y divide-line">
        <div className="px-4 py-3 text-sm text-muted">
          {t("Abonne Calendrier (iPhone, Mac) à ton échéancier : tâches, mensualités, fins de crédit, garanties, documents qui expirent, calendrier fiscal, avec un rappel la veille. Mis à jour toutes les 6 heures ; le lien est privé, garde-le pour toi.")}
        </div>
        {url ? (
          <div className="space-y-2 px-4 py-3 text-sm">
            <div className="font-medium text-warn">{t("Copie ce lien maintenant : il ne sera plus affiché.")}</div>
            <div className="break-all rounded-lg bg-bg p-2 font-mono text-[12px]">{url}</div>
            <div className="flex flex-wrap gap-2">
              <a href={webcal} className="press rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white">
                {t("S'abonner sur cet appareil")}
              </a>
              <button type="button" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success(t("Lien copié")))} className="press rounded-lg bg-card px-3 py-2 text-[13px] font-semibold ring-1 ring-line">
                {t("Copier le lien")}
              </button>
            </div>
          </div>
        ) : link.data?.link ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>
              {t("Abonnement actif depuis le {date}", { date: dateFr(link.data.link.created_at.slice(0, 10)) })}
              {link.data.link.last_used_at && <span className="text-muted"> · {t("lu {quand}", { quand: timeAgo(link.data.link.last_used_at) })}</span>}
            </span>
            <span className="flex shrink-0 gap-3">
              <button type="button" onClick={create} className="text-[13px] font-medium text-accent">
                {t("Nouveau lien")}
              </button>
              <button type="button" onClick={revoke} className="text-[13px] font-medium text-neg">
                {t("Couper##abonnement")}
              </button>
            </span>
          </div>
        ) : (
          <button type="button" onClick={create} className="press w-full px-4 py-3 text-left text-[15px] font-medium text-accent">
            {t("Créer le lien d'abonnement")}
          </button>
        )}
      </Card>
    </Section>
  );
}

/* ---------- Mode démo ---------- */

function DemoUnavailable({ what }: { what: string }) {
  // Une seule phrase à traduire ; « {quoi} » y marque la place du nom, rendu en gras.
  const [before, after = ""] = t("{quoi} : indisponible en mode démo (rien ne doit toucher à tes vrais appareils ni à tes vrais accès).").split("{quoi}");
  return (
    <Card className="flex items-start gap-3 p-4 text-sm">
      <Presentation size={18} className="mt-0.5 shrink-0 text-muted" />
      <span>
        {before}
        <b>{what}</b>
        {after}
      </span>
    </Card>
  );
}

/** Bandeau en tête des Réglages pendant une démo (iPhone). */
function DemoBanner() {
  return (
    <Link to="/reglages/demo" className="press card flex items-center gap-3 p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#0f766e] text-white">
        <Presentation size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{t("Mode démo actif")}</span>
        <span className="block text-[12px] text-muted">{t("Données fictives. Touche pour en sortir.")}</span>
      </span>
      <ChevronRight size={17} className="text-muted" />
    </Link>
  );
}

function DemoSection() {
  const me = useMe();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const demo = me.data?.user?.demo === true;
  const available = me.data?.demoAvailable !== false;
  async function run(fn: () => Promise<void>, fail: string) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error && e.name === "NotAllowedError" ? t("Opération annulée.") : e instanceof Error ? e.message : fail);
    }
  }
  return (
    <Section id="demo" title={t("Mode démo")}>
      <Card className="space-y-3 p-4 text-sm leading-relaxed">
        {demo ? (
          <>
            <p>
              <b>{t("Le mode démo est actif.")}</b> {t("Tout ce que tu vois est fictif : la famille, les comptes, les opérations, les factures, le patrimoine. Tes vraies données restent cachées.")}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => leaveDemo(qc), t("Sortie impossible"))}
              className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-60"
            >
              <ScanFace size={19} /> {busy ? t("Vérification…") : t("Quitter le mode démo")}
            </button>
            <p className="text-[12px] text-muted">{t("Face ID, Touch ID ou le code de l'appareil est demandé : personne ne peut sortir de la démo à ta place.")}</p>
          </>
        ) : (
          <>
            <p>{t("Montre Pécule sans rien dévoiler : l'appli passe sur une famille imaginaire, avec ses comptes, ses opérations, ses factures, son patrimoine et son échéancier. Tout fonctionne, l'assistant compris, mais sur ces données fictives.")}</p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>{t("Sur cet appareil seulement : les autres membres et tes autres appareils restent sur les vraies données.")}</li>
              <li>{t("Pour revenir à tes données : Face ID ou Touch ID.")}</li>
              <li>{t("Synchronisation, notifications et clés d'accès sont coupées pendant la démo ; les données fictives sont remises à neuf chaque jour.")}</li>
            </ul>
            <button
              type="button"
              disabled={busy || !available}
              onClick={() => run(() => enterDemo(qc), t("Mode démo indisponible"))}
              className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-60"
            >
              <Presentation size={18} /> {busy ? t("Préparation de la démo…") : available ? t("Passer en mode démo") : t("Mode démo non configuré")}
            </button>
          </>
        )}
      </Card>
    </Section>
  );
}
