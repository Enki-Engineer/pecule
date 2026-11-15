import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, MessageSquare, MoreHorizontal, PanelRight, Store } from "lucide-react";
import { toast } from "sonner";
import { api, queryClient, useSuggestions, type Transaction } from "../api.ts";
import { Sheet } from "./ui.tsx";
import { undoToast } from "../undo.ts";
import { askAssistant } from "../assistantBus.ts";
import { txTitle } from "../../lib/labels.ts";
import { merchantName } from "../../lib/nature.ts";
import { dateFr, money, plainMoney } from "../format.ts";
import { cn } from "../cn.ts";
import { t as tr, td, tk } from "../../lib/i18n.ts";

/*
 * Ligne d'opération (iPhone) avec gestes : balayer vers la gauche révèle « Classer dans [suggestion] »
 * et « Plus » (balayage complet = classer tout de suite) ; appui long = menu d'actions.
 */

const REVEAL = 168;

export function SwipeTxRow({ t, children, onOpen, onSearch }: { t: Transaction; children: ReactNode; onOpen: () => void; onSearch: (q: string) => void }) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const start = useRef<{ x: number; y: number; t: number; base: number; horizontal: boolean | null } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const moved = useRef(false);
  const sg = useSuggestions(open || menu ? t.id : null);
  const first = sg.data?.suggestions[0];

  async function classify(categoryId: string, name: string) {
    setOpen(false);
    setDx(0);
    try {
      const r = await api<{ undoId?: string }>(`/transactions/${encodeURIComponent(t.id)}`, { method: "PATCH", json: { categoryId } });
      undoToast(tr("Classée dans « {nom} »", { nom: td(name) }), r.undoId);
      void queryClient.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("Classement impossible"));
    }
  }

  const close = () => {
    setOpen(false);
    setDx(0);
  };

  return (
    <div className="relative overflow-hidden">
      {/* Actions révélées à droite */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: Math.max(REVEAL, -dx) }}>
        <button
          type="button"
          onClick={() => first && classify(first.categoryId, first.name)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-accent px-2 text-[11px] font-semibold text-white"
        >
          <Check size={18} />
          <span className="line-clamp-2 text-center leading-tight">{first ? td(first.name) : sg.isLoading ? "…" : tr("Classer")}</span>
        </button>
        <button type="button" onClick={() => (close(), setMenu(true))} className="flex w-16 flex-col items-center justify-center gap-0.5 bg-ink/80 text-[11px] font-semibold text-white">
          <MoreHorizontal size={18} />
          {tr("Plus")}
        </button>
      </div>
      <div
        className="relative bg-card"
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? "none" : "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
        onTouchStart={(e) => {
          moved.current = false;
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), base: open ? -REVEAL : 0, horizontal: null };
          press.current = setTimeout(() => {
            if (!moved.current) {
              start.current = null;
              setMenu(true);
            }
          }, 480);
        }}
        onTouchMove={(e) => {
          const s = start.current;
          if (!s) return;
          const x = e.touches[0].clientX - s.x;
          const y = e.touches[0].clientY - s.y;
          if (Math.abs(x) > 6 || Math.abs(y) > 6) {
            moved.current = true;
            clearTimeout(press.current);
          }
          if (s.horizontal === null && (Math.abs(x) > 8 || Math.abs(y) > 8)) s.horizontal = Math.abs(x) > Math.abs(y);
          if (!s.horizontal) return;
          const next = Math.min(0, s.base + x);
          if (next < -40 && !open) setOpen(true);
          setDx(next);
        }}
        onTouchEnd={() => {
          clearTimeout(press.current);
          const s = start.current;
          start.current = null;
          if (!s || !s.horizontal) return setDx(open ? -REVEAL : 0);
          const width = window.innerWidth;
          if (dx < -width * 0.6 && first) return void classify(first.categoryId, first.name);
          if (dx < -REVEAL / 2) {
            setOpen(true);
            setDx(-REVEAL);
          } else close();
        }}
        onClickCapture={(e) => {
          // Un balayage ou un appui long n'ouvre pas la fiche ; une ligne ouverte se referme d'abord.
          if (moved.current || open || menu) {
            e.stopPropagation();
            e.preventDefault();
            if (open && !moved.current) close();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </div>
      {menu &&
        createPortal(
          <Sheet open onClose={() => setMenu(false)} title={txTitle(t)}>
            <p className="-mt-1 mb-3 text-sm text-muted">
              {dateFr(t.date)} · {money(Number(t.amount))} · {td(t.category_name ?? tk("À classer"))}
            </p>
            {(sg.data?.suggestions.length ?? 0) > 0 && (
              <div className="mb-3 grid gap-2">
                {sg.data!.suggestions.map((s) => (
                  <ActionRow key={s.categoryId} icon={<Check size={17} />} label={tr("Classer dans « {nom} »", { nom: td(s.name) })} hint={s.reason} onClick={() => (setMenu(false), classify(s.categoryId, s.name))} accent />
                ))}
              </div>
            )}
            <div className="card divide-y divide-line">
              <ActionRow icon={<PanelRight size={17} />} label={tr("Ouvrir la fiche")} onClick={() => (setMenu(false), onOpen())} />
              <ActionRow icon={<Store size={17} />} label={tr("Opérations « {nom} »", { nom: merchantName(t.label, t.merchant).slice(0, 30) })} onClick={() => (setMenu(false), onSearch(merchantName(t.label, t.merchant)))} />
              <ActionRow
                icon={<MessageSquare size={17} />}
                label={tr("Demander à l'assistant")}
                onClick={() => (setMenu(false), askAssistant(tr("Que peux-tu me dire sur l'opération « {titre} » du {date} ({montant}) ?", { titre: txTitle(t), date: dateFr(t.date), montant: plainMoney(Number(t.amount)) })))}
              />
              <ActionRow icon={<Copy size={17} />} label={tr("Copier le libellé")} onClick={() => (setMenu(false), void navigator.clipboard.writeText(t.label).then(() => toast.success(tr("Libellé copié"))))} />
            </div>
          </Sheet>,
          document.body,
        )}
    </div>
  );
}

function ActionRow({ icon, label, hint, onClick, accent }: { icon: ReactNode; label: string; hint?: string; onClick: () => void; accent?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("press flex w-full items-center gap-3 px-4 py-3 text-left", accent && "card")}>
      <span className={cn("shrink-0", accent ? "text-accent" : "text-muted")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px]", accent && "font-semibold")}>{label}</span>
        {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
      </span>
    </button>
  );
}
