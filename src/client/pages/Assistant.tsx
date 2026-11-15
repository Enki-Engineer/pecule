import { Suspense, lazy, memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUp, AudioLines, Check, ChevronDown, ChevronLeft, Clock, Copy, FileText, History, Maximize2, Minimize2, PanelLeft, Paperclip, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api, apiStream, invalidateDocuments, invalidateInvoices, uploadToInbox, useMe } from "../api.ts";
import { PageHeader } from "../components/ui.tsx";
import { cn } from "../cn.ts";
import { screenName, useCurrentEntity } from "../assistantContext.ts";
import { Markdown, calloutLabel } from "../components/Markdown.tsx";
import { AssistantHistory } from "../components/AssistantHistory.tsx";
import { ErrorBoundary } from "../components/ErrorBoundary.tsx";
import type { ChatChartSpec } from "../components/ChatChart.tsx";
import { aiCost, momentLabel } from "../format.ts";
import { useMedia } from "../useMedia.ts";
import { VoiceSession, voiceSupported } from "../voice.ts";
import { VoiceMode } from "../components/VoiceMode.tsx";
import { SpeechStream, spokenDecision, spokenFarewell } from "../../lib/voice.ts";
import { t } from "../../lib/i18n.ts";
import { plainMarkdown } from "../../lib/markdown.ts";
import "../../styles/assistant.css";

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
  /** Moment du message (ISO) ; absent des conversations anciennes. */
  at?: string;
};
type PendingAction = { id: string | null; label: string; details: string[] };
type ThreadState = { threadId: string; title?: string; pinned?: boolean; display: Item[]; pending: PendingAction[] | null; cost?: number };
type Variant = "page" | "panel" | "full";

const STORAGE = "pecule.assistant.thread";
/** Plein écran : la colonne des conversations reste ouverte ou fermée comme on l'a laissée. */
const HISTORY_KEY = "pecule.assistant.historique";
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
export { askAssistant, openThread } from "../assistantBus.ts";

export function Assistant() {
  const [params] = useSearchParams();
  const desktop = useMedia("(min-width: 768px)");
  // Sur ordinateur, /assistant est le plein écran : la coquille (Layout) l'affiche par-dessus l'appli.
  if (desktop) return null;
  return <AssistantChat variant="page" prefill={params.get("q") ?? undefined} />;
}

/* ---------- Messages ---------- */

/** Copie la réponse en texte brut (sans marques de mise en forme, liens complets). */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(plainMarkdown(text, { label: calloutLabel, origin: location.origin }));
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      toast.error(t("Copie impossible dans ce navigateur"));
    }
  }
  return (
    <button type="button" onClick={copy} className={cn("press flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-line/50 hover:text-ink", done && "text-pos")}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? t("Copié") : t("Copier")}
    </button>
  );
}

function ActionItem({ m }: { m: Item }) {
  const note = m.details?.find((d) => d.startsWith("Note"));
  return (
    <div className={clsx("card px-4 py-3 text-[0.93em]", m.status === "done" ? "text-pos" : m.status === "error" ? "text-neg" : "text-muted")}>
      <div className="flex items-center gap-2 font-medium">
        {m.status === "done" ? <Check size={16} className="shrink-0" /> : m.status === "error" ? <AlertTriangle size={16} className="shrink-0" /> : m.status === "expired" ? <Clock size={16} className="shrink-0" /> : <X size={16} className="shrink-0" />}
        <span>
          {m.text}
          {m.status === "declined" && t(" — annulé")}
          {m.status === "expired" && t(" — expirée, rien n'a été fait")}
        </span>
      </div>
      {note && <div className="mt-1 pl-6 text-[12px] text-muted">{note}</div>}
    </div>
  );
}

function UserMessage({ m }: { m: Item }) {
  return (
    <div className="flex flex-col items-end gap-1">
      {m.context && <div className="max-w-[85%] truncate px-2 text-xs text-muted">{t("À propos de : {element}", { element: m.context })}</div>}
      <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-accent px-4 py-2.5 leading-relaxed text-white">{m.text}</div>
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
  );
}

