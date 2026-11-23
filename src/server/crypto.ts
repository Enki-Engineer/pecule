import { createHash } from "node:crypto";
import { isDemo } from "./demo-context.ts";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { env, sealingSecret } from "./env.ts";
import { db, exec, one, q, withLock } from "./db.ts";
import { adminMember, memberByName } from "./members.ts";
import { cryptoPositions, cryptoSources, cryptoSyncRuns, prices } from "./db/schema/index.ts";
import { coinstatsEnabled, creditsUsed, eurRate, listPortfolios, portfolioCoins, type CsCoinLine, type CsPortfolio } from "./coinstats.ts";
import { coingeckoCandidate, decideManualLines, portfolioSignature, suspiciousDrop, withoutChainCovered, type SyncedLine } from "../lib/crypto-sync.ts";
import { detectWallet, isWalletKind, shortAddress, WALLET_KINDS, WALLET_NAMES, type Holding, type WalletKind } from "../lib/crypto-chains.ts";
import { egldStaking, isMultiversXAddress } from "./multiversx.ts";
import { ethValidator, isValidatorId } from "./beacon.ts";
import { isBitcoinAddress, parseXpub, readBitcoinAddress, readBitcoinXpub } from "./chains/bitcoin.ts";
import { isEvmAddress, readEvmAddress } from "./chains/evm.ts";
import { isSolanaAddress, readSolanaAddress } from "./chains/solana.ts";
import { EXCHANGE_KINDS, EXCHANGES, exchangeOf, isExchangeKind, sameCoin, type ExchangeId } from "../lib/crypto-exchanges.ts";
import { ExchangeError, readExchange, type Credentials } from "./exchanges/index.ts";
import { logAudit, recordAlert } from "./journal.ts";
import { refreshPrices, snapshotWealth } from "./wealth.ts";
import { t } from "../lib/i18n.ts";
import { serviceKey } from "./service-keys.ts";
import { createSealer } from "./secret.ts";

/*
 * Quantités crypto, relues une fois par jour ou sur demande, par deux voies qui se complètent :
 * - les portefeuilles qu'un membre ajoute par leur adresse publique, lus sur la blockchain sans intermédiaire
 *   (src/server/chains/), et les comptes d'exchange qu'il relie par une clé d'API en lecture seule
 *   (src/server/exchanges/) — chacun a les siens ;
 * - le compte CoinStats du foyer, s'il en a un : portefeuilles « feuilles » uniquement (un parent ne fait que
 *   regrouper), doublons écartés, garde-fou contre une connexion cassée, lignes manuelles couvertes archivées.
 */

type Leaf = CsPortfolio & { parentId: string | null; parentName: string | null };
type Source = typeof cryptoSources.$inferSelect;
/** Ce qu'une lecture rend : les avoirs, une note pour l'écran, et le début des clés de ce qui n'a pas pu être lu. */
type Reading = { holdings: Holding[]; note: string; alert?: string; unread?: string[] };

const sealer = createSealer(sealingSecret);
/** Genres lus sans intermédiaire : par une adresse publique, ou par la clé d'un compte d'exchange. */
const DIRECT_KINDS: string[] = [...WALLET_KINDS, ...EXCHANGE_KINDS];
const isDirect = (type: string) => isWalletKind(type) || isExchangeKind(type);
/** `source` des lignes écrites pour une source lue sans intermédiaire. */
const lineSource = (type: string) => (isExchangeKind(type) ? "exchange" : "onchain");
const DIRECT_LINES = ["onchain", "exchange"];
/** Ce qui suit le préfixe de l'identifiant d'une source : son adresse (« btc:bc1… », « evm:0x… », « eth-val:12 »). */
const addressOf = (src: { portfolioId: string }) => src.portfolioId.slice(src.portfolioId.indexOf(":") + 1);

