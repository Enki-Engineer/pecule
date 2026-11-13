import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bitcoin, Blocks, Cable, CalendarClock, ExternalLink, FileUp, Info, KeyRound, Landmark, PenLine, Presentation, Smartphone, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, useAccounts, useMe, type Account } from "../api.ts";
import { AccountList } from "./AccountList.tsx";
import { AiSettings } from "./AiSettings.tsx";
import { BankConnections } from "./BankConnections.tsx";
import { BankFileImport } from "./BankFileImport.tsx";
import { Connector, ConnectorIcon, Family, Part, quietButton, type ConnectorState } from "./Connector.tsx";
import { BrandLogo } from "./Logo.tsx";
import { NewManualAccount } from "./ManualEntry.tsx";
import { BareSections } from "./SettingsSection.tsx";
import { BankBadge, Card, Spinner } from "./ui.tsx";
import { cn } from "../cn.ts";
import { AI_PROVIDER_INFO, type AiProvider } from "../../lib/ai-providers.ts";
import { dateFr } from "../format.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

type KeyStatus = { keySet: boolean; source: "reglages" | "hebergement" | null; unreadable: boolean };
type Connections = {
  banks: {
    enableBanking: { consents: number; mine: number; nextExpiry: string | null };
    finta: { enabled: boolean };
    files: { lastImport: string | null };
    manualAccounts: number;
    lastSync: { at: string | null; status: string | null } | null;
  };
  ai: { enabled: boolean; provider: string | null; model: string | null };
  services: Record<"coinstats" | "coingecko", KeyStatus>;
  crypto: { lastRun: { at: string | null; status: string | null } | null };
  apps: number;
  shortcuts: number;
  calendar: boolean;
  devices: number;
};

export type ConnectionSlots = { apps: ReactNode; shortcut: ReactNode; calendar: ReactNode };

/** Contenu écrit pour un écran à part (une carte et sa note) : logé dans un connecteur, il perd son cadre et suit ses marges. */
function Flat({ children }: { children: ReactNode }) {
  return (
    <BareSections>
      <div className="[&>.card]:rounded-none [&>.card]:border-0 [&>.card]:bg-transparent [&>.card]:shadow-none [&>div>.card]:rounded-none [&>div>.card]:border-0 [&>div>.card]:bg-transparent [&>div>.card]:shadow-none [&>div>p]:px-4 [&>div>p]:pb-3 [&>p]:px-4 [&>p]:pb-3">{children}</div>
    </BareSections>
  );
}

const daysUntil = (day: string) => Math.round((Date.parse(day.slice(0, 10)) - Date.now()) / 86400_000);

/**
 * Réglages → Comptes et connexions : un bloc par connecteur, avec son logo et son état. On le déplie pour voir les
 * comptes qu'il alimente et le régler sur place. D'abord les sources des comptes (Enable Banking, Finta, fichiers,
 * comptes tenus à la main, historique), puis les services (IA, crypto), puis ce qui accède à Pécule en ton nom.
 * L'adresse `?c=<bloc>` ouvre un bloc.
 */
