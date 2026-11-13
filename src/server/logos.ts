import { isDemo, runReal } from "./demo-context.ts";
import { exec, one, q } from "./db.ts";
import { BRAND_DOMAINS } from "../lib/brands.ts";
import { bankLogo, bankLogoKeyValid } from "./bank-logos.ts";
import { customDomains } from "./brands.ts";
import { publicFetch } from "./net.ts";
import { serviceKey } from "./service-keys.ts";

/*
 * Logos officiels : téléchargés une fois par le serveur, gardés en base, servis par /api/logos/:key.
 * Marques : icône du site officiel (apple-touch-icon, sinon l'icône haute définition connue de Google
 * ou de DuckDuckGo) pour les domaines du référentiel (src/lib/brands.ts) et pour les sites que le foyer a
 * donnés à ses propres enseignes (src/server/brands.ts) — jamais un domaine venu d'ailleurs. La liste n'est donc
 * plus tout à fait fermée : un membre connecté peut y ajouter un site. `publicFetch` garde la protection qui
 * compte (toute adresse, redirections comprises, doit mener à un hôte public), et la démo ne cherche aucun logo
 * hors du référentiel. Banques reliées : logo donné par Enable Banking (src/server/bank-logos.ts). Cryptos : image
 * CoinGecko. Pas de SVG (servi depuis notre domaine, il pourrait exécuter du script) : PNG, JPEG, WebP, GIF ou ICO
 * seulement, 400 Ko au plus.
 */

type Logo = { mime: string; data: Buffer };
const RETRY_DAYS = 7;
const MAX_BYTES = 400_000;
const OK_TYPES = /^image\/(png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon)$/;
const inflight = new Map<string, Promise<Logo | null>>();

