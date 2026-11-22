import { inflateSync } from "node:zlib";
import { q } from "./db.ts";
import { isDemo } from "./demo-context.ts";
import { ebBanks, ebLinkedBanks } from "./enable-banking.ts";
import { publicFetch, readCapped } from "./net.ts";
import { brandOf } from "../lib/brands.ts";
import { bankLogoKey, bankLogoUse, bankLogoVariant, decentIcon, isEnableBankingLogo, parseBankLogoKey, pngInk, pngSize } from "../lib/bank-logos.ts";

/*
 * Logos des banques reliées par Enable Banking. La liste des banques (`/aspsps`) donne l'adresse du logo de
 * chacune : le serveur le télécharge une fois, depuis cette adresse et aucune autre, et le garde dans le cache des
 * logos sous la clé « bank:<pays>:<banque> » (src/server/logos.ts). Seules les banques reliées par le foyer y ont
 * droit ; rien sans clé Enable Banking, rien en démo. Ces logos sont souvent des mots-symboles allongés : ils
 * prennent le relais quand la banque n'a pas de bonne icône de site (banque hors du référentiel, petit favicon),
 * selon la règle de src/lib/bank-logos.ts.
 */

type Logo = { mime: string; data: Buffer };
type Linked = Awaited<ReturnType<typeof ebLinkedBanks>>;

const MAX_BYTES = 400_000;
const TTL = 60_000;

let linked: { at: number; list: Linked } | null = null;

/** Banques reliées par le foyer (gardées une minute en mémoire). Aucune en démo. */
async function linkedBanks(): Promise<Linked> {
  if (isDemo()) return [];
  if (linked && Date.now() - linked.at < TTL) return linked.list;
  const list = await ebLinkedBanks().catch(() => [] as Linked);
  linked = { at: Date.now(), list };
  return list;
}

/** La clé désigne-t-elle une banque que le foyer a reliée ? */
export async function bankLogoKeyValid(key: string): Promise<boolean> {
  const k = parseBankLogoKey(key);
  if (!k) return false;
  return (await linkedBanks()).some((b) => b.country === k.country && b.aspsp === k.name);
}

async function fetchPng(url: string): Promise<Logo | null> {
  try {
    const res = await publicFetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "image/png" } });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (mime !== "image/png") return null;
    const data = await readCapped(res, MAX_BYTES);
    return data && data.length >= 200 && pngSize(data) ? { mime, data } : null;
  } catch {
    return null;
  }
}

/**
 * Logo à montrer dans la pastille d'une banque reliée, ou null quand l'icône de son site (`siteIcon`) ou ses
 * initiales font mieux. L'adresse vient de la liste des banques d'Enable Banking (`banksOf`), jamais de l'écran.
 */
export async function bankLogo(
  key: string,
  siteIcon: (domain: string) => Promise<Logo | null>,
  banksOf: (country: string) => Promise<{ name: string; logo: string | null }[]> = ebBanks,
): Promise<{ logo: Logo; source: string } | null> {
  const k = parseBankLogoKey(key);
  if (!k) return null;
  // Sans clé Enable Banking, ou si son service ne répond pas : pas de logo (nouvel essai plus tard, comme pour les autres).
  const url = await banksOf(k.country)
    .then((list) => list.find((b) => b.name === k.name)?.logo ?? null)
    .catch(() => null);
  if (!url || !isEnableBankingLogo(url)) return null;
  // L'icône du site de la banque, quand le référentiel la connaît et qu'elle est de bonne taille, fait une meilleure pastille.
  const brand = brandOf(k.name);
  const site = brand?.domain ? await siteIcon(brand.domain) : null;
  if (site && decentIcon(site.data)) return null;
  // D'abord la variante réduite (quelques Ko) ; si le service d'images ne la sert plus, le logo d'origine.
  const variant = bankLogoVariant(url);
  const small = await fetchPng(variant);
  const found = small ? { logo: small, source: variant } : await fetchPng(url).then((logo) => (logo ? { logo, source: url } : null));
  if (!found) return null;
  const size = pngSize(found.logo.data);
  const shape = size ? { ...size, ink: pngInk(found.logo.data, (data) => inflateSync(data, { maxOutputLength: 8_000_000 })) } : null;
  return bankLogoUse(shape, false) === "logo" ? found : null;
}

/**
 * Pour l'écran : les banques reliées dont le logo peut servir, avec les noms d'établissement des comptes qu'elles
 * alimentent (un compte repris d'une autre source garde le nom qu'elle lui donnait). Une banque dont le logo a déjà
 * été écarté n'est pas proposée : l'écran passe tout de suite à l'icône du site.
 */
export async function linkedBankLogos(): Promise<{ name: string; country: string; key: string; institutions: string[] }[]> {
  const banks = await linkedBanks();
  if (!banks.length) return [];
  const ids = [...new Set(banks.flatMap((b) => b.accountIds))];
  const accounts = ids.length ? await q<{ id: string; institution: string | null }>(`SELECT id, institution FROM accounts WHERE id IN (${ids.map(() => "?").join(", ")})`, ids) : [];
  const institutionOf = new Map(accounts.map((a) => [a.id, a.institution]));
  const set = await q<{ key: string }>("SELECT `key` FROM logos WHERE `key` LIKE 'bank:%' AND status <> 'ok' AND fetched_at >= NOW() - INTERVAL 7 DAY");
  const absent = new Set(set.map((r) => r.key));
  return banks
    .map((b) => ({
      name: b.aspsp,
      country: b.country,
      key: bankLogoKey(b.country, b.aspsp),
      institutions: [...new Set(b.accountIds.map((id) => institutionOf.get(id)).filter((x): x is string => !!x && x !== b.aspsp))],
    }))
    .filter((b) => !absent.has(b.key));
}
