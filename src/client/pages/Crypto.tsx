import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, FileUp, Layers, PencilLine, Plus, RefreshCw, Trash2, Wallet, X, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api, useCrypto, type CryptoPosition, type CryptoSource, type CryptoStatus } from "../api.ts";
import { Card, ErrorBox, Field, PageHeader, Segmented, Sheet, Spinner } from "../components/ui.tsx";
import { dateFr, money, moneySymbol, pct, timeAgo } from "../format.ts";
import { useCryptoEvents, type CryptoEvent } from "../api-situation.ts";
import { BrandLogo, CoinLogo, Tile } from "../components/Logo.tsx";
import { brandOf } from "../../lib/brands.ts";
import { EXCHANGES, type ExchangeId } from "../../lib/crypto-exchanges.ts";
import { FILE_APPS, type FileAppId } from "../../lib/crypto-files.ts";
import { AddWalletSheet, DuplicateNotices, ObservedSheet } from "../components/CryptoWallet.tsx";
import { CryptoEvolution } from "../components/CryptoEvolution.tsx";
import { useMedia } from "../useMedia.ts";
import { Stat, StatGrid } from "../components/blocks.tsx";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { cn } from "../cn.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

const qty = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: n < 1 ? 6 : 4 });
const SMALL = 1; // lignes de moins d'une unité de la devise du foyer : regroupées

type Group = { key: string; symbol: string; name: string; value: number; quantity: number; change: number | null; lines: CryptoPosition[] };

