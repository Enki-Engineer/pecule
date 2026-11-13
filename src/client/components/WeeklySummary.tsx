import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MessageSquare, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { Card } from "./ui.tsx";
import { Markdown } from "./Markdown.tsx";
import { openThread } from "../assistantBus.ts";
import { cn } from "../cn.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Résumé de la semaine (accueil, tableau de bord) : préparé par l'assistant chaque lundi matin ;
 * « En parler » ouvre la conversation pour approfondir. Sans résumé, on peut le demander (une fois par jour).
 */

type Summary = { week: string; threadId: string; createdAt: string; preview: string; text: string };

export function WeeklySummaryCard({ className }: { className?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["weekly-summary"], queryFn: () => api<{ summary: Summary | null }>("/weekly-summary"), staleTime: 3600_000 });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = q.data?.summary;
  async function generate() {
    setBusy(true);
    try {
      await api("/weekly-summary", { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["weekly-summary"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Résumé impossible"));
    } finally {
      setBusy(false);
    }
  }
  if (!q.data) return null;
  const fresh = s && Date.now() - Date.parse(s.createdAt) < 8 * 86_400_000;
  return (
    <Card className={cn("p-4 md:p-5", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <CalendarDays size={17} className="text-accent" /> {t("Résumé de la semaine")}
        </span>
        {s && (
          <button type="button" onClick={() => openThread(s.threadId)} className="press flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">
            <MessageSquare size={14} /> {t("En parler")}
          </button>
        )}
      </div>
      {s && fresh ? (
        <>
          <div className={cn("relative overflow-hidden text-[14px] leading-relaxed", !open && "max-h-44")}>
            <Markdown text={s.text} />
            {!open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />}
          </div>
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-[13px] font-medium text-accent">
            {open ? t("Réduire") : t("Lire la suite")}
          </button>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3 text-sm text-muted">
          <span>{t("Préparé chaque lundi matin par l'assistant : dépenses, faits marquants, ce qui t'attend.")}</span>
          <button type="button" disabled={busy} onClick={generate} className="press flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent disabled:opacity-50">
            <RefreshCw size={14} className={cn(busy && "animate-spin")} /> {busy ? t("Préparation…") : t("Le préparer")}
          </button>
        </div>
      )}
    </Card>
  );
}
