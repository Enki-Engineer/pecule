import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeEuro, Building2, CalendarClock, ChevronRight, FolderOpen, Landmark, Plus, Sunset, TrendingUp, Wallet } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api, useAssetPayouts, useWealth, type Asset, type Wealth as WealthData, type WealthCategory } from "../api.ts";
import { AssetPayouts } from "../components/AssetPayouts.tsx";
import { BankBadge, Card, ErrorBox, Field, PageHeader, ProgressBar, Segmented, Sheet, Spinner } from "../components/ui.tsx";
import { dateFr, money, moneySymbol, pct } from "../format.ts";
import { CATEGORY } from "../wealth.ts";
import { useMedia } from "../useMedia.ts";
import { Composition, EvolutionChart, WealthDesktop, historyPoints, type Mode } from "./WealthDesktop.tsx";
import { locale, t, tn } from "../../lib/i18n.ts";
import { useEnabled } from "../modules.ts";

export function Wealth() {
  const { data: w, isLoading, error } = useWealth();
  const [editing, setEditing] = useState<Asset | null>(null);
  const [adding, setAdding] = useState(false);
  const desktop = useMedia("(min-width: 768px)");

  if (desktop && w)
    return (
      <>
        <WealthDesktop w={w} onEdit={setEditing} onAdd={() => setAdding(true)} />
        <AssetSheet asset={editing} onClose={() => setEditing(null)} />
        <AddAssetSheet open={adding} onClose={() => setAdding(false)} />
      </>
    );

  return (
    <>
      <PageHeader title={t("Patrimoine")} subtitle={w ? t("Ta part · {date}", { date: dateFr(w.date) }) : undefined} />
      <MoreScreens />
      {error && <ErrorBox error={error} />}
      {isLoading || !w ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <MobileWealthTop w={w} />

          {w.accounts.length > 0 && (
            <Section id="poche-comptes" title={t("Comptes")} total={w.byCategory.comptes}>
              {w.accounts.map((a) => (
                <Link key={a.id} to={`/operations?compte=${encodeURIComponent(a.id)}`} className="press flex items-center gap-3 px-4 py-3">
                  <BankBadge bank={a.institution} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{a.display_name ?? a.name}</div>
                    {a.share < 1 && <div className="text-xs text-muted">{t("Compte commun · ta part {part}", { part: pct(a.share * 100, 0) })}</div>}
                  </div>
                  <span className={clsx("tnum font-semibold", a.balance < 0 && "text-neg")}>{money(a.balance)}</span>
                </Link>
              ))}
            </Section>
          )}

          <Link id="poche-crypto" to="/patrimoine/crypto" className="block scroll-mt-16">
            <Card className="press flex items-center gap-3 p-4">
              <span className="grid size-10 place-items-center rounded-xl text-sm font-bold text-white" style={{ background: CATEGORY.crypto.color }}>
                ₿
              </span>
              <div className="flex-1">
                <div className="font-semibold">{t("Crypto")}</div>
                <div className="text-xs text-muted">{tn("{n} crypto · cours CoinGecko", "{n} cryptos · cours CoinGecko", new Set(w.crypto.positions.map((p) => p.symbol.toUpperCase())).size)}</div>
              </div>
              <div className="text-right">
                <div className="tnum font-semibold">{money(w.crypto.total, true)}</div>
                {w.crypto.change24h != null && (
                  <div className={clsx("tnum text-xs", w.crypto.change24h >= 0 ? "text-pos" : "text-neg")}>
                    {t("{variation} sur 24 h", { variation: `${w.crypto.change24h >= 0 ? "+" : ""}${pct(w.crypto.change24h, 1)}` })}
                  </div>
                )}
              </div>
              <ChevronRight size={18} className="text-muted" />
            </Card>
          </Link>

          {(["placement", "epargne", "immobilier", "autre"] as WealthCategory[]).map((cat) => {
            const list = w.assets.filter((a) => a.category === cat);
            if (!list.length) return null;
            return (
              <Section key={cat} id={`poche-${cat}`} title={CATEGORY[cat].label} total={w.byCategory[cat]}>
                {list.map((a) => (
                  <AssetRow key={a.id} a={a} onClick={() => setEditing(a)} />
                ))}
              </Section>
            );
          })}

          {w.loans.length > 0 && (
            <Section title={t("Crédits")} total={-w.debts}>
              {w.loans.map((l) => (
                <Link key={l.id} to={`/credits/${l.id}`} className="press block px-4 py-3">
                  <div className="flex items-center gap-3">
                    <BankBadge bank={l.bank} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{l.name}</div>
                      <div className="text-xs text-muted">
                        {t("{part} remboursé · fin le {date}", { part: pct(l.summary.progress * 100, 0), date: dateFr(l.end_date) })}
                        {l.share < 1 && ` · ${t("ta part {part}", { part: pct(l.share * 100, 0) })}`}
                      </div>
                    </div>
                    <span className="tnum font-semibold">{money(l.shareRemaining)}</span>
                  </div>
                  <ProgressBar value={l.summary.progress} className="mt-2.5 h-1.5" />
                </Link>
              ))}
            </Section>
          )}

          <button type="button" onClick={() => setAdding(true)} className="press card flex w-full items-center justify-center gap-2 py-3.5 font-medium text-accent">
            <Plus size={18} /> {t("Ajouter un placement")}
          </button>
          <p className="px-1 text-xs leading-relaxed text-muted">
            {t("Biens communs comptés pour ta part. Crypto et PEA suivent les cours du marché ; les autres valeurs se mettent à jour à la main en touchant la ligne.")}
          </p>
        </div>
      )}
      <AssetSheet asset={editing} onClose={() => setEditing(null)} />
      <AddAssetSheet open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/** iPhone : patrimoine net, courbe nette ou par poche (toucher une date = sa répartition), répartition qui mène à la poche. */
function MobileWealthTop({ w }: { w: WealthData }) {
  const [mode, setMode] = useState<Mode>("net");
  const [selected, setSelected] = useState<string | null>(null);
  const [dated, setDated] = useState(false);
  const selectDate = (d: string | null) => {
    setSelected(d);
    setDated(true);
  };
  const points = useMemo(() => historyPoints(w), [w]);
  const at = points.find((p) => p.date === selected) ?? null;
  const first = points[0];
  const delta = first ? w.net - first.net : 0;
  return (
    <>
      <Card className="p-5">
        <div className="text-sm text-muted">{t("Patrimoine net")}</div>
        <div className="tnum mt-1 text-[34px] font-bold tracking-tight">{money(w.net, true)}</div>
        <div className="mt-0.5 text-sm text-muted">
          {t("Brut")} <span className="tnum text-ink">{money(w.gross, true)}</span> · {t("dettes")} <span className="tnum text-ink">{money(w.debts, true)}</span>
        </div>
        {points.length >= 2 && (
          <>
            <div className="mb-2 mt-4">
              <Segmented<Mode>
                value={mode}
                onChange={setMode}
                options={[
                  { value: "net", label: t("Net") },
                  { value: "poches", label: t("Par poche") },
                ]}
              />
            </div>
            <EvolutionChart points={points} mode={mode} range="tout" selected={selected} onSelect={selectDate} height={180} />
            <div className={clsx("tnum mt-1 text-xs", delta >= 0 ? "text-pos" : "text-neg")}>
              {t("{ecart} depuis le {date} · touche une date pour sa répartition", { ecart: `${delta >= 0 ? "+" : ""}${money(delta, true)}`, date: dateFr(first.date) })}
            </div>
          </>
        )}
      </Card>
      <Card key={selected ?? "aujourd'hui"} className={clsx("p-4", dated && "sel-swap")}>
        <Composition
          w={w}
          at={at}
          onClear={() => selectDate(null)}
          filter={null}
          onPick={(k) => k && document.getElementById(`poche-${k === "crypto" ? "crypto" : k}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      </Card>
    </>
  );
}

function Section({ id, title, total, children }: { id?: string; title: string; total: number; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <span className="tnum text-sm font-semibold text-muted">{money(total, true)}</span>
      </div>
      <Card className="divide-y divide-line">{children}</Card>
    </section>
  );
}

function AssetRow({ a, onClick }: { a: Asset; onClick: () => void }) {
  const sub =
    a.valuation === "cotation" && a.quantity != null && a.price != null
      ? t("{quantite} parts × {cours}", { quantite: a.quantity.toLocaleString(locale()), cours: money(a.price) })
      : a.share < 1
        ? t("Bien commun · ta part {part} ({montant})", { part: pct(a.share * 100, 0), montant: money(a.shareValue, true) })
        : (a.institution ?? "");
  return (
    <button type="button" onClick={onClick} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{a.name}</div>
        <div className="truncate text-xs text-muted">{sub}</div>
      </div>
      <div className="text-right">
        <div className="tnum font-semibold">{money(a.value, a.value >= 1000)}</div>
        {a.valueDate && (
          <div className="text-[11px] text-muted">
            {a.valuation === "cotation" ? t("cours du {date}", { date: dateFr(a.valueDate) }) : a.valuation === "versements" ? t("versement du {date}", { date: dateFr(a.valueDate) }) : t("au {date}", { date: dateFr(a.valueDate) })}
          </div>
        )}
      </div>
    </button>
  );
}

function AssetSheet({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cash, setCash] = useState("");
  useEffect(() => {
    setValue(asset?.value != null ? String(asset.value) : "");
    setQuantity(asset?.quantity != null ? String(asset.quantity) : "");
    setCash(asset?.cash != null ? String(asset.cash) : "");
  }, [asset]);
  // Versements reçus du placement ; s'il les suit, sa valeur ne se saisit pas (la fiche a pu être ouverte avant le réglage : on lit le serveur).
  const payouts = useAssetPayouts(asset?.id).data;
  if (!asset) return null;
  const follows = payouts?.follows ?? asset.valuation === "versements";
  const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

  async function save() {
    if (!asset) return;
    const body =
      asset.valuation === "cotation" ? { quantity: num(quantity), cash: num(cash) } : { value: num(value) };
    if (Object.values(body).some((v) => Number.isNaN(v))) return toast.error(t("Montant invalide"));
    try {
      await api(`/assets/${asset.id}`, { method: "PATCH", json: body });
      await qc.invalidateQueries({ queryKey: ["wealth"] });
      toast.success(t("Mis à jour"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    }
  }

  return (
    <Sheet open onClose={onClose} title={asset.name}>
      <Card className="mb-3 space-y-1 p-4 text-sm">
        {asset.institution && <div className="text-muted">{asset.institution}</div>}
        {asset.invested != null && (
          <div>
            {t("Investi :")} <span className="tnum font-medium">{money(asset.invested)}</span>
            {asset.value > 0 && (
              <span className={clsx("tnum ml-1", asset.value >= asset.invested ? "text-pos" : "text-neg")}>
                ({asset.value >= asset.invested ? "+" : ""}
                {money(asset.value - asset.invested, true)})
              </span>
            )}
          </div>
        )}
        {asset.liquidity && <div>{t("Liquidité : {valeur}", { valeur: asset.liquidity })}</div>}
        {asset.notes && <p className="pt-1 text-xs leading-relaxed text-muted">{asset.notes}</p>}
      </Card>
      {asset.valuation === "cotation" ? (
        <div className="space-y-3">
          <Field label={t("Nombre de parts")} value={quantity} onChange={setQuantity} />
          <Field label={t("Espèces sur le compte ({devise})", { devise: moneySymbol() })} value={cash} onChange={setCash} />
          <p className="px-1 text-xs text-muted">{t("La valeur suit le cours de {ticker} ; mettez à jour après chaque ordre ou versement.", { ticker: asset.ticker ?? "" })}</p>
        </div>
      ) : follows ? (
        <Card className="flex items-baseline justify-between gap-3 px-4 py-3">
          <span className="text-sm text-muted">{t("Valeur : le dernier versement reçu")}</span>
          <span className="tnum text-[17px] font-semibold">{money(payouts?.last?.amount ?? asset.value)}</span>
        </Card>
      ) : (
        <Field label={t("Valeur actuelle ({devise})", { devise: moneySymbol() })} value={value} onChange={setValue} />
      )}
      {!follows && (
        <button type="button" onClick={save} className="press mt-4 w-full rounded-xl bg-accent py-3.5 font-semibold text-white">
          {t("Enregistrer")}
        </button>
      )}
      <AssetPayouts asset={asset} p={payouts} onNavigate={onClose} />
    </Sheet>
  );
}

function AddAssetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"epargne" | "placement" | "immobilier" | "autre">("epargne");
  const [value, setValue] = useState("");
  const [institution, setInstitution] = useState("");
  const valid = useMemo(() => name.trim() && !Number.isNaN(Number(value.replace(",", "."))) && value !== "", [name, value]);

  async function add() {
    try {
      await api("/assets", { method: "POST", json: { name: name.trim(), category, value: Number(value.replace(",", ".")), institution: institution || null } });
      await qc.invalidateQueries({ queryKey: ["wealth"] });
      toast.success(t("Placement ajouté"));
      setName("");
      setValue("");
      setInstitution("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Ajout impossible"));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("Ajouter un placement")}>
      <div className="space-y-3">
        <Field label={t("Nom")} value={name} onChange={setName} text placeholder={t("Livret A, PEL, assurance vie…")} />
        <div className="flex flex-wrap gap-2">
          {(["epargne", "placement", "immobilier", "autre"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={clsx("press rounded-full px-3 py-2 text-sm font-medium", category === c ? "bg-accent text-white" : "bg-card ring-1 ring-line")}
            >
              {CATEGORY[c].label}
            </button>
          ))}
        </div>
        <Field label={t("Valeur actuelle ({devise})", { devise: moneySymbol() })} value={value} onChange={setValue} />
        <Field label={t("Établissement (facultatif)")} value={institution} onChange={setInstitution} text />
      </div>
      <button type="button" disabled={!valid} onClick={add} className="press mt-4 w-full rounded-xl bg-accent py-3.5 font-semibold text-white disabled:opacity-40">
        {t("Ajouter")}
      </button>
    </Sheet>
  );
}

/** iPhone : accès aux écrans de situation sans onglet supplémentaire (sur ordinateur, ils sont dans le menu). */
const MORE = [
  { to: "/immobilier", label: t("Immobilier"), icon: Building2 },
  { to: "/budget", label: t("Budget"), icon: Wallet },
  { to: "/revenus", label: t("Revenus"), icon: BadgeEuro },
  { to: "/impots", label: t("Impôts"), icon: Landmark },
  { to: "/retraite", label: t("Retraite"), icon: Sunset },
  { to: "/projections", label: t("Projections"), icon: TrendingUp },
  { to: "/documents", label: t("Documents"), icon: FolderOpen },
  { to: "/echeancier", label: t("Échéancier"), icon: CalendarClock },
];

function MoreScreens() {
  const more = useEnabled(MORE);
  return (
    <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
      {more.map((m) => (
        <Link key={m.to} to={m.to} className="press card flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium">
          <m.icon size={15} className="text-accent" /> {m.label}
        </Link>
      ))}
    </div>
  );
}
