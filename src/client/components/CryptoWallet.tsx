import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronLeft, ChevronRight, FileUp, Layers, ShieldAlert, Wallet } from "lucide-react";
import { Link } from "react-router";
import clsx from "clsx";
import { toast } from "sonner";
import { api, type CryptoDuplicate, type CryptoPosition, type CryptoSource, type CryptoStatus } from "../api.ts";
import { Card, Field, Sheet } from "./ui.tsx";
import { BrandLogo } from "./Logo.tsx";
import { detectWallet, looksSecret, WALLET_LABELS, type WalletKind } from "../../lib/crypto-chains.ts";
import { EXCHANGE_IDS, EXCHANGES, type ExchangeId } from "../../lib/crypto-exchanges.ts";
import { locale, t, tk, tn } from "../../lib/i18n.ts";
import { dateFr } from "../format.ts";

/** Ce qu'un dépôt de fichiers a donné : mouvements ajoutés, période couverte, soldes recalculés. */
type Imported = { added: number; known: number; from: string; to: string; holdings: { symbol: string; quantity: number }[]; negative: string[]; unpriced: string[] };

type Added = {
  portfolioId: string;
  kind: string;
  name: string;
  holdings: { symbol: string; quantity: number }[];
  manual: { id: number; symbol: string; quantity: number; location: string | null }[];
};

const qty = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: n < 1 ? 6 : 4 });

/** Ce que Pécule lira pour ce genre d'adresse, dit avant d'ajouter. */
function kindHint(kind: WalletKind): string {
  if (kind === "evm") return t("Lue sur Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis et Linea (la monnaie de chaque chaîne et les jetons les plus courants), et sur VeChain, dont les adresses ont la même forme.");
  if (kind === "ada") return t("ADA de tout le portefeuille, récompenses de staking comprises. Les jetons natifs de Cardano ne sont pas lus.");
  if (kind === "mvx") return t("EGLD du portefeuille, EGLD délégués et jetons que MultiversX sait valoriser.");
  if (kind === "btc-xpub") return t("Pécule en déduit toutes les adresses du compte et additionne leurs soldes. La clé est gardée chiffrée ; elle ne permet pas de dépenser.");
  if (kind === "sol") return t("SOL du portefeuille, SOL mis en staking et jetons les plus courants.");
  if (kind === "mvx-staking") return t("EGLD délégués, récompenses à réclamer et retraits en cours.");
  if (kind === "eth-validator") return t("Solde du validateur, récompenses comprises.");
  return t("Solde de cette adresse. Pour un Ledger ou un Trezor, colle plutôt la clé publique étendue du compte (xpub, ypub ou zpub) : elle couvre toutes ses adresses.");
}

