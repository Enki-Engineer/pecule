import { region } from "../region.ts";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, type Account } from "../api.ts";
import { BankBadge, ErrorBox, Field, Spinner } from "./ui.tsx";
import { AccountList, type CardNote } from "./AccountList.tsx";
import { dangerButton, mainButton, Part, quietButton } from "./Connector.tsx";
import { cn } from "../cn.ts";
import { dateFr } from "../format.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

type Outstanding = { amount: number; realtime: number | null; debitDate: string | null; count: number; sum: number; consistent: boolean; at: string };
type State = {
  configured: boolean;
  keyUnreadable: boolean;
  appId: string | null;
  redirectUrl: string;
  application: { name: string; active: boolean; environment: string; redirectOk: boolean } | null;
  error: string | null;
  sessions: { id: string; aspsp: string; country: string; userId: number; validUntil: string; daysLeft: number; accounts: { id: string; name: string; kind: string; deferred: boolean; tail: string | null }[] }[];
  lastSyncAt: string | null;
  own: { appId: string; keyUnreadable: boolean; application: State["application"]; error: string | null } | null;
  observation: boolean;
  cards: { accountId: string; name: string; tail: string | null; outstanding: Outstanding }[];
  admin: boolean;
};
type Comparison = {
  accountId: string;
  name: string;
  kind: string;
  tail: string | null;
  counterpart: { id: string; name: string } | null;
  from: string | null;
  read: number;
  same: number;
  shifted: number;
  onlyBankCount: number;
  onlyPeculeCount: number;
  onlyBank: { date: string; amount: number; label: string; pending: boolean }[];
};
type Bank = { name: string; country: string; personal: boolean; consentDays: number };

/** Pays proposés pour relier une banque (codes ISO ; le nom affiché vient du navigateur, dans la langue de Pécule). */
const COUNTRIES = ["FR", "BE", "LU", "DE", "ES", "IT", "PT", "NL", "IE", "AT", "FI", "SE", "DK", "NO", "PL", "EE", "LV", "LT", "GR", "CY", "MT", "SI", "SK", "HR", "HU", "RO", "BG", "IS", "LI"];

const button = mainButton;

/** Témoin laissé par le serveur au retour de la banque (« reliee » ou « erreur »), lu une fois puis effacé. */
function takeOutcome(): string | null {
  const m = /(?:^|; )pecule_banque=([^;]+)/.exec(document.cookie);
  if (!m) return null;
  document.cookie = "pecule_banque=; Max-Age=0; path=/";
  return m[1];
}

