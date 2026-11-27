import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check as CheckIcon, ChevronDown, Landmark, Plus, RefreshCw, Trash2 } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api } from "../api.ts";
import { useCryptoEvents, useCryptoSourceMoves, type CryptoEvent, type CryptoJournal, type CryptoProposal, type CryptoSourceMove } from "../api-situation.ts";
import { Card, InfoTip, Sheet, Spinner } from "./ui.tsx";
import { DataTable, type Column } from "./DataTable.tsx";
import { dateFr, money, moneySymbol } from "../format.ts";
import { cn } from "../cn.ts";
import { defaultTitle, EVENT_KIND_INFO, EVENT_KINDS, kindOf, unitPrice, type EventKind } from "../../lib/crypto-events.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

/*
 * Journal des mouvements crypto : le récit que le membre tient de ses achats, ventes, transferts et staking. Il
 * l'écrit ici ou le dicte à l'assistant ; rien n'y change une position. Un mouvement en attente (ordre posé, retrait
 * en cours) reste en vue tant qu'il n'est pas passé.
 */

/** Ce que le formulaire propose en saisie : les noms des portefeuilles du membre, et les cryptos qu'il détient. */
export type JournalHints = { platforms: string[]; assets: string[] };
/** Ce qui s'ouvre dans le formulaire : un mouvement à corriger, une proposition à noter, ou une ligne vierge. */
type Editing = { event: CryptoEvent | null; proposal?: CryptoProposal };

const qty = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: Math.abs(n) < 1 ? 8 : 4 });
/** Libellé du genre : celui de la liste, sinon le texte gardé d'une reprise. */
const kindLabel = (type: string | null) => {
  const kind = kindOf(type);
  return kind ? t(EVENT_KIND_INFO[kind].label) : (type ?? "");
};
const period = (e: Pick<CryptoEvent, "date" | "end_date">) => (e.end_date && e.end_date !== e.date ? t("du {debut} au {fin}", { debut: dateFr(e.date), fin: dateFr(e.end_date) }) : dateFr(e.date));
const isPending = (e: CryptoEvent) => e.status === "attente";
/** Cours et frais d'un mouvement, en une ligne ; `null` s'il n'en porte pas. */
function terms(e: CryptoEvent): string | null {
  const unit = unitPrice(e);
  const parts = [
    unit ? (unit.derived ? t("soit {cours} l'unité", { cours: money(unit.price) }) : t("au cours de {cours}", { cours: money(unit.price) })) : null,
    e.fee != null ? t("frais {montant}", { montant: money(e.fee) }) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function PendingChip() {
  return <span className="chip chip-dashed shrink-0 text-[11px]">{t("En attente##mouvement")}</span>;
}

function AddButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("press flex shrink-0 items-center gap-1 font-medium text-accent", className)}>
      <Plus size={15} /> {t("Ajouter un mouvement")}
    </button>
  );
}

function EmptyJournal() {
  return <Card className="px-4 py-3 text-sm text-muted">{t("Note ici tes achats, tes ventes, tes transferts et ce que rapporte ton staking : la date, le montant, le pourquoi. Tu peux aussi le dicter à l'assistant.")}</Card>;
}

function EventRow({ e, onOpen }: { e: CryptoEvent; onOpen: (e: CryptoEvent) => void }) {
  const line = terms(e);
  return (
    <button type="button" onClick={() => onOpen(e)} className="press block w-full px-4 py-2.5 text-left">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-medium">{e.title}</span>
          {isPending(e) && <PendingChip />}
        </span>
        {e.value != null && <span className="tnum shrink-0 text-sm font-semibold">{money(e.value)}</span>}
      </div>
      <div className="truncate text-xs text-muted">
        {[period(e), kindLabel(e.type), e.platform, e.quantity != null && e.asset ? `${qty(Number(e.quantity))} ${e.asset}` : null].filter(Boolean).join(" · ")}
      </div>
      {line && <div className="tnum truncate text-xs text-muted">{line}</div>}
      {e.note && <div className="mt-0.5 line-clamp-2 text-xs text-muted">{e.note}</div>}
    </button>
  );
}

/** Ce qu'une proposition raconte, en une ligne : le genre, ce qui a bougé, où. */
function proposalTitle(p: CryptoProposal): string {
  const label = p.direction === "in" ? t("Arrivée##mouvement") : p.direction === "out" ? t("Départ##mouvement") : kindLabel(p.type);
  const what = p.origin === "banque" ? null : [p.quantity != null ? qty(Number(p.quantity)) : null, p.asset].filter(Boolean).join(" ") || null;
  return defaultTitle(label, what, p.fromPlatform && p.platform ? `${p.fromPlatform} → ${p.platform}` : p.platform);
}

