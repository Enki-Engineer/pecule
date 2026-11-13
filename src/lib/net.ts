/*
 * Adresses réseau : une requête que le serveur fait vers une adresse choisie par quelqu'un (fournisseur d'IA réglé à
 * la main, icône déclarée par un site, service de notification) ne doit jamais viser la machine elle-même ni le
 * réseau privé de l'hébergement.
 */

/** Adresse IP (v4 ou v6) qui n'est pas joignable depuis Internet : boucle locale, réseau privé, lien local, réservée. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
    );
  }
  const h = ip.toLowerCase();
  if (!h.includes(":")) return true; // ni IPv4 ni IPv6 lisible : on refuse
  return h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb") || h.startsWith("ff") || h.startsWith("64:ff9b:") || h.startsWith("2001:db8:");
}