/** Saisie de l'identifiant et de la clé privée d'une application : celle du foyer, ou la clé personnelle du membre. */
function KeyForm({ scope, onSaved }: { scope: "foyer" | "moi"; onSaved: (next: State) => void }) {
  const [appId, setAppId] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      onSaved(await api<State>("/bank/enable-banking/key", { method: "PUT", json: { appId, privateKey: key, scope } }));
      setKey("");
      toast.success(t("Clé enregistrée"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Action impossible"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="space-y-2">
        <Field label={t("Identifiant de l'application")} value={appId} onChange={setAppId} placeholder="00000000-0000-0000-0000-000000000000" />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">{t("Clé privée (contenu du fichier .key ou .pem)")}</span>
          <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={4} spellCheck={false} placeholder="-----BEGIN PRIVATE KEY-----" className="card w-full px-3 py-2 font-mono text-xs" />
        </label>
      </div>
      <button type="button" className={cn(button, "mt-3", (busy || !appId.trim() || !key.trim()) && "pointer-events-none opacity-60")} onClick={send}>
        {t("Enregistrer la clé")}
      </button>
    </>
  );
}

/**
 * Enable Banking, déplié dans son connecteur : les comptes qu'il lit, les accords donnés à la banque (un par membre,
 * à redonner tous les 180 jours), relier une autre banque, puis l'application et sa clé. L'administrateur donne la
 * clé de l'application du foyer ; chaque membre relie ensuite ses banques.
 */
export function BankConnections({ accounts, members }: { accounts: Account[]; members: { id: number; name: string }[] }) {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["bank", "enable-banking"], queryFn: () => api<State>("/bank/enable-banking") });
  const [ownForm, setOwnForm] = useState(false);
  const [linking, setLinking] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  // Par défaut, le pays du foyer (s'il fait partie de ceux qu'Enable Banking couvre).
  const [country, setCountry] = useState(() => (COUNTRIES.includes(region().country) ? region().country : "FR"));
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [comparing, setComparing] = useState(false);
  const s = state.data;
  const compare = useQuery({ queryKey: ["bank", "enable-banking", "compare"], queryFn: () => api<{ accounts: Comparison[] }>("/bank/enable-banking/compare"), enabled: comparing });
  const usable = !!(s?.own ? s.own.application?.active : s?.configured && s.application?.active);
  const banks = useQuery({ queryKey: ["bank", "enable-banking", "banks", country], queryFn: () => api<{ banks: Bank[] }>(`/bank/enable-banking/banks?pays=${country}`), enabled: usable && (linking || !s?.sessions.length), staleTime: 3600_000 });

  useEffect(() => {
    const outcome = takeOutcome();
    if (outcome === "reliee") toast.success(t("Banque reliée. La première lecture est en cours."));
    else if (outcome) toast.error(t("La liaison avec la banque n'a pas abouti. Relance-la et valide sans attendre."));
  }, []);

  async function run(fn: () => Promise<State | void>, done?: string) {
    setBusy(true);
    try {
      const next = await fn();
      if (next) qc.setQueryData(["bank", "enable-banking"], next);
      if (done) toast.success(done);
      await qc.invalidateQueries({ queryKey: ["accounts"] });
      await qc.invalidateQueries({ queryKey: ["connections"] });
      // Une banque reliée ou retirée change les logos de banque proposés.
      await qc.invalidateQueries({ queryKey: ["bank-logos"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Action impossible"));
    } finally {
      setBusy(false);
    }
  }

  if (state.isLoading) return <div className="p-6"><Spinner /></div>;
  if (state.error || !s) return <div className="p-4"><ErrorBox error={state.error} /></div>;

  const countryName = (code: string) => new Intl.DisplayNames([locale()], { type: "region" }).of(code) ?? code;
  const memberName = (id: number) => members.find((m) => m.id === id)?.name ?? t("un membre");
  const cards = new Map<string, CardNote>(s.cards.map((c) => [c.accountId, { count: c.outstanding.count, debitDate: c.outstanding.debitDate }]));
  const connect = (aspsp: string, where: string) => run(async () => void (window.location.href = (await api<{ url: string }>("/bank/enable-banking/connect", { method: "POST", json: { aspsp, country: where } })).url));

  // Pas encore configuré : l'administrateur donne la clé de l'application.
  if (!s.configured && !s.own)
    return (
      <Part>
        <p className="text-sm">{t("Enable Banking lit tes comptes auprès de ta banque, avec ton accord : comptes, soldes, opérations, et l'encours des cartes à débit différé. Lecture seule, gratuit pour un usage personnel.")}</p>
        {s.keyUnreadable && <p className="mt-2 text-sm text-warn">{t("La clé enregistrée n'est plus lisible (le secret du serveur a changé) : saisis-la de nouveau.")}</p>}
        {s.admin ? (
          <>
            <p className="mb-3 mt-2 text-[13px] text-muted">
              {t("Crée ton application sur enablebanking.com (environnement Production), puis donne ici son identifiant et sa clé privée. Adresse de retour à y déclarer :")} <span className="select-all font-mono">{s.redirectUrl}</span>
            </p>
            <KeyForm scope="foyer" onSaved={(next) => qc.setQueryData(["bank", "enable-banking"], next)} />
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("Pas encore configuré : l'administrateur du foyer doit d'abord enregistrer la clé de l'application.")}</p>
        )}
      </Part>
    );

  const warnings = [
    s.error,
    s.application && !s.application.active ? t("L'application n'est pas encore active : relie d'abord tes comptes dans la console d'Enable Banking (« Activate by linking accounts »).") : null,
    s.application && !s.application.redirectOk ? `${t("L'adresse de retour n'est pas déclarée chez Enable Banking :")} ${s.redirectUrl}` : null,
    s.own && (s.own.error || s.own.keyUnreadable) ? (s.own.error ?? t("La clé enregistrée n'est plus lisible (le secret du serveur a changé) : saisis-la de nouveau.")) : null,
  ].filter((w): w is string => !!w);

  const linkForm = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setBank("");
          }}
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm"
          aria-label={t("Pays")}
        >
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {countryName(c)}
            </option>
          ))}
        </select>
        <select value={bank} onChange={(e) => setBank(e.target.value)} className="min-w-0 max-w-full rounded-lg border border-line bg-card px-3 py-2 text-sm" aria-label={t("Banque")}>
          <option value="">{banks.isLoading ? t("Chargement…") : t("Choisir une banque")}</option>
          {(banks.data?.banks ?? [])
            .filter((b) => b.personal)
            .map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
        </select>
        <button type="button" className={button} disabled={busy || !bank} onClick={() => connect(bank, country)}>
          {t("Relier")}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">{t("Tu passeras par une page d'accord puis par ta banque. Valide sans attendre : la page d'accord expire au bout d'un quart d'heure. La banque doit d'abord avoir été reliée dans la console d'Enable Banking.")}</p>
    </>
  );

  return (
    <>
      {warnings.length > 0 && (
        <Part>
          {warnings.map((w) => (
            <p key={w} className="text-sm text-warn">
              {w}
            </p>
          ))}
        </Part>
      )}

      <Part
        flush
        title={t("Comptes lus")}
        aside={
          s.sessions.length > 0 ? (
            <button type="button" className={cn(quietButton, "-my-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap")} disabled={busy} onClick={() => run(() => api<State>("/bank/enable-banking/sync", { method: "POST" }), t("Lecture terminée"))}>
              <RefreshCw size={13} className={cn(busy && "animate-spin")} /> {t("Lire maintenant")}
            </button>
          ) : undefined
        }
      >
        <AccountList accounts={accounts} cards={cards} empty={s.sessions.length ? t("Aucun compte lu pour l'instant : la première lecture suit de quelques minutes l'accord donné à la banque.") : t("Aucune banque reliée pour l'instant.")} />
        {s.lastSyncAt && <p className="border-t border-line px-4 py-2.5 text-xs text-muted">{t("Dernière lecture le {date}", { date: new Date(s.lastSyncAt).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) })}</p>}
      </Part>

      {s.sessions.length > 0 && (
        <Part flush title={t("Accords donnés à la banque")}>
          <ul className="divide-y divide-line">
            {s.sessions.map((x) => (
              <li key={x.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
                <BankBadge bank={x.aspsp} size="md" />
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">{t("{banque} · accord de {membre}", { banque: x.aspsp, membre: memberName(x.userId) })}</span>
                  <span className={cn("block text-xs", x.daysLeft < 15 ? "font-medium text-warn" : "text-muted")}>
                    {x.daysLeft < 0 ? t("Accord expiré") : t("Accord valable jusqu'au {date}", { date: dateFr(x.validUntil.slice(0, 10)) })} · {tn("{n} compte", "{n} comptes", x.accounts.length, { n: x.accounts.length })}
                  </span>
                </span>
                <span className="col-start-2 -ml-2.5 flex items-center md:col-start-3 md:ml-0">
                  <button type="button" className={quietButton} disabled={busy} onClick={() => connect(x.aspsp, x.country)}>
                    {t("Renouveler")}
                  </button>
                  <button type="button" className={dangerButton} disabled={busy} onClick={() => confirm(t("Retirer cet accord ? Les opérations déjà lues restent dans Pécule.")) && run(() => api<State>(`/bank/enable-banking/sessions/${x.id}`, { method: "DELETE" }), t("Accord retiré"))}>
                    {t("Retirer")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">{t("La banque demande de redonner ton accord tous les 180 jours ; Pécule te prévient avant l'échéance.")}</p>
        </Part>
      )}

      {usable &&
        (s.sessions.length === 0 ? (
          <Part title={t("Relier une banque")}>{linkForm}</Part>
        ) : (
          <Part>
            <button type="button" className={cn(quietButton, "-mx-2.5 inline-flex items-center gap-1")} aria-expanded={linking} onClick={() => setLinking((v) => !v)}>
              <ChevronRight size={15} className={cn("transition-transform", linking && "rotate-90")} /> {t("Relier une autre banque")}
            </button>
            {linking && <div className="mt-3">{linkForm}</div>}
          </Part>
        ))}

      <Part>
        <button type="button" className={cn(quietButton, "-mx-2.5 inline-flex items-center gap-1 text-muted")} aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
          <ChevronRight size={15} className={cn("transition-transform", advanced && "rotate-90")} /> {t("Application et clé")}
        </button>
        {advanced && (
          <div className="mt-2 space-y-4 text-sm">
            <div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{t("Application du foyer : {nom}", { nom: s.application?.name ?? s.appId ?? "—" })}</span>
                {s.application && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", s.application.active ? "bg-pos/10 text-pos" : "bg-line text-muted")}>{s.application.active ? t("Active") : t("Inactive")}</span>}
              </div>
              <p className="mt-1 text-xs text-muted">{t("C'est le nom donné à l'application sur enablebanking.com ; sa clé est gardée chiffrée.")}</p>
              {s.admin && (
                <button type="button" className={cn(dangerButton, "-mx-2.5 mt-1")} disabled={busy} onClick={() => confirm(t("Oublier la clé et tous les accords ? Les opérations déjà lues restent dans Pécule.")) && run(() => api<State>("/bank/enable-banking?scope=foyer", { method: "DELETE" }), t("Clé oubliée"))}>
                  {t("Oublier la clé et les accords")}
                </button>
              )}
            </div>
            <div>
              {s.own ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{t("Ta clé personnelle")}</span>
                    <span className="text-xs text-muted">{s.own.application?.name ?? s.own.appId}</span>
                    {s.own.application && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", s.own.application.active ? "bg-pos/10 text-pos" : "bg-line text-muted")}>{s.own.application.active ? t("Active") : t("Inactive")}</span>}
                  </div>
                  <button type="button" className={cn(dangerButton, "-mx-2.5 mt-1")} disabled={busy} onClick={() => confirm(t("Oublier ta clé personnelle et tes accords ? Les opérations déjà lues restent dans Pécule.")) && run(() => api<State>("/bank/enable-banking?scope=moi", { method: "DELETE" }), t("Clé oubliée"))}>
                    {t("Oublier ma clé")}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={cn(quietButton, "-mx-2.5")} onClick={() => setOwnForm((v) => !v)}>
                    {t("J'ai des comptes à mon seul nom")}
                  </button>
                  {ownForm && (
                    <>
                      <p className="mb-3 mt-1 text-xs text-muted">{t("L'usage gratuit d'Enable Banking ne couvre que les comptes de la personne inscrite. Si tu as des comptes à ton seul nom, crée ta propre application sur enablebanking.com et donne ici sa clé : elle servira à tes accords.")}</p>
                      <KeyForm scope="moi" onSaved={(next) => (qc.setQueryData(["bank", "enable-banking"], next), setOwnForm(false))} />
                    </>
                  )}
                </>
              )}
            </div>
            {s.observation && (
              <div>
                <button type="button" className={cn(quietButton, "-mx-2.5")} onClick={() => setComparing((v) => !v)}>
                  {t("Comparer avec mes comptes actuels")}
                </button>
                {comparing &&
                  (compare.isLoading ? (
                    <Spinner />
                  ) : (
                    <div className="mt-1 divide-y divide-line">
                      {(compare.data?.accounts ?? []).map((c) => {
                        const waiting = c.onlyBank.filter((x) => x.pending).length;
                        return (
                          <div key={c.accountId} className="py-2 text-sm">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-medium">{c.name}</span>
                              <span className="text-xs text-muted">{c.counterpart ? `↔ ${c.counterpart.name}` : t("Aucun compte de Pécule ne correspond")}</span>
                            </div>
                            {c.counterpart && (
                              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                                <span className="text-pos">{tn("{n} identique", "{n} identiques", c.same, { n: c.same })}</span>
                                {c.shifted > 0 && <span>{tn("{n} datée autrement", "{n} datées autrement", c.shifted, { n: c.shifted })}</span>}
                                {c.onlyBankCount > 0 && <span>{t("{n} seulement à la banque, dont {attente} en attente de prélèvement", { n: c.onlyBankCount, attente: waiting })}</span>}
                                {c.onlyPeculeCount > 0 && <span className="text-warn">{t("{n} seulement dans Pécule", { n: c.onlyPeculeCount })}</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <p className="pt-2 text-xs text-muted">{t("« Datées autrement » : des achats de fin de mois que la banque prélève un mois plus tard que ce que Pécule supposait. La date de la banque fera foi.")}</p>
                    </div>
                  ))}
                <p className="mt-1 text-xs text-muted">{t("Période d'observation : les comptes lus par Enable Banking sont gardés à part, masqués et hors statistiques, le temps de les comparer à ta source actuelle. Rien n'est compté deux fois.")}</p>
              </div>
            )}
          </div>
        )}
      </Part>
    </>
  );
}
