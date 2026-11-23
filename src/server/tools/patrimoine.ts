import { z } from "zod";
import { exec, one, q } from "../db.ts";
import { updateAsset, updateCryptoPosition } from "../actions.ts";
import { computeWealth, refreshWealth, snapshotWealth } from "../wealth.ts";
import { summarizeLoan, type ScheduleRow } from "../../lib/loans.ts";
import { ToolError, change, money, field, r2, readTool, today, writeTool } from "./registry.ts";
import { t as tr, tk } from "../../lib/i18n.ts";

/** Nature d'un placement dans un texte de confirmation : l'identifiant reste la valeur, on ne traduit qu'à l'affichage. */
const ASSET_CATEGORIES: Record<string, string> = { epargne: tk("Épargne"), placement: tk("Placement"), immobilier: tk("immobilier"), autre: tk("autre") };

/* Patrimoine : comptes, placements, crypto, crédits. */

const getWealth = readTool({
  name: "get_wealth",
  progress: tk("Calcul du patrimoine…"),
  description:
    "Patrimoine de l'utilisateur : net, brut, dettes, répartition, comptes, placements (avec leur asset_id), crypto regroupée par jeton, positions crypto saisies à la main (position_id), crédits. Un placement peut porter payout_match : le texte du libellé des versements qu'il rapporte (coupons, intérêts, ce qu'une plateforme reverse) — search_transactions avec ce texte en donne la liste ; valuation « versements » : sa valeur est le dernier versement reçu, mise à jour seule.",
  input: z.object({}),
  async run({ userId }) {
    const w = await computeWealth(userId);
    return {
      date: w.date,
      net: w.net,
      gross: w.gross,
      debts: w.debts,
      by_category: w.byCategory,
      accounts: w.accounts.map((a) => ({ name: a.display_name ?? a.name, balance: a.balance, share: a.share })),
      assets: w.assets.map((a) => ({
        asset_id: a.id,
        name: a.name,
        category: a.category,
        valuation: a.valuation,
        value: a.value,
        share: a.share,
        value_date: a.valueDate,
        quantity: a.quantity,
        cash: a.cash,
        price: a.price,
        invested: a.invested,
        // Texte des versements reçus (coupons, intérêts…) ; valuation « versements » : la valeur est le dernier versement.
        payout_match: a.payoutMatch,
      })),
      crypto: {
        total: w.crypto.total,
        change_24h_pct: w.crypto.change24h,
        // Regroupé par crypto (la synchro CoinStats donne une ligne par portefeuille, longue traîne comprise).
        by_coin: Object.values(
          w.crypto.positions.reduce<Record<string, { symbol: string; quantity: number; value: number; portfolios: string[] }>>((acc, p) => {
            const k = p.symbol.toUpperCase();
            acc[k] ??= { symbol: p.symbol, quantity: 0, value: 0, portfolios: [] };
            acc[k].quantity += p.manual_value != null ? 0 : p.quantity;
            acc[k].value += p.value ?? 0;
            if (p.location) acc[k].portfolios.push(p.location);
            return acc;
          }, {}),
        )
          .sort((a, b) => b.value - a.value)
          .slice(0, 25)
          .map((c) => ({ ...c, value: r2(c.value) })),
        // Seules les lignes saisies à la main sont modifiables (update_crypto_position) ; les autres viennent de CoinStats ou de la blockchain.
        manual_positions: w.crypto.positions
          .filter((p) => p.source === "manuel")
          .map((p) => ({ position_id: p.id, symbol: p.symbol, quantity: p.quantity, price: p.price, value: p.value, manual_value: p.manual_value })),
      },
      loans: w.loans.map((l) => ({ loan_id: l.id, name: l.name, remaining: l.summary.remaining, share: l.share, progress: l.summary.progress, end_date: l.end_date })),
    };
  },
});

const getLoan = readTool({
  name: "get_loan",
  progress: tk("Lecture du crédit…"),
  description: "Détail d'un crédit immobilier : capital restant dû, prochaine échéance, échéances à venir, coût total.",
  input: z.object({ loan_id: z.string().max(32) }),
  async run({ userId }, { loan_id }) {
    const loan = await one<Record<string, unknown> & { principal: number; disbursed: number | null }>(
      "SELECT * FROM loans WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)",
      [loan_id, userId],
    );
    if (!loan) throw new ToolError("Crédit introuvable");
    const schedule = await q<ScheduleRow>(
      "SELECT rang, date, payment, principal, interest, insurance, deferred_interest, remaining FROM loan_schedule WHERE loan_id = ? ORDER BY rang",
      [loan_id],
    );
    const d = today();
    return { loan, summary: summarizeLoan(schedule, Number(loan.disbursed ?? loan.principal), d), next_12_payments: schedule.filter((s) => s.date > d).slice(0, 12) };
  },
});