async function download(url: string, minBytes: number): Promise<Logo | null> {
  try {
    const res = await publicFetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": UA, Accept: "image/*" } });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!OK_TYPES.test(mime)) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length < minBytes || data.length > MAX_BYTES) return null;
    return { mime, data };
  } catch {
    return null;
  }
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/**
 * Icônes déclarées par la page d'accueil du site (<link rel="apple-touch-icon" | "icon" sizes=…>),
 * de la plus grande à la plus petite (au moins 64 px ; pas de SVG ni d'ICO).
 */
async function declaredIcons(domain: string): Promise<string[]> {
  for (const base of [`https://www.${domain}/`, `https://${domain}/`]) {
    try {
      const res = await publicFetch(base, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": UA, Accept: "text/html" } });
      if (!res.ok) continue;
      const html = (await res.text()).slice(0, 400_000);
      const found: { url: string; size: number }[] = [];
      for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
        const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
        if (!/icon/.test(rel) || /mask-icon/.test(rel)) continue;
        const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.replace(/&amp;/g, "&");
        if (!href || /\.svg(\?|$)/i.test(href) || /image\/svg/i.test(tag) || /\.ico(\?|$)/i.test(href)) continue;
        const sizes = /\bsizes\s*=\s*["']?(\d+)x\d+/i.exec(tag);
        const size = sizes ? Number(sizes[1]) : /apple-touch/.test(rel) ? 180 : 32;
        if (size < 64) continue;
        try {
          found.push({ url: new URL(href, res.url || base).toString(), size });
        } catch {
          /* adresse illisible */
        }
      }
      if (found.length) return [...new Set(found.sort((a, b) => b.size - a.size).map((f) => f.url))].filter((u) => u.startsWith("https://"));
    } catch {
      /* site injoignable : on tente l'autre adresse */
    }
  }
  return [];
}

/** Icône d'un site : celle qu'il déclare en haute définition, sinon les emplacements et services connus. */
async function brandLogo(domain: string): Promise<{ logo: Logo; source: string } | null> {
  const sources = [
    ...(await declaredIcons(domain)).slice(0, 3),
    `https://www.${domain}/apple-touch-icon.png`,
    `https://${domain}/apple-touch-icon.png`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
  ];
  // L'icône générique (globe) de Google pèse moins de 1 Ko : on l'écarte.
  for (const url of sources) {
    const logo = await download(url, url.includes("google.com") ? 1000 : 400);
    if (logo) return { logo, source: url };
  }
  return null;
}

/** Image d'une crypto (CoinGecko, grande taille). */
async function coinLogo(id: string): Promise<{ logo: Logo; source: string } | null> {
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Pecule)" };
  const coingecko = serviceKey("coingecko");
  if (coingecko) headers["x-cg-demo-api-key"] = coingecko;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&ids=${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const [coin] = (await res.json()) as { image?: string }[];
    if (!coin?.image || !/^https:\/\/(coin-images|assets)\.coingecko\.com\//.test(coin.image)) return null;
    const logo = await download(coin.image, 200);
    return logo ? { logo, source: coin.image } : null;
  } catch {
    return null;
  }
}

/** Clé du référentiel : « d:<domaine du référentiel> » ou « coin:<id CoinGecko> ». */
export function logoKeyValid(key: string): boolean {
  if (key.startsWith("d:")) return BRAND_DOMAINS.has(key.slice(2));
  return /^coin:[a-z0-9-]{1,80}$/.test(key);
}

/**
 * Clé dont le serveur accepte de chercher le logo : celles du référentiel, le site d'une enseigne du foyer
 * (« d:<domaine> ») et une banque reliée par Enable Banking (« bank:<pays>:<banque> »). En démo, le référentiel
 * seulement : une session de démonstration ne fait chercher aucun site au serveur.
 */
export async function logoKeyAllowed(key: string): Promise<boolean> {
  if (logoKeyValid(key)) return true;
  if (isDemo()) return false;
  if (key.startsWith("d:")) return (await customDomains()).has(key.slice(2));
  return bankLogoKeyValid(key);
}

/** Logo en cache, téléchargé au premier besoin ; null si introuvable (nouvel essai après 7 jours). */
export async function getLogo(key: string): Promise<Logo | null> {
  if (isDemo()) return runReal(() => getLogo(key)); // logos publics : même réserve pour la démo
  const row = await one<{ mime: string | null; data: Buffer | null; status: string; stale: number }>(
    `SELECT mime, data, status, fetched_at < NOW() - INTERVAL ${RETRY_DAYS} DAY AS stale FROM logos WHERE \`key\` = ?`,
    [key],
  );
  if (row?.status === "ok" && row.data && row.mime) return { mime: row.mime, data: row.data };
  if (row && !row.stale) return null;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const found = key.startsWith("coin:") ? await coinLogo(key.slice(5)) : key.startsWith("bank:") ? await bankLogo(key, (domain) => getLogo(`d:${domain}`)) : await brandLogo(key.slice(2));
    await exec(
      `INSERT INTO logos (\`key\`, mime, data, source, status, fetched_at) VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE mime = VALUES(mime), data = VALUES(data), source = VALUES(source), status = VALUES(status), fetched_at = NOW()`,
      [key, found?.logo.mime ?? null, found?.logo.data ?? null, found?.source ?? null, found ? "ok" : "absent"],
    );
    return found?.logo ?? null;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** État du cache (contrôle admin). */
export const logoStatus = () => q<{ key: string; status: string; source: string | null; bytes: number | null }>("SELECT `key`, status, source, LENGTH(data) AS bytes FROM logos ORDER BY `key`");

/** Efface les logos absents ou trop petits (favicons flous) : ils seront recherchés à nouveau. */
export async function refreshWeakLogos(minBytes = 3000): Promise<number> {
  const r = await exec("DELETE FROM logos WHERE status <> 'ok' OR data IS NULL OR LENGTH(data) < ?", [minBytes]);
  return r.affectedRows;
}

/** Efface un logo du cache (mauvaise icône trouvée) : il sera recherché au prochain affichage. */
export const resetLogo = (key: string) => exec("DELETE FROM logos WHERE `key` = ?", [key]);
