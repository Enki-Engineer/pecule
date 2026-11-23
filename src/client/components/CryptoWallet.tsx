import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ShieldAlert } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api, type CryptoStatus } from "../api.ts";
import { Card, Field, Segmented, Sheet } from "./ui.tsx";
import { BrandLogo } from "./Logo.tsx";
import { detectWallet, looksSecret, WALLET_LABELS, type WalletKind } from "../../lib/crypto-chains.ts";
import { EXCHANGE_IDS, EXCHANGES, type ExchangeId } from "../../lib/crypto-exchanges.ts";
import { locale, t } from "../../lib/i18n.ts";

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
  if (kind === "evm") return t("Lue sur Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis et Linea : la monnaie de chaque chaîne et les jetons les plus courants.");
  if (kind === "btc-xpub") return t("Pécule en déduit toutes les adresses du compte et additionne leurs soldes. La clé est gardée chiffrée ; elle ne permet pas de dépenser.");
  if (kind === "sol") return t("SOL du portefeuille, SOL mis en staking et jetons les plus courants.");
  if (kind === "mvx-staking") return t("EGLD délégués, récompenses à réclamer et retraits en cours.");
  if (kind === "eth-validator") return t("Solde du validateur, récompenses comprises.");
  return t("Solde de cette adresse. Pour un Ledger ou un Trezor, colle plutôt la clé publique étendue du compte (xpub, ypub ou zpub) : elle couvre toutes ses adresses.");
}

const INPUT = "w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-muted/60";

/**
 * Ajout d'un portefeuille : par son adresse publique (le membre colle, Pécule reconnaît la blockchain) ou, pour un
 * exchange, par une clé d'API en lecture seule, avec la marche à suivre de cet exchange. Dans les deux cas Pécule
 * lit tout de suite et montre ce qu'il a trouvé.
 */
export function AddWalletSheet({ open, onClose, st }: { open: boolean; onClose: () => void; st: CryptoStatus }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"adresse" | "exchange">("adresse");
  const [exchange, setExchange] = useState<ExchangeId>("kraken");
  const [key, setKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [replaces, setReplaces] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [archived, setArchived] = useState<number[]>([]);

  const text = address.trim();
  const secret = looksSecret(text);
  const kind = secret ? null : detectWallet(text);
  const coinstats = st.enabled ? st.sources.filter((s) => !s.direct && s.enabled) : [];
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["crypto"] }), qc.invalidateQueries({ queryKey: ["wealth"] })]);

  function close() {
    setMode("adresse");
    setKey("");
    setSecretKey("");
    setAddress("");
    setName("");
    setReplaces("");
    setAdded(null);
    setArchived([]);
    onClose();
  }

  const info = EXCHANGES[exchange];
  const ready = mode === "adresse" ? !!kind : key.trim().length > 0 && (!info.secretLabel || secretKey.trim().length > 0);

  async function add() {
    setBusy(true);
    try {
      const r =
        mode === "adresse"
          ? await api<Added>("/crypto/sources", { method: "POST", json: { address: text, name: name.trim() || null, replaces: replaces || null } })
          : await api<Added>("/crypto/exchanges", { method: "POST", json: { exchange, key: key.trim(), secret: secretKey.trim() || null, name: name.trim() || null, replaces: replaces || null } });
      // La clé ne reste pas dans la page une fois envoyée.
      setKey("");
      setSecretKey("");
      await refresh();
      setAdded(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Ajout impossible"));
    } finally {
      setBusy(false);
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
        <button type="button" onClick={close} className="press w-full rounded-xl bg-accent py-3 font-semibold text-white">
          {t("Terminé")}
        </button>
      </Sheet>
    );

  const coinstatsChoice = coinstats.length > 0 && (
    <label className="card block px-4 py-3">
      <span className="block text-xs text-muted">{t("Déjà suivi dans CoinStats ?")}</span>
      <select value={replaces} onChange={(e) => setReplaces(e.target.value)} className="w-full bg-transparent text-[15px] font-medium outline-none">
        <option value="">{t("Non")}</option>
        {coinstats.map((s) => (
          <option key={s.portfolioId} value={s.portfolioId}>
            {s.name}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs leading-relaxed text-muted">{t("Les cryptos lues ici ne seront plus comptées dans ce portefeuille CoinStats.")}</span>
    </label>
  );

  return (
    <Sheet open onClose={close} title={t("Ajouter un portefeuille")}>
      <div className="mb-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "adresse", label: t("Par son adresse") },
            { value: "exchange", label: t("Compte d'exchange") },
          ]}
        />
      </div>
      {mode === "adresse" ? (
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
            text.length > 0 && <div className="px-1 text-sm text-muted">{t("Adresse non reconnue pour le moment : Bitcoin, Ethereum, Solana ou MultiversX.")}</div>
          )}
          <Field label={t("Nom du portefeuille (facultatif)")} value={name} onChange={setName} text placeholder="Ledger, MetaMask…" />
          {coinstatsChoice}
          <button type="button" onClick={add} disabled={!ready || busy} className="press w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50">
            {busy ? t("Lecture en cours…") : t("Ajouter le portefeuille")}
          </button>
          <p className="px-1 text-xs leading-relaxed text-muted">{t("Pour un exchange (Kraken, Binance, Coinbase, Bitpanda), une adresse ne suffit pas : ses comptes ne sont pas sur une adresse à toi. Relie-le par l'onglet « Compte d'exchange ».")}</p>
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
          <Field label={t("Nom du portefeuille (facultatif)")} value={name} onChange={setName} text placeholder={info.name} />
          {coinstatsChoice}
          <button type="button" onClick={add} disabled={!ready || busy} className="press w-full rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-50">
            {busy ? t("Lecture en cours…") : t("Relier {exchange}", { exchange: info.name })}
          </button>
          <p className="px-1 text-xs leading-relaxed text-muted">{t("Un autre exchange ? Saisis la position à la main, ou passe par CoinStats.")}</p>
        </div>
      )}
    </Sheet>
  );
}