const DISTINCT_KEY = "pecule:crypto:distincts";
const pairKey = (d: CryptoDuplicate) => `${d.directId}|${d.otherId}`;
function readDistinct(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISTINCT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Deux sources qui portent les mêmes avoirs — l'une que le membre a reliée lui-même, l'autre qui vient d'un
 * agrégateur, quel qu'il soit — seraient comptées deux fois. Pécule le signale et propose de garder la lecture
 * directe ; rien n'est décidé à la place du membre, qui peut répondre que ce sont deux portefeuilles.
 */
export function DuplicateNotices({ st, only }: { st: CryptoStatus; only?: string }) {
  const qc = useQueryClient();
  const [distinct, setDistinct] = useState(readDistinct);
  const [busy, setBusy] = useState<string | null>(null);
  const shown = st.duplicates.filter((d) => !distinct.includes(pairKey(d)) && (!only || d.directId === only));
  if (!shown.length) return null;

  async function once(d: CryptoDuplicate) {
    setBusy(pairKey(d));
    try {
      await api(`/crypto/sources/${encodeURIComponent(d.directId)}/once`, { method: "POST", json: { other: d.otherId } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["crypto"] }), qc.invalidateQueries({ queryKey: ["wealth"] })]);
      toast.success(t("Compté une seule fois"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    } finally {
      setBusy(null);
    }
  }
  function keep(d: CryptoDuplicate) {
    const next = [...distinct, pairKey(d)];
    setDistinct(next);
    try {
      localStorage.setItem(DISTINCT_KEY, JSON.stringify(next.slice(-200)));
    } catch {
      // Sans stockage sur l'appareil, la question reviendra : rien de grave.
    }
  }

  return (
    <div className="space-y-3">
      {shown.map((d) => (
        <Card key={pairKey(d)} className="px-4 py-3 text-sm">
          <div className="font-medium">{t("Compté deux fois ?")}</div>
          <div className="mt-1 leading-relaxed text-muted">
            {t("« {direct} », que tu as relié toi-même, et « {autre} », suivi par un autre outil, portent les mêmes avoirs ({cryptos}).", { direct: d.directName, autre: d.otherName, cryptos: d.symbols.slice(0, 4).join(", ") + (d.symbols.length > 4 ? "…" : "") })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" onClick={() => once(d)} disabled={busy === pairKey(d)} className="press text-sm font-medium text-accent disabled:opacity-50">
              {t("Ne compter qu'une fois")}
            </button>
            <button type="button" onClick={() => keep(d)} className="press text-sm text-muted">
              {t("Ce sont deux portefeuilles")}
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}

const INPUT = "w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-muted/60";

/** Les façons de relier ce qu'on a : aucune n'est la voie « normale », chacune couvre un cas. */
const CHOICES = [
  { mode: "adresse", icon: Wallet, title: tk("Un portefeuille, par son adresse publique"), hint: tk("Ledger, Trezor, MetaMask, Phantom… Bitcoin, Ethereum et ses chaînes, Solana, Cardano, MultiversX, VeChain.") },
  { mode: "exchange", icon: Building2, title: tk("Un exchange, par une clé en lecture seule"), hint: tk("Kraken, Binance, Coinbase, Bitpanda, Bitvavo, OKX, Bybit, KuCoin, Bitget, Bitfinex, Crypto.com Exchange.") },
  { mode: "fichier", icon: FileUp, title: tk("L'appli Crypto.com, par son export"), hint: tk("L'appli n'a pas de clé d'API : dépose le fichier de son historique, de temps en temps.") },
  { mode: "coinstats", icon: Layers, title: tk("Un compte CoinStats"), hint: tk("Un agrégateur : tout ce que tu y as relié, y compris ce que Pécule ne lit pas lui-même.") },
] as const;

/**
 * Ajout d'un portefeuille : par son adresse publique (le membre colle, Pécule reconnaît la blockchain) ou, pour un
 * exchange, par une clé d'API en lecture seule, avec la marche à suivre de cet exchange. Dans les deux cas Pécule
 * lit tout de suite et montre ce qu'il a trouvé.
 */
export function AddWalletSheet({ open, onClose, st }: { open: boolean; onClose: () => void; st: CryptoStatus }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"choix" | "adresse" | "exchange" | "fichier" | "coinstats">("choix");
  const [imported, setImported] = useState<Imported | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState("");
  const [exchange, setExchange] = useState<ExchangeId>("kraken");
  const [key, setKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [archived, setArchived] = useState<number[]>([]);

  const text = address.trim();
  const secret = looksSecret(text);
  const kind = secret ? null : detectWallet(text);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["crypto"] }), qc.invalidateQueries({ queryKey: ["wealth"] })]);

  function close() {
    setMode("choix");
    setImported(null);
    setKey("");
    setSecretKey("");
    setPassphrase("");
    setAddress("");
    setName("");
    setAdded(null);
    setArchived([]);
    onClose();
  }

  const info = EXCHANGES[exchange];
  const ready = mode === "adresse" ? !!kind : key.trim().length > 0 && (!info.secretLabel || secretKey.trim().length > 0) && (!info.passLabel || passphrase.trim().length > 0);

  async function add() {
    setBusy(true);
    try {
      const r =
        mode === "adresse"
          ? await api<Added>("/crypto/sources", { method: "POST", json: { address: text, name: name.trim() || null } })
          : await api<Added>("/crypto/exchanges", { method: "POST", json: { exchange, key: key.trim(), secret: secretKey.trim() || null, passphrase: passphrase.trim() || null, name: name.trim() || null } });
      // La clé ne reste pas dans la page une fois envoyée.
      setKey("");
      setSecretKey("");
      setPassphrase("");
      await refresh();
      setAdded(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Ajout impossible"));
    } finally {
      setBusy(false);
    }
  }

  /** Dépose les fichiers choisis l'un après l'autre : chacun ajoute ses mouvements à ceux déjà gardés. */
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      let added = 0;
      let known = 0;
      let last: Imported | undefined;
      for (const f of Array.from(files)) {
        last = await api<Imported>("/crypto/files/cryptocom", { method: "POST", body: await f.arrayBuffer(), headers: { "Content-Type": "application/octet-stream" } });
        added += last.added;
        known += last.known;
      }
      await refresh();
      // Le dernier dépôt rend les soldes de tout l'historique ; les compteurs sont ceux de tous les fichiers.
      if (last) setImported({ ...last, added, known });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Import impossible"));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function archive(id: number) {
    if (!added) return;
    try {
      await api(`/crypto/${id}/archive`, { method: "POST", json: { portfolioId: added.portfolioId } });
      setArchived((a) => [...a, id]);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    }
  }

  if (!open) return null;
  if (added)
    return (
      <Sheet open onClose={close} title={t("Portefeuille ajouté")}>
        <Card className="mb-3 divide-y divide-line">
          {added.holdings.map((h) => (
            <div key={h.symbol} className="flex justify-between gap-3 px-4 py-3 text-sm">
              <span className="font-medium">{h.symbol}</span>
              <span className="tnum">{qty(h.quantity)}</span>
            </div>
          ))}
          {!added.holdings.length && <div className="px-4 py-3 text-sm text-muted">{added.kind.startsWith("x-") ? t("Ce compte est vide pour le moment. Pécule le relira chaque jour.") : t("Rien à cette adresse pour le moment. Pécule la relira chaque jour.")}</div>}
        </Card>
        {added.manual
          .filter((m) => !archived.includes(m.id))
          .map((m) => (
            <Card key={m.id} className="mb-3 px-4 py-3 text-sm">
              <div>
                {t("Tu as aussi {quantite} {symbole} saisis à la main{lieu}. Si c'est ce portefeuille, archive cette ligne pour ne pas le compter deux fois.", {
                  quantite: qty(m.quantity),
                  symbole: m.symbol,
                  lieu: m.location ? ` (${m.location})` : "",
                })}
              </div>
              <button type="button" onClick={() => archive(m.id)} className="press mt-2 text-sm font-medium text-accent">
                {t("Archiver la ligne saisie à la main")}
              </button>
            </Card>
          ))}
        <DuplicateNotices st={st} only={added.portfolioId} />
        <button type="button" onClick={close} className="press w-full rounded-xl bg-accent py-3 font-semibold text-white">
          {t("Terminé")}
        </button>
      </Sheet>
    );

  return (
    <Sheet open onClose={close} title={t("Ajouter un portefeuille")}>
      {mode !== "choix" && (
        <button type="button" onClick={() => setMode("choix")} className="press -ml-1 mb-2 flex items-center gap-0.5 text-sm font-medium text-accent">
          <ChevronLeft size={16} /> {t("Autres façons d'ajouter")}
        </button>
      )}
      {mode === "choix" ? (
        <div className="space-y-2">
          <p className="mb-3 px-1 text-sm leading-relaxed text-muted">{t("Pécule relit chaque jour ce que tu relies ici, et ne peut jamais rien dépenser ni vendre. Choisis ce qui correspond à ce que tu as.")}</p>
          {CHOICES.map((c) => (
            <button key={c.mode} type="button" onClick={() => setMode(c.mode)} className="press card flex w-full items-center gap-3 px-4 py-3 text-left">
              <c.icon size={22} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{t(c.title)}</span>
                <span className="block text-xs leading-relaxed text-muted">{t(c.hint)}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-muted" />
            </button>
          ))}
          <p className="px-1 pt-2 text-xs leading-relaxed text-muted">{t("Rien de tout cela ? Demande à l'assistant d'ajouter une position à la main : tu en corriges ensuite la quantité ici.")}</p>
        </div>
      ) : mode === "fichier" ? (
        <div className="space-y-3">
          <p className="px-1 text-sm leading-relaxed text-muted">
            {t("L'appli Crypto.com ne donne pas de clé d'API. Pécule lit le fichier de son historique : le solde de chaque crypto est la somme de ses mouvements. Un mouvement déjà connu n'est jamais compté deux fois.")}
          </p>
          <Card className="px-4 py-3 text-sm">
            <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed">
              <li>{t("Dans l'appli Crypto.com : Comptes → historique des transactions → exporter.")}</li>
              <li>{t("Choisis « Crypto Wallet », puis une période. L'appli limite la durée d'un export : fais-en plusieurs pour couvrir tout l'historique, depuis le premier jour.")}</li>
              <li>{t("Dépose ici tous les fichiers CSV obtenus. La fois suivante, un export de la période écoulée suffit.")}</li>
            </ol>
            <div className="mt-2 text-xs leading-relaxed text-muted">{t("Ce qui est immobilisé dans l'appli (staking, carte, « Earn ») reste compté. L'export du portefeuille en monnaie n'est pas lu.")}</div>
          </Card>
          <input ref={fileInput} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="press w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50">
            {busy ? t("Lecture en cours…") : t("Choisir les fichiers")}
          </button>
          {imported && (
            <Card className="divide-y divide-line text-sm">
              <div className="px-4 py-3">
                <div className="font-medium">{tn("{n} mouvement ajouté", "{n} mouvements ajoutés", imported.added)}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-muted">
                  {imported.known > 0 && <>{tn("{n} déjà connu.", "{n} déjà connus.", imported.known)} </>}
                  {t("Historique du {debut} au {fin}.", { debut: dateFr(imported.from), fin: dateFr(imported.to) })} {t("Compare ces soldes à ceux de l'appli : un écart dit qu'il manque un fichier.")}
                </div>
              </div>
              {imported.holdings.map((h) => (
                <div key={h.symbol} className="flex justify-between gap-3 px-4 py-2.5">
                  <span className="font-medium">
                    {h.symbol}
                    {imported.unpriced.includes(h.symbol) && <span className="ml-1.5 text-xs font-normal text-muted">{t("sans cours")}</span>}
                  </span>
                  <span className="tnum">{qty(h.quantity)}</span>
                </div>
              ))}
              {imported.negative.length > 0 && (
                <div className="px-4 py-3 text-xs leading-relaxed text-warn">{t("Solde négatif pour {cryptos} : il manque des mouvements plus anciens. Dépose aussi l'export des premières années.", { cryptos: imported.negative.join(", ") })}</div>
              )}
            </Card>
          )}
        </div>
      ) : mode === "coinstats" ? (
        <div className="space-y-3">
          <p className="px-1 text-sm leading-relaxed text-muted">
            {t("CoinStats est un agrégateur : un compte chez lui réunit des portefeuilles et des exchanges, y compris ceux que Pécule ne lit pas lui-même. Pécule relit alors tout le compte une fois par jour.")}
          </p>
          <Card className="px-4 py-3 text-sm">
            <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed">
              <li>{t("Relie tes portefeuilles et tes exchanges dans ton compte CoinStats.")}</li>
              <li>{t("Crée une clé d'API sur openapi.coinstats.app.")}</li>
              <li>{t("L'administrateur du foyer la saisit dans Réglages → Comptes et connexions.")}</li>
            </ol>
            <div className="mt-2 text-xs leading-relaxed text-muted">{t("Un seul compte CoinStats par foyer : ses portefeuilles sont ceux de l'administrateur. Si tu relies aussi l'un d'eux directement, Pécule te signale ce qui serait compté deux fois.")}</div>
          </Card>
          <div className="px-1 text-sm">{st.enabled ? t("CoinStats est relié à ce foyer.") : t("CoinStats n'est pas relié à ce foyer.")}</div>
          <Link to="/reglages/connexions?c=coinstats" onClick={close} className="press block w-full rounded-xl bg-accent py-3 text-center font-semibold text-white">
            {t("Ouvrir Comptes et connexions")}
          </Link>
        </div>
      ) : mode === "adresse" ? (

        <div className="space-y-3">
          <p className="px-1 text-sm leading-relaxed text-muted">
            {t("Colle l'adresse publique de ton portefeuille : Pécule reconnaît la blockchain et lit ce qu'il contient, chaque jour. Une adresse publique permet de lire, jamais de dépenser.")}
          </p>
          {/* Ni majuscule ni correction automatiques : une adresse se colle telle quelle. */}
          <label className="card block px-4 py-3">
            <span className="block text-xs text-muted">{t("Adresse publique ou clé publique étendue")}</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="bc1q…, 0x…, xpub…" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} className={INPUT} />
          </label>
          {secret ? (
            <div className="flex gap-2 px-1 text-sm text-warn">
              <ShieldAlert size={18} className="mt-0.5 shrink-0" />
              <span>{t("Ceci ressemble à une clé privée ou à une phrase de récupération. Ne la saisis nulle part, et surtout pas ici : Pécule n'a besoin que de l'adresse publique.")}</span>
            </div>
          ) : kind ? (
            <div className="px-1 text-sm">
              <div className="flex items-center gap-1.5 font-medium">
                <Check size={16} className="text-accent" /> {t(WALLET_LABELS[kind])}
              </div>
              <div className="mt-1 leading-relaxed text-muted">{kindHint(kind)}</div>
            </div>
          ) : (
            text.length > 0 && <div className="px-1 text-sm text-muted">{t("Adresse non reconnue pour le moment : Bitcoin, Ethereum, Solana, Cardano ou MultiversX.")}</div>
          )}
          <Field label={t("Nom du portefeuille (facultatif)")} value={name} onChange={setName} text placeholder="Ledger, MetaMask…" />
          <button type="button" onClick={add} disabled={!ready || busy} className="press w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50">
            {busy ? t("Lecture en cours…") : t("Ajouter le portefeuille")}
          </button>
          <p className="px-1 text-xs leading-relaxed text-muted">{t("Pour un exchange, une adresse ne suffit pas : ses comptes ne sont pas sur une adresse à toi. Relie-le par sa clé en lecture seule.")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="px-1 text-sm leading-relaxed text-muted">
            {t("Pécule lit ton compte avec une clé d'API en lecture seule, que tu crées chez l'exchange : elle montre les soldes, elle ne peut ni vendre ni retirer. Elle est gardée chiffrée et n'est plus jamais affichée.")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {EXCHANGE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setExchange(id);
                  setKey("");
                  setSecretKey("");
                  setPassphrase("");
                }}
                aria-pressed={exchange === id}
                className={clsx("press card flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium", exchange === id ? "outline outline-2 -outline-offset-2 outline-[var(--color-accent)]" : "opacity-70")}
              >
                <BrandLogo texts={[EXCHANGES[id].name]} size="sm" tone="neutral" />
                {EXCHANGES[id].name}
              </button>
            ))}
          </div>
          <Card className="px-4 py-3 text-sm">
            <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed">
              {info.steps.map((step) => (
                <li key={step}>{t(step)}</li>
              ))}
            </ol>
            <div className="mt-2 text-xs leading-relaxed text-muted">{t(info.covers)}</div>
          </Card>
          <label className="card block px-4 py-3">
            <span className="block text-xs text-muted">{t(info.keyLabel)}</span>
            <input value={key} onChange={(e) => setKey(e.target.value)} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} className={INPUT} />
          </label>
          {info.secretLabel && (
            <label className="card block px-4 py-3">
              <span className="block text-xs text-muted">{t(info.secretLabel)}</span>
              {info.longSecret ? (
                <textarea value={secretKey} onChange={(e) => setSecretKey(e.target.value)} rows={4} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} className={`${INPUT} resize-none font-mono text-[12px]`} />
              ) : (
                <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="new-password" className={INPUT} />
              )}
            </label>
          )}
          {info.passLabel && (
            <label className="card block px-4 py-3">
              <span className="block text-xs text-muted">{t(info.passLabel)}</span>
              <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" className={INPUT} />
            </label>
          )}
          <Field label={t("Nom du portefeuille (facultatif)")} value={name} onChange={setName} text placeholder={info.name} />
          <button type="button" onClick={add} disabled={!ready || busy} className="press w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50">
            {busy ? t("Lecture en cours…") : t("Relier {exchange}", { exchange: info.name })}
          </button>
          <p className="px-1 text-xs leading-relaxed text-muted">{t("Un autre exchange ? Passe par un compte CoinStats, ou demande à l'assistant d'ajouter la position à la main.")}</p>
        </div>
      )}
    </Sheet>
  );
}

