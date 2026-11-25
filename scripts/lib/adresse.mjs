// Ce que permet l'adresse où Pécule est servi (APP_URL), pour les scripts de l'installation (setup, doctor) : une clé
// d'accès ne se crée qu'en https sur un nom de domaine, ou sur http://localhost ; ailleurs — une adresse IP, le http du
// réseau de la maison —, on se connecte par mot de passe. Sans dépendance (Node seul).
//
// Même règle que le serveur et l'écran (`src/lib/address.ts`, un test compare les deux).

const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".home.arpa", ".internal", ".intranet", ".localdomain"];

function ipv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

const privateV4 = ([a, b]) => a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);

/**
 * `{ kind, ip, passkeys }` ; `null` si ce n'est pas une adresse http ou https.
 *   kind      « https », « local » (la machine elle-même, en http), « reseau » (le réseau de la maison, en http) ou
 *             « public » (en http sur une adresse publique : refusée)
 *   ip        le nom d'hôte est une adresse IP
 *   passkeys  une clé d'accès peut se créer à cette adresse
 */
export function addressInfo(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const v6 = host.startsWith("[") ? host.slice(1, -1) : null;
  const v4 = ipv4(host);
  const ip = !!v4 || v6 !== null;
  if (parsed.protocol === "https:") return { kind: "https", ip, passkeys: !ip };
  if (host === "localhost" || host.endsWith(".localhost")) return { kind: "local", ip: false, passkeys: true };
  if ((v4 && v4[0] === 127) || v6 === "::1") return { kind: "local", ip: true, passkeys: false };
  const home = v4 ? privateV4(v4) : v6 !== null ? /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) : !host.includes(".") || LOCAL_SUFFIXES.some((s) => host.endsWith(s));
  return { kind: home ? "reseau" : "public", ip, passkeys: false };
}