export function ConnectionsSettings({ slots }: { slots: ConnectionSlots }) {
  const c = useQuery({ queryKey: ["connections"], queryFn: () => api<Connections>("/connections") }).data;
  const accounts = useAccounts().data?.accounts;
  const members = useQuery({ queryKey: ["household"], queryFn: () => api<{ members: { id: number; name: string }[] }>("/household"), staleTime: 3600_000 }).data?.members ?? [];
  const me = useMe().data?.user;
  const admin = me?.admin === true;
  const demo = me?.demo === true;
  const [params, setParams] = useSearchParams();
  const open = params.get("c");
  const block = (id: string) => ({ open: open === id, onToggle: () => setParams(open === id ? {} : { c: id }, { replace: true }) });
  if (!c || !accounts) return <Spinner />;

  const fed = (feed: string) => accounts.filter((a) => a.feed === feed);
  const [byBank, byFinta, stopped, manual, history] = [fed("enablebanking"), fed("finta"), fed("arret"), fed("manuel"), fed("historique")];
  // Sans Finta, ce qu'il ne lit plus rejoint les archives.
  const showFinta = c.banks.finta.enabled || byFinta.length > 0;
  const archived = showFinta ? history : [...history, ...stopped];
  const eb = c.banks.enableBanking;
  const renewSoon = !!eb.nextExpiry && daysUntil(eb.nextExpiry) < 15;
  const count = (n: number) => tn("{n} compte", "{n} comptes", n, { n });
  const keyState = (k: KeyStatus): { state: ConnectorState; label: string } =>
    k.unreadable ? { state: "attention", label: t("Clé à ressaisir") } : k.keySet ? { state: "ok", label: t("Clé enregistrée") } : { state: "off", label: t("Sans clé") };

  return (
    <>
      <Family title={t("Tes comptes et ce qui les alimente")} hint={t("Chaque source montre ses comptes : touche un compte pour le renommer, le masquer ou le sortir des statistiques.")}>
        {demo && (
          <Connector {...block("demo")} logo={<ConnectorIcon tone="bg-[#0f766e]"><Presentation size={19} /></ConnectorIcon>} name={t("Comptes de la démonstration")} state="ok" stateLabel={t("Démo")} summary={`${count(accounts.length)} · ${t("famille fictive, rien n'est relié à une banque")}`}>
            <Part flush>
              <AccountList accounts={accounts} />
            </Part>
          </Connector>
        )}
        {!demo && <SourceGuide />}
        {!demo && (
          <Connector
            {...block("banque")}
            logo={<BrandLogo texts={["Enable Banking"]} icon={Landmark} />}
            name="Enable Banking"
            state={eb.consents === 0 ? "off" : renewSoon ? "attention" : "ok"}
            stateLabel={eb.consents === 0 ? t("Non relié") : renewSoon ? t("Accord à renouveler") : t("Relié")}
            summary={
              eb.consents > 0
                ? `${tn("{n} compte lu chez la banque", "{n} comptes lus chez la banque", byBank.length, { n: byBank.length })}${eb.nextExpiry ? ` · ${t("accord à renouveler avant le {date}", { date: dateFr(eb.nextExpiry.slice(0, 10)) })}` : ""}`
                : t("Lit tes comptes, soldes et opérations directement chez ta banque, en lecture seule")
            }
          >
            <BankConnections accounts={byBank} members={members} />
          </Connector>
        )}
        {!demo && showFinta && (
          <Connector
            {...block("finta")}
            logo={<BrandLogo texts={["Finta"]} icon={Cable} />}
            name="Finta"
            state={byFinta.length ? "ok" : c.banks.finta.enabled ? "attention" : "off"}
            stateLabel={byFinta.length ? t("Relié") : c.banks.finta.enabled ? t("Ne lit plus rien") : t("Débranché")}
            summary={[byFinta.length ? tn("{n} compte lu", "{n} comptes lus", byFinta.length, { n: byFinta.length }) : t("Aucun compte lu"), stopped.length ? tn("{n} compte n'est plus lu", "{n} comptes ne sont plus lus", stopped.length, { n: stopped.length }) : null].filter(Boolean).join(" · ")}
          >
            <FintaPanel live={byFinta} stopped={stopped} enabled={c.banks.finta.enabled} />
          </Connector>
        )}
        {!demo && (
          <Connector
            {...block("fichiers")}
            logo={<ConnectorIcon tone="bg-[#1f7a5c]"><FileUp size={19} /></ConnectorIcon>}
            name={t("Fichiers de la banque")}
            state={c.banks.files.lastImport ? "ok" : "off"}
            stateLabel={c.banks.files.lastImport ? t("Utilisé") : t("À la demande")}
            summary={c.banks.files.lastImport ? t("Dernière opération importée : {date}", { date: dateFr(c.banks.files.lastImport) }) : t("Export OFX, QIF ou CSV de ton espace client, sans rien relier")}
          >
            <Part>
              <Flat>
                <div className="[&>.card]:p-0">
                  <BankFileImport />
                </div>
              </Flat>
            </Part>
          </Connector>
        )}
        {!demo && (
          <Connector
            {...block("manuel")}
            logo={<ConnectorIcon tone="bg-[#7a5c1f]"><PenLine size={19} /></ConnectorIcon>}
            name={t("Comptes tenus à la main")}
            state={manual.length ? "ok" : "off"}
            stateLabel={manual.length ? count(manual.length) : t("Aucun compte")}
            summary={t("Espèces, compte d'une banque que tu ne relies pas : tu saisis ses opérations ou tu y importes un fichier")}
          >
            {manual.length > 0 && (
              <Part flush title={t("Comptes")}>
                <AccountList accounts={manual} />
              </Part>
            )}
            <Part>
              <div className="[&>.card]:mt-0 [&>.card]:border-0 [&>.card]:bg-transparent [&>.card]:p-0 [&>.card]:shadow-none [&>button]:mt-0">
                <NewManualAccount />
              </div>
              <p className="mt-3 text-xs text-muted">{t("Les opérations d'un compte tenu à la main s'ajoutent depuis l'écran Opérations (bouton « Ajouter »).")}</p>
            </Part>
          </Connector>
        )}
        {!demo && archived.length > 0 && (
          <Connector
            {...block("historique")}
            logo={<ConnectorIcon tone="bg-[#5e6a7c]"><Archive size={19} /></ConnectorIcon>}
            name={t("Historique et comptes fermés")}
            state="off"
            stateLabel={t("Archives")}
            summary={`${count(archived.length)} · ${t("venus d'un export ou d'une reprise : leurs opérations restent, plus rien ne les alimente")}`}
          >
            <Part flush>
              <AccountList accounts={archived} />
            </Part>
          </Connector>
        )}
        <p className="px-1 text-xs text-muted">
          {t("Masquer un compte ou le sortir des statistiques ne vaut que pour toi : les autres membres gardent leurs propres réglages.")}
          {c.banks.lastSync?.at ? ` ${t("Dernière synchronisation des banques : {date}", { date: `${dateFr(c.banks.lastSync.at.slice(0, 10))} ${c.banks.lastSync.at.slice(11, 16)}` })}${c.banks.lastSync.status === "error" ? ` · ${t("erreur")}` : ""}` : ""}
        </p>
      </Family>

      <Family title={t("Services")} hint={t("Facultatifs : l'assistant et la lecture des documents, les cours et les portefeuilles crypto.")}>
        <Connector
          {...block("ia")}
          logo={<ConnectorIcon tone="bg-accent"><Sparkles size={19} /></ConnectorIcon>}
          name={t("Intelligence artificielle")}
          state={c.ai.enabled ? "ok" : "off"}
          stateLabel={c.ai.enabled ? t("Branchée") : t("Non branchée")}
          summary={c.ai.enabled ? [c.ai.provider ? (AI_PROVIDER_INFO[c.ai.provider as AiProvider]?.label ?? c.ai.provider) : null, c.ai.model].filter(Boolean).join(" · ") : t("Avec ta propre clé d'IA : l'assistant, la lecture des factures et des documents")}
        >
          {demo ? (
            <Part>
              <p className="text-sm text-muted">{t("Indisponible en mode démo")}</p>
            </Part>
          ) : (
            <Part flush>
              <Flat>
                <AiSettings />
              </Flat>
            </Part>
          )}
        </Connector>
        {!demo && (
          <Connector {...block("coinstats")} logo={<BrandLogo texts={["CoinStats"]} icon={Bitcoin} />} name="CoinStats" {...stateProps(keyState(c.services.coinstats))} summary={c.services.coinstats.keySet && c.crypto.lastRun?.at ? t("Portefeuilles crypto · dernière lecture le {date}", { date: dateFr(c.crypto.lastRun.at.slice(0, 10)) }) : t("Quantités de tes portefeuilles crypto, lues une fois par jour")}>
            <Part>
              <ServiceKey service="coinstats" name="CoinStats" hint={t("Quantités de tes portefeuilles, lues une fois par jour (clé d'API en lecture seule).")} status={c.services.coinstats} admin={admin} />
            </Part>
          </Connector>
        )}
        {!demo && (
          <Connector {...block("coingecko")} logo={<BrandLogo texts={["CoinGecko"]} icon={Bitcoin} />} name="CoinGecko" {...stateProps(keyState(c.services.coingecko))} summary={t("Cours des cryptos ; marche sans clé, dans une limite partagée")}>
            <Part>
              <ServiceKey service="coingecko" name="CoinGecko" hint={t("Cours des cryptos (clé « Demo » gratuite : sans elle, la limite est partagée avec les autres visiteurs de l'hébergement).")} status={c.services.coingecko} admin={admin} />
            </Part>
          </Connector>
        )}
      </Family>

      {!demo && (
        <Family title={t("Ce qui accède à Pécule en ton nom")} hint={t("Chaque accès se retire d'un geste.")}>
          <Connector {...block("applications")} logo={<ConnectorIcon tone="bg-[#2f6f8f]"><Blocks size={19} /></ConnectorIcon>} name={t("Applications connectées")} state={c.apps > 0 ? "ok" : "off"} stateLabel={c.apps > 0 ? tn("{n} application", "{n} applications", c.apps, { n: c.apps }) : t("Aucune")} summary={t("Ton assistant (Claude…) relié à Pécule par son serveur MCP")}>
            <Part flush>
              <Flat>{slots.apps}</Flat>
            </Part>
          </Connector>
          <Connector {...block("raccourci")} logo={<ConnectorIcon tone="bg-[#3d4a5c]"><Smartphone size={19} /></ConnectorIcon>} name={t("Raccourci « Envoyer à Pécule »")} state={c.shortcuts > 0 ? "ok" : "off"} stateLabel={c.shortcuts > 0 ? tn("{n} jeton", "{n} jetons", c.shortcuts, { n: c.shortcuts }) : t("Non installé")} summary={t("Déposer une photo ou un PDF depuis le menu de partage de l'iPhone")}>
            <Part flush>
              <Flat>{slots.shortcut}</Flat>
            </Part>
          </Connector>
          <Connector {...block("calendrier")} logo={<ConnectorIcon tone="bg-[#b83e33]"><CalendarClock size={19} /></ConnectorIcon>} name={t("Échéancier dans Calendrier")} state={c.calendar ? "ok" : "off"} stateLabel={c.calendar ? t("Abonné") : t("Non abonné")} summary={t("Tes échéances dans l'appli Calendrier, par un lien privé")}>
            <Part flush>
              <Flat>{slots.calendar}</Flat>
            </Part>
          </Connector>
          {admin && (
            <Connector {...block("jetons")} logo={<ConnectorIcon tone="bg-[#5e6a7c]"><KeyRound size={19} /></ConnectorIcon>} name={t("Jetons d'administration")} state="off" stateLabel={t("Administrateur")} summary={t("Pour la ligne de commande, tes scripts ou un assistant en accès complet")}>
              <Part flush>
                <Flat>
                  <AdminTokens />
                </Flat>
              </Part>
            </Connector>
          )}
        </Family>
      )}
    </>
  );
}

