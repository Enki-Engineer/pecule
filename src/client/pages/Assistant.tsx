import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUp, AudioLines, Check, ChevronLeft, Clock, FileText, History, Paperclip, Plus, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api, apiStream, invalidateDocuments, invalidateInvoices, uploadToInbox } from "../api.ts";
import { PageHeader } from "../components/ui.tsx";
import { cn } from "../cn.ts";
import { screenName, useCurrentEntity } from "../assistantContext.ts";
import { Markdown } from "../components/Markdown.tsx";
import type { ChatChartSpec } from "../components/ChatChart.tsx";
import { dateFr } from "../format.ts";
import { VoiceSession, voiceSupported } from "../voice.ts";
import { VoiceMode } from "../components/VoiceMode.tsx";
import { SpeechStream, spokenDecision, spokenFarewell } from "../../lib/voice.ts";
import { locale, t } from "../../lib/i18n.ts";

const ChatChart = lazy(() => import("../components/ChatChart.tsx"));

type Item = {
  role: "user" | "assistant" | "action";
  text: string;
  details?: string[];
  status?: "done" | "declined" | "error" | "expired";
  attachments?: { id: number; name: string; type?: "invoice" | "document" }[];
  context?: string;
  cost?: number;
  charts?: ChatChartSpec[];
};
type ThreadSummary = { id: string; title: string; messages: number; createdAt: string; updatedAt: string; cost: number };
type ThreadState = { threadId: string; display: Item[]; pending: { id: string | null; label: string; details: string[] }[] | null; cost?: number };

const STORAGE = "pecule.assistant.thread";
const MAX_FILES = 3;
type Suggestion = { label: string; text: string; send?: boolean };

/** Questions : envoyées telles quelles. */
const QUESTIONS: Suggestion[] = [
  { label: t("Combien ai-je dépensé ce mois-ci, et où ?"), text: t("Combien ai-je dépensé ce mois-ci, et où ?"), send: true },
  { label: t("Où puis-je faire des économies ?"), text: t("Quelles dépenses devrais-je baisser pour faire des économies ?"), send: true },
  { label: t("Qu'est-ce qui m'attend ces prochaines semaines ?"), text: t("Qu'est-ce qui m'attend ces prochaines semaines ?"), send: true },
  { label: t("Comment évolue mon patrimoine ?"), text: t("Comment évolue mon patrimoine ?"), send: true },
];

/** Actions : la phrase est pré-remplie, l'utilisateur la complète (valeur, nom…) avant d'envoyer. */
const ACTIONS: Suggestion[] = [
  { label: t("Classer mes opérations à classer"), text: t("Classe mes opérations à classer"), send: true },
  { label: t("Mettre à jour la valeur d'un bien"), text: t("Mets à jour la valeur estimée de ") },
  { label: t("Modifier mon bonus de cette année"), text: t("Modifie mon bonus de cette année : ") },
  { label: t("Renommer ou déplacer une catégorie"), text: t("Renomme la catégorie ") },
  { label: t("Créer une catégorie"), text: t("Crée une catégorie ") },
  { label: t("Ajouter un engagement au budget"), text: t("Ajoute au budget ") },
  { label: t("Mettre à jour un placement"), text: t("Mets à jour la valeur de mon ") },
  { label: t("Me rappeler une échéance"), text: t("Rappelle-moi de ") },
  { label: t("Retenir une information"), text: t("Souviens-toi que ") },
];

