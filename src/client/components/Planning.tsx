import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, Target, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api, useWealth } from "../api.ts";
import { useEnvelopes, useGoals, type Envelope, type EnvelopeCandidates, type Goal } from "../api-situation.ts";
import { Card, Field, Segmented, Sheet } from "./ui.tsx";
import { openDrill } from "./DrillDrawer.tsx";
import { dateFr, money, moneySymbol } from "../format.ts";
import { householdDay } from "../region.ts";
import { cn } from "../cn.ts";
import { useMedia } from "../useMedia.ts";
import { Stat } from "./blocks.tsx";
import { t, td, tn } from "../../lib/i18n.ts";

/*
 * Piloter : enveloppes mensuelles par poste (jauge, projection de fin de mois, alerte) et objectifs
 * d'épargne (avancement, versement mensuel conseillé). Listes complètes et résumés pour l'accueil.
 */

const tone = (state: Envelope["state"]) => (state === "depasse" ? "bg-neg" : state === "alerte" ? "bg-warn" : "bg-accent");
const month = () => householdDay().slice(0, 7);

/** Jauge d'une enveloppe : dépensé, plafond, repère de la projection de fin de mois. */
export function EnvelopeGauge({ e, compact = false, onClick }: { e: Envelope; compact?: boolean; onClick?: () => void }) {
  const width = Math.min(100, e.pct);
  const proj = e.projected != null && e.monthly > 0 ? Math.min(100, (e.projected / e.monthly) * 100) : null;
  return (
    <button type="button" onClick={onClick} className={cn("block w-full rounded-md text-left", onClick && "hover:bg-bg", compact ? "-mx-2 w-[calc(100%+1rem)] px-2 py-1" : "px-4 py-3")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("truncate font-medium", compact ? "text-[14px]" : "text-[15px]")}>{td(e.label)}</span>
        <span className="tnum shrink-0 text-[13px]">
          <b>{money(e.spent, true)}</b> <span className="text-muted">/ {money(e.monthly, true)}</span>
        </span>
      </div>
      <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-line/70">
        <div className={cn("h-full rounded-full transition-[width] duration-500", tone(e.state))} style={{ width: `${width}%` }} />
        {proj != null && proj > width && <span className="absolute inset-y-0 w-0.5 bg-ink/40" style={{ left: `${proj}%` }} title={t("Projection de fin de mois : {montant}", { montant: money(e.projected!, true) })} />}
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between text-[12px] text-muted">
          <span className={cn(e.state === "depasse" && "font-medium text-neg", e.state === "alerte" && "font-medium text-warn")}>
            {e.left >= 0 ? t("Reste {montant}", { montant: money(e.left, true) }) : t("Dépassée de {montant}", { montant: money(-e.left, true) })}
          </span>
          <span>{e.projected != null ? t("fin de mois ≈ {projection} · moyenne {moyenne}", { projection: money(e.projected, true), moyenne: money(e.average, true) }) : t("moyenne {moyenne}", { moyenne: money(e.average, true) })}</span>
        </div>
      )}
    </button>
  );
}

