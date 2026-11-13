import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Keyboard, MessageSquare, Search, SkipForward } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api, useCategories, useSuggestions, type Transaction } from "../api.ts";
import { Amount, Card, PageHeader, Sheet, Spinner } from "../components/ui.tsx";
import { TxLogo } from "../components/Logo.tsx";
import { dateFr, money } from "../format.ts";
import { txTitle } from "../../lib/labels.ts";
import { undoToast } from "../undo.ts";
import { askAssistant } from "../assistantBus.ts";
import { useMedia } from "../useMedia.ts";
import { t as tr, td, tn } from "../../lib/i18n.ts";

/*
 * Mode tri : les opérations à classer une à une. Trois catégories proposées (règle, facture,
 * même libellé, même marchand) ; un geste ou une touche pour valider. Quand le même libellé revient
 * dans la file, « classer aussi les autres et retenir la règle » est proposé (coché d'office).
 * iPhone : balayer à droite = première suggestion, à gauche = passer. Ordinateur : 1-2-3, → pour passer.
 */

export function Triage() {
  const qc = useQueryClient();
  const desktop = useMedia("(min-width: 768px)");
  const categories = useCategories();
  const list = useQuery({
    queryKey: ["transactions", "triage"],
    queryFn: () => api<{ transactions: Transaction[] }>("/transactions?uncategorized=1&limit=300"),
    staleTime: 0,
  });
  const [done, setDone] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [all, setAll] = useState(true);
  const queue = useMemo(() => (list.data?.transactions ?? []).filter((t) => !done.has(t.id) && !skipped.has(t.id)), [list.data, done, skipped]);
  const total = list.data?.transactions.length ?? 0;
  // Ordinateur : on peut choisir une opération dans la file ; sinon la première.
  const [focus, setFocus] = useState<string | null>(null);
  const t = queue.find((x) => x.id === focus) ?? queue[0] ?? null;
  const suggestions = useSuggestions(t?.id);
  // Même libellé ailleurs dans la file : on propose de les classer ensemble et de retenir la règle.
  const twins = useMemo(() => (t ? queue.filter((x) => x.id !== t.id && sameLabel(x, t)) : []), [queue, t]);
  useEffect(() => setAll(true), [t?.id]);

  async function classify(categoryId: string, name: string) {
    if (!t || busy) return;
    setBusy(true);
    try {
      const ids = all && twins.length ? [t.id, ...twins.map((x) => x.id)] : [t.id];
      const r =
        ids.length > 1
          ? await api<{ undoId?: string }>("/transactions/bulk-category", { method: "POST", json: { ids, categoryId, remember: true } })
          : await api<{ undoId?: string }>(`/transactions/${encodeURIComponent(t.id)}`, { method: "PATCH", json: { categoryId } });
      setDone((d) => new Set([...d, ...ids]));
      undoToast(ids.length > 1 ? tr("{n} opérations classées dans « {nom} » · règle créée", { n: ids.length, nom: td(name) }) : tr("Classée dans « {nom} »", { nom: td(name) }), r.undoId);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "transactions" || q.queryKey[1] !== "triage" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("Classement impossible"));
    } finally {
      setBusy(false);
    }
  }
  const skip = () => t && setSkipped((s) => new Set([...s, t.id]));

  // Clavier (ordinateur) : 1, 2, 3 = suggestion ; → ou s = passer ; / = autre catégorie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey || picking) return;
      const sg = suggestions.data?.suggestions ?? [];
      if (/^[1-3]$/.test(e.key) && sg[Number(e.key) - 1]) {
        e.preventDefault();
        void classify(sg[Number(e.key) - 1].categoryId, sg[Number(e.key) - 1].name);
      } else if (e.key === "ArrowRight" || e.key === "s") {
        e.preventDefault();
        skip();
      } else if (e.key === "/") {
        e.preventDefault();
        setPicking(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  const progress = total ? (total - queue.length) / total : 0;
  // Une seule phrase à traduire ; elle est coupée à l'endroit du nombre, affiché en gras.
  const twinsText = tn("Classer aussi les {n} autre opération de même libellé et retenir la règle", "Classer aussi les {n} autres opérations de même libellé et retenir la règle", twins.length, { n: "\u0000" }).split("\u0000");
  return (
    <>
      <PageHeader title={tr("À classer")} subtitle={total ? `${tr("{fait} sur {total}", { fait: total - queue.length, total })}${skipped.size ? ` · ${tn("{n} passée", "{n} passées", skipped.size)}` : ""}` : undefined} />
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
      <div className={clsx("min-w-0", t ? "lg:col-span-7" : "lg:col-span-12")}>
      {list.isLoading ? (
        <Spinner />
      ) : !t ? (
        <Card className="p-8 text-center">
          <div className="text-4xl">🎉</div>
          <div className="mt-3 text-lg font-semibold">{skipped.size ? tr("Fin de la file") : tr("Tout est classé")}</div>
          <p className="mt-1 text-sm text-muted">{skipped.size ? tn("{n} opération passée reste à classer.", "{n} opérations passées restent à classer.", skipped.size) : tr("Plus aucune opération à classer.")}</p>
          <div className="mt-5 flex justify-center gap-2">
            {skipped.size > 0 && (
              <button type="button" onClick={() => setSkipped(new Set())} className="press rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
                {tr("Reprendre les passées")}
              </button>
            )}
            <Link to="/operations" className="press rounded-lg bg-card px-4 py-2 text-sm font-semibold ring-1 ring-line">
              {tr("Voir les opérations")}
            </Link>
          </div>
        </Card>
      ) : (
        <SwipeCard key={t.id} enabled={!desktop && !busy} onRight={() => suggestions.data?.suggestions[0] && classify(suggestions.data.suggestions[0].categoryId, suggestions.data.suggestions[0].name)} onLeft={skip}>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <TxLogo t={t} />
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-semibold leading-snug">{txTitle(t)}</div>
                <div className="mt-0.5 break-words text-xs text-muted">{t.label}</div>
              </div>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div className="text-sm text-muted">
                {dateFr(t.date)} · {t.account_name}
              </div>
              <Amount value={t.amount} className="text-2xl font-bold" />
            </div>
            {t.note && <div className="mt-3 rounded-lg bg-bg px-3 py-2 text-sm">{t.note}</div>}
          </Card>
        </SwipeCard>
      )}

      {t && (
        <div className="mt-4 space-y-2">
          {twins.length > 0 && (
            <label className="flex items-start gap-2 px-1 text-sm">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
              <span>
                {twinsText[0]}
                <b>{twins.length}</b>
                {twinsText[1]}
              </span>
            </label>
          )}
          {suggestions.isLoading ? (
            <div className="skeleton h-14 rounded-[var(--radius-card)]" />
          ) : (
            (suggestions.data?.suggestions ?? []).map((sg, i) => (
              <button
                key={sg.categoryId}
                type="button"
                disabled={busy}
                onClick={() => classify(sg.categoryId, sg.name)}
                className={clsx("press card flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-60", i === 0 && "ring-2 ring-accent/50")}
              >
                <kbd className="hidden size-6 shrink-0 place-items-center rounded border border-line text-[12px] text-muted md:grid">{i + 1}</kbd>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{td(sg.name)}</span>
                  <span className="block truncate text-xs text-muted">
                    {sg.poste ? `${td(sg.poste)} · ` : ""}
                    {sg.reason}
                  </span>
                </span>
                <Check size={18} className="shrink-0 text-accent" />
              </button>
            ))
          )}
          {!suggestions.isLoading && !suggestions.data?.suggestions.length && <p className="px-1 text-sm text-muted">{tr("Pas de suggestion : choisis une catégorie.")}</p>}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button type="button" onClick={() => setPicking(true)} className="press card flex flex-col items-center gap-1 py-2.5 text-[12px] font-medium">
              <Search size={17} /> {tr("Autre##catégorie")}
            </button>
            <button type="button" onClick={skip} className="press card flex flex-col items-center gap-1 py-2.5 text-[12px] font-medium">
              <SkipForward size={17} /> {tr("Passer")}
            </button>
            <button
              type="button"
              onClick={() => askAssistant(tr("Aide-moi à classer l'opération « {titre} » du {date} ({montant}, libellé « {libelle} »).", { titre: txTitle(t), date: dateFr(t.date), montant: money(t.amount), libelle: t.label }))}
              className="press card flex flex-col items-center gap-1 py-2.5 text-[12px] font-medium"
            >
              <MessageSquare size={17} /> {tr("Assistant")}
            </button>
          </div>
          <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[12px] text-muted">
            {desktop ? (
              <>
                <Keyboard size={13} /> {tr("1, 2, 3 pour choisir · → pour passer · / pour une autre catégorie")}
              </>
            ) : (
              <>
                {tr("Balaye à droite pour la 1ʳᵉ suggestion, à gauche pour passer")} <ArrowRight size={12} />
              </>
            )}
          </p>
        </div>
      )}
      </div>

      {/* Ordinateur : la file d'attente, pour voir ce qui reste et choisir par où commencer. */}
      {desktop && t && (
        <aside className="hidden lg:col-span-5 lg:block">
          <Card className="overflow-clip">
            <div className="flex items-baseline justify-between px-4 pb-2 pt-3.5">
              <h2 className="text-[13px] font-semibold">{tr("File d'attente")}</h2>
              <span className="text-[12px] text-muted">
                {tn("{n} restante", "{n} restantes", queue.length)}
                {skipped.size > 0 && (
                  <>
                    {" · "}
                    <button type="button" onClick={() => setSkipped(new Set())} className="text-accent hover:underline">
                      {tn("reprendre les {n} passée", "reprendre les {n} passées", skipped.size)}
                    </button>
                  </>
                )}
              </span>
            </div>
            <div className="max-h-[calc(100vh-230px)] divide-y divide-line overflow-y-auto border-t border-line">
              {queue.slice(0, 60).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setFocus(x.id)}
                  aria-current={x.id === t.id}
                  className={clsx("flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-bg", x.id === t.id && "bg-accent-soft hover:bg-accent-soft")}
                >
                  <TxLogo t={x} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{txTitle(x)}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {dateFr(x.date).slice(0, 5)} · {x.account_name}
                    </span>
                  </span>
                  <Amount value={x.amount} className="font-semibold" />
                </button>
              ))}
              {queue.length > 60 && <div className="px-4 py-2 text-[12px] text-muted">{tn("… et {n} autre", "… et {n} autres", queue.length - 60)}</div>}
            </div>
          </Card>
        </aside>
      )}
      </div>

      {picking && t && (
        <CategoryPicker
          categories={categories.data?.categories ?? []}
          onClose={() => setPicking(false)}
          onPick={(id, name) => {
            setPicking(false);
            void classify(id, name);
          }}
        />
      )}
    </>
  );
}