/** Lecteur de chaque genre de portefeuille lu directement (lecture seule, sans clé). */
const READERS: Record<WalletKind, (src: Source) => Promise<Reading>> = {
  btc: (src) => readBitcoinAddress(addressOf(src)),
  "btc-xpub": async (src) => {
    const xpub = src.secret ? sealer.open(src.secret) : null;
    if (!xpub) throw new Error("clé publique étendue illisible : retirer ce portefeuille et l'ajouter de nouveau");
    return readBitcoinXpub(xpub);
  },
  evm: (src) => readEvmAddress(addressOf(src)),
  sol: (src) => readSolanaAddress(addressOf(src)),
  "mvx-staking": async (src) => {
    const st = await egldStaking(addressOf(src));
    return {
      holdings: [{ key: "elrond-erd-2", symbol: "EGLD", name: "MultiversX", coingeckoId: "elrond-erd-2", quantity: st.total }],
      note: `${st.active.toFixed(4)} EGLD délégués + ${st.rewards.toFixed(4)} à réclamer${st.undelegating ? ` + ${st.undelegating.toFixed(4)} en retrait` : ""}`,
    };
  },
  "eth-validator": async (src) => {
    const v = await ethValidator(addressOf(src));
    return {
      holdings: [{ key: "ethereum", symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", quantity: v.balance }],
      note: `validateur n° ${v.index} · ${v.balance.toFixed(4)} ETH · ${v.status}`,
      alert: v.slashed ? "validateur SANCTIONNÉ (slashed) : vérifier dans Kiln" : v.status.startsWith("active") ? undefined : `validateur dans l'état « ${v.status} »`,
    };
  },
};
/** Lit une source selon son genre : une adresse sur sa blockchain, un compte chez son exchange. */
function read(src: Source): Promise<Reading> {
  if (isWalletKind(src.type)) return READERS[src.type](src);
  if (!isExchangeKind(src.type)) throw new Error(`source de genre inconnu : ${src.type}`);
  const opened = src.secret ? sealer.open(src.secret) : null;
  let creds: Credentials | null = null;
  try {
    creds = opened ? (JSON.parse(opened) as Credentials) : null;
  } catch {
    creds = null;
  }
  if (!creds?.key) throw new ExchangeError("clé illisible : retirer ce compte et l'ajouter de nouveau", true);
  return readExchange(exchangeOf(src.type), creds);
}

type Fetched = { leaf: Leaf; lines: CsCoinLine[]; totalEur: number };

const MIN_EUR_FOR_COINGECKO = 20;

async function ownerId(): Promise<number> {
  const u = env.COINSTATS_OWNER ? await memberByName(env.COINSTATS_OWNER) : await adminMember();
  if (!u) throw new Error("Aucun membre administrateur : impossible d'attribuer les positions CoinStats");
  return u.id;
}

/** Ids CoinGecko qui répondent vraiment (un appel pour tous les candidats). */
async function validCoingeckoIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Pecule)" };
  const coingecko = serviceKey("coingecko");
  if (coingecko) headers["x-cg-demo-api-key"] = coingecko;
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.map(encodeURIComponent).join(",")}&vs_currencies=eur`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CoinGecko → HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, { eur?: number }>;
  return new Set(Object.entries(data).filter(([, v]) => typeof v.eur === "number").map(([k]) => k));
}

/** Écrit ce qu'une lecture a rendu : les lignes du portefeuille, et l'état de la source. */
async function writeReading(src: Source, r: Reading) {
  const source = lineSource(src.type);
  const exchange = isExchangeKind(src.type) ? exchangeOf(src.type) : null;
  const keys: string[] = [];
  for (const h of r.holdings) {
    const lineKey = `${src.portfolioId}:${h.key}`.slice(0, 160);
    keys.push(lineKey);
    // Le cours que la source donne elle-même est gardé sous sa propre clé : il vaut pour ce que CoinGecko ne suit
    // pas, et il dément la table quand deux cryptos portent le même symbole.
    const ownPrice = exchange ? `x:${exchange}:${h.symbol}`.slice(0, 90) : null;
    let coingeckoId = h.coingeckoId;
    if (coingeckoId && h.priceEur) {
      const known = await one<{ p: number }>("SELECT price_eur AS p FROM prices WHERE id = ?", [`cg:${coingeckoId}`]);
      if (known?.p && !sameCoin(h.priceEur, Number(known.p))) coingeckoId = null;
    }
    if (ownPrice && h.priceEur)
      await db
        .insert(prices)
        .values({ id: `cs:${ownPrice}`, priceEur: h.priceEur })
        .onDuplicateKeyUpdate({ set: { priceEur: h.priceEur, updatedAt: sql`CURRENT_TIMESTAMP` } });
    const row = {
      name: h.name.slice(0, 80),
      symbol: h.symbol.slice(0, 24),
      quantity: h.quantity,
      coingeckoId,
      coinstatsId: ownPrice ?? h.coingeckoId,
      location: (h.place ? `${src.name} · ${h.place}` : src.name).slice(0, 255),
      portfolioId: src.portfolioId,
      syncedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURDATE()`,
    };
    await db
      .insert(cryptoPositions)
      .values({ ownerUserId: src.ownerUserId, source, lineKey, ...row })
      .onDuplicateKeyUpdate({ set: row });
  }
  // Ce qui n'est plus détenu part ; ce qui n'a pas pu être lu cette fois garde sa ligne d'avant.
  const kept = (r.unread ?? []).map((prefix) => `${src.portfolioId}:${prefix}`);
  const before = await db
    .select({ id: cryptoPositions.id, lineKey: cryptoPositions.lineKey })
    .from(cryptoPositions)
    .where(and(eq(cryptoPositions.source, source), eq(cryptoPositions.portfolioId, src.portfolioId)));
  const gone = before.filter((p) => !keys.includes(p.lineKey) && !kept.some((prefix) => p.lineKey.startsWith(prefix)));
  if (gone.length) await db.delete(cryptoPositions).where(inArray(cryptoPositions.id, gone.map((p) => p.id)));
  const lines = before.length - gone.length + keys.filter((k) => !before.some((p) => p.lineKey === k)).length;
  await db
    .update(cryptoSources)
    .set({ status: lines ? "ok" : "vide", lines, lastSyncedAt: sql`CURRENT_TIMESTAMP`, note: (exchange ? r.note : `${r.note} (lu sur la blockchain)`).slice(0, 255) })
    .where(eq(cryptoSources.portfolioId, src.portfolioId));
}

/**
 * Relit une source. Une lecture qui échoue garde les lignes d'avant et le dit dans l'état : « erreur » pour une
 * panne, « refus » quand c'est la clé d'un exchange qui n'est plus acceptée (expirée, retirée, droits changés).
 */
