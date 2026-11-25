/*
 * L'adresse où Pécule est servi (APP_URL) dit comment on peut s'y connecter. Une clé d'accès ne se crée que dans un
 * contexte que le navigateur juge sûr, et sur un nom : en https avec un nom de domaine, ou sur http://localhost.
 * Ailleurs — une adresse IP, le http du réseau de la maison —, il reste le mot de passe.
 *
 * Les scripts de l'installation, qui tournent avec Node seul, ont la même règle dans `scripts/lib/adresse.mjs`
 * (un test compare les deux).
 */

/**
 * - `https` : servie en https (un serveur, un tunnel) ;
 * - `local` : la machine elle-même, en http (localhost, 127.0.0.1) ;
 * - `reseau` : une machine du réseau de la maison, en http (adresse privée, nom sans domaine, « .local »…) ;
 * - `public` : en http sur une adresse publique — refusée, tout y circulerait en clair sur Internet.
 */
export type AddressKind = "https" | "local" | "reseau" | "public";

export type AddressInfo = {
  kind: AddressKind;
  /** Le nom d'hôte est une adresse IP : aucun navigateur n'y crée de clé d'accès, même en https. */
  ip: boolean;
  /** Une clé d'accès peut-elle se créer à cette adresse ? */
  passkeys: boolean;
};

const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".home.arpa", ".internal", ".intranet", ".localdomain"];

/** Adresse IPv4 écrite en quatre nombres ; `null` sinon. */
function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

/** Adresse IPv4 réservée à un réseau privé (maison, lien local, réseau privé d'un opérateur ou d'un VPN). */
function privateV4([a, b]: number[]): boolean {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** Ce que permet une adresse ; `null` si ce n'en est pas une (ni http, ni https). */
export function addressInfo(url: string): AddressInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // Une adresse IPv6 s'écrit entre crochets dans une URL.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const v6 = host.startsWith("[") ? host.slice(1, -1) : null;
  const v4 = ipv4(host);
  const ip = !!v4 || v6 !== null;
  if (parsed.protocol === "https:") return { kind: "https", ip, passkeys: !ip };
  if (host === "localhost" || host.endsWith(".localhost")) return { kind: "local", ip: false, passkeys: true };
  if ((v4 && v4[0] === 127) || v6 === "::1") return { kind: "local", ip: true, passkeys: false };
  const home = v4
    ? privateV4(v4)
    : v6 !== null
      ? /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
      : // Un nom sans domaine (« nas », « raspberrypi ») ou d'un domaine réservé aux réseaux privés.
        !host.includes(".") || LOCAL_SUFFIXES.some((s) => host.endsWith(s));
  return { kind: home ? "reseau" : "public", ip, passkeys: false };
}