const sameLabel = (a: Transaction, b: Transaction) => a.label.replace(/\d+/g, "").trim().toLowerCase() === b.label.replace(/\d+/g, "").trim().toLowerCase();

/** Carte qu'on balaie (iPhone) : à droite = valider la suggestion, à gauche = passer. */
function SwipeCard({ enabled, onRight, onLeft, children }: { enabled: boolean; onRight: () => void; onLeft: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [leaving, setLeaving] = useState<0 | 1 | -1>(0);
  const end = () => {
    const d = dx;
    start.current = null;
    if (Math.abs(d) > 110) {
      setLeaving(d > 0 ? 1 : -1);
      setTimeout(() => (d > 0 ? onRight() : onLeft()), 160);
    } else setDx(0);
  };
  return (
    <div
      className="relative touch-pan-y select-none"
      onTouchStart={(e) => enabled && (start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchMove={(e) => {
        if (!start.current) return;
        const x = e.touches[0].clientX - start.current.x;
        if (Math.abs(e.touches[0].clientY - start.current.y) > 40 && Math.abs(x) < 30) return;
        setDx(x);
      }}
      onTouchEnd={end}
    >
      <div className={clsx("pointer-events-none absolute inset-0 flex items-center rounded-[var(--radius-card)] px-6 text-sm font-semibold", dx > 0 ? "justify-start bg-pos/15 text-pos" : "justify-end bg-line text-muted")} style={{ opacity: Math.min(1, Math.abs(dx) / 110) }}>
        {dx > 0 ? tr("Classer") : tr("Passer")}
      </div>
      <div
        style={{
          transform: leaving ? `translateX(${leaving * 120}%) rotate(${leaving * 8}deg)` : `translateX(${dx}px) rotate(${dx / 30}deg)`,
          transition: start.current ? "none" : "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Choix d'une autre catégorie (recherche). */
function CategoryPicker({ categories, onPick, onClose }: { categories: { id: string; name: string; poste: string | null; kind: string }[]; onPick: (id: string, name: string) => void; onClose: () => void }) {
  const [f, setF] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // La recherche lit le nom d'origine et le nom affiché (traduit).
  const rows = categories.filter((c) => !f || norm(`${c.name} ${td(c.name)} ${c.poste ?? ""} ${td(c.poste) ?? ""}`).includes(norm(f)));
  return (
    <Sheet open onClose={onClose} title={tr("Autre catégorie")}>
      <label className="card mb-3 flex items-center gap-2 px-4 py-2.5">
        <Search size={16} className="text-muted" />
        <input autoFocus value={f} onChange={(e) => setF(e.target.value)} placeholder={tr("Chercher une catégorie…")} className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted md:text-[14px]" />
      </label>
      <Card className="divide-y divide-line">
        {rows.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c.id, c.name)} className="press flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left">
            <span className="text-[15px]">{td(c.name)}</span>
            <span className="text-xs text-muted">{td(c.poste)}</span>
          </button>
        ))}
      </Card>
    </Sheet>
  );
}