const stateProps = (s: { state: ConnectorState; label: string }) => ({ state: s.state, stateLabel: s.label });

/** Encart « Quelle source choisir ? » : ce que coûte chaque façon d'alimenter ses comptes, avant d'en déplier une. */
function SourceGuide() {
  const sources: { name: string; price: string; free: boolean; text: string }[] = [
    {
      name: "Enable Banking",
      price: t("Gratuit"),
      free: true,
      text: t("Gratuit pour un usage personnel : tu crées ton application sur enablebanking.com et tu y relies les comptes à ton nom (un autre adulte du foyer fait de même pour les siens). Lecture seule, directement chez la banque."),
    },
    {
      name: "Finta",
      price: t("Abonnement payant"),
      free: false,
      text: t("Service tiers sur abonnement : Pécule le lit si tu as déjà un compte Finta et sa clé d'API. Rien ne t'oblige à le prendre."),
    },
    {
      name: t("Fichiers de la banque"),
      price: t("Gratuit"),
      free: true,
      text: t("Sans rien relier : tu déposes de temps en temps l'export OFX, QIF ou CSV de ton espace client."),
    },
  ];
  return (
    <aside className="rounded-xl bg-accent-soft/60 px-4 py-3.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Info size={15} className="shrink-0 text-accent" /> {t("Quelle source choisir ?")}
      </h3>
      <dl className="mt-2.5 grid gap-x-5 gap-y-3 md:grid-cols-3">
        {sources.map((x) => (
          <div key={x.name} className="min-w-0">
            <dt className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-semibold">
              {x.name}
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none", x.free ? "bg-pos/15 text-pos" : "bg-warn/20 text-warn")}>{x.price}</span>
            </dt>
            <dd className="mt-1 text-[12.5px] leading-snug text-muted">{x.text}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

type FintaConnection = { id: string; institutionName: string | null; status: string | null; lastSyncedAt: string | null; lastProviderErrorMessage: string | null; reconnectUrl: string | null };

/** Finta, déplié : les comptes qu'il lit encore, ceux qu'il ne lit plus, et l'état de ses connexions aux banques. */
function FintaPanel({ live, stopped, enabled }: { live: Account[]; stopped: Account[]; enabled: boolean }) {
  const connections = useQuery({ queryKey: ["finta-connections"], queryFn: () => api<{ bankConnections?: FintaConnection[] }>("/sync/connections"), enabled, staleTime: 5 * 60_000 });
  const list = connections.data?.bankConnections ?? [];
  return (
    <>
      <Part flush title={t("Comptes lus par Finta")}>
        <AccountList accounts={live} empty={t("Finta ne lit plus aucun compte.")} />
      </Part>
      {stopped.length > 0 && (
        <Part flush title={t("Ne sont plus lus")}>
          <AccountList accounts={stopped} />
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">{t("La connexion de Finta à leur banque a expiré, ou le compte est fermé. Leurs opérations restent dans Pécule.")}</p>
        </Part>
      )}
      {enabled && (
        <Part flush title={t("Connexions de Finta aux banques")}>
          {connections.isLoading ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : list.length ? (
            <ul className="divide-y divide-line">
              {list.map((x) => {
                const ok = x.status === "active";
                return (
                  <li key={x.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <BankBadge bank={x.institutionName} size="md" />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium">{x.institutionName ?? "—"}</span>
                      <span className={cn("block text-xs", ok ? "text-muted" : "font-medium text-warn")}>
                        {ok ? t("Connexion active") : t("Connexion à refaire chez Finta")}
                        {x.lastSyncedAt ? ` · ${t("dernière lecture le {date}", { date: new Date(x.lastSyncedAt).toLocaleDateString(locale()) })}` : ""}
                      </span>
                    </span>
                    {!ok && x.reconnectUrl && /^https:\/\/app\.finta\.io\//.test(x.reconnectUrl) && (
                      <a href={x.reconnectUrl} target="_blank" rel="noreferrer" className={cn(quietButton, "col-start-2 -ml-2.5 inline-flex items-center gap-1 justify-self-start md:col-start-3 md:ml-0")}>
                        {t("Reconnecter")} <ExternalLink size={13} />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted">{t("Aucune connexion connue de Finta.")}</p>
          )}
        </Part>
      )}
      <Part>
        <p className="text-xs text-muted">{t("Finta se branche par la variable FINTA_API_KEY de l'hébergement. Un compte que tu as rattaché à Enable Banking n'est plus alimenté par Finta.")}</p>
      </Part>
    </>
  );
}

/** Clé d'un service : jamais réaffichée ; « Retirer » rend la main à la valeur de l'hébergement, s'il y en a une. */
function ServiceKey({ service, name, hint, status, admin }: { service: string; name: string; hint: string; status: KeyStatus; admin: boolean }) {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(value: string) {
    setBusy(true);
    try {
      await api(`/connections/keys/${service}`, { method: "PUT", json: { key: value } });
      toast.success(value ? t("Clé enregistrée") : t("Clé retirée"));
      setKey("");
      await qc.invalidateQueries({ queryKey: ["connections"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Réglage non enregistré"));
    } finally {
      setBusy(false);
    }
  }
  const state = status.unreadable ? t("Clé illisible : à ressaisir") : status.source === "reglages" ? t("Clé enregistrée ici") : status.source === "hebergement" ? t("Clé posée par l'hébergement") : t("Sans clé");
  return (
    <>
      <p className="text-sm">{hint}</p>
      <p className={cn("mt-1 text-[13px]", status.unreadable ? "font-medium text-warn" : "text-muted")}>{state}</p>
      {admin ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) void save(key.trim());
          }}
        >
          <input value={key} onChange={(e) => setKey(e.target.value)} type="password" autoComplete="off" spellCheck={false} placeholder={status.keySet ? t("Coller une nouvelle clé") : t("Coller la clé")} aria-label={t("Clé de {service}", { service: name })} className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-[16px] md:text-[14px]" />
          <button type="submit" disabled={busy || !key.trim()} className="press rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {t("Enregistrer")}
          </button>
          {status.source === "reglages" && (
            <button type="button" disabled={busy} onClick={() => void save("")} className="press px-2 py-2 text-sm font-medium text-neg disabled:opacity-50">
              {t("Retirer")}
            </button>
          )}
        </form>
      ) : (
        <p className="mt-2 text-xs text-muted">{t("Seul l'administrateur du foyer peut changer ces réglages.")}</p>
      )}
    </>
  );
}

type Token = { id: number; name: string; created_at: string; last_used_at: string | null };

/**
 * Jetons d'administration (administrateur seulement) : pour la ligne de commande, les scripts et un assistant branché
 * sur le serveur MCP. Un jeton n'est montré qu'à sa création ; on le révoque d'un geste.
 */
function AdminTokens() {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ["admin-tokens"], queryFn: () => api<{ tokens: Token[] }>("/connections/admin-tokens") });
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/connections/admin-tokens", { method: "POST", json: { name: name.trim() } });
      setFresh(r.token);
      setName("");
      await qc.invalidateQueries({ queryKey: ["admin-tokens"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Création impossible"));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(tok: Token) {
    if (!confirm(t("Révoquer le jeton « {nom} » ? Ce qui s'en sert perdra l'accès tout de suite.", { nom: tok.name }))) return;
    await api(`/connections/admin-tokens/${tok.id}`, { method: "DELETE" }).catch((e) => toast.error(e instanceof Error ? e.message : t("Action impossible")));
    await qc.invalidateQueries({ queryKey: ["admin-tokens"] });
  }
  return (
    <div id="jetons">
      <Card className="divide-y divide-line">
        {tokens.data?.tokens.map((tok) => (
          <div key={tok.id} className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{tok.name}</span>
              <span className="block text-xs text-muted">
                {t("créé le {date}", { date: dateFr(tok.created_at) })} · {tok.last_used_at ? t("utilisé le {date}", { date: dateFr(tok.last_used_at) }) : t("jamais utilisé")}
              </span>
            </span>
            <button type="button" onClick={() => void revoke(tok)} className="press shrink-0 text-sm font-medium text-neg">
              {t("Révoquer")}
            </button>
          </div>
        ))}
        <form
          className="flex flex-wrap items-center gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("À quoi sert-il ? (ex. ligne de commande)")} aria-label={t("Nom du jeton")} className="min-w-0 flex-1 rounded-md bg-bg px-3 py-2 text-[16px] ring-1 ring-line md:text-[14px]" />
          <button type="submit" disabled={busy || !name.trim()} className="press rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {t("Créer un jeton")}
          </button>
        </form>
        {fresh && (
          <div className="px-4 py-3 text-sm">
            <p className="font-medium">{t("Copie ce jeton maintenant : il ne sera plus jamais affiché.")}</p>
            <code className="mt-2 block break-all rounded-md bg-bg p-2 text-xs">{fresh}</code>
            <div className="mt-2 flex gap-3">
              <button type="button" className="press font-medium text-accent" onClick={() => navigator.clipboard.writeText(fresh).then(() => toast.success(t("Jeton copié")))}>
                {t("Copier")}
              </button>
              <button type="button" className="press text-muted" onClick={() => setFresh(null)}>
                {t("C'est noté")}
              </button>
            </div>
          </div>
        )}
      </Card>
      <p className="mt-2 px-1 text-xs text-muted">
        {t("Un jeton d'administration donne tous les droits sur Pécule, au nom de l'administrateur : pour la ligne de commande, tes scripts, ou un assistant relié au serveur MCP. Donne-lui un nom par usage, et révoque celui qui ne sert plus. Seule son empreinte est gardée.")}
      </p>
    </div>
  );
}
