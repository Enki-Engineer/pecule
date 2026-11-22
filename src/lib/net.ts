/*
 * Adresses réseau : une requête que le serveur fait vers une adresse choisie par quelqu'un (fournisseur d'IA réglé à
 * la main, icône déclarée par un site, service de notification) ne doit jamais viser la machine elle-même ni le
 * réseau privé de l'hébergement.
 */

/** IPv4 qui n'est pas joignable depuis Internet, d'après ses deux premiers octets. */
const privateV4 = (a: number, b: number) =>
  a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));

/** Les huit groupes d'une adresse IPv6 (forme abrégée, IPv4 finale en clair comprises) ; `null` si elle est illisible. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  // Adresse liée à une interface (« fe80::1%en0 ») : jamais une adresse d'Internet.
  if (s.includes("%")) return null;
  const tail4 = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (tail4) {
    const n = tail4.slice(2).map(Number);
    if (n.some((x) => x > 255)) return null;
    s = `${tail4[1]}${((n[0] << 8) | n[1]).toString(16)}:${((n[2] << 8) | n[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parts = (half: string) => (half ? half.split(":") : []);
  const head = parts(halves[0]);
  const tail = halves.length === 2 ? parts(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  return groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? groups.map((g) => parseInt(g, 16)) : null;
}

/** Adresse IP (v4 ou v6) qui n'est pas joignable depuis Internet : boucle locale, réseau privé, lien local, réservée. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const n = v4.slice(1).map(Number);
    return n.some((x) => x > 255) || privateV4(n[0], n[1]);
  }
  const g = ipv6Groups(ip);
  if (!g) return true; // ni IPv4 ni IPv6 lisible : on refuse
  // Une IPv4 portée par une IPv6 (« ::ffff:7f00:1 » est la boucle locale, écrite autrement) : c'est elle qui compte.
  if (g.slice(0, 5).every((x) => x === 0)) return g[5] === 0xffff ? privateV4(g[6] >> 8, g[6] & 0xff) : true; // « :: », « ::1 », IPv4 « compatibles »
  // « ::ffff:0:a.b.c.d », IPv4 traduite (RFC 2765) : jamais l'adresse d'un service public.
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return true;
  return (
    (g[0] & 0xfe00) === 0xfc00 || // fc00::/7, réseau privé
    (g[0] & 0xff80) === 0xfe80 || // fe80::/9 : lien local et anciennes adresses de site
    (g[0] & 0xff00) === 0xff00 || // diffusion
    (g[0] === 0x64 && g[1] === 0xff9b) || // 64:ff9b::/32, vers une IPv4 traduite
    g[0] === 0x2002 || // 6to4 : porte une IPv4
    (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) // Teredo, documentation
  );
}
