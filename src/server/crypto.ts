import { isDemo } from "./demo-context.ts";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { env } from "./env.ts";
import { db, one, withLock } from "./db.ts";
import { adminMember, memberByName } from "./members.ts";
import { cryptoPositions, cryptoSources, cryptoSyncRuns, prices } from "./db/schema/index.ts";
import { coinstatsEnabled, creditsUsed, eurRate, listPortfolios, portfolioCoins, type CsCoinLine, type CsPortfolio } from "./coinstats.ts";
import { coingeckoCandidate, decideManualLines, portfolioSignature, suspiciousDrop, withoutChainCovered, type SyncedLine } from "../lib/crypto-sync.ts";
import { egldStaking, isMultiversXAddress } from "./multiversx.ts";
import { ethValidator, isValidatorId } from "./beacon.ts";
import { recordAlert } from "./journal.ts";
import { refreshPrices, snapshotWealth } from "./wealth.ts";
import { t } from "../lib/i18n.ts";
import { serviceKey } from "./service-keys.ts";

/*
 * Synchro des quantités crypto depuis CoinStats (une fois par jour, ou sur demande) :
 * portefeuilles « feuilles » uniquement (un parent ne fait que regrouper), doublons écartés,
 * garde-fou contre une connexion cassée, lignes manuelles couvertes archivées.
 */

type Leaf = CsPortfolio & { parentId: string | null; parentName: string | null };

/** Sources lues directement sur la blockchain (identifiant de source préfixé par la chaîne). */
type ChainDef = { symbol: string; name: string; identifier: string; read: (portfolioId: string) => Promise<{ quantity: number; note: string; alert?: string }> };
const CHAIN: Record<string, ChainDef> = {
  "mvx-staking": {
    symbol: "EGLD",
    name: "MultiversX",
    identifier: "elrond-erd-2",
    read: async (id) => {
      const st = await egldStaking(id.replace(/^mvx:/, ""));
      return {
        quantity: st.total,
        note: `${st.active.toFixed(4)} EGLD délégués + ${st.rewards.toFixed(4)} à réclamer${st.undelegating ? ` + ${st.undelegating.toFixed(4)} en retrait` : ""}`,
      };
    },
  },
  "eth-validator": {
    symbol: "ETH",
    name: "Ethereum",
    identifier: "ethereum",
    read: async (id) => {
      const v = await ethValidator(id.replace(/^eth-val:/, ""));
      return {
        quantity: v.balance,
        note: `validateur n° ${v.index} · ${v.balance.toFixed(4)} ETH · ${v.status}`,
        alert: v.slashed ? "validateur SANCTIONNÉ (slashed) : vérifier dans Kiln" : v.status.startsWith("active") ? undefined : `validateur dans l'état « ${v.status} »`,
      };
    },
  },
};
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