function bySymbol(positions: CryptoPosition[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of positions) {
    const k = p.symbol.toUpperCase();
    const g = map.get(k) ?? { key: k, symbol: p.symbol, name: p.name, value: 0, quantity: 0, change: null, lines: [] };
    g.value += p.value ?? 0;
    g.quantity += p.manual_value != null ? 0 : p.quantity;
    g.lines.push(p);
    if (p.change_24h != null && g.change == null) g.change = Number(p.change_24h);
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

/** Portefeuille choisi dans la liste : ses cryptos ressortent dans « Par crypto ». `MANUAL` : les lignes saisies à la main. */
const MANUAL = "manuel";
const inFocus = (p: CryptoPosition, focus: string) => (focus === MANUAL ? p.source === "manuel" : p.portfolio_id === focus);
/** Ce que le portefeuille choisi porte de cette crypto (sa valeur) ; `null` s'il n'en porte pas. */
function shareOf(g: Group, focus: string | null): number | null {
  if (!focus) return null;
  const lines = g.lines.filter((l) => inFocus(l, focus));
  return lines.length ? lines.reduce((sum, l) => sum + (l.value ?? 0), 0) : null;
}
const focusName = (st: CryptoStatus, focus: string) => (focus === MANUAL ? t("Saisis à la main") : (st.sources.find((s) => s.portfolioId === focus)?.name ?? ""));
/** Ligne d'une crypto du portefeuille choisi : fond teinté et filet d'accent, comme une ligne choisie dans un tableau. */
const FOCUSED = "bg-accent-soft shadow-[inset_3px_0_0_var(--color-accent)]";

/** Bandeau du portefeuille choisi : son nom, ce qu'il porte, et de quoi revenir à la liste entière. */
function FocusBar({ st, groups, focus, onClear }: { st: CryptoStatus; groups: Group[]; focus: string; onClear: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Sur un écran étroit, la liste des cryptos est plus haut que celle des portefeuilles : on y ramène le regard.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);
  const shares = groups.map((g) => shareOf(g, focus)).filter((v): v is number => v != null);
  return (
    <div ref={ref} className="flex scroll-mt-20 items-center gap-3 rounded-xl bg-accent-soft px-4 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{t("Dans « {nom} »", { nom: focusName(st, focus) })}</div>
        <div className="tnum truncate text-xs text-muted">
          {shares.length ? `${tn("{n} crypto", "{n} cryptos", shares.length)} · ${money(shares.reduce((a, b) => a + b, 0), true)}` : t("Aucune crypto comptée ici")}
        </div>
      </div>
      <button type="button" onClick={onClear} className="press flex shrink-0 items-center gap-1 text-xs font-medium text-accent">
        <X size={14} /> {t("Tout afficher")}
      </button>
    </div>
  );
}

export function Crypto() {
  const { data, isLoading, error } = useCrypto();
  const qc = useQueryClient();
  const [view, setView] = useState<"coins" | "portefeuilles">("coins");
  const [open, setOpen] = useState<Group | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showSmall, setShowSmall] = useState(false);
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const desktop = useMedia("(min-width: 768px)");

  const groups = useMemo(() => bySymbol(data?.positions ?? []), [data]);
  // Les cryptos du portefeuille choisi passent devant, par ce qu'il en porte ; les petites lignes des autres restent repliées.
  const mine = focus ? groups.filter((g) => shareOf(g, focus) != null).sort((a, b) => (shareOf(b, focus) ?? 0) - (shareOf(a, focus) ?? 0)) : [];
  const others = groups.filter((g) => !mine.includes(g));
  const big = others.filter((g) => g.value >= SMALL);
  const small = others.filter((g) => g.value < SMALL);
  const smallTotal = small.reduce((s, g) => s + g.value, 0);
  // Toucher un portefeuille montre ses cryptos : sur téléphone, la liste « Par crypto » prend la place.
  const pick = (id: string) => {
    setFocus((now) => (now === id ? null : id));
    if (focus !== id) setView("coins");
  };

  async function sync() {
    setSyncing(true);
    try {
      // Le détail n'est rendu qu'au titulaire des portefeuilles ; un autre membre apprend seulement que c'est fait.
      const r = await api<{ sources?: number; lines?: number; archived?: number }>("/crypto/sync", { method: "POST" });
      await Promise.all([qc.invalidateQueries({ queryKey: ["crypto"] }), qc.invalidateQueries({ queryKey: ["wealth"] })]);
      toast.success(
        r.sources == null
          ? t("Fait")
          : `${tn("{n} portefeuille", "{n} portefeuilles", r.sources)}, ${tn("{n} ligne", "{n} lignes", r.lines ?? 0)}${r.archived ? ` · ${tn("{n} ligne manuelle archivée", "{n} lignes manuelles archivées", r.archived)}` : ""}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Synchro impossible"));
    } finally {
      setSyncing(false);
    }
  }

  const st = data?.status;
  if (desktop && data && st)
    return (
      <>
        <CryptoDesktop data={data} st={st} groups={groups} onOpen={setOpen} syncing={syncing} onSync={sync} onAdd={() => setAdding(true)} focus={focus} onFocus={pick} />
        <GroupSheet g={open} onClose={() => setOpen(null)} />
        <AddWalletSheet open={adding} onClose={() => setAdding(false)} st={st} />
      </>
    );
  return (
    <>
      <PageHeader
        title={t("Crypto")}
        right={
          st ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setAdding(true)} className="press grid size-10 place-items-center rounded-full bg-card text-accent ring-1 ring-line" aria-label={t("Ajouter un portefeuille")}>
                <Plus size={20} />
              </button>
              {canSync(st) && (
                <button type="button" onClick={sync} disabled={syncing} className="press grid size-10 place-items-center rounded-full bg-card text-accent ring-1 ring-line" aria-label={syncLabel()}>
                  <RefreshCw size={18} className={clsx(syncing && "animate-spin")} />
                </button>
              )}
            </div>
          ) : undefined
        }
      />
      {error && <ErrorBox error={error} />}
      {isLoading || !data || !st ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="text-sm text-muted">{t("Valeur totale")}</div>
            <div className="tnum mt-1 text-[34px] font-bold tracking-tight">{money(data.total, true)}</div>
            <div className="mt-0.5 text-sm text-muted">
              {data.change24h != null && (
                <span className={clsx("tnum font-medium", data.change24h >= 0 ? "text-pos" : "text-neg")}>
                  {t("{variation} sur 24 h", { variation: `${data.change24h >= 0 ? "+" : ""}${pct(data.change24h, 1)}` })} ·{" "}
                </span>
              )}
              {t("cours {quand}", { quand: timeAgo(data.pricesAt) })}
            </div>
            <SyncLine st={st} />
          </Card>

          <DuplicateNotices st={st} />

          <CryptoEvolution history={data.history} />

          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "coins", label: t("Par crypto") },
              { value: "portefeuilles", label: t("Par portefeuille") },
            ]}
          />

          {view === "coins" && focus && <FocusBar st={st} groups={groups} focus={focus} onClear={() => setFocus(null)} />}

          {view === "coins" ? (
            <Card className="divide-y divide-line overflow-hidden">
              {mine.map((g) => (
                <GroupRow key={g.key} g={g} onClick={() => setOpen(g)} here={shareOf(g, focus)} />
              ))}
              {big.map((g) => (
                <GroupRow key={g.key} g={g} onClick={() => setOpen(g)} away={!!focus} />
              ))}
              {small.length > 0 && (
                <>
                  <button type="button" onClick={() => setShowSmall(!showSmall)} className="press flex w-full items-center justify-between px-4 py-3 text-sm text-muted">
                    <span>
                      {tn("{n} petite ligne (moins de {seuil}) · {total}", "{n} petites lignes (moins de {seuil} chacune) · {total}", small.length, { seuil: money(SMALL, true), total: money(smallTotal) })}
                    </span>
                    <ChevronDown size={16} className={clsx("transition-transform", showSmall && "rotate-180")} />
                  </button>
                  {showSmall && small.map((g) => <GroupRow key={g.key} g={g} onClick={() => setOpen(g)} away={!!focus} />)}
                </>
              )}
            </Card>
          ) : (
            <Portfolios positions={data.positions} st={st} onAdd={() => setAdding(true)} focus={focus} onFocus={pick} />
          )}

          <Archived st={st} />

          <Journal />

          <Sources st={st} className="px-1 text-xs leading-relaxed text-muted" />
        </div>
      )}
      <GroupSheet g={open} onClose={() => setOpen(null)} />
      {st && <AddWalletSheet open={adding} onClose={() => setAdding(false)} st={st} />}
    </>
  );
}

/** Il y a quelque chose à relire : le compte CoinStats du foyer, ou un portefeuille ajouté par son adresse. */
const canSync = (st: CryptoStatus) => st.enabled || st.sources.some((s) => s.direct && s.enabled);
const syncLabel = () => t("Synchroniser");

function SyncLine({ st }: { st: CryptoStatus }) {
  // Tout ce qui est relié se relit ensemble, d'où que cela vienne : adresse, exchange ou compte CoinStats.
  const read = st.sources.filter((s) => s.enabled && !s.file && (s.direct || st.enabled));
  if (!read.length && st.sources.some((s) => s.file && s.enabled)) return <div className="mt-2 text-xs text-muted">{t("Tenu par les fichiers déposés : dépose un nouvel export pour mettre à jour.")}</div>;
  if (!read.length) return <div className="mt-2 text-xs text-muted">{t("Rien n'est relié pour le moment : ajoute un portefeuille, ou saisis tes positions à la main.")}</div>;
  const r = st.lastRun;
  if (st.enabled && r?.status === "error") return <div className="mt-2 text-xs text-neg">{t("Dernière synchro en échec {quand}", { quand: timeAgo(r.startedAt) })}</div>;
  if (r?.status === "running") return <div className="mt-2 text-xs text-muted">{t("Synchro en cours…")}</div>;
  const last = read.map((s) => s.lastSyncedAt).filter(Boolean).sort().at(-1);
  return <div className="mt-2 text-xs text-muted">{tn("{n} portefeuille relu {quand}", "{n} portefeuilles relus {quand}", read.length, { quand: timeAgo(last ?? null) })}</div>;
}

/** D'où viennent les quantités et les cours : dit en bas de l'écran, selon ce que le foyer a relié. */
function Sources({ st, className }: { st: CryptoStatus; className: string }) {
  const linked = st.enabled || st.sources.some((s) => s.direct);
  return (
    <p className={className}>
      {linked && <>{t("Ce que tu as relié est relu une fois par jour ; rien ici ne peut dépenser ni vendre.")} </>}
      {st.enabled && (
        <>
          <b>Powered by CoinStats</b> {t("pour les portefeuilles de ce compte.")}{" "}
        </>
      )}
      {t("Cours :")} <b>Data provided by CoinGecko</b>, {t("toutes les heures.")} {t("Les lignes saisies à la main restent modifiables.")}
    </p>
  );
}

/** `here` : ce que le portefeuille choisi porte de cette crypto (elle ressort) ; `away` : un autre portefeuille est choisi. */
function GroupRow({ g, onClick, here = null, away = false }: { g: Group; onClick: () => void; here?: number | null; away?: boolean }) {
  const manual = g.lines.some((l) => l.source === "manuel");
  return (
    <button type="button" onClick={onClick} className={clsx("press flex w-full items-center gap-3 px-4 py-3 text-left", here != null && FOCUSED, away && "text-muted")}>
      <CoinLogo coingeckoId={g.lines.find((l) => l.coingecko_id)?.coingecko_id} symbol={g.symbol} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">
          {g.name}
          {manual && <span className="ml-1.5 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">{t("saisie")}</span>}
        </div>
        <div className="truncate text-xs text-muted">
          {g.quantity > 0 ? `${qty(g.quantity)} ${g.symbol}` : t("Valeur saisie")}
          {/* Portefeuille choisi : ce qu'il porte de cette crypto prend la place du nombre de portefeuilles. */}
          {g.lines.length > 1 && ` · ${here != null ? t("dont {montant} ici", { montant: money(here, here >= 1000) }) : tn("{n} portefeuille", "{n} portefeuilles", g.lines.length)}`}
        </div>
      </div>
      <div className="text-right">
        <div className="tnum font-semibold">{money(g.value, g.value >= 1000)}</div>
        {g.change != null && (
          <div className={clsx("tnum text-[11px]", g.change >= 0 ? "text-pos" : "text-neg")}>
            {g.change >= 0 ? "+" : ""}
            {pct(g.change, 1)}
          </div>
        )}
      </div>
    </button>
  );
}

const STATUS: Record<CryptoSource["status"], string> = { ok: "", vide: t("vide"), doublon: t("doublon ignoré"), a_verifier: t("à vérifier"), erreur: t("erreur"), refus: t("clé refusée") };

/** D'où vient un portefeuille : c'est ce qui range la liste, pour qu'on voie d'un coup d'œil ce qui dépend de quoi. */
type Origin = "adresse" | "exchange" | "fichier" | "agregateur";
const originOf = (s: CryptoSource): Origin => (s.exchange ? "exchange" : s.file ? "fichier" : s.direct ? "adresse" : "agregateur");
/** Chaque provenance a son pictogramme, le même que dans « Ajouter un portefeuille » ; un outil tiers a son logo. */
const ORIGINS: { id: Origin; title: string; hint: string; icon: LucideIcon; brand?: string }[] = [
  { id: "adresse", title: t("Par leur adresse"), hint: t("Lus sur la blockchain, sans intermédiaire"), icon: Wallet },
  { id: "exchange", title: t("Exchanges"), hint: t("Lus chez l'exchange, par ta clé en lecture seule"), icon: Building2 },
  { id: "fichier", title: t("Par leurs exports"), hint: t("Mis à jour quand tu déposes un fichier"), icon: FileUp },
  { id: "agregateur", title: t("Via CoinStats"), hint: t("Ce que réunit le compte CoinStats du foyer"), icon: Layers, brand: "CoinStats" },
];

/** Pictogramme d'un compartiment : le logo de l'outil s'il en a un, sinon l'icône de la provenance. */
function OriginIcon({ icon: Icon, brand }: { icon: LucideIcon; brand?: string }) {
  if (brand) return <BrandLogo texts={[brand]} size="sm" tone="neutral" icon={Icon} />;
  return (
    <Tile size="sm" tone="accent">
      <Icon size={15} />
    </Tile>
  );
}

/** Crypto dont le logo dit la blockchain d'un portefeuille lu par son adresse. */
const KIND_COIN: Record<string, string> = { btc: "bitcoin", "btc-xpub": "bitcoin", evm: "ethereum", "eth-validator": "ethereum", sol: "solana", ada: "cardano", mvx: "elrond-erd-2", "mvx-staking": "elrond-erd-2" };
/** Blockchain nommée dans un portefeuille venu d'un agrégateur (« Cardano Wallet ») : son logo, faute de marque. */
const NAME_COIN: [RegExp, string][] = [
  [/bitcoin|\bbtc\b/i, "bitcoin"],
  [/ethereum|\beth\b/i, "ethereum"],
  [/bnb|\bbsc\b/i, "binancecoin"],
  [/solana/i, "solana"],
  [/cardano/i, "cardano"],
  [/vechain/i, "vechain"],
  [/polygon/i, "polygon-ecosystem-token"],
  [/avalanche/i, "avalanche-2"],
  [/tezos/i, "tezos"],
];

/**
 * Logo d'un portefeuille : la marque que son nom cite (Ledger, Kraken…), sinon celle de son exchange ou de son
 * appli, sinon la blockchain où il est lu — jamais de simples initiales quand on sait d'où il vient.
 */
function SourceLogo({ s }: { s: CryptoSource }) {
  const known = s.exchange ? EXCHANGES[s.exchange as ExchangeId]?.name : s.file ? FILE_APPS[s.type.slice(2) as FileAppId]?.name : null;
  const coin = KIND_COIN[s.type] ?? NAME_COIN.find(([re]) => re.test(s.name))?.[1];
  if (brandOf(s.name, known) || !coin) return <BrandLogo texts={[s.name, known]} size="md" tone="neutral" />;
  return <CoinLogo coingeckoId={coin} symbol={s.name.slice(0, 3)} size="md" />;
}

type RowActions = {
  toggle: (s: CryptoSource) => void;
  remove: (s: CryptoSource) => void;
  accept: (s: CryptoSource) => void;
  accepting: string | null;
  /** Corriger un solde d'un portefeuille tenu par ses exports. */
  observe: (s: CryptoSource) => void;
  /** Portefeuille dont les cryptos ressortent dans « Par crypto », et de quoi le choisir. */
  focus: string | null;
  pick: (id: string) => void;
};

function SourceRow({ s, value, actions }: { s: CryptoSource; value: number; actions: RowActions }) {
  const warn = s.status === "a_verifier" || s.status === "erreur" || s.status === "refus";
  const chosen = actions.focus === s.portfolioId;
  return (
    <div className={clsx("px-4 py-3", chosen && FOCUSED)}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => actions.pick(s.portfolioId)} aria-pressed={chosen} title={chosen ? t("Tout afficher") : t("Voir ses cryptos")} className="press flex min-w-0 flex-1 items-center gap-3 text-left">
          <SourceLogo s={s} />
          <span className="block min-w-0 flex-1">
            <span className={clsx("block truncate text-[15px] font-medium", !s.enabled && "text-muted line-through")}>{s.name}</span>
            <span className="block truncate text-xs text-muted" title={s.note ?? undefined}>
              {[s.address, s.lines ? tn("{n} ligne", "{n} lignes", s.lines) : null].filter(Boolean).join(" · ") || t("aucune ligne")}
              {STATUS[s.status] && <span className={clsx("ml-1 font-medium", warn && "text-warn")}> · {STATUS[s.status]}</span>}
            </span>
          </span>
          <span className="tnum text-sm font-semibold">{money(value, value >= 1000)}</span>
        </button>
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={!!s.enabled} onChange={() => actions.toggle(s)} className="size-[18px] accent-[var(--color-accent)]" aria-label={t("Compter « {nom} »", { nom: s.name })} />
        </label>
        {s.file && (
          <button type="button" onClick={() => actions.observe(s)} className="press grid size-8 place-items-center rounded-full text-muted hover:text-ink" aria-label={t("Corriger un solde")} title={t("Corriger un solde")}>
            <PencilLine size={16} />
          </button>
        )}
        {(s.direct || s.file) && (
          <button type="button" onClick={() => actions.remove(s)} className="press -mr-1 grid size-8 place-items-center rounded-full text-muted hover:text-ink" aria-label={t("Retirer ce portefeuille")} title={t("Retirer ce portefeuille")}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {s.direct && s.status === "erreur" && !!s.enabled && (
        <div className="mt-2 text-xs text-muted">{t("Lecture impossible à la dernière synchro : Pécule garde les quantités d'avant et réessaiera.")}</div>
      )}
      {s.status === "refus" && !!s.enabled && (
        <div className="mt-2 text-xs text-muted">{t("L'exchange n'accepte plus cette clé (expirée, retirée ou droits changés). Pécule garde les quantités d'avant : retire ce compte et relie-le avec une nouvelle clé.")}</div>
      )}
      {s.status === "a_verifier" && !!s.enabled && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="min-w-0 flex-1">{t("CoinStats rend ce portefeuille vide ou bien plus bas qu'avant. Tant que tu ne confirmes pas, Pécule garde ses positions d'avant.")}</span>
          <button type="button" onClick={() => actions.accept(s)} disabled={actions.accepting === s.portfolioId} className="press shrink-0 text-xs font-medium text-accent disabled:opacity-50">
            {t("C'est exact")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Un compartiment de la liste : une provenance, son total, ses portefeuilles. Ceux qui ne comptent rien se replient. */
function OriginCard({ title, hint, icon, brand, rows, positions, actions }: { title: string; hint: string; icon: LucideIcon; brand?: string; rows: CryptoSource[]; positions: CryptoPosition[]; actions: RowActions }) {
  const [showIdle, setShowIdle] = useState(false);
  const valued = rows.map((s) => ({ s, value: valueOf(positions, s) })).sort((a, b) => b.value - a.value);
  // « Sans rien de compté » : vide, en double, ou dont tout est déjà compté par une lecture directe.
  const idle = valued.filter((r) => r.value === 0 && (r.s.lines === 0 || r.s.status === "doublon") && r.s.status !== "a_verifier" && r.s.status !== "erreur" && r.s.status !== "refus");
  const shown = valued.filter((r) => showIdle || !idle.includes(r) || valued.length === idle.length);
  const hidden = valued.length - shown.length;
  return (
    <Card className="divide-y divide-line">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <OriginIcon icon={icon} brand={brand} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="truncate text-xs text-muted">{hint}</div>
        </div>
        <span className="tnum shrink-0 text-sm font-semibold">{money(valued.reduce((sum, r) => sum + (r.s.enabled ? r.value : 0), 0), true)}</span>
      </div>
      {shown.map((r) => (
        <SourceRow key={r.s.portfolioId} s={r.s} value={r.value} actions={actions} />
      ))}
      {(hidden > 0 || (showIdle && idle.length > 0 && valued.length !== idle.length)) && (
        <button type="button" onClick={() => setShowIdle(!showIdle)} className="press flex w-full items-center justify-between px-4 py-2.5 text-xs text-muted">
          <span>{showIdle ? t("Replier ceux qui ne comptent rien") : tn("{n} autre, sans rien de compté", "{n} autres, sans rien de compté", hidden)}</span>
          <ChevronDown size={14} className={clsx("transition-transform", showIdle && "rotate-180")} />
        </button>
      )}
    </Card>
  );
}

function Portfolios({ positions, st, onAdd, focus, onFocus }: { positions: CryptoPosition[]; st: CryptoStatus; onAdd: () => void; focus: string | null; onFocus: (id: string) => void }) {
  const qc = useQueryClient();
  const [observing, setObserving] = useState<string | null>(null);
  const manual = positions.filter((p) => p.source === "manuel");
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["crypto"] }), qc.invalidateQueries({ queryKey: ["wealth"] })]);
  const toggle = (s: CryptoSource) =>
    api(`/crypto/sources/${encodeURIComponent(s.portfolioId)}`, { method: "PATCH", json: { enabled: !s.enabled } })
      .then(refresh)
      .then(() => toast.success(s.enabled ? t("Portefeuille exclu (pris en compte à la prochaine synchro si réactivé)") : t("Portefeuille réactivé : synchronise pour le compter")));
  // Un portefeuille « à vérifier » garde ses positions d'avant : le membre confirme s'il a vraiment été vidé ou vendu.
  const [accepting, setAccepting] = useState<string | null>(null);
  const accept = async (s: CryptoSource) => {
    setAccepting(s.portfolioId);
    try {
      await api(`/crypto/sources/${encodeURIComponent(s.portfolioId)}/accept`, { method: "POST" });
      await refresh();
      toast.success(t("Nouvelle valeur confirmée"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Synchro impossible"));
    } finally {
      setAccepting(null);
    }
  };
  // Un portefeuille que le membre a relié lui-même se retire ; celui d'un agrégateur se décoche (il reviendrait).
  const remove = async (s: CryptoSource) => {
    if (!confirm(t("Retirer « {nom} » ? Ses lignes ne seront plus comptées. Tu pourras l'ajouter de nouveau.", { nom: s.name }))) return;
    try {
      await api(`/crypto/sources/${encodeURIComponent(s.portfolioId)}`, { method: "DELETE" });
      await refresh();
      toast.success(t("Portefeuille retiré"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    }
  };
  const actions: RowActions = { toggle, remove, accept, accepting, observe: (s) => setObserving(s.portfolioId), focus, pick: onFocus };
  return (
    <div className="space-y-3">
      {ORIGINS.map((o) => {
        const rows = st.sources.filter((s) => originOf(s) === o.id);
        return rows.length ? <OriginCard key={o.id} title={o.title} hint={o.hint} icon={o.icon} brand={o.brand} rows={rows} positions={positions} actions={actions} /> : null;
      })}
      {manual.length > 0 && (
        <Card className="divide-y divide-line overflow-hidden">
          <button
            type="button"
            onClick={() => onFocus(MANUAL)}
            aria-pressed={focus === MANUAL}
            title={focus === MANUAL ? t("Tout afficher") : t("Voir ses cryptos")}
            className={clsx("press flex w-full items-center gap-3 px-4 py-2.5 text-left", focus === MANUAL && FOCUSED)}
          >
            <OriginIcon icon={PencilLine} />
            <span className="block min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{t("Saisis à la main")}</span>
              <span className="block truncate text-xs text-muted">{manual.map((m) => m.symbol).join(", ")}</span>
            </span>
            <span className="tnum shrink-0 text-sm font-semibold">{money(manual.reduce((sum, m) => sum + (m.value ?? 0), 0), true)}</span>
          </button>
        </Card>
      )}
      {!st.sources.length && !manual.length && <Card className="px-4 py-3 text-sm text-muted">{t("Aucun portefeuille.")}</Card>}
      <button type="button" onClick={onAdd} className="press card flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-accent">
        <Plus size={16} /> {t("Ajouter un portefeuille")}
      </button>
      <ObservedSheet source={st.sources.find((s) => s.portfolioId === observing) ?? null} positions={positions} onClose={() => setObserving(null)} />
    </div>
  );
}

const valueOf = (positions: CryptoPosition[], s: CryptoSource) => positions.filter((p) => p.portfolio_id === s.portfolioId).reduce((sum, p) => sum + (p.value ?? 0), 0);

function Archived({ st }: { st: CryptoStatus }) {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  if (!st.archived.length) return null;
  const restore = (id: number) =>
    api(`/crypto/${id}/restore`, { method: "POST" })
      .then(() => Promise.all([qc.invalidateQueries({ queryKey: ["crypto"] }), qc.invalidateQueries({ queryKey: ["wealth"] })]))
      .then(() => toast.success(t("Ligne remise en compte")));
  // Une ligne archivée ne compte plus : la supprimer ne change aucun total, mais ne se rattrape pas.
  const remove = async (id: number, symbol: string) => {
    if (!confirm(t("Supprimer pour de bon la ligne « {nom} » ? Elle ne pourra plus être remise en compte.", { nom: symbol }))) return;
    try {
      await api(`/crypto/${id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["crypto"] });
      toast.success(t("Ligne supprimée"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    }
  };
  return (
    <Card>
      <button type="button" onClick={() => setShow(!show)} className="press flex w-full items-center justify-between px-4 py-3 text-sm">
        <span className="font-medium">{t("Lignes saisies à la main archivées ({n})", { n: st.archived.length })}</span>
        <ChevronDown size={16} className={clsx("text-muted transition-transform", show && "rotate-180")} />
      </button>
      {show && (
        <div className="divide-y divide-line border-t border-line">
          {st.archived.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {a.symbol} · {a.manualValue != null && !(Number(a.quantity) > 0) ? money(Number(a.manualValue)) : qty(Number(a.quantity))}
                </div>
                <div className="text-xs text-muted">
                  {a.archivedReason} · {dateFr(a.archivedAt)}
                </div>
              </div>
              <button type="button" onClick={() => restore(a.id)} className="press shrink-0 text-xs font-medium text-accent">
                {t("Remettre en compte")}
              </button>
              <button type="button" onClick={() => remove(a.id, a.symbol)} className="press -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted hover:text-ink" aria-label={t("Supprimer la ligne archivée")} title={t("Supprimer la ligne archivée")}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function GroupSheet({ g, onClose }: { g: Group | null; onClose: () => void }) {
  if (!g) return null;
  return (
    <Sheet open onClose={onClose} title={`${g.name} (${g.symbol})`}>
      <Card className="mb-3 divide-y divide-line">
        {g.lines.map((p) => (
          <div key={p.id} className="px-4 py-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="min-w-0 truncate font-medium">{p.location ?? (p.source === "manuel" ? t("Saisie à la main") : "CoinStats")}</span>
              <span className="tnum font-semibold">{money(p.value)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {p.manual_value != null ? t("Valeur saisie") : `${qty(p.quantity)} ${p.symbol}`}
              {p.price != null && ` × ${money(p.price)} (${p.price_source === "coingecko" ? "CoinGecko" : p.source === "exchange" ? t("cours de l'exchange") : p.source === "coinstats" ? "CoinStats" : t("cours de la blockchain")})`}
              {p.source === "coinstats"
                ? ` · ${t("synchro {quand}", { quand: timeAgo(p.synced_at) })}`
                : p.source === "onchain"
                  ? ` · ${t("lu sur la blockchain {quand}", { quand: timeAgo(p.synced_at) })}`
                  : p.source === "exchange"
                    ? ` · ${t("lu chez l'exchange {quand}", { quand: timeAgo(p.synced_at) })}`
                    : p.source === "fichier"
                      ? ` · ${t("d'après le fichier déposé {quand}", { quand: timeAgo(p.synced_at) })}`
                  : p.updated_at
                    ? ` · ${t("saisie le {date}", { date: dateFr(p.updated_at) })}`
                    : ""}
            </div>
            {p.source === "manuel" && <ManualEdit p={p} onDone={onClose} />}
          </div>
        ))}
      </Card>
    </Sheet>
  );
}

function ManualEdit({ p, onDone }: { p: CryptoPosition; onDone: () => void }) {
  const qc = useQueryClient();
  const manual = p.manual_value != null;
  const [val, setVal] = useState("");
  useEffect(() => {
    setVal(String(p.manual_value ?? p.quantity));
  }, [p]);
  async function save() {
    const n = Number(val.replace(/\s/g, "").replace(",", "."));
    if (Number.isNaN(n) || n < 0) return toast.error(t("Valeur invalide"));
    try {
      await api(`/crypto/${p.id}`, { method: "PATCH", json: manual ? { manualValue: n } : { quantity: n } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["crypto"] }), qc.invalidateQueries({ queryKey: ["wealth"] })]);
      toast.success(t("Position mise à jour"));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    }
  }
  return (
    <div className="mt-3">
      <Field label={manual ? t("Valeur ({devise})", { devise: moneySymbol() }) : t("Quantité ({symbole})", { symbole: p.symbol })} value={val} onChange={setVal} />
      <button type="button" onClick={save} className="press mt-2 w-full rounded-xl bg-accent py-3 font-semibold text-white">
        {t("Enregistrer")}
      </button>
    </div>
  );
}

/** Journal des mouvements (achats, ventes, transferts, staking…). */
function Journal() {
  const [open, setOpen] = useState(false);
  const events = useCryptoEvents();
  const list = events.data?.events ?? [];
  if (!list.length) return null;
  return (
    <section>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mb-1.5 flex w-full items-center justify-between px-1 text-[15px] font-semibold text-ink">
        {t("Journal des mouvements ({n})", { n: list.length })}
        <ChevronDown size={16} className={clsx("transition", open && "rotate-180")} />
      </button>
      {open && (
        <Card className="divide-y divide-line">
          {list.map((e) => (
            <div key={e.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[15px] font-medium">{e.title}</span>
                {e.value != null && <span className="tnum shrink-0 text-sm font-semibold">{money(e.value)}</span>}
              </div>
              <div className="truncate text-xs text-muted">
                {dateFr(e.date)}
                {e.type && ` · ${e.type}`}
                {e.platform && ` · ${e.platform}`}
                {e.quantity != null && e.asset && ` · ${qty(Number(e.quantity))} ${e.asset}`}
              </div>
              {e.note && <div className="mt-0.5 line-clamp-2 text-xs text-muted">{e.note}</div>}
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

/* ---------- Ordinateur ---------- */

type CryptoData = NonNullable<ReturnType<typeof useCrypto>["data"]>;

function CryptoDesktop({
  data,
  st,
  groups,
  onOpen,
  syncing,
  onSync,
  onAdd,
  focus,
  onFocus,
}: {
  data: CryptoData;
  st: CryptoStatus;
  groups: Group[];
  onOpen: (g: Group) => void;
  syncing: boolean;
  onSync: () => void;
  onAdd: () => void;
  focus: string | null;
  onFocus: (id: string) => void;
}) {
  const [showSmall, setShowSmall] = useState(false);
  // Les cryptos du portefeuille choisi se montrent toutes, même les petites lignes.
  const rows = showSmall ? groups : groups.filter((g) => g.value >= SMALL || shareOf(g, focus) != null);
  const hiddenCount = groups.length - groups.filter((g) => g.value >= SMALL).length;
  const change24 = data.change24h != null ? (data.total * data.change24h) / (100 + data.change24h) : null;
  const top = groups.slice(0, 8);
  const rest = groups.slice(8).reduce((s, g) => s + g.value, 0);
  const max = Math.max(1, ...top.map((g) => g.value));
  // Part d'une crypto dans le total ; rien n'a de cours (total nul) : zéro, pas une division par zéro.
  const weight = (g: Group) => (data.total > 0 ? (g.value / data.total) * 100 : 0);
  const columns: Column<Group>[] = [
    {
      key: "name",
      header: t("Crypto"),
      sort: (g) => g.name,
      cell: (g) => (
        <div className="flex min-w-0 items-center gap-2.5 py-1">
          <CoinLogo coingeckoId={g.lines.find((l) => l.coingecko_id)?.coingecko_id} symbol={g.symbol} size="sm" />
          <span className="text-[11px] font-semibold text-muted">{g.symbol.toUpperCase().slice(0, 6)}</span>
          <span className="truncate font-medium">{g.name}</span>
          {g.lines.some((l) => l.source === "manuel") && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">{t("saisie")}</span>}
          {g.lines.some((l) => l.source === "onchain") && <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] text-muted">{t("blockchain")}</span>}
          {shareOf(g, focus) != null && g.lines.length > 1 && <span className="chip tnum shrink-0">{t("dont {montant} ici", { montant: money(shareOf(g, focus) ?? 0, true) })}</span>}
        </div>
      ),
    },
    { key: "qty", header: t("Quantité"), align: "right", sort: (g) => g.quantity, cell: (g) => (g.quantity > 0 ? qty(g.quantity) : <span className="text-muted">{t("valeur saisie")}</span>), hideBelow: "lg" },
    { key: "price", header: t("Cours"), align: "right", sort: (g) => g.lines[0]?.price ?? null, cell: (g) => (g.lines[0]?.price != null ? money(Number(g.lines[0].price)) : "—"), hideBelow: "xl" },
    {
      key: "change",
      header: t("24 h"),
      align: "right",
      className: "whitespace-nowrap",
      sort: (g) => g.change,
      cell: (g) =>
        g.change != null ? (
          <span className={g.change >= 0 ? "text-pos" : "text-neg"}>
            {g.change >= 0 ? "+" : ""}
            {pct(g.change, 1)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: "wallets", header: t("Portefeuilles"), align: "right", sort: (g) => g.lines.length, cell: (g) => <span className="text-muted">{g.lines.length}</span>, hideBelow: "2xl" },
    { key: "value", header: t("Valeur"), align: "right", sort: (g) => g.value, cell: (g) => <span className="font-semibold">{money(g.value, g.value >= 1000)}</span> },
    {
      key: "weight",
      header: t("Poids"),
      align: "right",
      width: "110px",
      sort: (g) => g.value,
      cell: (g) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1 w-12 overflow-hidden rounded-full bg-bg">
            <div className="h-full rounded-full bg-[var(--series-2)]" style={{ width: `${Math.min(100, weight(g))}%` }} />
          </div>
          <span className="w-9 text-[12px] text-muted">{pct(weight(g), 0)}</span>
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={t("Crypto")}
        subtitle={`${t("Cours {quand}", { quand: timeAgo(data.pricesAt) })} · Data provided by CoinGecko`}
        right={
          <div className="flex items-center gap-2">
            <button type="button" onClick={onAdd} className="flex items-center gap-1.5 rounded-md border border-line bg-card px-3 py-1.5 text-[13px] font-medium hover:bg-bg">
              <Plus size={14} /> {t("Ajouter un portefeuille")}
            </button>
            {canSync(st) && (
              <button type="button" onClick={onSync} disabled={syncing} className="flex items-center gap-1.5 rounded-md border border-line bg-card px-3 py-1.5 text-[13px] font-medium hover:bg-bg">
                <RefreshCw size={14} className={clsx(syncing && "animate-spin")} /> {syncLabel()}
              </button>
            )}
          </div>
        }
      />
      <StatGrid>
        <Stat label={t("Valeur totale")} value={money(data.total, true)} hint={t("toutes les lignes comptées")} />
        <Stat
          label={t("Sur 24 heures")}
          value={change24 != null ? `${change24 >= 0 ? "+" : ""}${money(change24, true)}` : "—"}
          tone={change24 == null ? undefined : change24 >= 0 ? "pos" : "neg"}
          hint={data.change24h != null ? `${data.change24h >= 0 ? "+" : ""}${pct(data.change24h, 1)}` : undefined}
        />
        <Stat label={t("Cryptos")} value={groups.filter((g) => g.value >= SMALL).length} hint={hiddenCount ? tn("+ {n} ligne de moins de {seuil}", "+ {n} lignes de moins de {seuil}", hiddenCount, { seuil: money(SMALL, true) }) : undefined} />
        <Stat label={t("Portefeuilles")} value={st.sources.filter((s) => s.enabled && s.lines > 0).length} hint={<SyncLine st={st} />} />
      </StatGrid>
      <div className="mb-4">
        <CryptoEvolution history={data.history} />
      </div>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">{t("Par crypto")}</h2>
            {hiddenCount > 0 && (
              <button type="button" onClick={() => setShowSmall((v) => !v)} className="text-[12px] text-accent hover:underline">
                {showSmall ? tn("Masquer la petite ligne", "Masquer les {n} petites lignes", hiddenCount) : tn("Afficher la petite ligne", "Afficher les {n} petites lignes", hiddenCount)}
              </button>
            )}
          </div>
          {focus && (
            <div className="mb-2">
              <FocusBar st={st} groups={groups} focus={focus} onClear={() => onFocus(focus)} />
            </div>
          )}
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(g) => g.key}
            initialSort={{ key: "value", dir: "desc" }}
            onRowClick={onOpen}
            rowClassName={(g) => (!focus ? undefined : shareOf(g, focus) != null ? "bg-accent-soft hover:bg-accent-soft [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-accent)]" : "text-muted")}
          />
        </div>
        <div className="col-span-12 space-y-4 xl:col-span-4">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">{t("Répartition")}</h2>
            <div className="space-y-1">
              {top.map((g) => (
                <button key={g.key} type="button" onClick={() => onOpen(g)} className="block w-full rounded-md px-2 py-1 text-left hover:bg-bg">
                  <div className="flex justify-between text-[13px]">
                    <span className="flex items-center gap-2">
                      <CoinLogo coingeckoId={g.lines.find((l) => l.coingecko_id)?.coingecko_id} symbol={g.symbol} size="sm" />
                      {g.symbol.toUpperCase()}
                    </span>
                    <span className="tnum">
                      {money(g.value, true)} <span className="text-muted">· {pct(weight(g), 0)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg">
                    <div className="h-full rounded-full bg-[var(--series-2)]" style={{ width: `${(g.value / max) * 100}%` }} />
                  </div>
                </button>
              ))}
              {rest > 0 && (
                <div className="flex justify-between px-2 pt-1 text-[12px] text-muted">
                  <span>{tn("{n} autre", "{n} autres", groups.length - top.length)}</span>
                  <span className="tnum">{money(rest, true)}</span>
                </div>
              )}
            </div>
          </Card>
          <DuplicateNotices st={st} />
          <div>
            <h2 className="mb-2 font-semibold">{t("Portefeuilles")}</h2>
            <Portfolios positions={data.positions} st={st} onAdd={onAdd} focus={focus} onFocus={onFocus} />
          </div>
          <Archived st={st} />
        </div>
        <div className="col-span-12">
          <JournalTable />
        </div>
      </div>
      <Sources st={st} className="mt-4 text-[12px] leading-relaxed text-muted" />
    </>
  );
}

const EVENT_COLUMNS: Column<CryptoEvent>[] = [
  { key: "date", header: t("Date"), sort: (e) => e.date, cell: (e) => <span className="tnum text-muted">{dateFr(e.date)}</span>, width: "110px" },
  {
    key: "title",
    header: t("Mouvement"),
    sort: (e) => e.title,
    cell: (e) => (
      <div className="min-w-0 py-1">
        <div className="truncate font-medium">{e.title}</div>
        {e.note && <div className="line-clamp-1 text-[12px] text-muted">{e.note}</div>}
      </div>
    ),
  },
  { key: "type", header: t("Type"), sort: (e) => e.type ?? "", cell: (e) => <span className="text-muted">{e.type ?? "—"}</span>, hideBelow: "lg" },
  { key: "platform", header: t("Plateforme"), sort: (e) => e.platform ?? "", cell: (e) => <span className="text-muted">{e.platform ?? "—"}</span>, hideBelow: "lg" },
  { key: "qty", header: t("Quantité"), align: "right", sort: (e) => e.quantity, cell: (e) => (e.quantity != null ? `${qty(Number(e.quantity))} ${e.asset ?? ""}` : "—"), hideBelow: "xl" },
  { key: "value", header: t("Valeur"), align: "right", sort: (e) => e.value, cell: (e) => (e.value != null ? money(e.value) : <span className="text-muted">—</span>) },
];

function JournalTable() {
  const events = useCryptoEvents();
  const list = events.data?.events ?? [];
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  return (
    <section>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mb-2 flex items-center gap-1.5 font-semibold">
        {t("Journal des mouvements")} <span className={cn("tnum text-[12px] font-normal text-muted")}>{list.length}</span>
        <ChevronDown size={15} className={clsx("text-muted transition", open && "rotate-180")} />
      </button>
      {open && <DataTable rows={list} columns={EVENT_COLUMNS} rowKey={(e) => String(e.id)} initialSort={{ key: "date", dir: "desc" }} />}
    </section>
  );
}