/** Enveloppes du mois (Budget) : liste, ajout, modification. */
export function EnvelopesSection() {
  const q = useEnvelopes();
  const [editing, setEditing] = useState<Envelope | "new" | null>(null);
  const list = q.data?.envelopes ?? [];
  // Arrivée par « Enveloppes du mois » (accueil, tableau de bord) : la section vient à l'écran.
  useEffect(() => {
    if (q.data && window.location.hash === "#enveloppes") document.getElementById("enveloppes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [q.data]);
  const total = list.reduce((s, e) => s + e.monthly, 0);
  const spent = list.reduce((s, e) => s + e.spent, 0);
  return (
    <section id="enveloppes" className="mb-6 scroll-mt-20">
      <div className="mb-2 flex items-end justify-between px-1">
        <div>
          <h2 className="text-[15px] font-semibold text-ink md:text-[15px] md:normal-case md:tracking-normal md:text-ink">{t("Enveloppes du mois")}</h2>
          {list.length > 0 && (
            <p className="text-[12px] text-muted">
              {t("{depense} dépensés sur {prevu} prévus", { depense: money(spent, true), prevu: money(total, true) })}
            </p>
          )}
        </div>
        <button type="button" onClick={() => setEditing("new")} className="press flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">
          <Plus size={15} /> {t("Enveloppe")}
        </button>
      </div>
      {list.length ? (
        <Card className="divide-y divide-line">
          {list.map((e) => (
            <EnvelopeGauge key={e.id} e={e} onClick={() => setEditing(e)} />
          ))}
        </Card>
      ) : (
        <Card className="p-4 text-sm text-muted">
          {t("Fixe un plafond mensuel par poste (Alimentation, Restaurants…) : la jauge se remplit au fil du mois, l'alerte tombe à 80 %. Pécule propose la moyenne de tes 3 derniers mois.")}
        </Card>
      )}
      {editing && q.data && <EnvelopeSheet envelope={editing === "new" ? null : editing} candidates={q.data.candidates} taken={list} onClose={() => setEditing(null)} />}
    </section>
  );
}

function EnvelopeSheet({ envelope, candidates, taken, onClose }: { envelope: Envelope | null; candidates: EnvelopeCandidates; taken: Envelope[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"poste" | "categorie">(envelope?.scope ?? "poste");
  const [ref, setRef] = useState(envelope?.ref ?? "");
  const [monthly, setMonthly] = useState(envelope ? String(envelope.monthly) : "");
  const [alertPct, setAlertPct] = useState(String(envelope?.alertPct ?? 80));
  const options = (scope === "poste" ? candidates.postes : candidates.categories).filter((o) => envelope || !taken.some((x) => x.scope === scope && x.ref === o.ref));
  const chosen = options.find((o) => o.ref === ref);
  useEffect(() => {
    if (!envelope && chosen && !monthly) setMonthly(String(Math.max(10, Math.round(chosen.average / 10) * 10)));
  }, [chosen, envelope, monthly]);
  const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));
  async function save() {
    try {
      const body = { scope, ref, monthly: num(monthly), alertPct: num(alertPct) };
      if (envelope) await api(`/envelopes/${envelope.id}`, { method: "PATCH", json: body });
      else await api("/envelopes", { method: "POST", json: body });
      await qc.invalidateQueries({ queryKey: ["envelopes"] });
      toast.success(t("Enveloppe enregistrée"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    }
  }
  async function remove() {
    if (!envelope || !confirm(t("Supprimer l'enveloppe « {nom} » ?", { nom: td(envelope.label) }))) return;
    await api(`/envelopes/${envelope.id}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["envelopes"] });
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title={envelope ? td(envelope.label) : t("Nouvelle enveloppe")}>
      <div className="space-y-3">
        {!envelope && (
          <>
            <Segmented<"poste" | "categorie">
              value={scope}
              onChange={(v) => {
                setScope(v);
                setRef("");
                setMonthly("");
              }}
              options={[
                { value: "poste", label: t("Poste") },
                { value: "categorie", label: t("Catégorie") },
              ]}
            />
            <select value={ref} onChange={(e) => (setRef(e.target.value), setMonthly(""))} aria-label={t("Poste ou catégorie")} className="card w-full px-4 py-3 text-[15px]">
              <option value="">{t("Choisir…")}</option>
              {options.map((o) => (
                <option key={o.ref} value={o.ref}>
                  {t("{nom} · moyenne {moyenne}", { nom: td(o.label), moyenne: money(o.average, true) })}
                </option>
              ))}
            </select>
          </>
        )}
        <Field label={t("Plafond mensuel ({devise})", { devise: moneySymbol() })} value={monthly} onChange={setMonthly} />
        <Field label={t("Alerte à (% du plafond)")} value={alertPct} onChange={setAlertPct} />
        {envelope && (
          <button type="button" onClick={() => openDrill(td(envelope.label), envelope.scope === "poste" ? { month: month(), poste: envelope.ref, debits: true } : { month: month(), category: envelope.ref, debits: true }, t("Ce mois-ci ·"))} className="text-[13px] text-accent hover:underline">
            {t("Voir les opérations du mois")}
          </button>
        )}
      </div>
      <button type="button" disabled={!ref || !(num(monthly) >= 0) || !monthly} onClick={save} className="press mt-4 w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-40">
        {t("Enregistrer")}
      </button>
      {envelope && (
        <button type="button" onClick={remove} className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-sm text-neg">
          <Trash2 size={15} /> {t("Supprimer l'enveloppe")}
        </button>
      )}
    </Sheet>
  );
}

/** Résumé des enveloppes (accueil, tableau de bord) : les plus entamées d'abord. */
export function EnvelopesCard({ className }: { className?: string }) {
  const q = useEnvelopes();
  const list = [...(q.data?.envelopes ?? [])].sort((a, b) => b.pct - a.pct).slice(0, 4);
  if (!q.data) return null;
  return (
    <Card className={cn("p-4 md:p-5", className)}>
      <Link to="/budget#enveloppes" className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold">
          <Wallet size={17} className="text-accent" /> {t("Enveloppes du mois")}
        </span>
        <ChevronRight size={17} className="text-muted" />
      </Link>
      {list.length ? (
        <div className="space-y-1">
          {list.map((e) => (
            <EnvelopeGauge key={e.id} e={e} compact onClick={() => openDrill(td(e.label), e.scope === "poste" ? { month: month(), poste: e.ref, debits: true } : { month: month(), category: e.ref, debits: true }, t("Ce mois-ci ·"))} />
          ))}
        </div>
      ) : (
        <Link to="/budget#enveloppes" className="block text-sm text-muted">
          {t("Aucune enveloppe : fixe des plafonds par poste dans le Budget.")}
        </Link>
      )}
    </Card>
  );
}

/* ---------- Objectifs d'épargne ---------- */

function GoalRow({ g, onClick }: { g: Goal; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="press block w-full px-4 py-3 text-left hover:bg-bg">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] font-semibold">
          {g.emoji ? `${g.emoji} ` : ""}
          {g.name}
        </span>
        <span className="tnum shrink-0 text-[13px]">
          <b>{money(g.current, true)}</b> <span className="text-muted">/ {money(g.target, true)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line/70">
        <div className={cn("h-full rounded-full transition-[width] duration-500", g.status === "atteint" ? "bg-pos" : "bg-accent")} style={{ width: `${g.pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between gap-3 text-[12px] text-muted">
        <span>{g.status === "atteint" ? t("Objectif atteint 🎉") : t("{pct} % · reste {montant}", { pct: Math.round(g.pct), montant: money(g.remaining, true) })}</span>
        <span className="truncate">
          {g.targetDate ? t("pour le {date}", { date: dateFr(g.targetDate) }) : t("sans échéance")}
          {g.monthlyNeeded != null && ` · ${t("{montant}/mois", { montant: money(g.monthlyNeeded, true) })}`}
          {g.assetName && ` · ${g.assetName}`}
        </span>
      </div>
    </button>
  );
}

/** Carte d'un objectif (ordinateur) : avancement, reste, échéance, versement conseillé. */
function GoalCard({ g, onClick }: { g: Goal; onClick: () => void }) {
  const done = g.status === "atteint";
  return (
    <button type="button" onClick={onClick} className="card group p-5 text-left transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-[20px]">{g.emoji || "🎯"}</span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">{g.name}</span>
            <span className="block text-[12px] text-muted">{g.targetDate ? t("pour le {date}", { date: dateFr(g.targetDate) }) : t("sans échéance")}</span>
          </span>
        </span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold", done ? "bg-pos/10 text-pos" : "bg-accent-soft text-accent")}>{done ? t("Atteint") : `${Math.round(g.pct)} %`}</span>
      </div>
      <div className="tnum mt-4 text-[22px] font-bold leading-none">
        {money(g.current, true)} <span className="text-[13px] font-normal text-muted">{t("sur {montant}", { montant: money(g.target, true) })}</span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-line/70">
        <div className={cn("h-full rounded-full transition-[width] duration-500", done ? "bg-pos" : "bg-accent")} style={{ width: `${g.pct}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-[12px]">
        <div>
          <div className="text-muted">{t("Reste##objectif")}</div>
          <div className="tnum text-[13px] font-semibold">{done ? "—" : money(g.remaining, true)}</div>
        </div>
        <div>
          <div className="text-muted">{t("À verser")}</div>
          <div className="tnum text-[13px] font-semibold">{g.monthlyNeeded != null ? t("{montant}/mois", { montant: money(g.monthlyNeeded, true) }) : "—"}</div>
        </div>
        <div className="min-w-0">
          <div className="text-muted">{t("Suivi")}</div>
          <div className="truncate text-[13px] font-semibold">{g.assetName ?? t("saisi à la main")}</div>
        </div>
      </div>
    </button>
  );
}

export function GoalsList() {
  const q = useGoals();
  const desktop = useMedia("(min-width: 1024px)");
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const list = q.data?.goals ?? [];
  const add = (
    <button type="button" onClick={() => setEditing("new")} className="press flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[14px] font-semibold text-white md:h-auto md:rounded-md md:py-1.5 md:text-[13px] md:font-medium">
      <Plus size={15} /> {t("Objectif")}
    </button>
  );
  if (desktop && list.length) {
    const saved = list.reduce((s, g) => s + Math.min(g.current, g.target), 0);
    const target = list.reduce((s, g) => s + g.target, 0);
    const monthly = list.reduce((s, g) => s + (g.monthlyNeeded ?? 0), 0);
    const next = list.filter((g) => g.targetDate && g.status !== "atteint").sort((a, b) => a.targetDate!.localeCompare(b.targetDate!))[0];
    return (
      <>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t("Mis de côté")} value={money(saved, true)} hint={t("sur {montant} visés", { montant: money(target, true) })} />
          <Stat label={t("Avancement")} value={`${target ? Math.round((saved / target) * 100) : 0} %`} hint={tn("{n} objectif atteint sur {total}", "{n} objectifs atteints sur {total}", list.filter((g) => g.status === "atteint").length, { total: list.length })} />
          <Stat label={t("À verser")} value={monthly ? t("{montant}/mois", { montant: money(monthly, true) }) : "—"} hint={t("pour tenir toutes les dates")} />
          <Stat label={t("Prochaine échéance")} value={next ? dateFr(next.targetDate!) : "—"} hint={next ? `${next.emoji ? `${next.emoji} ` : ""}${next.name}` : t("aucune date fixée")} />
        </div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t("Tes objectifs")}</h2>
          {add}
        </div>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {list.map((g) => (
            <GoalCard key={g.id} g={g} onClick={() => setEditing(g)} />
          ))}
        </div>
        {editing && <GoalSheet goal={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      </>
    );
  }
  return (
    <>
      <div className="mb-3 flex justify-end">{add}</div>
      {list.length ? (
        <Card className="divide-y divide-line">
          {list.map((g) => (
            <GoalRow key={g.id} g={g} onClick={() => setEditing(g)} />
          ))}
        </Card>
      ) : (
        <Card className="p-5 text-sm text-muted">
          {t("Un objectif = un projet (voyage, travaux, voiture, apport…), un montant et une date. Relie-le à un livret ou un placement : l'avancement suit sa valeur, et Pécule calcule le versement mensuel pour tenir la date.")}
        </Card>
      )}
      {editing && <GoalSheet goal={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function GoalSheet({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const qc = useQueryClient();
  const wealth = useWealth();
  const [name, setName] = useState(goal?.name ?? "");
  const [emoji, setEmoji] = useState(goal?.emoji ?? "🎯");
  const [target, setTarget] = useState(goal ? String(goal.target) : "");
  const [date, setDate] = useState(goal?.targetDate ?? "");
  const [assetId, setAssetId] = useState<string>(goal?.assetId ? String(goal.assetId) : "");
  const [manual, setManual] = useState(goal?.currentManual != null ? String(goal.currentManual) : "");
  const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));
  const assets = (wealth.data?.assets ?? []).filter((a) => a.category === "epargne" || a.category === "placement");
  async function save() {
    try {
      const body = { name: name.trim(), emoji: emoji || null, target: num(target), targetDate: date || null, assetId: assetId ? Number(assetId) : null, currentManual: assetId || !manual ? null : num(manual) };
      if (goal) await api(`/goals/${goal.id}`, { method: "PATCH", json: body });
      else await api("/goals", { method: "POST", json: body });
      await qc.invalidateQueries({ queryKey: ["goals"] });
      toast.success(t("Objectif enregistré"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    }
  }
  async function remove() {
    if (!goal || !confirm(t("Supprimer l'objectif « {nom} » ?", { nom: goal.name }))) return;
    await api(`/goals/${goal.id}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["goals"] });
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title={goal ? goal.name : t("Nouvel objectif")}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label={t("Emoji")} className="card w-16 px-3 py-3 text-center text-[18px]" />
          <div className="flex-1">
            <Field label={t("Nom")} value={name} onChange={setName} text placeholder={t("Voyage, travaux, apport…")} />
          </div>
        </div>
        <Field label={t("Montant visé ({devise})", { devise: moneySymbol() })} value={target} onChange={setTarget} />
        <label className="card flex items-center justify-between gap-3 px-4 py-3 text-[15px]">
          <span className="text-muted">{t("Pour le")}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-transparent text-right outline-none" />
        </label>
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} aria-label={t("Suivi de l'avancement")} className="card w-full px-4 py-3 text-[15px]">
          <option value="">{t("Avancement saisi à la main")}</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {t("Suivre « {nom} » ({valeur})", { nom: a.name, valeur: money(a.value, true) })}
            </option>
          ))}
        </select>
        {!assetId && <Field label={t("Déjà mis de côté ({devise})", { devise: moneySymbol() })} value={manual} onChange={setManual} />}
      </div>
      <button type="button" disabled={!name.trim() || !(num(target) > 0)} onClick={save} className="press mt-4 w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-40">
        {t("Enregistrer")}
      </button>
      {goal && (
        <button type="button" onClick={remove} className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-sm text-neg">
          <Trash2 size={15} /> {t("Supprimer l'objectif")}
        </button>
      )}
    </Sheet>
  );
}

/** Résumé des objectifs (accueil, tableau de bord). */
export function GoalsCard({ className }: { className?: string }) {
  const q = useGoals();
  const list = (q.data?.goals ?? []).slice(0, 3);
  if (!q.data || !list.length) return null;
  return (
    <Card className={cn("p-4 md:p-5", className)}>
      <Link to="/objectifs" className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold">
          <Target size={17} className="text-accent" /> {t("Objectifs d'épargne")}
        </span>
        <ChevronRight size={17} className="text-muted" />
      </Link>
      <div className="space-y-2.5">
        {list.map((g) => (
          <Link key={g.id} to="/objectifs" className="block">
            <div className="flex justify-between gap-3 text-[14px]">
              <span className="truncate font-medium">
                {g.emoji ? `${g.emoji} ` : ""}
                {g.name}
              </span>
              <span className="tnum shrink-0 text-muted">{Math.round(g.pct)} %</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/70">
              <div className={cn("h-full rounded-full", g.status === "atteint" ? "bg-pos" : "bg-accent")} style={{ width: `${g.pct}%` }} />
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}