const updateAssetTool = writeTool({
  name: "update_asset",
  description:
    "Met à jour un placement : value pour une valeur saisie à la main (livret, assurance vie…), quantity/cash pour un placement coté (PEA : nombre de parts et espèces). payout_match : texte du libellé des versements qu'il rapporte (coupons d'une obligation, intérêts, ce qu'une plateforme reverse) — sa fiche en montre alors l'historique, le total par année et le rendement ; chaîne vide pour ne plus les suivre. value_follows_payouts : true pour un portefeuille vidé à chaque versement (sa valeur devient le dernier versement reçu et se met à jour seule), false pour revenir à une valeur saisie.",
  input: z.object({
    asset_id: z.number().int(),
    value: z.number().optional(),
    quantity: z.number().optional(),
    cash: z.number().optional(),
    payout_match: z.string().max(120).optional().describe("Texte présent dans le libellé des versements reçus ; \"\" pour arrêter le suivi"),
    value_follows_payouts: z.boolean().optional().describe("La valeur du placement est le dernier versement reçu"),
  }),
  async describe({ userId }, i) {
    const a = await one<{ name: string; value: number | null; quantity: number | null; cash: number | null; payout_match: string | null; valuation: string }>(
      "SELECT name, value, quantity, cash, payout_match, valuation FROM assets WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)",
      [i.asset_id, userId],
    );
    if (!a) throw new ToolError("Placement introuvable");
    const details: string[] = [];
    if (i.value !== undefined) details.push(change(tr("Valeur"), money(Number(a.value ?? 0)), money(i.value)));
    if (i.quantity !== undefined) details.push(change(tr("Parts##titres"), a.quantity ?? 0, i.quantity));
    if (i.cash !== undefined) details.push(change(tr("Espèces"), money(Number(a.cash ?? 0)), money(i.cash)));
    if (i.payout_match !== undefined) details.push(change(tr("Versements reçus"), a.payout_match ?? "—", i.payout_match.trim() || "—"));
    if (i.value_follows_payouts !== undefined)
      details.push(change(tr("Valeur"), a.valuation === "versements" ? tr("le dernier versement reçu") : tr("saisie à la main"), i.value_follows_payouts ? tr("le dernier versement reçu") : tr("saisie à la main")));
    return { label: tr("Mettre à jour « {nom} »", { nom: a.name }), details };
  },
  async run({ userId }, i) {
    await updateAsset(userId, i.asset_id, { value: i.value, quantity: i.quantity, cash: i.cash, payoutMatch: i.payout_match, followPayouts: i.value_follows_payouts });
    return "Fait : placement mis à jour.";
  },
});

const updateCrypto = writeTool({
  name: "update_crypto_position",
  description:
    "Met à jour une position crypto SAISIE À LA MAIN : quantity, ou manual_value pour une ligne valorisée à la main. Les positions synchronisées (CoinStats, blockchain) ne se modifient pas ici.",
  input: z.object({ position_id: z.number().int(), quantity: z.number().min(0).optional(), manual_value: z.number().optional() }),
  async describe({ userId }, i) {
    const p = await one<{ name: string; symbol: string; quantity: number; manual_value: number | null }>(
      "SELECT name, symbol, quantity, manual_value FROM crypto_positions WHERE id = ? AND owner_user_id = ?",
      [i.position_id, userId],
    );
    if (!p) throw new ToolError("Position introuvable");
    const details: string[] = [];
    if (i.quantity !== undefined) details.push(change(tr("Quantité"), `${Number(p.quantity)} ${p.symbol}`, `${i.quantity} ${p.symbol}`));
    if (i.manual_value !== undefined) details.push(change(tr("Valeur"), money(Number(p.manual_value ?? 0)), money(i.manual_value)));
    return { label: tr("Mettre à jour la position « {nom} »", { nom: p.name }), details };
  },
  async run({ userId }, i) {
    await updateCryptoPosition(userId, i.position_id, { quantity: i.quantity, manualValue: i.manual_value });
    return "Fait : position mise à jour.";
  },
});