export async function syncCrypto(trigger: "auto" | "manuel" | "assistant") {
  if (isDemo()) throw new Error("Synchro crypto indisponible en mode démo");
  if (!coinstatsEnabled()) return null;
  return withLock("pecule:crypto", async () => {
    const owner = await ownerId();
    const [run] = await db.insert(cryptoSyncRuns).values({ trigger }).$returningId();
    try {
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

      // Staking lu sur la blockchain (EGLD délégués, validateur Ethereum) : prioritaire sur la saisie dans CoinStats.
      const usd = new Map<string, number>();
      for (const f of fetched) for (const r of f.lines) if (r.price?.USD) usd.set(r.coin.identifier, Number(r.price.USD));
      const chainSources = (await db.select().from(cryptoSources)).filter((s) => s.type in CHAIN && s.ownerUserId === owner && s.enabled);
      const previous = new Set(
        (await db.select({ p: cryptoPositions.portfolioId }).from(cryptoPositions).where(and(eq(cryptoPositions.ownerUserId, owner), eq(cryptoPositions.source, "onchain")))).map((r) => r.p),
      );
      // Un actif saisi dans CoinStats n'est écarté que si la blockchain a répondu, ou si une lecture précédente est conservée.
      const skipKeys = new Set<string>();
      const chainLines: { portfolioId: string; location: string; quantity: number; def: ChainDef }[] = [];
      for (const src of chainSources) {
        const def = CHAIN[src.type];
        let ok = previous.has(src.portfolioId);
        try {
          const r = await def.read(src.portfolioId);
          chainLines.push({ portfolioId: src.portfolioId, location: src.name, quantity: r.quantity, def });
          ok = true;
          const value = usd.has(def.identifier) ? Math.round(r.quantity * usd.get(def.identifier)! * rate * 100) / 100 : null;
          await db
            .update(cryptoSources)
            .set({ status: "ok", lines: 1, lastTotalEur: value, lastSyncedAt: sql`CURRENT_TIMESTAMP`, note: `${r.note} (lu sur la blockchain)`.slice(0, 255) })
            .where(eq(cryptoSources.portfolioId, src.portfolioId));
          if (r.alert) await recordAlert("crypto", `${src.name} : ${r.alert}`, undefined, "alerte");
        } catch (e) {
          await db.update(cryptoSources).set({ status: "erreur", note: (e instanceof Error ? e.message : String(e)).slice(0, 255) }).where(eq(cryptoSources.portfolioId, src.portfolioId));
          await recordAlert("crypto", `Lecture sur la blockchain impossible (${src.name}) : ${e instanceof Error ? e.message : String(e)}`, undefined, "alerte");
        }
        if (ok && src.replacesId) skipKeys.add(`${src.replacesId}:${def.symbol}`);
      }
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
      for (const c of chainLines) {
        const row = {
          name: c.def.name,
          symbol: c.def.symbol,
          quantity: c.quantity,
          coingeckoId: c.def.identifier,
          coinstatsId: c.def.identifier,
          location: c.location.slice(0, 255),
          portfolioId: c.portfolioId,
          syncedAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURDATE()`,
        };
        await db
          .insert(cryptoPositions)
          .values({ ownerUserId: owner, source: "onchain", lineKey: `${c.portfolioId}:${c.def.identifier}`.slice(0, 160), ...row })
          .onDuplicateKeyUpdate({ set: row });
        synced.push({ symbol: c.def.symbol, identifier: c.def.identifier, count: c.quantity, valueEur: c.quantity * (usd.get(c.def.identifier) ?? 0) * rate });
      }

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
      await db
        .update(cryptoSyncRuns)
        .set({
          status: "ok",
          finishedAt: sql`CURRENT_TIMESTAMP`,
          sources: fetched.length,
          lines: synced.length,
          totalEur: total,
          creditsUsed: creditsBefore && creditsAfter ? creditsAfter.usedCredits - creditsBefore.usedCredits : null,
        })
        .where(eq(cryptoSyncRuns.id, run.id));
      await refreshPrices().catch(() => undefined);
      await snapshotWealth(owner);
      return { sources: fetched.length, lines: synced.length, totalEur: total, archived: toArchive.length };
    } catch (e) {
      await db
        .update(cryptoSyncRuns)
        .set({ status: "error", finishedAt: sql`CURRENT_TIMESTAMP`, error: (e instanceof Error ? e.message : String(e)).slice(0, 2000) })
        .where(eq(cryptoSyncRuns.id, run.id));
      await recordAlert("crypto", `Synchro CoinStats en échec : ${e instanceof Error ? e.message : String(e)}`, e);
      throw e;
    }
  });
}

/** Synchro quotidienne : appelée par le planificateur horaire, ne fait rien si la dernière réussie a moins de 20 h. */
export async function maybeSyncCrypto() {
  if (isDemo()) return;
  if (!coinstatsEnabled()) return;
  const last = await one<{ age: number | null }>("SELECT TIMESTAMPDIFF(HOUR, MAX(finished_at), NOW()) AS age FROM crypto_sync_runs WHERE status = 'ok'");
  if (last?.age != null && last.age < 20) return;
  await syncCrypto("auto").catch((e) => console.error("[crypto] synchro", e));
}

/** État pour l'écran Crypto : sources, dernière synchro, lignes manuelles archivées. */
export async function cryptoStatus(userId: number) {
  const sources = await db.select().from(cryptoSources).where(eq(cryptoSources.ownerUserId, userId)).orderBy(desc(cryptoSources.lastTotalEur));
  const [run] = await db.select().from(cryptoSyncRuns).orderBy(desc(cryptoSyncRuns.id)).limit(1);
  // La valeur totale des portefeuilles ne regarde que leur titulaire : un autre membre voit seulement la date et l'état.
  const lastRun = run && !sources.length ? { ...run, totalEur: null, lines: 0, sources: 0, error: null } : run;
  const archived = await db
    .select({ id: cryptoPositions.id, symbol: cryptoPositions.symbol, name: cryptoPositions.name, quantity: cryptoPositions.quantity, manualValue: cryptoPositions.manualValue, archivedAt: cryptoPositions.archivedAt, archivedReason: cryptoPositions.archivedReason })
    .from(cryptoPositions)
    .where(and(eq(cryptoPositions.ownerUserId, userId), eq(cryptoPositions.source, "manuel"), sql`${cryptoPositions.archivedAt} IS NOT NULL`));
  return { enabled: coinstatsEnabled(), sources, lastRun: lastRun ?? null, archived };
}

export async function setSourceEnabled(userId: number, portfolioId: string, enabled: boolean) {
  // Seulement une source de ce membre : celle d'un autre n'est ni réglée ni vidée de ses positions.
  const mine = and(eq(cryptoSources.portfolioId, portfolioId), eq(cryptoSources.ownerUserId, userId));
  const own = await db.select({ id: cryptoSources.portfolioId, status: cryptoSources.status }).from(cryptoSources).where(mine);
  if (!own.length) return;
  await db.update(cryptoSources).set({ enabled: enabled ? 1 : 0 }).where(mine);
  if (enabled) return;
  await db.delete(cryptoPositions).where(and(inArray(cryptoPositions.source, ["coinstats", "onchain"]), eq(cryptoPositions.portfolioId, portfolioId)));
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
 * Ajoute (ou met à jour) une source lue sur la blockchain : staking EGLD d'une adresse MultiversX,
 * ou validateur Ethereum (index ou clé publique). `replaces` = portefeuille CoinStats dont elle
 * remplace l'actif (EGLD ou ETH) pour éviter le double compte.
 */
export async function addChainSource(userId: number, chain: "multiversx" | "ethereum", id: string, name: string, replaces?: string | null) {
  if (isDemo()) throw new Error(t("Indisponible en mode démo"));
  let portfolioId: string;
  let type: string;
  if (chain === "multiversx") {
    if (!isMultiversXAddress(id)) throw new Error(t("Adresse MultiversX invalide"));
    portfolioId = `mvx:${id}`;
    type = "mvx-staking";
  } else {
    if (!isValidatorId(id)) throw new Error(t("Identifiant de validateur invalide (index ou clé publique 0x…)"));
    const v = await ethValidator(id);
    portfolioId = `eth-val:${v.index}`;
    type = "eth-validator";
  }
  if (replaces && !(await db.select().from(cryptoSources).where(and(eq(cryptoSources.portfolioId, replaces), eq(cryptoSources.ownerUserId, userId)))).length) throw new Error(t("Portefeuille CoinStats à remplacer introuvable"));
  const existing = await db.select().from(cryptoSources).where(eq(cryptoSources.portfolioId, portfolioId));
  // Une adresse déjà suivie par un autre membre reste la sienne.
  if (existing.length && existing[0].ownerUserId !== userId) throw new Error(t("Cette adresse est déjà suivie par un autre membre du foyer."));
  if (existing.length) await db.update(cryptoSources).set({ name, enabled: 1, replacesId: replaces ?? null }).where(eq(cryptoSources.portfolioId, portfolioId));
  else await db.insert(cryptoSources).values({ portfolioId, ownerUserId: userId, name, type, replacesId: replaces ?? null });
  return { portfolioId };
}