/**
 * Solde constaté d'une crypto dans un portefeuille tenu par ses exports : l'export d'une appli peut avoir un trou
 * (des récompenses qu'elle n'y écrit pas). Le membre relève ce que l'appli affiche ; les mouvements déposés ensuite
 * s'y ajoutent.
 */
export function ObservedSheet({ source, positions, onClose }: { source: CryptoSource | null; positions: CryptoPosition[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [symbol, setSymbol] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  if (!source) return null;
  const sym = symbol.trim().toUpperCase();
  const value = Number(amount.replace(/\s/g, "").replace(",", "."));
  const ready = /^[A-Z0-9]{1,24}$/.test(sym) && amount.trim() !== "" && Number.isFinite(value) && value >= 0;
  const current = positions.find((p) => p.portfolio_id === source.portfolioId && p.symbol.toUpperCase() === sym);
  const close = () => {
    setSymbol("");
    setAmount("");
    onClose();
  };
  const save = async (s: string, quantity: number | null) => {
    setBusy(true);
    try {
      await api(`/crypto/sources/${encodeURIComponent(source.portfolioId)}/balance`, { method: "POST", json: { symbol: s, quantity } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["crypto"] }), qc.invalidateQueries({ queryKey: ["wealth"] })]);
      toast.success(quantity == null ? t("Solde constaté retiré") : t("Solde enregistré"));
      setSymbol("");
      setAmount("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={close} title={t("Corriger un solde")}>
      <div className="space-y-3">
        <p className="px-1 text-sm leading-relaxed text-muted">
          {t("L'export d'une appli n'est pas toujours complet : des récompenses anciennes peuvent y manquer. Relève ici ce que l'appli affiche pour une crypto : Pécule part de ce solde, et les mouvements des exports que tu déposeras ensuite s'y ajoutent.")}
        </p>
        <Field label={t("Crypto (son symbole)")} value={symbol} onChange={setSymbol} text placeholder="BTC" />
        <Field label={t("Solde affiché dans l'appli")} value={amount} onChange={setAmount} placeholder="0" />
        {current && <div className="px-1 text-xs text-muted">{t("Pécule compte aujourd'hui {quantite} {symbole}.", { quantite: qty(current.quantity), symbole: current.symbol })}</div>}
        <button type="button" onClick={() => save(sym, value)} disabled={!ready || busy} className="press w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50">
          {t("Enregistrer ce solde")}
        </button>
        {!!source.observed?.length && (
          <Card className="divide-y divide-line">
            <div className="px-4 py-2.5 text-[13px] font-semibold">{t("Soldes constatés")}</div>
            {source.observed.map((o) => (
              <div key={o.symbol} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="tnum font-medium">
                    {qty(o.quantity)} {o.symbol}
                  </div>
                  <div className="text-xs text-muted">{t("relevé le {date}", { date: dateFr(o.at) })}</div>
                </div>
                <button type="button" onClick={() => save(o.symbol, null)} disabled={busy} className="press text-xs font-medium text-accent disabled:opacity-50">
                  {t("Retirer##solde")}
                </button>
              </div>
            ))}
          </Card>
        )}
      </div>
    </Sheet>
  );
}