/** Actions liées à l'écran ouvert (panneau ordinateur) ou à l'élément affiché. */
function contextualActions(path: string, entity: { type: string; label: string } | null): Suggestion[] {
  if (entity?.type === "operation") return [{ label: t("Classer cette opération"), text: t("Classe cette opération dans ") }, { label: t("Noter cette opération"), text: t("Ajoute une note à cette opération : ") }];
  if (entity?.type === "facture") return [{ label: t("Relier cette facture"), text: t("Relie cette facture à son paiement"), send: true }, { label: t("Corriger cette facture"), text: t("Corrige cette facture : ") }];
  if (/^\/immobilier\/./.test(path) || entity?.type === "bien")
    return [{ label: t("Mettre à jour la valeur de ce bien"), text: t("Mets à jour la valeur estimée de ce bien : ") }, { label: t("Modifier le loyer"), text: t("Change le loyer de ce bien : ") }];
  if (path.startsWith("/budget")) return [{ label: t("Ajouter un engagement"), text: t("Ajoute au budget ") }, { label: t("Modifier mon bonus de l'année"), text: t("Modifie mon bonus de cette année : ") }];
  if (path.startsWith("/revenus")) return [{ label: t("Modifier mon bonus de l'année"), text: t("Modifie mon bonus de cette année : ") }, { label: t("Mettre à jour mon salaire"), text: t("Mets à jour mon salaire net : ") }];
  if (path.startsWith("/patrimoine/crypto")) return [{ label: t("Corriger une position"), text: t("Corrige ma position ") }];
  if (path.startsWith("/patrimoine") || path.startsWith("/immobilier")) return [{ label: t("Mettre à jour un placement"), text: t("Mets à jour la valeur de mon ") }, { label: t("Mettre à jour la valeur d'un bien"), text: t("Mets à jour la valeur estimée de ") }];
  if (path.startsWith("/operations") || path.startsWith("/mois")) return [{ label: t("Classer mes opérations à classer"), text: t("Classe mes opérations à classer"), send: true }, { label: t("Renommer une catégorie"), text: t("Renomme la catégorie ") }];
  if (path.startsWith("/echeancier")) return [{ label: t("Ajouter un rappel"), text: t("Rappelle-moi de ") }];
  return [];
}
const euro = (n: number) => (n < 0.01 ? "< 0,01 €" : new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", maximumFractionDigits: n < 1 ? 3 : 2 }).format(n));

const RichText = ({ text }: { text: string }) => <Markdown text={text} />;

export { askAssistant, openThread } from "../assistantBus.ts";

export function Assistant() {
  const [params] = useSearchParams();
  return <AssistantChat variant="page" prefill={params.get("q") ?? undefined} />;
}

/** Conversation avec l'assistant : page (iPhone) ou panneau latéral (ordinateur). */
export function AssistantChat({ variant, prefill, onClose }: { variant: "page" | "panel"; prefill?: string; onClose?: () => void }) {
  const qc = useQueryClient();
  const location = useLocation();
  const entity = useCurrentEntity();
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [text, setText] = useState(prefill ?? "");
  useEffect(() => {
    if (prefill) setText(prefill);
  }, [prefill]);
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dropping, setDropping] = useState(false);
  // Contexte écarté par l'utilisateur (croix sur la pastille) : jusqu'au prochain élément ouvert.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [history, setHistory] = useState<ThreadSummary[] | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const panel = variant === "panel";
  const entityKey = entity ? `${entity.type}:${entity.id}` : null;
  const activeEntity = panel && entity && dismissed !== entityKey ? entity : null;

  useEffect(() => {
    const load = () => {
      const id = localStorage.getItem(STORAGE);
      if (id) api<ThreadState>(`/assistant/threads/${id}`).then(setThread).catch(() => localStorage.removeItem(STORAGE));
    };
    load();
    window.addEventListener("pecule-thread", load);
    return () => {
      window.removeEventListener("pecule-thread", load);
    };
  }, []);
  useEffect(() => {
    // Ne rien renvoyer : scrollIntoView renvoie une promesse dans les navigateurs récents.
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread, busy, stream, step]);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const ok = [...list].filter((f) => f.type === "application/pdf" || f.type.startsWith("image/") || /\.(pdf|hei[cf])$/i.test(f.name));
    if (ok.length < [...list].length) toast.error(t("Formats acceptés : PDF ou photo"));
    setFiles((cur) => [...cur, ...ok].slice(0, MAX_FILES));
  }

  /** `onText` : chaque fragment de la réponse, au fil de son écriture (mode vocal : il est dit sans attendre la fin). */
  async function call(path: string, body: Record<string, unknown>, onText?: (delta: string) => void) {
    setStream("");
    setStep(null);
    try {
      const r = await apiStream<ThreadState>(path, body, {
        onText: (t) => {
          setStep(null);
          setStream((s) => s + t);
          onText?.(t);
        },
        onStep: setStep,
      });
      setThread(r);
      localStorage.setItem(STORAGE, r.threadId);
      // Une action a pu modifier des données : on rafraîchit les écrans.
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("L'assistant ne répond pas"));
      return null;
    } finally {
      setStream("");
      setStep(null);
    }
  }

  async function send(value = text) {
    const staged = files;
    const v = value.trim() || (staged.length ? (staged.length > 1 ? t("Voici des documents.") : t("Voici un document.")) : "");
    if (!v || busy) return;
    setBusy(true);
    setText("");
    setFiles([]);
    const before = thread;
    setThread((t) => ({
      threadId: t?.threadId ?? "",
      display: [
        ...(t?.display ?? []),
        { role: "user", text: v, attachments: staged.map((f, i) => ({ id: -1 - i, name: f.name })), context: activeEntity?.label },
      ],
      pending: null,
      cost: t?.cost,
    }));
    try {
      // Les fichiers sont d'abord enregistrés comme factures (lues par Claude), puis confiés à l'assistant.
      // Claude reconnaît chaque fichier : facture → Factures, tout le reste → coffre de documents.
      const invoiceIds: number[] = [];
      const documentIds: number[] = [];
      for (const f of staged) {
        setStep(t("Lecture et rangement de « {nom} »…", { nom: f.name }));
        const r = await uploadToInbox(f);
        (r.type === "invoice" ? invoiceIds : documentIds).push(r.id);
      }
      if (staged.length) void Promise.all([invalidateInvoices(qc), invalidateDocuments(qc)]);
      const context = panel
        ? { path: location.pathname + location.search, screen: screenName(location.pathname), entity: activeEntity ?? undefined }
        : undefined;
      const ok = await call("/assistant/message", {
        threadId: thread?.threadId || undefined,
        text: v,
        invoiceIds: invoiceIds.length ? invoiceIds : undefined,
        documentIds: documentIds.length ? documentIds : undefined,
        context,
      });
      if (!ok) {
        // Les factures jointes restent enregistrées (écran Factures) ; on rend la main pour réessayer.
        setThread(before);
        setText(value);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Envoi impossible"));
      setThread(before);
      setText(value);
      setFiles(staged);
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  async function confirm(approve: boolean) {
    if (!thread || busy) return;
    setBusy(true);
    try {
      await call("/assistant/confirm", { threadId: thread.threadId, approve, actionIds: thread.pending?.map((p) => p.id) });
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Mode vocal (conversation mains libres) ---------- */
  // L'IA est facultative : sans fournisseur réglé, l'écran le dit d'emblée plutôt que d'échouer à l'envoi.
  const aiStatus = useQuery({ queryKey: ["assistant-status"], queryFn: () => api<{ enabled: boolean }>("/assistant/status"), staleTime: 60_000 });
  const voiceStatus = useQuery({ queryKey: ["voice-status"], queryFn: () => api<{ enabled: boolean }>("/voice/status"), staleTime: Infinity });
  const canTalk = voiceStatus.data?.enabled === true && voiceSupported();
  const [voice, setVoice] = useState<VoiceSession | null>(null);
  // Le tour de parole est appelé depuis la session vocale : il lit le fil courant par une référence.
  const live = useRef<{ thread: ThreadState | null; busy: boolean }>({ thread, busy });
  useEffect(() => {
    live.current = { thread, busy };
  }, [thread, busy]);
  const voiceRef = useRef<VoiceSession | null>(null);
  useEffect(
    () => () => {
      voiceRef.current?.stop();
    },
    [],
  );

  /** Ouvre le micro dans le geste (exigé par l'iPhone), puis affiche l'écran du mode vocal. */
  function startVoice() {
    const session = new VoiceSession();
    voiceRef.current = session;
    void session.start();
    setVoice(session);
  }
  function stopVoice() {
    voiceRef.current?.stop();
    voiceRef.current = null;
    setVoice(null);
  }

  /**
   * Un tour de parole : la phrase dictée part à l'assistant (ou vaut « confirme » / « annule » quand une action attend,
   * ou « au revoir » qui termine). La réponse est dite au fil de son écriture (`say`) ; la valeur rendue est dite à la suite.
   */
  async function voiceTurn(spoken: string, say: (part: string) => void): Promise<string | null> {
    const cur = live.current;
    if (cur.busy) return null;
    const decision = cur.thread?.pending?.length ? spokenDecision(spoken) : null;
    if (decision === null && spokenFarewell(spoken)) {
      // La session se ferme (son de fin) : ce tour de parole s'arrête là.
      stopVoice();
      return null;
    }
    setBusy(true);
    try {
      const speech = new SpeechStream();
      const onText = (delta: string) => speech.push(delta).forEach(say);
      let r: ThreadState | null;
      if (decision !== null && cur.thread) {
        r = await call("/assistant/confirm", { threadId: cur.thread.threadId, approve: decision, actionIds: cur.thread.pending?.map((p) => p.id) }, onText);
      } else {
        setThread((t) => ({ threadId: t?.threadId ?? "", display: [...(t?.display ?? []), { role: "user", text: spoken }], pending: null, cost: t?.cost }));
        const context = panel ? { path: location.pathname + location.search, screen: screenName(location.pathname), entity: activeEntity ?? undefined } : undefined;
        r = await call("/assistant/message", { threadId: cur.thread?.threadId || undefined, text: spoken, voice: true, context }, onText);
        if (!r) setThread(cur.thread);
      }
      if (!r) return speech.spoke ? t("Je n'ai pas pu terminer ma réponse.") : t("Je n'ai pas pu répondre. Réessaie dans un instant.");
      speech.flush().forEach(say);
      // Réponse reçue d'un bloc (sans flux) : on dit le texte de la conversation.
      if (!speech.spoke) {
        speech.push([...r.display].reverse().find((i) => i.role === "assistant")?.text ?? "");
        speech.flush().forEach(say);
      }
      if (r.pending?.length) return `${speech.spoke ? "" : `${t("Je te propose ceci : {actions}.", { actions: r.pending.map((p) => p.label).join(" ; ") })} `}${t("Dis « confirme » ou « annule ».")}`;
      return speech.spoke ? null : t("C'est fait.");
    } finally {
      setBusy(false);
    }
  }

  /** Suggestion : envoyée directement, ou pré-remplie à compléter (curseur en fin de phrase). */
  function suggest(sg: Suggestion) {
    if (sg.send) return void send(sg.text);
    setText(sg.text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(sg.text.length, sg.text.length);
    });
  }

  function reset() {
    localStorage.removeItem(STORAGE);
    setThread(null);
    setHistory(null);
  }

  async function openHistory() {
    if (history) return setHistory(null);
    try {
      setHistory((await api<{ threads: ThreadSummary[] }>("/assistant/threads?limit=50")).threads);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Historique indisponible"));
    }
  }

  async function openThread(id: string) {
    try {
      const t = await api<ThreadState>(`/assistant/threads/${id}`);
      setThread(t);
      localStorage.setItem(STORAGE, id);
      setHistory(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Conversation introuvable"));
    }
  }

  const items = thread?.display ?? [];

  return (
    <div
      className={cn("relative flex flex-col", panel ? "h-full" : "min-h-[calc(100dvh-8rem)]")}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-semibold text-accent">
          {t("Déposer le fichier ici")}
        </div>
      )}
      {voice && <VoiceMode session={voice} onTurn={voiceTurn} onClose={stopVoice} hint={step} fixed={!panel} />}
      {panel ? (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles size={18} className="text-accent" /> Assistant
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={openHistory} aria-pressed={!!history} title={t("Conversations précédentes")} className={cn("press grid size-8 place-items-center rounded-lg text-muted hover:bg-line/50", history && "bg-accent-soft text-accent")}>
              <History size={16} />
            </button>
            {(items.length > 0 || history) && (
              <button type="button" onClick={reset} className="press rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft">
                {t("Nouvelle")}
              </button>
            )}
            {onClose && (
              <button type="button" onClick={onClose} aria-label={t("Fermer l'assistant")} title={t("Fermer (⌘J)")} className="press grid size-8 place-items-center rounded-lg text-muted hover:bg-line/50">
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <PageHeader
          title={t("Assistant")}
          subtitle={t("Questions, factures et actions sur tes comptes")}
          right={
            <div className="flex items-center gap-2">
              <button type="button" onClick={openHistory} aria-pressed={!!history} className={cn("press card flex items-center gap-1 px-3 py-2 text-sm font-medium", history ? "text-accent" : "text-muted")}>
                <History size={16} /> Historique
              </button>
              {(items.length > 0 || history) && (
                <button type="button" onClick={reset} className="press card flex items-center gap-1 px-3 py-2 text-sm font-medium text-accent">
                  <Plus size={16} /> Nouvelle
                </button>
              )}
            </div>
          }
        />
      )}

      {/* En page sur ordinateur : la conversation reste dans une colonne de lecture, centrée. */}
      <div className={cn("flex-1 space-y-3 pb-4", panel ? "overflow-y-auto px-4 pt-4" : "md:mx-auto md:w-full md:max-w-[860px]")}>
        {aiStatus.data?.enabled === false && (
          <div className="card p-4 text-sm">
            <p className="font-medium">{t("L'assistant n'est pas branché")}</p>
            <p className="mt-1 text-muted">{t("Pécule fonctionne sans IA : seules la lecture automatique des factures et des documents et les réponses à tes questions en dépendent. Pour les activer, ajoute la clé de ton fournisseur d'IA.")}</p>
            <Link to="/reglages/assistant" className="mt-2 inline-block font-medium text-accent">
              {t("Réglages → Assistant")}
            </Link>
          </div>
        )}
        {history && (
          <div className="space-y-2">
            <button type="button" onClick={() => setHistory(null)} className="flex items-center gap-1 text-sm font-medium text-accent">
              <ChevronLeft size={16} /> Retour à la conversation
            </button>
            {history.length === 0 && <p className="px-1 text-sm text-muted">{t("Aucune conversation enregistrée.")}</p>}
            <div className="card divide-y divide-line">
              {history.map((h) => (
                <button key={h.id} type="button" onClick={() => openThread(h.id)} className={cn("press block w-full px-4 py-3 text-left hover:bg-bg", h.id === thread?.threadId && "bg-accent-soft")}>
                  <div className="line-clamp-2 text-[14px] font-medium">{h.title}</div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {dateFr(h.updatedAt.slice(0, 10))} · {h.messages} message{h.messages > 1 ? "s" : ""}
                    {h.cost > 0 && ` · ${euro(h.cost)}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!history && items.length === 0 && !busy && (
          <div className="space-y-2 pt-6">
            <div className="mb-4 flex flex-col items-center text-center text-muted">
              <Sparkles size={28} className="mb-2 text-accent" />
              <p className="max-w-xs text-sm">
                {t("Pose une question sur tes dépenses, tes comptes, ton patrimoine ou tes crédits, joins une facture ou un document (trombone) pour le ranger, ou demande une action. Chaque action t'est soumise avant d'être faite.")}
              </p>
            </div>
            <div className="px-1 pt-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{t("Questions")}</div>
            {QUESTIONS.map((sg) => (
              <button key={sg.label} type="button" onClick={() => suggest(sg)} className="press card block w-full px-4 py-3 text-left text-[15px] md:py-2.5 md:text-[14px]">
                {sg.label}
              </button>
            ))}
            <div className="px-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-muted">{t("Actions")}</div>
            <div className="flex flex-wrap gap-2">
              {[...contextualActions(location.pathname, activeEntity), ...ACTIONS]
                .filter((sg, i, all) => all.findIndex((x) => x.label === sg.label) === i)
                .map((sg) => (
                  <button key={sg.label} type="button" onClick={() => suggest(sg)} className="press rounded-full bg-card px-3.5 py-2 text-[14px] text-accent ring-1 ring-line md:py-1.5 md:text-[13px]">
                    {sg.label}
                  </button>
                ))}
            </div>
            <p className="px-1 pt-1 text-[12px] text-muted">{t("Une action pré-remplit la demande : complète-la (valeur, nom…) puis envoie. Rien n'est modifié sans ta confirmation.")}</p>
          </div>
        )}

        {!history && items.map((m, i) =>
          m.role === "action" ? (
            <div
              key={i}
              className={clsx("card mx-2 px-4 py-3 text-sm", m.status === "done" ? "text-pos" : m.status === "error" ? "text-neg" : "text-muted")}
            >
              <div className="flex items-center gap-2 font-medium">
                {m.status === "done" ? <Check size={16} className="shrink-0" /> : m.status === "error" ? <AlertTriangle size={16} className="shrink-0" /> : m.status === "expired" ? <Clock size={16} className="shrink-0" /> : <X size={16} className="shrink-0" />}
                <span>
                  {m.text}
                  {m.status === "declined" && t(" — annulé")}
                  {m.status === "expired" && t(" — expirée, rien n'a été fait")}
                </span>
              </div>
              {m.details && m.details.some((d) => d.startsWith("Note")) && <div className="mt-1 pl-6 text-[12px] text-muted">{m.details.find((d) => d.startsWith("Note"))}</div>}
            </div>
          ) : m.role === "user" ? (
            <div key={i} className="flex flex-col items-end gap-1">
              {m.context && <div className="max-w-[85%] truncate px-2 text-xs text-muted">À propos de : {m.context}</div>}
              <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-white">{m.text}</div>
              {m.attachments?.map((a) =>
                a.id > 0 ? (
                  <Link key={a.id} to={a.type === "document" ? `/documents?id=${a.id}` : `/factures?id=${a.id}`} className="press card flex max-w-[85%] items-center gap-2 px-3 py-2 text-sm font-medium text-accent">
                    <FileText size={16} /> <span className="truncate">{a.name}</span>
                  </Link>
                ) : (
                  <div key={a.id} className="card flex max-w-[85%] items-center gap-2 px-3 py-2 text-sm text-muted">
                    <FileText size={16} /> <span className="truncate">{a.name}</span>
                  </div>
                ),
              )}
            </div>
          ) : m.text || m.charts?.length ? (
            <div key={i} className="flex flex-col items-start gap-2">
              {m.text && (
                <div className="card w-full rounded-3xl rounded-bl-lg px-4 py-3 text-[15px] leading-relaxed md:rounded-xl md:text-[14px]">
                  <RichText text={m.text} />
                </div>
              )}
              {m.charts?.map((c, j) => (
                <Suspense key={j} fallback={<div className="card h-48 w-full animate-pulse" />}>
                  <ChatChart chart={c} />
                </Suspense>
              ))}
              {m.cost != null && m.cost > 0 && <div className="px-2 text-[11px] text-muted tnum" title={t("Coût de cette réponse (Foundry)")}>{euro(m.cost)}</div>}
            </div>
          ) : null,
        )}

        {busy && stream && !history && (
          <div className="flex justify-start">
            <div className="card w-full rounded-3xl rounded-bl-lg px-4 py-3 text-[15px] leading-relaxed md:rounded-xl md:text-[14px]">
              <RichText text={stream} />
            </div>
          </div>
        )}

        {thread?.pending && !busy && !history && (
          <div className="card space-y-3 border border-accent/30 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">{t("Action proposée")}</div>
            {thread.pending.map((p, i) => (
              <div key={p.id ?? i}>
                <div className="font-semibold">{p.label}</div>
                {p.details.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-sm text-muted">
                    {p.details.map((d, j) => (
                      <li key={j} className={cn("tnum", d.startsWith("Attention") && "font-medium text-neg")}>
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => confirm(true)}
                className="press flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50"
              >
                <Check size={18} /> {t("Confirmer")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => confirm(false)}
                className="press flex-1 rounded-xl bg-card py-3 font-semibold text-muted ring-1 ring-line disabled:opacity-50"
              >
                {t("Annuler")}
              </button>
            </div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 px-2 text-sm text-muted">
            <span className="size-2 animate-pulse rounded-full bg-accent" />
            <span className="size-2 animate-pulse rounded-full bg-accent [animation-delay:150ms]" />
            <span className="size-2 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
            {step && <span className="ml-1">{step}</span>}
          </div>
        )}
        {/* Marge pour que le dernier message ne passe pas sous le champ de saisie. */}
        <div ref={bottom} className={panel ? "h-2" : "h-20"} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className={cn(panel ? "border-t border-line p-3" : "sticky bottom-24 z-30 md:bottom-4 md:mx-auto md:w-full md:max-w-[860px]")}
      >
        {items.length > 0 && !busy && !text && !files.length && !history && contextualActions(location.pathname, activeEntity).length > 0 && (
          <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {contextualActions(location.pathname, activeEntity).map((sg) => (
              <button key={sg.label} type="button" onClick={() => suggest(sg)} className="press shrink-0 rounded-full bg-card px-3 py-1.5 text-[13px] text-accent ring-1 ring-line">
                {sg.label}
              </button>
            ))}
          </div>
        )}
        {(activeEntity || files.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {activeEntity && (
              <span className="flex max-w-full items-center gap-1 rounded-full bg-accent-soft py-1 pl-3 pr-1 text-xs font-medium text-accent">
                <span className="truncate">À propos de : {activeEntity.label}</span>
                <button type="button" onClick={() => setDismissed(entityKey)} aria-label={t("Ne pas joindre ce contexte")} className="grid size-5 place-items-center rounded-full hover:bg-accent/15">
                  <X size={12} />
                </button>
              </span>
            )}
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1 rounded-full bg-card py-1 pl-3 pr-1 text-xs font-medium ring-1 ring-line">
                <FileText size={12} className="shrink-0 text-accent" />
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={`Retirer ${f.name}`} className="grid size-5 place-items-center rounded-full text-muted hover:bg-line/60">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="card flex items-end gap-1 p-2">
          <input
            ref={picker}
            type="file"
            multiple
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={busy || files.length >= MAX_FILES}
            aria-label={t("Joindre une facture ou un document (PDF ou photo)")}
            title={t("Joindre une facture ou un document (PDF ou photo)")}
            className="press grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-line/50 disabled:opacity-40"
          >
            <Paperclip size={20} />
          </button>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            rows={1}
            placeholder={files.length ? t("Un mot (facultatif)…") : t("Écrire à l'assistant…")}
            className="max-h-32 flex-1 resize-none bg-transparent py-2 text-[16px] outline-none placeholder:text-muted"
          />
          {canTalk && !text.trim() && !files.length ? (
            <button
              type="button"
              onClick={startVoice}
              disabled={busy}
              className="press grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white disabled:opacity-40"
              aria-label={t("Parler à l'assistant (mode vocal)")}
              title={t("Parler à l'assistant (mode vocal)")}
            >
              <AudioLines size={20} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={busy || (!text.trim() && !files.length)}
              className="press grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white disabled:opacity-40"
              aria-label={t("Envoyer")}
            >
              <ArrowUp size={20} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