/** D'où vient une proposition : l'opération bancaire, ou les deux lectures entre lesquelles le solde a bougé. */
const proposalSource = (p: CryptoProposal) =>
  p.origin === "fichier"
    ? t("Lu dans l'export de {nom}, au {date}", { nom: p.platform ?? "", date: dateFr(p.date) })
    : p.origin === "banque"
    ? [dateFr(p.date), p.label, p.account].filter(Boolean).join(" · ")
    : p.since && p.since !== p.date
      ? t("Solde changé entre le {debut} et le {fin}", { debut: dateFr(p.since), fin: dateFr(p.date) })
      : t("Solde changé à la lecture du {date}", { date: dateFr(p.date) });

/**
 * Ce que Pécule propose de noter : une opération bancaire vers une plateforme, un solde qui a bougé. « Noter »
 * ouvre le formulaire rempli, à relire ; « Écarter » retire la proposition pour de bon. Rien n'est écrit sans ce geste.
 */
function Proposals({ proposals, onNote }: { proposals: CryptoProposal[]; onNote: (p: CryptoProposal) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  if (!proposals.length) return null;
  const shown = all ? proposals : proposals.slice(0, 3);
  const dismiss = async (refs: string[]) => {
    if (refs.length > 1 && !confirm(t("Écarter ces {n} propositions ? Elles ne seront plus montrées.", { n: refs.length }))) return;
    setBusy(true);
    try {
      await api("/crypto/proposals/dismiss", { method: "POST", json: { refs } });
      await qc.invalidateQueries({ queryKey: ["crypto-events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="divide-y divide-line">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{tn("{n} mouvement à noter ?", "{n} mouvements à noter ?", proposals.length)}</div>
          <div className="text-xs text-muted">{t("Repérés dans tes opérations et tes portefeuilles. Rien n'est noté sans toi.")}</div>
        </div>
        {proposals.length > 1 && (
          <button type="button" disabled={busy} onClick={() => dismiss(proposals.map((p) => p.ref))} className="press shrink-0 text-xs font-medium text-muted hover:text-ink disabled:opacity-50">
            {t("Tout écarter")}
          </button>
        )}
      </div>
      {shown.map((p) => (
        <div key={p.ref} className="flex items-center gap-3 px-4 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bg text-muted" title={p.origin === "banque" ? t("Vu dans tes opérations bancaires") : t("Vu à la synchronisation de tes portefeuilles")}>
            {p.origin === "banque" ? <Landmark size={15} /> : <RefreshCw size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <span className="line-clamp-2 min-w-0 text-[15px] font-medium leading-snug">{proposalTitle(p)}</span>
              {p.value != null && (
                <span className="tnum shrink-0 text-sm font-semibold">
                  {p.origin === "synchro" && p.type !== "achat" && p.type !== "vente" ? "≈ " : ""}
                  {money(p.value)}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted">{proposalSource(p)}</div>
            <div className="mt-1.5 flex gap-4 text-[13px] font-medium">
              <button type="button" disabled={busy} onClick={() => onNote(p)} className="press text-accent disabled:opacity-50">
                {t("Noter")}
              </button>
              <button type="button" disabled={busy} onClick={() => dismiss([p.ref])} className="press text-muted hover:text-ink disabled:opacity-50">
                {t("Écarter")}
              </button>
            </div>
          </div>
        </div>
      ))}
      {proposals.length > 3 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="press flex w-full items-center justify-between px-4 py-2.5 text-xs text-muted">
          <span>{all ? t("Replier") : tn("{n} autre proposition", "{n} autres propositions", proposals.length - 3)}</span>
          <ChevronDown size={14} className={clsx("transition-transform", all && "rotate-180")} />
        </button>
      )}
    </Card>
  );
}

/**
 * Ce que le journal dit avoir versé sur les plateformes, et retiré : la somme de ses dépôts et de ses retraits, rien
 * de plus. Pas de plus-value ici : le journal est un récit, il ne dit pas tout ce qui a été acheté.
 */
function CashLine({ cash }: { cash: CryptoJournal["cash"] }) {
  if (!cash || !(cash.deposited > 0 || cash.withdrawn > 0)) return null;
  return (
    <div className="flex items-center gap-1.5 px-1 text-xs text-muted">
      <span className="tnum">
        {[cash.deposited > 0 ? t("Dépôts notés : {montant}", { montant: money(cash.deposited, true) }) : null, cash.withdrawn > 0 ? t("Retraits notés : {montant}", { montant: money(cash.withdrawn, true) }) : null].filter(Boolean).join(" · ")}
      </span>
      <InfoTip text={t("La somme des dépôts et des retraits notés au journal, sans ceux qui sont en attente.")} />
    </div>
  );
}

/** Journal sur téléphone : ce qui attend reste en vue, le reste se déplie. */
export function Journal({ hints }: { hints: JournalHints }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const events = useCryptoEvents();
  const list = events.data?.events ?? [];
  const pending = list.filter(isPending);
  const done = list.filter((e) => !isPending(e));
  const edit = (event: CryptoEvent) => setEditing({ event });
  return (
    <section className="space-y-2">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={!done.length} className="flex w-full items-center justify-between px-1 text-[15px] font-semibold text-ink">
        {t("Journal des mouvements ({n})", { n: list.length })}
        {done.length > 0 && <ChevronDown size={16} className={clsx("shrink-0 transition", open && "rotate-180")} />}
      </button>
      <CashLine cash={events.data?.cash} />
      <Proposals proposals={events.data?.proposals ?? []} onNote={(proposal) => setEditing({ event: null, proposal })} />
      {!list.length && !events.isLoading && <EmptyJournal />}
      {pending.length > 0 && (
        <Card className="divide-y divide-line">
          {pending.map((e) => (
            <EventRow key={e.id} e={e} onOpen={edit} />
          ))}
        </Card>
      )}
      {open && done.length > 0 && (
        <Card className="divide-y divide-line">
          {done.map((e) => (
            <EventRow key={e.id} e={e} onOpen={edit} />
          ))}
        </Card>
      )}
      <AddButton onClick={() => setEditing({ event: null })} className="card w-full gap-2 px-4 py-3 text-left text-sm" />
      {editing && <EventSheet event={editing.event} proposal={editing.proposal} hints={hints} onClose={() => setEditing(null)} />}
    </section>
  );
}

const EVENT_COLUMNS: Column<CryptoEvent>[] = [
  { key: "date", header: t("Date"), sort: (e) => e.date, cell: (e) => <div className="tnum py-1 leading-tight text-muted">{period(e)}</div>, width: "130px" },
  {
    key: "title",
    header: t("Mouvement"),
    sort: (e) => e.title,
    cell: (e) => (
      <div className="min-w-0 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{e.title}</span>
          {isPending(e) && <PendingChip />}
        </div>
        {e.note && <div className="line-clamp-1 text-[12px] text-muted">{e.note}</div>}
      </div>
    ),
  },
  { key: "type", header: t("Genre##mouvement"), sort: (e) => kindLabel(e.type), cell: (e) => <span className="text-muted">{kindLabel(e.type) || "—"}</span>, hideBelow: "lg" },
  { key: "platform", header: t("Plateforme"), sort: (e) => e.platform ?? "", cell: (e) => <span className="text-muted">{e.platform ?? "—"}</span>, hideBelow: "lg" },
  { key: "qty", header: t("Quantité"), align: "right", sort: (e) => e.quantity, cell: (e) => (e.quantity != null ? `${qty(Number(e.quantity))} ${e.asset ?? ""}` : "—"), hideBelow: "xl" },
  {
    key: "price",
    header: t("Cours"),
    align: "right",
    sort: (e) => unitPrice(e)?.price ?? null,
    cell: (e) => {
      const unit = unitPrice(e);
      return unit ? <span title={unit.derived ? t("Montant divisé par la quantité : frais compris.") : undefined}>{money(unit.price)}</span> : <span className="text-muted">—</span>;
    },
    hideBelow: "xl",
  },
  { key: "value", header: t("Valeur"), align: "right", sort: (e) => e.value, cell: (e) => (e.value != null ? money(e.value) : <span className="text-muted">—</span>) },
];

/** Journal sur ordinateur : un tableau qui se trie ; une ligne s'ouvre pour être corrigée. */
export function JournalTable({ hints }: { hints: JournalHints }) {
  const events = useCryptoEvents();
  const list = events.data?.events ?? [];
  const pending = list.filter(isPending);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Ce qui attend reste en vue même journal replié.
  const rows = open ? list : pending;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" onClick={() => setOpen((o) => !o)} disabled={!list.length} className="flex items-center gap-1.5 font-semibold">
            {t("Journal des mouvements")} <span className={cn("tnum text-[12px] font-normal text-muted")}>{list.length}</span>
            {list.length > 0 && <ChevronDown size={15} className={clsx("text-muted transition", open && "rotate-180")} />}
          </button>
          <CashLine cash={events.data?.cash} />
        </div>
        <AddButton onClick={() => setEditing({ event: null })} className="rounded-md border border-line bg-card px-3 py-1.5 text-[13px] text-ink hover:bg-bg" />
      </div>
      <Proposals proposals={events.data?.proposals ?? []} onNote={(proposal) => setEditing({ event: null, proposal })} />
      {!list.length && !events.isLoading && <EmptyJournal />}
      {rows.length > 0 && <DataTable rows={rows} columns={EVENT_COLUMNS} rowKey={(e) => String(e.id)} initialSort={{ key: "date", dir: "desc" }} onRowClick={(event) => setEditing({ event })} />}
      {editing && <EventSheet event={editing.event} proposal={editing.proposal} hints={hints} onClose={() => setEditing(null)} />}
    </section>
  );
}

/* ---------- Saisie ---------- */

const today = () => new Date().toLocaleDateString("sv-SE");
/** Nombre remis dans un champ : écrit comme le membre le saisit dans sa langue, sans séparateur de milliers. */
const shown = (n: number | null | undefined) => (n == null ? "" : Number(n).toLocaleString(locale(), { useGrouping: false, maximumFractionDigits: 10 }));
/** Nombre saisi (virgule ou point) ; vide : `null` ; illisible : `NaN`. */
function parsed(text: string): number | null {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  return clean ? Number(clean) : null;
}

const INPUT = "w-full bg-transparent text-[16px] font-medium outline-none placeholder:font-normal placeholder:text-muted/70";

function Box({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("card block px-3.5 py-2.5", className)}>
      <span className="block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="card flex items-start gap-3 px-3.5 py-2.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 accent-[var(--color-accent)]" />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Ajout (`event` nul) ou correction d'un mouvement. Une proposition de Pécule remplit le formulaire : le membre la
 * relit, la corrige, puis la note — ou referme sans rien écrire.
 */
function EventSheet({ event, proposal, hints, onClose }: { event: CryptoEvent | null; proposal?: CryptoProposal; hints: JournalHints; onClose: () => void }) {
  const qc = useQueryClient();
  const seed = event ?? proposal;
  const [type, setType] = useState<EventKind>(kindOf(seed?.type) ?? (seed ? "autre" : "achat"));
  const [date, setDate] = useState(seed?.date ?? today());
  const [ranged, setRanged] = useState(!!event?.end_date && event.end_date !== event.date);
  const [endDate, setEndDate] = useState(event?.end_date ?? "");
  const [asset, setAsset] = useState(seed?.asset ?? "");
  const [quantity, setQuantity] = useState(shown(seed?.quantity));
  const [value, setValue] = useState(shown(seed?.value));
  const [price, setPrice] = useState(shown(event?.price));
  const [fee, setFee] = useState(shown(event?.fee));
  const [platform, setPlatform] = useState(seed?.platform ?? "");
  const [pending, setPending] = useState(event?.status === "attente");
  // Un transfert reconnu entre deux portefeuilles, une arrivée, un départ : le titre le dit, le genre ne suffit pas.
  const [title, setTitle] = useState(event?.title ?? (proposal && (proposal.fromPlatform || proposal.direction) ? proposalTitle(proposal) : ""));
  const [note, setNote] = useState(event?.note ?? "");
  const [busy, setBusy] = useState(false);

  const numbers = { quantity: parsed(quantity), value: parsed(value), price: parsed(price), fee: parsed(fee) };
  const what = [numbers.quantity != null && Number.isFinite(numbers.quantity) ? qty(numbers.quantity) : null, asset.trim()].filter(Boolean).join(" ") || null;
  const proposed = defaultTitle(t(EVENT_KIND_INFO[type].label), what, platform);
  const derived = unitPrice({ type, quantity: numbers.quantity, value: numbers.value });
  const invalid = Object.values(numbers).some((n) => n != null && !Number.isFinite(n));
  const badPeriod = ranged && !!endDate && endDate < date;
  const ready = !!date && !invalid && !badPeriod && (!ranged || !!endDate);

  const done = async (message: string) => {
    await qc.invalidateQueries({ queryKey: ["crypto-events"] });
    toast.success(message);
    onClose();
  };

  async function save() {
    setBusy(true);
    const json = {
      date,
      endDate: ranged && endDate ? endDate : null,
      type,
      title: title.trim() || proposed,
      asset: asset.trim() || null,
      ...numbers,
      platform: platform.trim() || null,
      status: pending ? "attente" : "fait",
      note: note.trim() || null,
    };
    try {
      if (event) await api(`/crypto/events/${event.id}`, { method: "PATCH", json });
      else await api("/crypto/events", { method: "POST", json: proposal ? { ...json, proposal: proposal.ref } : json });
      await done(event ? t("Mouvement mis à jour") : t("Mouvement ajouté"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
      setBusy(false);
    }
  }

  async function remove() {
    if (!event || !confirm(t("Supprimer « {titre} » du journal ?", { titre: event.title }))) return;
    setBusy(true);
    try {
      await api(`/crypto/events/${event.id}`, { method: "DELETE" });
      await done(t("Mouvement supprimé"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Suppression impossible"));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={event ? t("Modifier le mouvement") : t("Ajouter un mouvement")}>
      <div className="space-y-3">
        {proposal && (
          <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-xs leading-relaxed">
            <span className="font-medium">{proposalSource(proposal)}.</span> {t("Relis, corrige ce qui doit l'être, puis note-le.")}
            {proposal.origin === "synchro" && proposal.type !== "achat" && proposal.type !== "vente" && ` ${t("Le montant est une estimation au cours du jour de la lecture.")}`}
          </p>
        )}
        <div>
          <Box label={t("Genre##mouvement")}>
            <select value={type} onChange={(e) => setType(e.target.value as EventKind)} className={cn(INPUT, "-ml-0.5")}>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(EVENT_KIND_INFO[k].label)}
                </option>
              ))}
            </select>
          </Box>
          <p className="mt-1 px-1 text-xs text-muted">{t(EVENT_KIND_INFO[type].hint)}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Box label={ranged ? t("Du##date") : t("Date")} className={ranged ? undefined : "col-span-2"}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(INPUT, "tnum")} />
          </Box>
          {ranged && (
            <Box label={t("Au##date")}>
              <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} className={cn(INPUT, "tnum")} />
            </Box>
          )}
        </div>
        {badPeriod && <p className="px-1 text-xs text-neg">{t("La fin de la période précède son début")}</p>}
        <Check checked={ranged} onChange={setRanged} label={t("Sur une période")} hint={t("Pour résumer plusieurs mouvements en une ligne : des récompenses cumulées, une série de virements.")} />

        <div className="grid grid-cols-2 gap-3">
          <Box label={t("Crypto")}>
            <input value={asset} onChange={(e) => setAsset(e.target.value)} list="journal-cryptos" placeholder="BTC" autoCapitalize="characters" className={INPUT} />
          </Box>
          <Box label={t("Quantité")}>
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" placeholder="0" className={cn(INPUT, "tnum")} />
          </Box>
          <Box label={t("Montant ({devise})", { devise: moneySymbol() })}>
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0" className={cn(INPUT, "tnum")} />
          </Box>
          <Box label={t("Cours ({devise})", { devise: moneySymbol() })}>
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder={derived ? shown(Math.round(derived.price * 100) / 100) : t("facultatif")} className={cn(INPUT, "tnum")} />
          </Box>
          <Box label={t("Frais ({devise})", { devise: moneySymbol() })}>
            <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder={t("facultatif")} className={cn(INPUT, "tnum")} />
          </Box>
          <Box label={t("Plateforme")}>
            <input value={platform} onChange={(e) => setPlatform(e.target.value)} list="journal-plateformes" placeholder={t("facultatif")} maxLength={60} className={INPUT} />
          </Box>
        </div>
        {invalid && <p className="px-1 text-xs text-neg">{t("Un des nombres saisis n'est pas lisible.")}</p>}

        <Check checked={pending} onChange={setPending} label={t("En attente##mouvement")} hint={t("Un ordre posé et pas encore exécuté, un retrait en cours : tu le compléteras quand il sera passé.")} />

        <Box label={t("Titre")}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={proposed} maxLength={255} className={INPUT} />
        </Box>
        <Box label={t("Note")}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} placeholder={t("Pourquoi, d'où viennent les fonds, la référence de l'ordre…")} className={cn(INPUT, "resize-y text-[15px] font-normal leading-snug")} />
        </Box>

        <datalist id="journal-cryptos">
          {hints.assets.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <datalist id="journal-plateformes">
          {hints.platforms.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <button type="button" onClick={save} disabled={!ready || busy} className="press w-full rounded-xl bg-accent py-3 text-[15px] font-semibold text-white disabled:opacity-50">
          {event ? t("Enregistrer") : t("Ajouter au journal")}
        </button>
        {event && (
          <button type="button" onClick={remove} disabled={busy} className="press flex w-full items-center justify-center gap-1.5 py-2 text-sm text-neg disabled:opacity-50">
            <Trash2 size={15} /> {t("Supprimer ce mouvement")}
          </button>
        )}
        <p className="px-1 text-xs text-muted">{t("Le journal raconte ce que tu as fait : il ne change ni tes positions ni leur valeur.")}</p>
      </div>
    </Sheet>
  );
}

/* ---------- Mouvements lus dans les exports d'une appli ---------- */

/** Genre écrit par l'appli, rendu lisible faute de mieux (« crypto_earn_interest_paid » → « crypto earn interest paid »). */
const rawKind = (kind: string) => kind.replace(/[_.]+/g, " ");
const signed = (m: CryptoSourceMove) => `${m.amount > 0 ? "+" : "−"}${qty(Math.abs(m.amount))} ${m.symbol}`;
const MOVES_STEP = 200;

/**
 * Ce que Pécule a lu dans les exports d'un portefeuille (appli sans clé d'API) : tous ses mouvements, tels que
 * l'appli les écrit. Toucher une ligne ouvre le mouvement rempli, à relire avant de le noter au journal ; rien n'y
 * est noté d'office.
 */
export function SourceMovesSheet({ portfolioId, hints, onClose }: { portfolioId: string; hints: JournalHints; onClose: () => void }) {
  const qc = useQueryClient();
  const [limit, setLimit] = useState(MOVES_STEP);
  const [noting, setNoting] = useState<CryptoProposal | null>(null);
  const moves = useCryptoSourceMoves(portfolioId, limit);
  const data = moves.data;
  const note = (m: CryptoSourceMove) =>
    setNoting({ ref: m.ref, origin: "fichier", date: m.at.slice(0, 10), since: null, type: m.type ?? "autre", asset: m.symbol, quantity: Math.abs(m.amount), value: null, platform: data?.name ?? null, fromPlatform: null, direction: null, label: null, account: null });
  return (
    <Sheet open onClose={onClose} title={data ? t("Mouvements de « {nom} »", { nom: data.name }) : t("Mouvements")}>
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          <p className="px-1 text-xs leading-relaxed text-muted">
            {tn("{n} mouvement lu dans les fichiers que tu as déposés, tel que l'appli l'écrit.", "{n} mouvements lus dans les fichiers que tu as déposés, tels que l'appli les écrit.", data.total)}{" "}
            {t("Touche une ligne pour la noter au journal : tu la relis avant.")}
          </p>
          <Card className="divide-y divide-line">
            {data.moves.map((m) => (
              <button key={m.ref} type="button" disabled={m.noted} onClick={() => note(m)} className="press flex w-full items-center gap-3 px-4 py-2.5 text-left disabled:opacity-100">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{m.type ? kindLabel(m.type) : rawKind(m.kind)}</div>
                  <div className="truncate text-xs text-muted">
                    {dateFr(m.at.slice(0, 10))}
                    {m.type && ` · ${rawKind(m.kind)}`}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tnum text-sm font-semibold">{signed(m)}</div>
                  {m.noted && (
                    <div className="flex items-center justify-end gap-1 text-[11px] text-muted">
                      <CheckIcon size={12} /> {t("noté au journal")}
                    </div>
                  )}
                </div>
              </button>
            ))}
            {!data.moves.length && <div className="px-4 py-3 text-sm text-muted">{t("Aucun mouvement.")}</div>}
          </Card>
          {data.moves.length < data.total && (
            <button type="button" onClick={() => setLimit((n) => n + MOVES_STEP)} disabled={moves.isFetching} className="press card w-full px-4 py-3 text-sm font-medium text-accent disabled:opacity-50">
              {t("Afficher les mouvements plus anciens ({reste})", { reste: data.total - data.moves.length })}
            </button>
          )}
        </div>
      )}
      {noting && (
        <EventSheet
          event={null}
          proposal={noting}
          hints={hints}
          onClose={() => {
            setNoting(null);
            void qc.invalidateQueries({ queryKey: ["crypto-source-moves", portfolioId] });
          }}
        />
      )}
    </Sheet>
  );
}