const addAsset = writeTool({
  name: "add_asset",
  description:
    "Ajoute un placement ou un compte d'épargne au patrimoine de l'utilisateur (livret, PEA, assurance vie, épargne salariale…), valorisé à la main. Pour changer ensuite sa valeur : update_asset.",
  input: z.object({
    name: z.string().min(2).max(160).describe("Nom affiché (ex. « Livret A de Camille »)"),
    category: z.enum(["epargne", "placement", "immobilier", "autre"]).describe("epargne = livrets ; placement = PEA, assurance vie, titres"),
    value: z.number().min(0),
    institution: z.string().max(255).nullable().optional().describe("Banque ou établissement"),
    invested: z.number().min(0).nullable().optional().describe("Montant versé, pour un placement"),
    notes: z.string().max(2000).nullable().optional(),
  }),
  async describe({ userId }, i) {
    const same = await one("SELECT id FROM assets WHERE owner_user_id = ? AND name = ?", [userId, i.name]);
    if (same) throw new ToolError(`Un placement « ${i.name} » existe déjà : utilise update_asset pour changer sa valeur`);
    return { label: tr("Ajouter « {nom} » à ton patrimoine", { nom: i.name }), details: [field(tr("Valeur"), money(i.value)), tr(ASSET_CATEGORIES[i.category] ?? i.category), i.institution ?? null].filter((x): x is string => !!x) };
  },
  async run({ userId }, i) {
    const max = await one<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM assets WHERE owner_user_id = ? AND category = ?", [userId, i.category]);
    await exec("INSERT INTO assets (owner_user_id, name, category, value, value_date, institution, invested, notes, liquidity, sort_order) VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?)", [
      userId,
      i.name,
      i.category,
      i.value,
      i.institution ?? null,
      i.invested ?? null,
      i.notes ?? null,
      i.category === "epargne" ? "Liquide" : null,
      (max?.m ?? 0) + 1,
    ]);
    await snapshotWealth(userId);
    return "Fait : placement ajouté.";
  },
});

const addCrypto = writeTool({
  name: "add_crypto_position",
  description:
    "Ajoute (ou remplace) une position crypto saisie à la main dans le patrimoine de l'utilisateur, pour une plateforme sans synchronisation (ex. SwissBorg). " +
    "coingecko_id (ex. « bitcoin », « ethereum ») donne le cours ; sans lui, fournir manual_value. Une seule ligne à la main par symbole : la redonner remplace sa quantité." +
    " Un portefeuille dont le membre connaît l'adresse publique (Bitcoin, Ethereum, Solana, clé xpub d'un Ledger) ou un compte chez un exchange que Pécule sait lire (Kraken, Binance, Coinbase, Bitpanda, Bitvavo, OKX, Bybit, KuCoin, Bitget, Bitfinex, Crypto.com Exchange) ne se saisit pas à la main : il l'ajoute lui-même à l'écran Crypto (par l'adresse, par une clé d'API en lecture seule, ou par l'export CSV de l'appli Crypto.com), où il est relu chaque jour (manuel : article « crypto »). Ne demande jamais une clé d'API dans la conversation.",
  input: z.object({
    symbol: z.string().min(1).max(24),
    name: z.string().min(1).max(80),
    quantity: z.number().min(0),
    coingecko_id: z.string().max(80).nullable().optional(),
    manual_value: z.number().min(0).nullable().optional().describe("Valeur saisie à la main, dans la devise du foyer, quand il n'y a pas de cours"),
    location: z.string().max(255).nullable().optional().describe("Plateforme ou portefeuille (ex. « SwissBorg »)"),
  }),
  async describe({ userId }, i) {
    if (!i.coingecko_id && i.manual_value == null) throw new ToolError("Sans coingecko_id, la position n'a pas de cours : fournis manual_value");
    const before = await one<{ quantity: number }>("SELECT quantity FROM crypto_positions WHERE owner_user_id = ? AND source = 'manuel' AND line_key = ?", [userId, i.symbol.toUpperCase()]);
    return {
      label: before ? tr("Remplacer la position {symbole} saisie à la main", { symbole: i.symbol.toUpperCase() }) : tr("Ajouter la position {symbole} saisie à la main", { symbole: i.symbol.toUpperCase() }),
      details: [
        before ? change(tr("Quantité"), Number(before.quantity), `${i.quantity} ${i.symbol.toUpperCase()}`) : field(tr("Quantité"), `${i.quantity} ${i.symbol.toUpperCase()}`),
        i.location ?? null,
        i.manual_value != null ? field(tr("Valeur"), money(i.manual_value)) : null,
      ].filter((x): x is string => !!x),
    };
  },
  async run({ userId }, i) {
    const symbol = i.symbol.toUpperCase();
    const max = await one<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM crypto_positions WHERE owner_user_id = ?", [userId]);
    await exec(
      `INSERT INTO crypto_positions (owner_user_id, symbol, line_key, name, coingecko_id, quantity, manual_value, location, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), coingecko_id = VALUES(coingecko_id), quantity = VALUES(quantity), manual_value = VALUES(manual_value),
         location = VALUES(location), updated_at = VALUES(updated_at), archived_at = NULL, archived_reason = NULL`,
      [userId, symbol, symbol, i.name, i.coingecko_id ?? null, i.quantity, i.manual_value ?? null, i.location ?? null, (max?.m ?? 0) + 1],
    );
    // Cours de la nouvelle crypto, puis instantané du patrimoine.
    await refreshWealth().catch(() => undefined);
    await snapshotWealth(userId);
    return `Fait : position ${symbol} enregistrée.`;
  },
});

export const patrimoineTools = [getWealth, getLoan, updateAssetTool, updateCrypto, addAsset, addCrypto];
