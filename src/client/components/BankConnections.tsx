import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, useMe, type Account } from "../api.ts";
import { BANK_STATE_KEY, guideFacts, takeBankOutcome, useBankState, type BankScope, type BankState } from "../api-bank.ts";
import { BankBadge, ErrorBox, Spinner } from "./ui.tsx";
import { AccountList, type CardNote } from "./AccountList.tsx";
import { BankGuide, BankLinkForm } from "./BankGuide.tsx";
import { dangerButton, Part, quietButton } from "./Connector.tsx";
import { cn } from "../cn.ts";
import { dateFr } from "../format.ts";
import { bankGuide } from "../../lib/onboarding.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

type State = BankState;
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

const INTRO = () => t("Enable Banking lit tes comptes auprès de ta banque, avec ton accord : comptes, soldes, opérations, et l'encours des cartes à débit différé. Lecture seule, gratuit pour un usage personnel.");
const OWN_HINT = () => t("L'usage gratuit d'Enable Banking ne couvre que les comptes de la personne inscrite. Si tu as des comptes à ton seul nom, crée ta propre application sur enablebanking.com et donne ici sa clé : elle servira à tes accords.");

/**
 * Enable Banking, déplié dans son connecteur : les comptes qu'il lit, les accords donnés à la banque (un par membre,
 * à redonner tous les 180 jours), relier une autre banque, puis l'application et sa clé. L'administrateur donne la
 * clé de l'application du foyer ; chaque membre relie ensuite ses banques.
 */
