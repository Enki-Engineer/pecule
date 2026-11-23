import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Search, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { cn } from "../cn.ts";
import { aiCost, momentLabel } from "../format.ts";
import { groupHistory, type HistoryGroup } from "../../lib/chat-history.ts";
import { t, tk, tn } from "../../lib/i18n.ts";
import "../../styles/assistant.css";

/*
 * Historique des conversations de l'assistant : recherche (titres et texte des messages), rangement par ancienneté,
 * épinglées en tête ; chaque conversation se rouvre, se renomme, s'épingle ou se supprime. Sert de colonne en plein
 * écran et de liste à la place de la conversation ailleurs (panneau, téléphone).
 */

export type ThreadSummary = { id: string; title: string; pinned: boolean; messages: number; createdAt: string; updatedAt: string; cost: number };

const GROUPS: Record<HistoryGroup, string> = {
  pinned: tk("Épinglées"),
  today: tk("Aujourd'hui"),
  yesterday: tk("Hier"),
  week: tk("Cette semaine"),
  month: tk("Ce mois-ci"),
  older: tk("Plus ancien"),
};

const actionButton = "press grid size-7 place-items-center rounded-md text-muted hover:bg-line/60 hover:text-ink";

function HistoryRow({
  thread,
  current,
  disabled,
  onOpen,
  onPatch,
  onRemove,
}: {
  thread: ThreadSummary;
  current: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onPatch: (patch: { title?: string; pinned?: boolean }) => Promise<void>;
  onRemove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  // Échap rend le titre d'origine : la perte du focus qui suit ne doit pas l'enregistrer.
  const cancelled = useRef(false);

  if (renaming)
    return (
      <input
        autoFocus
        value={title}
        maxLength={160}
        aria-label={t("Nouveau titre")}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            // La touche ne doit pas aussi fermer le plein écran.
            e.preventDefault();
            e.stopPropagation();
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          setRenaming(false);
          if (!cancelled.current && title.trim() !== thread.title) void onPatch({ title: title.trim() });
          cancelled.current = false;
        }}
        className="w-full rounded-lg bg-card px-2.5 py-2 text-[13.5px] outline-none ring-2 ring-accent"
      />
    );

  return (
    <div className={cn("chat-history-row group relative rounded-lg", current ? "bg-accent-soft" : "hover:bg-line/40")}>
      <button type="button" disabled={disabled} onClick={onOpen} aria-current={current ? "true" : undefined} className="chat-history-open block w-full rounded-lg px-2.5 py-2 text-left disabled:opacity-60">
        <span className={cn("line-clamp-2 text-[13.5px] font-medium leading-snug", current && "text-accent")}>
          {thread.pinned && <Star size={11} className="mr-1 inline -translate-y-px fill-current text-accent" aria-label={t("Épinglée")} />}
          {thread.title}
        </span>
        <span className="mt-0.5 block text-[11.5px] text-muted tnum">
          {momentLabel(thread.updatedAt)} · {tn("{n} question", "{n} questions", thread.messages, { n: thread.messages })}
          {thread.cost > 0 && ` · ${aiCost(thread.cost)}`}
        </span>
      </button>
      <span className={cn("chat-history-actions absolute right-1 top-1 flex rounded-md", current ? "bg-accent-soft" : "bg-card shadow-sm ring-1 ring-line")}>
        <button type="button" className={cn(actionButton, thread.pinned && "text-accent")} title={thread.pinned ? t("Désépingler") : t("Épingler en tête")} aria-label={thread.pinned ? t("Désépingler") : t("Épingler en tête")} aria-pressed={thread.pinned} onClick={() => void onPatch({ pinned: !thread.pinned })}>
          <Star size={14} className={cn(thread.pinned && "fill-current")} />
        </button>
        <button
          type="button"
          className={actionButton}
          title={t("Renommer")}
          aria-label={t("Renommer")}
          onClick={() => {
            setTitle(thread.title);
            setRenaming(true);
          }}
        >
          <Pencil size={14} />
        </button>
        {/* La conversation en fichier texte, fabriquée par le serveur dans la langue du membre. */}
        <a className={actionButton} href={`/api/assistant/threads/${thread.id}/export`} download title={t("Exporter en texte")} aria-label={t("Exporter en texte")}>
          <Download size={14} />
        </a>
        <button type="button" className={cn(actionButton, "hover:text-neg")} title={t("Supprimer")} aria-label={t("Supprimer")} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

export function AssistantHistory({
  current,
  disabled,
  onOpen,
  onRemoved,
  onRenamed,
  className,
}: {
  /** Conversation ouverte (mise en avant dans la liste). */
  current?: string;
  /** Une réponse s'écrit : on ne change pas de conversation. */
  disabled?: boolean;
  onOpen: (id: string) => void;
  onRemoved: (id: string) => void;
  onRenamed: (id: string) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  // La recherche part quand la frappe s'arrête.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setTerm(search.trim()), 250);
    return () => {
      clearTimeout(id);
    };
  }, [search]);
  const list = useQuery({
    queryKey: ["assistant-threads", term],
    queryFn: () => api<{ threads: ThreadSummary[] }>(`/assistant/threads?limit=100${term ? `&q=${encodeURIComponent(term)}` : ""}`),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
  const threads = list.data?.threads ?? [];

  async function patch(thread: ThreadSummary, body: { title?: string; pinned?: boolean }) {
    try {
      await api(`/assistant/threads/${thread.id}`, { method: "PATCH", json: body });
      await qc.invalidateQueries({ queryKey: ["assistant-threads"] });
      if (body.title !== undefined) onRenamed(thread.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Modification impossible"));
    }
  }

  async function remove(thread: ThreadSummary) {
    // La conversation ouverte ne se supprime pas pendant qu'une réponse s'y écrit (elle serait recréée à la fin).
    if (disabled && thread.id === current) return void toast.error(t("Attends la fin de la réponse pour supprimer cette conversation."));
    if (!confirm(t("Supprimer la conversation « {titre} » ? Elle ne pourra pas être retrouvée.", { titre: thread.title }))) return;
    try {
      await api(`/assistant/threads/${thread.id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["assistant-threads"] });
      onRemoved(thread.id);
      toast.success(t("Conversation supprimée"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Suppression impossible"));
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <label className="focus-frame flex items-center gap-2 rounded-lg bg-card px-2.5 py-2 ring-1 ring-line">
        <Search size={14} className="shrink-0 text-muted" />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Rechercher…")} aria-label={t("Rechercher dans mes conversations…")} autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted" />
      </label>
      <div className={cn("-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 pb-2 transition-opacity", list.isPlaceholderData && "opacity-60")}>
        {list.isPending && <div className="skeleton h-14 rounded-lg" />}
        {list.isError && <p className="px-2 py-3 text-[13px] text-muted">{t("Historique indisponible")}</p>}
        {list.data && threads.length === 0 && <p className="px-2 py-3 text-[13px] text-muted">{term ? t("Aucune conversation ne correspond.") : t("Tes conversations apparaîtront ici.")}</p>}
        {groupHistory(threads).map((g) => (
          <div key={g.group}>
            <div className="px-2.5 pb-1 pt-3 text-[12.5px] font-medium text-muted">{t(GROUPS[g.group])}</div>
            <div className="space-y-0.5">
              {g.threads.map((h) => (
                <HistoryRow key={h.id} thread={h} current={h.id === current} disabled={disabled} onOpen={() => onOpen(h.id)} onPatch={(body) => patch(h, body)} onRemove={() => void remove(h)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
