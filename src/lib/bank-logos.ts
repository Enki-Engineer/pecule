/*
 * Logos des banques reliées : règles pures. Enable Banking donne, pour chaque banque de sa liste, l'adresse de son
 * logo. Mesurés sur les 132 banques françaises de la liste (novembre 2026), ces logos sont presque tous des
 * mots-symboles allongés (77 font plus de 2,5 fois leur hauteur, 8 seulement sont carrés) : parfaits dans un
 * bandeau, moins nets dans une pastille carrée que l'icône que le site de la banque a dessinée pour cela. D'où la
 * règle : l'icône du site d'abord, quand le référentiel connaît la banque et que son icône est de bonne taille ; à
 * défaut, le logo d'Enable Banking montré entier, s'il n'est ni démesurément allongé ni trop pâle pour se voir ;
 * sinon la pastille garde les initiales.
 */

/** Au-delà de ce rapport largeur / hauteur, un logo montré entier dans une pastille ne se lit plus. */
export const MAX_RATIO = 8;
/** En dessous de cette « encre » moyenne, un logo (traits fins et clairs, petit dans son cadre) laisse une pastille presque blanche. */
export const MIN_INK = 0.09;

/** Clé d'un logo de banque dans le cache des logos : « bank:<pays>:<nom de la banque chez Enable Banking> ». */
export const bankLogoKey = (country: string, name: string) => `bank:${country.toUpperCase()}:${name}`;

/** Pays et banque d'une clé « bank:… », ou null si elle n'en a pas la forme. */
export function parseBankLogoKey(key: string): { country: string; name: string } | null {
  const m = /^bank:([A-Z]{2}):(.{1,120})$/.exec(key);
  return m ? { country: m[1], name: m[2] } : null;
}

/** Adresse de la variante du logo qui tient dans un carré de 192 px, en PNG (le service d'images d'Enable Banking redimensionne à la demande). */
export const bankLogoVariant = (url: string) => `${url.endsWith("/") ? url : `${url}/`}-/preview/192x192/-/format/png/`;

/** L'adresse est-elle bien celle d'un logo servi par Enable Banking (jamais un autre hôte) ? */
export function isEnableBankingLogo(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "enablebanking.com" || u.hostname.endsWith(".enablebanking.com")) && u.pathname.startsWith("/brands/");
  } catch {
    return false;
  }
}

/** Largeur et hauteur d'une image PNG, lues dans son en-tête (IHDR) ; null si ce n'en est pas une. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 29 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const [width, height] = [view.getUint32(16), view.getUint32(20)];
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Plus grand côté, en points, d'une icône PNG ou ICO (la plus grande image que porte le fichier) ; null pour un autre format. */
export function iconSide(bytes: Uint8Array): number | null {
  const png = pngSize(bytes);
  if (png) return Math.max(png.width, png.height);
  // ICO : en-tête (0, 1, nombre d'images) puis une entrée de 16 octets par image, qui commence par sa largeur et sa hauteur (0 = 256).
  if (bytes.length >= 22 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    const count = bytes[4] | (bytes[5] << 8);
    let side = 0;
    for (let i = 0; i < count && 7 + i * 16 < bytes.length; i++) side = Math.max(side, bytes[6 + i * 16] || 256, bytes[7 + i * 16] || 256);
    return side || null;
  }
  return null;
}

/** En dessous de ce côté, l'icône d'un site est un favicon : agrandie dans une pastille, elle est floue. */
export const DECENT_SIDE = 96;

/**
 * L'icône d'un site fait-elle une bonne pastille ? Au moins 96 points de côté (le poids ne dit rien : une icône
 * nette aux aplats simples pèse à peine plus d'un Ko) ; pour un format qu'on ne mesure pas ici, au moins 3 Ko.
 */
export function decentIcon(bytes: Uint8Array): boolean {
  const side = iconSide(bytes);
  return side != null ? side >= DECENT_SIDE : bytes.length >= 3000;
}

/** Nombre de valeurs par point selon le type de couleur du PNG : gris, couleur, gris + transparence, couleur + transparence. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
/** Au-delà, l'image n'est pas une vignette : on ne la décompresse pas pour si peu. */
const MAX_PIXELS = 1_000_000;

/**
 * « Encre » moyenne d'un PNG posé sur fond blanc : 0 pour une page blanche, 1 pour un aplat noir ou de couleur vive.
 * Elle dit si un logo se verra dans une pastille. `inflate` est la décompression zlib, fournie par l'appelant (ce
 * module reste sans dépendance). Null quand l'image n'est pas un PNG simple — 8 bits par valeur, sans palette ni
 * entrelacement, ce que rend le service d'images d'Enable Banking — ou qu'elle est trop grande.
 */
export function pngInk(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): number | null {
  const size = pngSize(bytes);
  const channels = CHANNELS[bytes[25]];
  if (!size || bytes[24] !== 8 || !channels || bytes[28] !== 0 || size.width * size.height > MAX_PIXELS) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  for (let o = 8; o + 12 <= bytes.length; ) {
    const length = view.getUint32(o);
    const name = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    if (name === "IEND" || o + 12 + length > bytes.length) break;
    if (name === "IDAT") parts.push(bytes.subarray(o + 8, o + 8 + length));
    o += 12 + length;
  }
  const packed = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    packed.set(p, at);
    at += p.length;
  }
  let raw: Uint8Array;
  try {
    raw = inflate(packed);
  } catch {
    return null;
  }
  const { width, height } = size;
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  let previous = new Uint8Array(stride);
  let total = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    if (filter > 4) return null;
    // Chaque ligne est écrite par différence avec le point de gauche, celui du dessus, ou les deux (filtres du format PNG).
    const line = raw.slice(start + 1, start + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const corner = x >= channels ? previous[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [dl, du, dc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        add = dl <= du && dl <= dc ? left : du <= dc ? up : corner;
      }
      line[x] = (line[x] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const i = x * channels;
      // Écart au blanc : la composante la plus sombre (un orange vif marque autant qu'un noir, un gris clair à peine).
      const darkest = channels <= 2 ? line[i] : Math.min(line[i], line[i + 1], line[i + 2]);
      const alpha = channels === 2 ? line[i + 1] : channels === 4 ? line[i + 3] : 255;
      total += (alpha / 255) * (1 - darkest / 255);
    }
    previous = line;
  }
  return total / (width * height);
}

/**
 * Que montrer dans la pastille d'une banque : l'icône de son site quand elle est bonne (`site`), sinon son logo
 * d'Enable Banking s'il se voit dans une pastille (`logo`), sinon rien de mieux que ses initiales (`aucun`).
 * `ink` null : encre non mesurée (image d'un autre format), on fait confiance au logo.
 */
export function bankLogoUse(logo: { width: number; height: number; ink: number | null } | null, hasSiteIcon: boolean): "logo" | "site" | "aucun" {
  if (hasSiteIcon) return "site";
  if (!logo) return "aucun";
  const ratio = logo.width / logo.height;
  if (ratio > MAX_RATIO || ratio < 1 / MAX_RATIO) return "aucun";
  return logo.ink == null || logo.ink >= MIN_INK ? "logo" : "aucun";
}