/**
 * Graphique qui ne peut pas s'afficher — le plus souvent parce qu'une nouvelle version de Pécule a été déployée
 * pendant que l'appli était ouverte : son code n'est plus sur le serveur. La réponse, elle, reste lisible.
 */
function ChartUnavailable({ title }: { title: string }) {
  return (
    <div className="card w-full p-4 text-[0.93em]">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-muted">{t("Ce graphique n'a pas pu se charger : une nouvelle version de Pécule est sans doute en ligne. Recharge la page pour l'afficher, la conversation est gardée.")}</p>
      <button type="button" onClick={() => window.location.reload()} className="press mt-2 flex items-center gap-1.5 font-medium text-accent">
        <RefreshCw size={14} /> {t("Recharger")}
      </button>
    </div>
  );
}

/** Réponse de l'assistant : le texte se lit à même la page (sans bulle), ses graphiques dessous, puis copier, heure et coût. */
function AssistantReply({ m }: { m: Item }) {
  if (!m.text && !m.charts?.length) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      {m.text && <Markdown text={m.text} className="w-full" />}
      {m.charts?.map((c, j) => (
        <ErrorBoundary key={j} fallback={<ChartUnavailable title={c.title} />}>
          <Suspense fallback={<div className="card h-48 w-full animate-pulse" />}>
            <ChatChart chart={c} />
          </Suspense>
        </ErrorBoundary>
      ))}
      <div className="-ml-1.5 flex items-center gap-1 text-[12px] text-muted">
        {m.text && <CopyButton text={m.text} />}
        {m.at && <span className="px-1 tnum">{momentLabel(m.at)}</span>}
        {m.cost != null && m.cost > 0 && (
          <span className="px-1 tnum" title={t("Coût de cette réponse (Foundry)")}>
            {aiCost(m.cost)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Les messages déjà reçus : dessinés une fois, pas à chaque fragment de la réponse qui s'écrit. */
const ChatMessages = memo(function ChatMessages({ items }: { items: Item[] }) {
  return (
    <>
      {items.map((m, i) => (m.role === "action" ? <ActionItem key={i} m={m} /> : m.role === "user" ? <UserMessage key={i} m={m} /> : <AssistantReply key={i} m={m} />))}
    </>
  );
});

function ChatWelcome({ name, wide, actions, onSuggest }: { name?: string; wide: boolean; actions: Suggestion[]; onSuggest: (sg: Suggestion) => void }) {
  return (
    <div className={cn("chat-in space-y-2", wide ? "pt-[7vh]" : "pt-4")}>
      <div className="mb-5 flex flex-col items-center text-center">
        <span className="chat-orb mb-3" aria-hidden>
          <Sparkles size={24} />
        </span>
        <p className={cn("font-semibold tracking-tight", wide ? "text-[26px]" : "text-[20px]")}>{name ? t("Bonjour {prenom}", { prenom: name }) : t("Bonjour")}</p>
        <p className="mt-1.5 max-w-md text-sm text-muted">
          {t("Pose une question sur tes dépenses, tes comptes, ton patrimoine ou tes crédits, joins une facture ou un document (trombone) pour le ranger, ou demande une action. Chaque action t'est soumise avant d'être faite.")}
        </p>
      </div>
      <div className="px-1 pt-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{t("Questions")}</div>
      <div className={cn("grid gap-2", wide && "grid-cols-2")}>
        {QUESTIONS.map((sg) => (
          <button key={sg.label} type="button" onClick={() => onSuggest(sg)} className="press card block w-full px-4 py-3 text-left text-[15px] md:py-2.5 md:text-[14px]">
            {sg.label}
          </button>
        ))}
      </div>
      <div className="px-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-muted">{t("Actions")}</div>
      <div className="flex flex-wrap gap-2">
        {actions.map((sg) => (
          <button key={sg.label} type="button" onClick={() => onSuggest(sg)} className="press rounded-full bg-card px-3.5 py-2 text-[14px] text-accent ring-1 ring-line md:py-1.5 md:text-[13px]">
            {sg.label}
          </button>
        ))}
      </div>
      <p className="px-1 pt-1 text-[12px] text-muted">{t("Une action pré-remplit la demande : complète-la (valeur, nom…) puis envoie. Rien n'est modifié sans ta confirmation.")}</p>
    </div>
  );
}

function PendingCard({ pending, onConfirm }: { pending: PendingAction[]; onConfirm: (approve: boolean) => void }) {
  return (
    <div className="card chat-in space-y-3 border border-accent/30 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-accent">{t("Action proposée")}</div>
      {pending.map((p, i) => (
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
        <button type="button" onClick={() => onConfirm(true)} className="press flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent py-3 font-semibold text-white">
          <Check size={18} /> {t("Confirmer")}
        </button>
        <button type="button" onClick={() => onConfirm(false)} className="press flex-1 rounded-xl bg-card py-3 font-semibold text-muted ring-1 ring-line">
          {t("Annuler")}
        </button>
      </div>
    </div>
  );
}

function HeadButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed} className={cn("press grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-line/50", pressed && "bg-accent-soft text-accent")}>
      {children}
    </button>
  );
}

/* ---------- Conversation ---------- */

/**
 * Conversation avec l'assistant, sous trois formes : page (téléphone), panneau latéral (ordinateur) et plein écran
 * (ordinateur : la colonne des conversations à gauche, la réponse dans une colonne de lecture). Le panneau et le plein
 * écran sont le même composant monté une seule fois par la coquille : passer de l'un à l'autre ne perd ni la
 * conversation ni une réponse en cours d'écriture.
 */
export function AssistantChat({
  variant,
  prefill,
  onClose,
  onExpand,
  onReduce,
}: {
  variant: Variant;
  prefill?: string;
  onClose?: () => void;
  /** Panneau → plein écran. */
  onExpand?: () => void;
  /** Plein écran → panneau (écran assez large pour le panneau). */
  onReduce?: () => void;
}) {
  const qc = useQueryClient();
  const location = useLocation();
  const entity = useCurrentEntity();
  const me = useMe();
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
  const root = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const panel = variant === "panel";
  const full = variant === "full";
  const entityKey = entity ? `${entity.type}:${entity.id}` : null;
  const activeEntity = panel && entity && dismissed !== entityKey ? entity : null;

  /* ---------- Historique ---------- */
  // Plein écran assez large : les conversations tiennent dans une colonne à gauche. Ailleurs, la liste prend la place de la conversation.
  const roomy = useMedia("(min-width: 1024px)");
  const sidebar = full && roomy;
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    setHistoryOpen(sidebar ? localStorage.getItem(HISTORY_KEY) !== "0" : false);
  }, [sidebar]);
  const listing = historyOpen && !sidebar;
  function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (sidebar) localStorage.setItem(HISTORY_KEY, next ? "1" : "0");
  }

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

  /* ---------- Défilement ---------- */
  // La conversation suit la réponse qui s'écrit tant qu'on est en bas ; dès qu'on remonte lire (molette, doigt,
  // clavier, barre de défilement), elle ne bouge plus et un bouton propose de rejoindre la suite. Elle ne se remet à
  // suivre qu'une fois revenu tout en bas. En page (téléphone), c'est la fenêtre qui défile.
  const stick = useRef(true);
  const lastTop = useRef(0);
  const [jump, setJump] = useState(false);
  const scroller = () => (variant === "page" ? document.scrollingElement : log.current);
  const toBottom = () => {
    const el = scroller();
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  };
  useEffect(() => {
    const target: HTMLElement | Window | null = variant === "page" ? window : log.current;
    if (!target) return;
    const area = () => (variant === "page" ? document.scrollingElement : log.current);
    const release = () => {
      stick.current = false;
    };
    const onScroll = () => {
      const el = area();
      if (!el) return;
      const top = el.scrollTop;
      // Revenu en bas : on suit de nouveau. Position qui remonte : c'est le lecteur (la conversation, elle, ne fait que descendre).
      if (el.scrollHeight - top - el.clientHeight < 40) stick.current = true;
      else if (top < lastTop.current - 1) stick.current = false;
      lastTop.current = top;
      if (stick.current) setJump(false);
    };
    // L'intention de remonter est connue avant que la position ne change : la réponse en cours ne ramène pas en bas entre-temps.
    const onWheel = (e: Event) => {
      if ((e as WheelEvent).deltaY < 0) release();
    };
    let touchY = 0;
    const onTouchStart = (e: Event) => {
      touchY = (e as TouchEvent).touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: Event) => {
      if (((e as TouchEvent).touches[0]?.clientY ?? 0) > touchY + 6) release();
    };
    const onKey = (e: Event) => {
      const k = e as KeyboardEvent;
      const typing = k.target instanceof HTMLTextAreaElement || k.target instanceof HTMLInputElement;
      if (k.key === "PageUp" || ((k.key === "ArrowUp" || k.key === "Home") && !typing)) release();
    };
    // Panneau ↔ plein écran : la conversation se redessine dans une autre zone, qui repart du dernier message.
    stick.current = true;
    lastTop.current = 0;
    target.addEventListener("scroll", onScroll, { passive: true });
    target.addEventListener("wheel", onWheel, { passive: true });
    target.addEventListener("touchstart", onTouchStart, { passive: true });
    target.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      target.removeEventListener("scroll", onScroll);
      target.removeEventListener("wheel", onWheel);
      target.removeEventListener("touchstart", onTouchStart);
      target.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [variant]);
  const messageCount = thread?.display.length ?? 0;
  useEffect(() => {
    // L'accueil (aucun message) se lit depuis le haut.
    if (!messageCount && !busy) return;
    if (stick.current) toBottom();
    else if (busy) setJump(true);
  }, [thread, messageCount, busy, stream, step, listing, variant]);

  // Le champ grandit avec le texte.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, full ? 240 : 128)}px`;
  }, [text, full]);

  // Plein écran : le champ est prêt à recevoir la question ; Échap revient au panneau (ou ferme).
  useEffect(() => {
    if (full) inputRef.current?.focus();
  }, [full]);
  const leave = onReduce ?? onClose;
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const voiceOn = useRef(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || voiceOn.current) return;
      // Une fenêtre ouverte par-dessus (palette de commandes) garde sa touche Échap.
      const target = e.target instanceof Node ? e.target : null;
      if (target && target !== document.body && !root.current?.contains(target)) return;
      leaveRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

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
      // Une action a pu modifier des données : on rafraîchit les écrans (et l'historique des conversations).
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
    setHistoryOpen((open) => open && sidebar);
    stick.current = true;
    setJump(false);
    const before = thread;
    setThread((t) => ({
      threadId: t?.threadId ?? "",
      title: t?.title,
      pinned: t?.pinned,
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
    stick.current = true;
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
  voiceOn.current = !!voice;
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
        setThread((t) => ({ threadId: t?.threadId ?? "", title: t?.title, pinned: t?.pinned, display: [...(t?.display ?? []), { role: "user", text: spoken }], pending: null, cost: t?.cost }));
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
    if (busy) return;
    localStorage.removeItem(STORAGE);
    setThread(null);
    setHistoryOpen((open) => open && sidebar);
    stick.current = true;
    // Sur le téléphone, le clavier ne s'ouvre pas tout seul.
    if (variant !== "page") requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function openThread(id: string) {
    if (busy) return;
    try {
      const opened = await api<ThreadState>(`/assistant/threads/${id}`);
      stick.current = true;
      setThread(opened);
      localStorage.setItem(STORAGE, id);
      setHistoryOpen((open) => open && sidebar);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Conversation introuvable"));
    }
  }

  const items = thread?.display ?? [];
  const contextual = contextualActions(location.pathname, activeEntity);
  const welcomeActions = [...contextual, ...ACTIONS].filter((sg, i, all) => all.findIndex((x) => x.label === sg.label) === i);
  const firstName = me.data?.user?.name?.trim().split(/\s+/)[0];
  const canReset = items.length > 0 || listing;

  const history = (
    <AssistantHistory
      current={thread?.threadId || undefined}
      disabled={busy}
      onOpen={(id) => void openThread(id)}
      onRemoved={(id) => {
        if (id === thread?.threadId) {
          localStorage.removeItem(STORAGE);
          setThread(null);
        }
      }}
      onRenamed={(id) => {
        if (id === thread?.threadId) void api<ThreadState>(`/assistant/threads/${id}`).then((renamed) => setThread((cur) => (cur?.threadId === id ? { ...cur, title: renamed.title } : cur)));
      }}
      className={sidebar ? "flex-1" : undefined}
    />
  );

  const conversation = (
    <>
      {aiStatus.data?.enabled === false && (
        <div className="card p-4 text-sm">
          <p className="font-medium">{t("L'assistant n'est pas branché")}</p>
          <p className="mt-1 text-muted">{t("Pécule fonctionne sans IA : seules la lecture automatique des factures et des documents et les réponses à tes questions en dépendent. Pour les activer, ajoute la clé de ton fournisseur d'IA.")}</p>
          <Link to="/reglages/assistant" className="mt-2 inline-block font-medium text-accent">
            {t("Réglages → Assistant")}
          </Link>
        </div>
      )}
      {listing ? (
        <div className="space-y-2">
          <button type="button" onClick={toggleHistory} className="flex items-center gap-1 text-sm font-medium text-accent">
            <ChevronLeft size={16} /> {t("Retour à la conversation")}
          </button>
          {history}
        </div>
      ) : (
        <>
          {items.length === 0 && !busy && <ChatWelcome name={firstName} wide={full} actions={welcomeActions} onSuggest={suggest} />}
          <ChatMessages items={items} />
          {busy && stream && <Markdown text={stream} streaming className="w-full" />}
          {thread?.pending && !busy && <PendingCard pending={thread.pending} onConfirm={(approve) => void confirm(approve)} />}
          {busy && (
            <div className="flex items-center gap-2 text-sm" role="status">
              <span className="chat-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {step && <span className="chat-status">{step}</span>}
            </div>
          )}
        </>
      )}
    </>
  );

  const composer = (
    <>
      {jump && busy && !listing && (
        <button
          type="button"
          onClick={() => {
            stick.current = true;
            setJump(false);
            toBottom();
          }}
          className="press chat-in absolute -top-11 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-card px-3 py-1.5 text-[13px] font-medium text-muted shadow-md ring-1 ring-line"
        >
          <ChevronDown size={14} /> {t("Suite de la réponse")}
        </button>
      )}
      {items.length > 0 && !busy && !text && !files.length && !listing && contextual.length > 0 && (
        <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {contextual.map((sg) => (
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
              <span className="truncate">{t("À propos de : {element}", { element: activeEntity.label })}</span>
              <button type="button" onClick={() => setDismissed(entityKey)} aria-label={t("Ne pas joindre ce contexte")} className="grid size-5 place-items-center rounded-full hover:bg-accent/15">
                <X size={12} />
              </button>
            </span>
          )}
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1 rounded-full bg-card py-1 pl-3 pr-1 text-xs font-medium ring-1 ring-line">
              <FileText size={12} className="shrink-0 text-accent" />
              <span className="truncate">{f.name}</span>
              <button type="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={t("Retirer {nom}", { nom: f.name })} className="grid size-5 place-items-center rounded-full text-muted hover:bg-line/60">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={cn("card flex items-end gap-1 p-2", full && "rounded-3xl shadow-sm")}>
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
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
          className="flex-1 resize-none bg-transparent py-2 text-[16px] outline-none placeholder:text-muted"
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
      {full && <p className="mt-1.5 text-center text-[11.5px] text-muted">{t("Entrée pour envoyer · Maj + Entrée pour aller à la ligne · Échap pour quitter le plein écran")}</p>}
    </>
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void send();
  };

  return (
    <div
      ref={root}
      className={cn("relative flex", full ? "h-full" : panel ? "h-full flex-col" : "min-h-[calc(100dvh-8rem)] flex-col")}
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

      {full ? (
        <>
          {sidebar && historyOpen && (
            <aside className="flex w-[300px] shrink-0 flex-col gap-3 border-r border-line bg-card p-3" aria-label={t("Mes conversations")}>
              <div className="flex items-center justify-between gap-2 pl-1.5">
                <h2 className="text-[15px] font-semibold">{t("Mes conversations")}</h2>
                <button type="button" onClick={reset} disabled={busy} className="press flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">
                  <Plus size={14} /> {t("Nouvelle")}
                </button>
              </div>
              {history}
              <p className="px-1.5 text-[11.5px] leading-snug text-muted">{t("Tes conversations ne sont visibles que de toi.")}</p>
            </aside>
          )}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-2 border-b border-line bg-card px-3 py-2.5">
              <HeadButton label={t("Mes conversations")} onClick={toggleHistory} pressed={historyOpen}>
                {sidebar ? <PanelLeft size={17} /> : <History size={17} />}
              </HeadButton>
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white" aria-hidden>
                <Sparkles size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[15px] font-semibold leading-tight">{(!listing && thread?.title) || t("Assistant")}</h1>
                <p className="truncate text-[12px] text-muted">{t("Questions, factures et actions sur tes comptes")}</p>
              </div>
              {canReset && !(sidebar && historyOpen) && (
                <button type="button" onClick={reset} disabled={busy} className="press flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft disabled:opacity-50">
                  <Plus size={15} /> {t("Nouvelle")}
                </button>
              )}
              {onReduce && (
                <HeadButton label={t("Réduire en panneau")} onClick={onReduce}>
                  <Minimize2 size={16} />
                </HeadButton>
              )}
              {onClose && (
                <HeadButton label={t("Fermer l'assistant")} onClick={onClose}>
                  <X size={18} />
                </HeadButton>
              )}
            </header>
            <div ref={log} className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[800px] space-y-5 px-6 py-6 text-[15.5px]">{conversation}</div>
            </div>
            <form onSubmit={submit} className="relative mx-auto w-full max-w-[800px] px-6 pb-3">
              {composer}
            </form>
          </div>
        </>
      ) : panel ? (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 font-semibold">
              <Sparkles size={18} className="shrink-0 text-accent" /> <span className="truncate">{t("Assistant")}</span>
            </div>
            <div className="flex items-center gap-1">
              <HeadButton label={t("Mes conversations")} onClick={toggleHistory} pressed={historyOpen}>
                <History size={16} />
              </HeadButton>
              {canReset && (
                <button type="button" onClick={reset} disabled={busy} className="press rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft disabled:opacity-50">
                  {t("Nouvelle")}
                </button>
              )}
              {onExpand && (
                <HeadButton label={t("Plein écran (⌘⇧J)")} onClick={onExpand}>
                  <Maximize2 size={15} />
                </HeadButton>
              )}
              {onClose && (
                <HeadButton label={t("Fermer (⌘J)")} onClick={onClose}>
                  <X size={18} />
                </HeadButton>
              )}
            </div>
          </div>
          <div ref={log} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[14px]">
            {conversation}
          </div>
          <form onSubmit={submit} className="relative border-t border-line p-3">
            {composer}
          </form>
        </>
      ) : (
        <>
          <PageHeader
            title={t("Assistant")}
            subtitle={t("Questions, factures et actions sur tes comptes")}
            right={
              <div className="flex items-center gap-2">
                <button type="button" onClick={toggleHistory} aria-pressed={historyOpen} className={cn("press card flex items-center gap-1 px-3 py-2 text-sm font-medium", historyOpen ? "text-accent" : "text-muted")}>
                  <History size={16} /> {t("Historique")}
                </button>
                {canReset && (
                  <button type="button" onClick={reset} disabled={busy} className="press card flex items-center gap-1 px-3 py-2 text-sm font-medium text-accent disabled:opacity-50">
                    <Plus size={16} /> {t("Nouvelle")}
                  </button>
                )}
              </div>
            }
          />
          <div className="flex-1 space-y-4 pb-4 text-[15px]">
            {conversation}
            {/* Marge pour que le dernier message ne passe pas sous le champ de saisie. */}
            <div className="h-20" />
          </div>
          <form onSubmit={submit} className="sticky bottom-24 z-30">
            {composer}
          </form>
        </>
      )}
    </div>
  );
}