async function readSource(src: Source): Promise<{ ok: true } | { ok: false; message: string; refused: boolean }> {
  try {
    const reading = await read(src);
    await writeReading(src, reading);
    if (reading.alert) await recordAlert("crypto", `${src.name} : ${reading.alert}`, undefined, "alerte");
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const refused = e instanceof ExchangeError && e.refused;
    await db.update(cryptoSources).set({ status: refused ? "refus" : "erreur", note: message.slice(0, 255) }).where(eq(cryptoSources.portfolioId, src.portfolioId));
    await recordAlert("crypto", `${isExchangeKind(src.type) ? "Lecture du compte impossible" : "Lecture sur la blockchain impossible"} (${src.name}) : ${message}`, undefined, "alerte");
    return { ok: false, message, refused };
  }
}

/** Valeur de chaque source lue sans intermédiaire, aux cours du moment (en euros, le pivot des cours). */
async function refreshDirectTotals() {
  await exec(
    `UPDATE crypto_sources s SET s.last_total_eur = (
       SELECT ROUND(SUM(c.quantity * COALESCE(pg.price_eur, ps.price_eur)), 2)
       FROM crypto_positions c
       LEFT JOIN prices pg ON pg.id = CONCAT('cg:', c.coingecko_id)
       LEFT JOIN prices ps ON ps.id = CONCAT('cs:', c.coinstats_id)
       WHERE c.portfolio_id = s.portfolio_id AND c.source IN ('onchain', 'exchange') AND c.archived_at IS NULL)
     WHERE s.type IN (${DIRECT_KINDS.map(() => "?").join(", ")})`,
    DIRECT_KINDS,
  );
}

/** Sources lues directement, celles de tous les membres : chacun a les siennes. */
const directSources = (onlyEnabled = true) =>
  db
    .select()
    .from(cryptoSources)
    .where(and(inArray(cryptoSources.type, DIRECT_KINDS), onlyEnabled ? eq(cryptoSources.enabled, 1) : sql`1 = 1`));

/**
 * Synchro des quantités : les portefeuilles lus sur la blockchain, puis le compte CoinStats s'il y en a un.
 * `null` si une synchro tourne déjà, ou s'il n'y a rien à relire.
 */
export async function syncCrypto(trigger: "auto" | "manuel" | "assistant") {
  if (isDemo()) throw new Error("Synchro crypto indisponible en mode démo");
  const coinstats = coinstatsEnabled();
  if (!coinstats && !(await directSources()).length) return null;
  return withLock("pecule:crypto", async () => {
    const [run] = await db.insert(cryptoSyncRuns).values({ trigger }).$returningId();
    try {
      const direct = await directSources();
      let read = 0;
      for (const src of direct) if ((await readSource(src)).ok) read++;
      // CoinStats en panne n'empêche pas de garder ce que la blockchain vient de rendre : l'échec est levé à la fin.
      let failure: unknown = null;
      const cs = coinstats
        ? await syncCoinstats().catch((e) => {
            failure = e;
            return null;
          })
        : null;
      await refreshPrices().catch(() => undefined);
      await refreshDirectTotals();
      const owners = new Set(direct.map((s) => s.ownerUserId));
      if (cs) owners.add(cs.owner);
      for (const id of owners) await snapshotWealth(id);
      if (failure) throw failure;
      const lines = await one<{ n: number }>("SELECT COUNT(*) AS n FROM crypto_positions WHERE source IN ('coinstats', 'onchain', 'exchange') AND archived_at IS NULL");
      await db
        .update(cryptoSyncRuns)
        .set({ status: "ok", finishedAt: sql`CURRENT_TIMESTAMP`, sources: read + (cs?.sources ?? 0), lines: Number(lines?.n ?? 0), totalEur: cs?.totalEur ?? null, creditsUsed: cs?.creditsUsed ?? null })
        .where(eq(cryptoSyncRuns.id, run.id));
      return { archived: cs?.archived ?? 0, archivedFor: cs?.owner ?? null };
    } catch (e) {
      await db
        .update(cryptoSyncRuns)
        .set({ status: "error", finishedAt: sql`CURRENT_TIMESTAMP`, error: (e instanceof Error ? e.message : String(e)).slice(0, 2000) })
        .where(eq(cryptoSyncRuns.id, run.id));
      await recordAlert("crypto", `Synchro crypto en échec : ${e instanceof Error ? e.message : String(e)}`, e);
      throw e;
    }
  });
}

/** Ce que la synchro laisse à un membre : ses portefeuilles et ses lignes, jamais ceux d'un autre. */
export async function syncSummary(userId: number, r: { archived: number; archivedFor: number | null }) {
  const mine = await one<{ sources: number; n: number }>(
    `SELECT (SELECT COUNT(*) FROM crypto_sources WHERE owner_user_id = ? AND enabled = 1 AND status IN ('ok', 'vide')) AS sources,
            (SELECT COUNT(*) FROM crypto_positions WHERE owner_user_id = ? AND source IN ('coinstats', 'onchain', 'exchange') AND archived_at IS NULL) AS n`,
    [userId, userId],
  );
  const any = await one("SELECT 1 AS x FROM crypto_sources WHERE owner_user_id = ? LIMIT 1", [userId]);
  return any ? { sources: Number(mine?.sources ?? 0), lines: Number(mine?.n ?? 0), archived: r.archivedFor === userId ? r.archived : 0 } : {};
}