export function BankConnections({ accounts, members }: { accounts: Account[]; members: { id: number; name: string }[] }) {
  const qc = useQueryClient();
  const userId = useMe().data?.user?.id;
  const state = useBankState();
  const [ownForm, setOwnForm] = useState(false);
  const [linking, setLinking] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comparing, setComparing] = useState(false);
  const s = state.data;
  const compare = useQuery({ queryKey: ["bank", "enable-banking", "compare"], queryFn: () => api<{ accounts: Comparison[] }>("/bank/enable-banking/compare"), enabled: comparing });
  const usable = !!(s?.own ? s.own.application?.active : s?.configured && s.application?.active);

  // Application dont le membre fait lui-même tous les temps du guide : celle du foyer pour l'administrateur, la sienne
  // pour qui a des comptes à son seul nom. Un autre membre se sert de l'application du foyer telle qu'elle est.
  const scope: BankScope | null = !s ? null : s.own ? "moi" : s.admin ? "foyer" : null;
  // Le guide tient lieu de formulaires tant que l'application qu'il suit n'a rien relié — celle du foyer : aucun accord
  // dans le foyer ; celle d'un membre : aucun accord de ce membre — ou quand sa clé est à redonner : il dit où on en
  // est et ce qui reste à faire. (Ce que le membre a déclaré ne compte pas ici : seul parle ce que le serveur sait.)
  const guide = s && scope ? bankGuide({ ...guideFacts(s, scope, userId), declared: { application: true, activation: true } }) : null;
  const guiding = !!s && !!guide && !guide.done && (scope === "moi" || s.sessions.length === 0 || guide.current === "cle");
  // Le guide vient d'apparaître plus haut (clé personnelle enregistrée dans « Application et clé », dernier accord
  // retiré) : on l'amène sous les yeux.
  const guideBox = useRef<HTMLDivElement>(null);
  const guided = useRef<boolean | null>(null);
  const loaded = !!s;
  useEffect(() => {
    if (!loaded) return;
    if (guided.current === false && guiding) guideBox.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    guided.current = guiding;
  }, [guiding, loaded]);

  useEffect(() => {
    const outcome = takeBankOutcome();
    if (outcome === "reliee") toast.success(t("Banque reliée. La première lecture est en cours."));
    else if (outcome) toast.error(t("La liaison avec la banque n'a pas abouti. Relance-la et valide sans attendre."));
  }, []);

  async function run(fn: () => Promise<State | void>, done?: string) {
    setBusy(true);
    try {
      const next = await fn();
      if (next) qc.setQueryData(BANK_STATE_KEY, next);
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

  const memberName = (id: number) => members.find((m) => m.id === id)?.name ?? t("un membre");
  const cards = new Map<string, CardNote>(s.cards.map((c) => [c.accountId, { count: c.outstanding.count, debitDate: c.outstanding.debitDate }]));
  const connect = (aspsp: string, where: string) => run(async () => void (window.location.href = (await api<{ url: string }>("/bank/enable-banking/connect", { method: "POST", json: { aspsp, country: where } })).url));

  // Pas encore configuré : l'administrateur crée l'application du foyer, pas à pas. (Une clé du foyer devenue
  // illisible : l'administrateur garde l'écran complet, où le guide lui fait redonner la clé ; un autre membre ne
  // peut rien y faire, il est renvoyé à l'administrateur comme avant.)
  if (!s.configured && !s.own && !(s.keyUnreadable && s.admin))
    return (
      <Part>
        <p className="text-sm">{INTRO()}</p>
        {s.admin ? (
          <div className="mt-4">
            <BankGuide scope="foyer" />
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">{t("Pas encore configuré : l'administrateur du foyer doit d'abord enregistrer la clé de l'application.")}</p>
            <button type="button" className={cn(quietButton, "-mx-2.5 mt-2 inline-flex items-center gap-1")} aria-expanded={ownForm} onClick={() => setOwnForm((v) => !v)}>
              <ChevronRight size={15} className={cn("transition-transform", ownForm && "rotate-90")} /> {t("J'ai des comptes à mon seul nom")}
            </button>
            {ownForm && (
              <>
                <p className="mb-4 mt-1 text-xs text-muted">{OWN_HINT()}</p>
                <BankGuide scope="moi" />
              </>
            )}
          </>
        )}
      </Part>
    );

  // Quand le guide est affiché, c'est lui qui dit ce qui manque à l'application qu'il suit.
  const warnings = [
    guiding && scope === "foyer" ? null : s.error,
    s.application && !s.application.active && !(guiding && scope === "foyer") ? t("L'application n'est pas encore active : relie d'abord tes comptes dans la console d'Enable Banking (« Activate by linking accounts »).") : null,
    s.application && !s.application.redirectOk && !(guiding && scope === "foyer") ? `${t("L'adresse de retour n'est pas déclarée chez Enable Banking :")} ${s.redirectUrl}` : null,
    s.keyUnreadable && s.admin && !(guiding && scope === "foyer") ? t("La clé enregistrée n'est plus lisible (le secret du serveur a changé) : saisis-la de nouveau.") : null,
    s.own && (s.own.error || s.own.keyUnreadable) && !(guiding && scope === "moi") ? (s.own.error ?? t("La clé enregistrée n'est plus lisible (le secret du serveur a changé) : saisis-la de nouveau.")) : null,
  ].filter((w): w is string => !!w);

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

      {guiding && scope ? (
        <Part title={t("Relier une banque")}>
          <div ref={guideBox} className="scroll-mt-24 pt-2">
            <BankGuide scope={scope} />
          </div>
        </Part>
      ) : (
        usable &&
        (s.sessions.length === 0 ? (
          <Part title={t("Relier une banque")}>
            <BankLinkForm />
          </Part>
        ) : (
          <Part>
            <button type="button" className={cn(quietButton, "-mx-2.5 inline-flex items-center gap-1")} aria-expanded={linking} onClick={() => setLinking((v) => !v)}>
              <ChevronRight size={15} className={cn("transition-transform", linking && "rotate-90")} /> {t("Relier une autre banque")}
            </button>
            {linking && (
              <div className="mt-3">
                <BankLinkForm />
              </div>
            )}
          </Part>
        ))
      )}

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
                      <p className="mb-4 mt-1 text-xs text-muted">{OWN_HINT()}</p>
                      <BankGuide scope="moi" />
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