/** Partie CoinStats de la synchro : les quantités de tous les portefeuilles du compte du foyer. */
async function syncCoinstats() {
  const owner = await ownerId();
  const creditsBefore = await creditsUsed().catch(() => null);
  const rate = await eurRate();
  // Taux du jour gardé pour convertir le coût de l'IA (facturé en dollars).
  await db
    .insert(prices)
    .values({ id: "fx:USD", priceEur: rate })
    .onDuplicateKeyUpdate({ set: { priceEur: rate, updatedAt: sql`UTC_TIMESTAMP()` } });
  const tree = await listPortfolios();
  const leaves = tree.flatMap((p): Leaf[] =>
    p.portfolioType === "parent"
      ? (p.children ?? []).map((c) => ({ ...c, parentId: p.portfolioId, parentName: p.portfolioName }))
      : [{ ...p, parentId: null, parentName: null }],
  );

  // Sources connues (on garde le choix « enabled » fait dans l'appli).
  const known = new Map((await db.select().from(cryptoSources)).map((s) => [s.portfolioId, s]));
  for (const l of leaves) {
    const name = l.parentName && l.parentName.trim() !== l.portfolioName.trim() ? `${l.parentName.trim()} · ${l.portfolioName.trim()}` : l.portfolioName.trim();
    if (!known.has(l.portfolioId))
      await db.insert(cryptoSources).values({ portfolioId: l.portfolioId, ownerUserId: owner, parentId: l.parentId, name, type: l.portfolioType });
    else await db.update(cryptoSources).set({ name, type: l.portfolioType, parentId: l.parentId }).where(eq(cryptoSources.portfolioId, l.portfolioId));
  }

  const fetched: Fetched[] = [];
  const seen = new Set<string>();
  for (const leaf of leaves) {
    const src = known.get(leaf.portfolioId);
    if (src && !src.enabled) continue;
    // Lignes sans cours ignorées : jetons « spam » déposés sans demande (fréquents sur la BSC), sans valeur.
    const lines = (await portfolioCoins(leaf.portfolioId)).filter((r) => r.count > 0 && Number(r.price?.USD ?? 0) > 0);
    const sig = portfolioSignature(leaf.parentId, leaf.portfolioName, lines.map((r) => ({ identifier: r.coin.identifier, count: r.count })));
    const totalEur = lines.reduce((s, r) => s + r.count * Number(r.price?.USD ?? 0) * rate, 0);
    const status = { set: (s: Parameters<ReturnType<typeof db.update<typeof cryptoSources>>["set"]>[0]) => db.update(cryptoSources).set(s).where(eq(cryptoSources.portfolioId, leaf.portfolioId)) };
    if (lines.length && seen.has(sig)) {
      await status.set({ status: "doublon", lines: lines.length, note: "Même contenu qu'un autre portefeuille du même nom : compté une seule fois", lastSyncedAt: sql`CURRENT_TIMESTAMP` });
      await db.delete(cryptoPositions).where(and(eq(cryptoPositions.source, "coinstats"), eq(cryptoPositions.portfolioId, leaf.portfolioId)));
      continue;
    }
    seen.add(sig);
    if (suspiciousDrop(src?.lastTotalEur ?? null, totalEur, lines.length)) {
      await status.set({ status: "a_verifier", note: `Valeur passée de ${Math.round(src?.lastTotalEur ?? 0)} € à ${Math.round(totalEur)} € : positions précédentes conservées` });
      await recordAlert("crypto", `Portefeuille CoinStats « ${leaf.portfolioName} » à vérifier : ${Math.round(src?.lastTotalEur ?? 0)} € → ${Math.round(totalEur)} € (connexion à vérifier dans CoinStats)`, undefined, "alerte");
      continue;
    }
    fetched.push({ leaf, lines, totalEur });
    await status.set({ status: lines.length ? "ok" : "vide", lines: lines.length, lastTotalEur: Math.round(totalEur * 100) / 100, lastSyncedAt: sql`CURRENT_TIMESTAMP`, note: null });
  }

  const usd = new Map<string, number>();
  for (const f of fetched) for (const r of f.lines) if (r.price?.USD) usd.set(r.coin.identifier, Number(r.price.USD));

  // Un actif lu sur la blockchain (staking, validateur) l'emporte sur sa saisie dans CoinStats : la source dit quel
  // portefeuille CoinStats elle remplace, et l'actif n'y est écarté que si la blockchain a déjà rendu une ligne.
  const chainLines = await q<{ portfolio_id: string; symbol: string; identifier: string | null; quantity: number; replaces_id: string | null }>(
    `SELECT c.portfolio_id, c.symbol, c.coingecko_id AS identifier, c.quantity, s.replaces_id
     FROM crypto_positions c JOIN crypto_sources s ON s.portfolio_id = c.portfolio_id
     WHERE c.source IN ('onchain', 'exchange') AND c.owner_user_id = ? AND s.enabled = 1 AND c.archived_at IS NULL`,
    [owner],
  );
  const skipKeys = new Set(chainLines.filter((c) => c.replaces_id).map((c) => `${c.replaces_id}:${c.symbol.toUpperCase()}`));
  // Seul ce qui a un identifiant de cours compte ensuite pour juger les lignes saisies à la main.
  for (const f of fetched) {
    const { kept, skipped } = withoutChainCovered(f.lines, f.leaf.portfolioId, skipKeys);
    if (!skipped.length) continue;
    f.lines = kept;
    f.totalEur = kept.reduce((s, r) => s + r.count * Number(r.price?.USD ?? 0) * rate, 0);
    await db
      .update(cryptoSources)
      .set({ lines: kept.length, lastTotalEur: Math.round(f.totalEur * 100) / 100, note: `${skipped.map((r) => r.coin.symbol).join(", ")} ignoré ici : lu sur la blockchain` })
      .where(eq(cryptoSources.portfolioId, f.leaf.portfolioId));
  }

  // Correspondance CoinGecko pour les lignes qui pèsent (le reste est valorisé au cours CoinStats).
  const manualRows = await db
    .select()
    .from(cryptoPositions)
    .where(and(eq(cryptoPositions.ownerUserId, owner), eq(cryptoPositions.source, "manuel")));
  const knownBySymbol = new Map(manualRows.filter((m) => m.coingeckoId).map((m) => [m.symbol.toUpperCase(), m.coingeckoId!]));
  const heavy = new Map<string, string>();
  for (const f of fetched)
    for (const r of f.lines) {
      const value = r.count * Number(r.price?.USD ?? 0) * rate;
      const cand = coingeckoCandidate(r.coin.identifier, r.coin.symbol, knownBySymbol);
      if (value >= MIN_EUR_FOR_COINGECKO && cand) heavy.set(r.coin.identifier, cand);
    }
  const valid = await validCoingeckoIds([...new Set(heavy.values())]).catch(async (e) => {
    await recordAlert("cours", `CoinGecko indisponible pendant la synchro crypto : ${e instanceof Error ? e.message : String(e)}`, undefined, "alerte");
    return new Set<string>();
  });

  // Écriture : lignes de chaque portefeuille synchronisé, cours CoinStats du jour.
  const synced: SyncedLine[] = [];
  for (const f of fetched) {
    const keys: string[] = [];
    for (const r of f.lines) {
      const lineKey = `${f.leaf.portfolioId}:${r.coin.identifier}`.slice(0, 160);
      const cg = heavy.get(r.coin.identifier);
      const priceEur = Number(r.price?.USD ?? 0) * rate;
      keys.push(lineKey);
      synced.push({ symbol: r.coin.symbol, identifier: r.coin.identifier, count: r.count, valueEur: r.count * priceEur });
      const row = {
        name: r.coin.name.slice(0, 80),
        symbol: r.coin.symbol.slice(0, 24),
        quantity: r.count,
        coingeckoId: cg && valid.has(cg) ? cg : null,
        coinstatsId: r.coin.identifier.slice(0, 120),
        location: (known.get(f.leaf.portfolioId)?.name ?? f.leaf.portfolioName).slice(0, 255),
        portfolioId: f.leaf.portfolioId,
        syncedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURDATE()`,
      };
      await db
        .insert(cryptoPositions)
        .values({ ownerUserId: owner, source: "coinstats", lineKey, ...row })
        .onDuplicateKeyUpdate({ set: row });
      if (priceEur > 0)
        await db
          .insert(prices)
          .values({ id: `cs:${r.coin.identifier}`.slice(0, 96), priceEur, change24h: r.coin.priceChange24h ?? null })
          .onDuplicateKeyUpdate({ set: { priceEur, change24h: r.coin.priceChange24h ?? null, updatedAt: sql`CURRENT_TIMESTAMP` } });
    }
    await db
      .delete(cryptoPositions)
      .where(and(eq(cryptoPositions.source, "coinstats"), eq(cryptoPositions.portfolioId, f.leaf.portfolioId), keys.length ? notInArray(cryptoPositions.lineKey, keys) : sql`1 = 1`));
  }
  // Ce que la blockchain a rendu compte aussi pour juger les lignes saisies à la main.
  for (const c of chainLines) synced.push({ symbol: c.symbol, identifier: c.identifier ?? c.symbol, count: Number(c.quantity), valueEur: Number(c.quantity) * (usd.get(c.identifier ?? "") ?? 0) * rate });

  // Portefeuilles disparus de CoinStats : leurs lignes partent aussi.
  const leafIds = leaves.map((l) => l.portfolioId);
  if (leafIds.length) await db.delete(cryptoPositions).where(and(eq(cryptoPositions.source, "coinstats"), notInArray(cryptoPositions.portfolioId, leafIds)));

  // Lignes saisies à la main : archivées si CoinStats les couvre.
  const decisions = decideManualLines(
    manualRows.filter((m) => !m.archivedAt).map((m) => ({ id: m.id, symbol: m.symbol, quantity: Number(m.quantity), manualValue: m.manualValue == null ? null : Number(m.manualValue) })),
    synced,
  );
  const toArchive = decisions.filter((d) => d.action === "archiver");
  for (const d of toArchive) await db.update(cryptoPositions).set({ archivedAt: sql`CURRENT_TIMESTAMP`, archivedReason: d.reason }).where(eq(cryptoPositions.id, d.id));
  for (const d of decisions.filter((x) => x.action === "conflit")) {
    const m = manualRows.find((r) => r.id === d.id)!;
    await recordAlert("crypto", `${m.symbol} compté deux fois ? ${d.reason} : archiver la ligne manuelle ou corriger CoinStats`, undefined, "alerte");
  }

  const total = Math.round(synced.reduce((s, l) => s + l.valueEur, 0) * 100) / 100;
  const creditsAfter = await creditsUsed().catch(() => null);
  return { owner, sources: fetched.length, totalEur: total, archived: toArchive.length, creditsUsed: creditsBefore && creditsAfter ? creditsAfter.usedCredits - creditsBefore.usedCredits : null };
}

/** Synchro quotidienne : appelée par le planificateur horaire, ne fait rien si la dernière réussie a moins de 20 h. */
export async function maybeSyncCrypto() {
  if (isDemo()) return;
  if (!coinstatsEnabled() && !(await directSources()).length) return;
  const last = await one<{ age: number | null }>("SELECT TIMESTAMPDIFF(HOUR, MAX(finished_at), NOW()) AS age FROM crypto_sync_runs WHERE status = 'ok'");
  if (last?.age != null && last.age < 20) return;
  await syncCrypto("auto").catch((e) => console.error("[crypto] synchro", e));
}

/** État pour l'écran Crypto : sources du membre, dernière synchro, lignes manuelles archivées. */
export async function cryptoStatus(userId: number) {
  const rows = await db.select().from(cryptoSources).where(eq(cryptoSources.ownerUserId, userId)).orderBy(desc(cryptoSources.lastTotalEur));
  // Le secret d'une source (clé étendue, chiffrée) ne quitte jamais le serveur.
  const sources = rows.map(({ secret: _secret, ...s }) => ({ ...s, direct: isDirect(s.type), exchange: isExchangeKind(s.type) ? exchangeOf(s.type) : null, address: s.type === "btc" || s.type === "evm" || s.type === "sol" ? shortAddress(addressOf(s)) : null }));
  const [run] = await db.select().from(cryptoSyncRuns).orderBy(desc(cryptoSyncRuns.id)).limit(1);
  // Le journal des synchros est commun au foyer : un membre n'y lit que la date et l'état, et le compte de ses
  // propres portefeuilles — la valeur de ceux d'un autre ne le regarde pas.
  const lastRun = run ? { ...run, totalEur: null, creditsUsed: null, error: null, lines: sources.reduce((n, s) => n + (s.enabled && s.status !== "doublon" ? s.lines : 0), 0), sources: sources.filter((s) => s.enabled && (s.status === "ok" || s.status === "vide")).length } : null;
  const archived = await db
    .select({ id: cryptoPositions.id, symbol: cryptoPositions.symbol, name: cryptoPositions.name, quantity: cryptoPositions.quantity, manualValue: cryptoPositions.manualValue, archivedAt: cryptoPositions.archivedAt, archivedReason: cryptoPositions.archivedReason })
    .from(cryptoPositions)
    .where(and(eq(cryptoPositions.ownerUserId, userId), eq(cryptoPositions.source, "manuel"), sql`${cryptoPositions.archivedAt} IS NOT NULL`));
  return { enabled: coinstatsEnabled(), sources, lastRun, archived };
}

export async function setSourceEnabled(userId: number, portfolioId: string, enabled: boolean) {
  // Seulement une source de ce membre : celle d'un autre n'est ni réglée ni vidée de ses positions.
  const mine = and(eq(cryptoSources.portfolioId, portfolioId), eq(cryptoSources.ownerUserId, userId));
  const own = await db.select({ id: cryptoSources.portfolioId, status: cryptoSources.status }).from(cryptoSources).where(mine);
  if (!own.length) return;
  await db.update(cryptoSources).set({ enabled: enabled ? 1 : 0 }).where(mine);
  if (enabled) return;
  await db.delete(cryptoPositions).where(and(inArray(cryptoPositions.source, ["coinstats", ...DIRECT_LINES]), eq(cryptoPositions.portfolioId, portfolioId)));
  // Plus aucune position n'est gardée : le garde-fou n'a plus de valeur d'avant à défendre si le portefeuille revient.
  await db
    .update(cryptoSources)
    .set(own[0].status === "a_verifier" ? { lastTotalEur: null, status: "vide", lines: 0, note: null } : { lastTotalEur: null })
    .where(mine);
}

/**
 * Le membre confirme qu'un portefeuille « à vérifier » a bien changé (vidé, vendu, transféré ailleurs) : la valeur
 * d'avant est oubliée, et la synchro suivante écrit ce que CoinStats rend. Faux si le portefeuille n'attend rien.
 */
export async function acceptSourceValue(userId: number, portfolioId: string) {
  const mine = and(eq(cryptoSources.portfolioId, portfolioId), eq(cryptoSources.ownerUserId, userId));
  const [src] = await db.select({ status: cryptoSources.status }).from(cryptoSources).where(mine);
  if (src?.status !== "a_verifier") return false;
  await db.update(cryptoSources).set({ lastTotalEur: null }).where(mine);
  return true;
}

/** Désarchive une ligne manuelle (elle recompte dans le total). */
export async function restoreManualLine(userId: number, id: number) {
  await db
    .update(cryptoPositions)
    .set({ archivedAt: null, archivedReason: null })
    .where(and(eq(cryptoPositions.id, id), eq(cryptoPositions.ownerUserId, userId), eq(cryptoPositions.source, "manuel")));
}

/**
 * Ajoute un portefeuille lu par son adresse publique : ce que le membre a collé est reconnu (Bitcoin, clé étendue
 * d'un compte Bitcoin, Ethereum et chaînes compatibles, Solana, staking MultiversX, validateur Ethereum), contrôlé,
 * puis lu tout de suite — rien n'est gardé si la lecture échoue. `replaces` : le portefeuille CoinStats du membre où
 * ces mêmes avoirs sont déjà saisis, pour ne pas les compter deux fois.
 */
export async function addWallet(userId: number, input: { address: string; name?: string | null; replaces?: string | null }) {
  if (isDemo()) throw new Error(t("Indisponible en mode démo"));
  const raw = input.address.trim();
  let kind = detectWallet(raw);
  // Une ancienne adresse Bitcoin et une adresse Solana courte ont la même forme : la somme de contrôle tranche.
  if (kind === "btc" && !isBitcoinAddress(raw) && isSolanaAddress(raw)) kind = "sol";
  if (!kind) throw new Error(t("Adresse non reconnue. Pécule lit une adresse Bitcoin, Ethereum, Solana ou MultiversX, et la clé publique étendue d'un compte Bitcoin."));

  let portfolioId: string;
  let secret: string | null = null;
  let label = `${WALLET_NAMES[kind]} ${shortAddress(raw)}`;
  if (kind === "btc") {
    if (!isBitcoinAddress(raw)) throw new Error(t("Adresse Bitcoin invalide : vérifie qu'elle est complète."));
    portfolioId = `btc:${/^bc1/i.test(raw) ? raw.toLowerCase() : raw}`;
  } else if (kind === "btc-xpub") {
    if (!parseXpub(raw)) throw new Error(t("Clé publique étendue invalide : vérifie qu'elle est complète."));
    // La clé donne toutes les adresses du compte : elle est gardée chiffrée, et la source se nomme par son empreinte.
    portfolioId = `btcx:${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
    secret = sealer.seal(raw);
    label = WALLET_NAMES[kind];
  } else if (kind === "evm") {
    if (!isEvmAddress(raw)) throw new Error(t("Adresse Ethereum invalide : vérifie qu'elle est complète et que ses majuscules n'ont pas changé."));
    portfolioId = `evm:${raw.toLowerCase()}`;
    // Une même adresse vaut pour toutes les chaînes : son nom ne dit pas « Ethereum », chaque ligne dit la sienne.
    label = t("Portefeuille {adresse}", { adresse: shortAddress(raw) });
  } else if (kind === "sol") {
    if (!isSolanaAddress(raw)) throw new Error(t("Adresse Solana invalide : vérifie qu'elle est complète."));
    portfolioId = `sol:${raw}`;
  } else if (kind === "mvx-staking") {
    if (!isMultiversXAddress(raw)) throw new Error(t("Adresse MultiversX invalide"));
    portfolioId = `mvx:${raw}`;
  } else {
    if (!isValidatorId(raw)) throw new Error(t("Identifiant de validateur invalide (index ou clé publique 0x…)"));
    const v = await ethValidator(raw);
    portfolioId = `eth-val:${v.index}`;
    label = `${WALLET_NAMES[kind]} n° ${v.index}`;
  }

  return adopt(userId, { portfolioId, kind, name: (input.name?.trim() || label).slice(0, 160), secret, replaces: input.replaces || null });
}

/**
 * Relie un compte d'exchange par une clé d'API en lecture seule. La clé est gardée chiffrée, n'est jamais rendue à
 * l'écran, et ne sert qu'aux lectures écrites dans src/server/exchanges/ ; un exchange qui sait dire les droits d'une
 * clé voit refuser celle qui peut vendre ou retirer. Rien n'est gardé si la première lecture échoue.
 */
export async function addExchange(userId: number, input: { exchange: ExchangeId; key: string; secret?: string | null; name?: string | null; replaces?: string | null }) {
  if (isDemo()) throw new Error(t("Indisponible en mode démo"));
  const info = EXCHANGES[input.exchange];
  const key = input.key.trim();
  const secret = input.secret?.trim() ?? "";
  if (!key || (info.secretLabel && !secret)) throw new Error(t("Il manque une partie de la clé : colle les deux valeurs que {exchange} t'a données.", { exchange: info.name }));
  const kind = `x-${input.exchange}` as const;
  // La source se nomme par l'empreinte de sa clé : la même clé ajoutée deux fois reste un seul compte.
  const portfolioId = `${kind}:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
  return adopt(userId, { portfolioId, kind, name: (input.name?.trim() || info.name).slice(0, 160), secret: sealer.seal(JSON.stringify({ key, secret: secret || undefined })), replaces: input.replaces || null });
}

/** Enregistre une source lue sans intermédiaire et la lit tout de suite ; une source jamais lue n'est pas gardée. */
async function adopt(userId: number, input: { portfolioId: string; kind: string; name: string; secret: string | null; replaces: string | null }) {
  const { portfolioId, kind, name, secret, replaces } = input;
  if (replaces && !(await db.select({ id: cryptoSources.portfolioId }).from(cryptoSources).where(and(eq(cryptoSources.portfolioId, replaces), eq(cryptoSources.ownerUserId, userId)))).length)
    throw new Error(t("Portefeuille CoinStats à remplacer introuvable"));
  const [existing] = await db.select().from(cryptoSources).where(eq(cryptoSources.portfolioId, portfolioId));
  // Une adresse ou un compte déjà suivi par un autre membre reste le sien.
  if (existing && existing.ownerUserId !== userId) throw new Error(isExchangeKind(kind) ? t("Ce compte est déjà suivi par un autre membre du foyer.") : t("Cette adresse est déjà suivie par un autre membre du foyer."));
  if (existing) await db.update(cryptoSources).set({ name, enabled: 1, replacesId: replaces, secret: secret ?? existing.secret }).where(eq(cryptoSources.portfolioId, portfolioId));
  else await db.insert(cryptoSources).values({ portfolioId, ownerUserId: userId, name, type: kind, replacesId: replaces, secret });

  const [src] = await db.select().from(cryptoSources).where(eq(cryptoSources.portfolioId, portfolioId));
  const outcome = await readSource(src);
  if (!outcome.ok) {
    // Une source jamais lue n'est pas gardée : le membre réessaie, sans ligne en erreur à l'écran ni clé inutile en base.
    if (!existing) await db.delete(cryptoSources).where(eq(cryptoSources.portfolioId, portfolioId));
    if (outcome.refused) throw new Error(t("La clé est refusée ({raison}). Vérifie qu'elle est complète, encore valable, et qu'elle a bien le droit de lecture demandé.", { raison: outcome.message }));
    throw new Error(t("Lecture impossible pour le moment ({raison}). Réessaie dans quelques minutes.", { raison: outcome.message }));
  }
  // Tracé ici plutôt que par le journal automatique des écritures : ni l'adresse collée ni la clé n'y figurent.
  await logAudit("crypto : source ajoutée", portfolioId, { genre: kind, nom: name });
  await refreshPrices().catch(() => undefined);
  await refreshDirectTotals();
  await snapshotWealth(userId);

  const found = await q<{ symbol: string; quantity: number }>(
    "SELECT symbol, SUM(quantity) AS quantity FROM crypto_positions WHERE source IN ('onchain', 'exchange') AND portfolio_id = ? AND owner_user_id = ? GROUP BY symbol ORDER BY symbol",
    [portfolioId, userId],
  );
  // Les mêmes cryptos saisies à la main : peut-être ce portefeuille, que le membre comptait jusque-là lui-même.
  const manual = found.length
    ? await q<{ id: number; symbol: string; quantity: number; location: string | null }>(
        `SELECT id, symbol, quantity, location FROM crypto_positions
         WHERE owner_user_id = ? AND source = 'manuel' AND archived_at IS NULL AND UPPER(symbol) IN (${found.map(() => "?").join(", ")})`,
        [userId, ...found.map((f) => f.symbol.toUpperCase())],
      )
    : [];
  return { portfolioId, kind, name, holdings: found.map((f) => ({ symbol: f.symbol, quantity: Number(f.quantity) })), manual: manual.map((m) => ({ ...m, quantity: Number(m.quantity) })) };
}

/** Retire un portefeuille lu par son adresse ou un compte d'exchange, ses lignes et sa clé. Faux si ce n'en est pas un du membre. */
export async function removeWallet(userId: number, portfolioId: string) {
  const mine = and(eq(cryptoSources.portfolioId, portfolioId), eq(cryptoSources.ownerUserId, userId));
  const [src] = await db.select({ type: cryptoSources.type }).from(cryptoSources).where(mine);
  if (!src || !isDirect(src.type)) return false;
  await db.delete(cryptoPositions).where(and(inArray(cryptoPositions.source, DIRECT_LINES), eq(cryptoPositions.portfolioId, portfolioId), eq(cryptoPositions.ownerUserId, userId)));
  await db.delete(cryptoSources).where(mine);
  await snapshotWealth(userId);
  return true;
}

/** Archive une ligne saisie à la main que le portefeuille `portfolioId` du membre remplace (elle se remet en compte). */
export async function archiveManualLine(userId: number, id: number, portfolioId: string) {
  const [src] = await db.select({ name: cryptoSources.name }).from(cryptoSources).where(and(eq(cryptoSources.portfolioId, portfolioId), eq(cryptoSources.ownerUserId, userId)));
  if (!src) return false;
  await db
    .update(cryptoPositions)
    .set({ archivedAt: sql`CURRENT_TIMESTAMP`, archivedReason: t("Remplacée par le portefeuille « {nom} »", { nom: src.name }).slice(0, 255) })
    .where(and(eq(cryptoPositions.id, id), eq(cryptoPositions.ownerUserId, userId), eq(cryptoPositions.source, "manuel")));
  await snapshotWealth(userId);
  return true;
}
