// Logo de Pécule : le coffre au trésor.
// Dessine le coffre et ses déclinaisons — 5 fonds pour le logo de tous les jours, 10 thèmes de l'année —
// et écrit dans public/icons :
//   coffre/<id>.svg            logo, coffre ouvert, plein cadre (c'est l'écran qui arrondit les coins). Le fichier
//                              contient aussi le couvercle fermé et la lueur, cachés : l'écran de connexion les
//                              anime (src/client/components/ChestLogo.tsx, src/styles/coffre.css).
//   coffre/onglet-<id>.svg     coffre fermé, coins arrondis : onglet du navigateur (lisible en 16 px)
//   coffre/<id>-{180,192,512}.png et coffre/<id>.webmanifest : icône de l'écran d'accueil
//   icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png : valeurs par défaut (fond sable, DEFAULT_FOND de src/lib/logo.ts)
// Usage : node scripts/logo.mjs [--svg]   (--svg : sans les PNG, qui demandent Chrome)
// Les identifiants sont ceux de src/lib/logo.ts (fonds) et src/lib/seasons.ts (thèmes).
// Après une retouche du dessin : changer le nom du cache dans public/sw.js (les icônes sont servies « cache d'abord »).
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(path.join(OUT, "coffre"), { recursive: true });

let uid = 0;
const lin = (a, b) => {
  const id = `g${++uid}`;
  return { id, def: `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` };
};

const BAND = "#e0a233", BAND_D = "#b97f1c", INK = "#6b3a12";

// ───── Ornements ─────
const coin = (cx, cy, r, fill = "#ffd257", ring = "#dc9c26") =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.66}" fill="none" stroke="${ring}" stroke-width="${r * 0.14}" opacity="0.8"/>`;
const heart = (cx, cy, s, fill) =>
  `<path transform="translate(${cx} ${cy}) scale(${s})" d="M0 .95C-.55 .55-1 .15-1-.3-1-.75-.45-.95 0-.45.45-.95 1-.75 1-.3 1 .15.55.55 0 .95Z" fill="${fill}"/>`;
const star = (cx, cy, R, fill, r = R * 0.45) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const rad = i % 2 ? r : R;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${fill}" stroke-width="${R * 0.12}" stroke-linejoin="round"/>`;
};
const sparkle = (cx, cy, s, fill = "#fff6d6") => `<path d="M${cx} ${cy - s}Q${cx} ${cy} ${cx + s} ${cy}Q${cx} ${cy} ${cx} ${cy + s}Q${cx} ${cy} ${cx - s} ${cy}Q${cx} ${cy} ${cx} ${cy - s}Z" fill="${fill}"/>`;
const gem = (cx, cy, s, fill, light) =>
  `<g transform="translate(${cx} ${cy}) scale(${s})"><path d="M-.62-.55H.62L1 0 0 1-1 0Z" fill="${fill}"/><path d="M-.62-.55H.62L.3 0H-.3Z" fill="${light}"/></g>`;
const pumpkin = (cx, cy, s, face = false) =>
  `<rect x="${cx - s * 0.1}" y="${cy - s * 1.05}" width="${s * 0.2}" height="${s * 0.4}" rx="${s * 0.08}" fill="#5f7a3a"/>` +
  `<ellipse cx="${cx}" cy="${cy}" rx="${s}" ry="${s * 0.8}" fill="#f08a24"/>` +
  `<ellipse cx="${cx}" cy="${cy}" rx="${s * 0.5}" ry="${s * 0.8}" fill="none" stroke="#c9620f" stroke-width="${s * 0.07}"/>` +
  (face
    ? `<path d="M${cx - s * 0.5} ${cy - s * 0.1}l${s * 0.18}-${s * 0.28} ${s * 0.18} ${s * 0.28}zM${cx + s * 0.14} ${cy - s * 0.1}l${s * 0.18}-${s * 0.28} ${s * 0.18} ${s * 0.28}z" fill="#3a1d08"/>`
    : "");
const flower = (cx, cy, r, petal, center = "#f4c04e", n = 6) => {
  let s = "";
  for (let i = 0; i < n; i++) {
    const a = ((360 / n) * i - 90) * (Math.PI / 180);
    s += `<circle cx="${(cx + r * 0.62 * Math.cos(a)).toFixed(1)}" cy="${(cy + r * 0.62 * Math.sin(a)).toFixed(1)}" r="${r * 0.42}" fill="${petal}"/>`;
  }
  return s + `<circle cx="${cx}" cy="${cy}" r="${r * 0.36}" fill="${center}"/>`;
};
const dots = (list, fill, r = 5, op = 0.9) => list.map(([x, y, k = 1]) => `<circle cx="${x}" cy="${y}" r="${r * k}" fill="${fill}" opacity="${op}"/>`).join("");
const bat = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M-24 0Q-12-14 0-2 12-14 24 0 14-4 8 6 0 0-8 6-14-4-24 0Z" fill="#0b0d14"/>`;
const leaf = (cx, cy, s, rot, fill) =>
  `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s})"><path d="M0-1C.72-.5.72.5 0 1-.72.5-.72-.5 0-1Z" fill="${fill}"/><path d="M0-.7V.9" stroke="#000" stroke-opacity=".22" stroke-width=".09" stroke-linecap="round"/></g>`;
const gift = (x, y, w, h, fill, ribbon) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}"/><rect x="${x + w / 2 - 7}" y="${y}" width="14" height="${h}" fill="${ribbon}"/>` +
  `<circle cx="${x + w / 2 - 11}" cy="${y - 5}" r="11" fill="${ribbon}"/><circle cx="${x + w / 2 + 11}" cy="${y - 5}" r="11" fill="${ribbon}"/>`;
const pencil = (cx, len, rot, fill, eraser = false) =>
  `<g transform="rotate(${rot} ${cx} 280)"><rect x="${cx - 13}" y="${280 - len}" width="26" height="${len}" fill="${fill}"/>` +
  `<rect x="${cx - 4}" y="${280 - len}" width="8" height="${len}" fill="#fff" opacity=".22"/>` +
  (eraser
    ? `<rect x="${cx - 13}" y="${280 - len - 12}" width="26" height="14" fill="#c9ced6"/><rect x="${cx - 13}" y="${280 - len - 36}" width="26" height="26" rx="8" fill="#ff9fb0"/>`
    : `<path d="M${cx - 13} ${280 - len}h26l-13-36z" fill="#f3d6a4"/><path d="M${cx - 5} ${280 - len - 22}h10l-5-14z" fill="#3a3a3a"/>`) +
  `</g>`;
let eggId = 0;
const egg = (defs, cx, cy, rx, ry, fill) => {
  const id = `e${++eggId}`;
  defs.push(`<clipPath id="${id}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>`);
  const wave = (y) => `<path d="M${cx - rx} ${y}q${rx / 4}-9 ${rx / 2} 0t${rx / 2} 0 ${rx / 2} 0 ${rx / 2} 0" fill="none" stroke="#fff" stroke-width="6" opacity=".85"/>`;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/><g clip-path="url(#${id})">${wave(cy - ry * 0.3)}${wave(cy + ry * 0.1)}</g>`;
};
const burst = (cx, cy, r, c) => {
  let s = "";
  for (let i = 0; i < 10; i++) {
    const a = i * 36 * (Math.PI / 180);
    s += `<path d="M${(cx + r * 0.35 * Math.cos(a)).toFixed(1)} ${(cy + r * 0.35 * Math.sin(a)).toFixed(1)}L${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`;
  }
  return s;
};
const confetti = (list) => list.map(([x, y, rot, c]) => `<rect x="${x - 7}" y="${y - 3.5}" width="14" height="7" rx="2" fill="${c}" transform="rotate(${rot} ${x} ${y})"/>`).join("");

const clover = (cx, cy, s, fill, rot = 0) =>
  `<g transform="translate(${cx} ${cy}) rotate(${rot})"><path d="M0 0q${s * 0.25} ${s * 0.9} ${s * 0.9} ${s * 1.5}" fill="none" stroke="${fill}" stroke-width="${s * 0.2}" stroke-linecap="round"/>` +
  [0, 120, 240].map((a) => `<g transform="rotate(${a})">${heart(0, -s * 0.95, s, fill)}</g>`).join("") +
  `</g>`;
const flag = (x, y, rot) =>
  `<g transform="rotate(${rot} ${x} ${y})"><rect x="${x - 3}" y="${y - 120}" width="6" height="120" rx="3" fill="#f6ecd9"/>` +
  `<rect x="${x + 3}" y="${y - 118}" width="20" height="42" fill="#2a56c6"/><rect x="${x + 23}" y="${y - 118}" width="20" height="42" fill="#ffffff"/><rect x="${x + 43}" y="${y - 118}" width="20" height="42" fill="#e5484d"/></g>`;
const lumignon = (x, color) =>
  `<circle cx="${x}" cy="222" r="34" fill="#ffd27a" opacity=".22"/>` +
  `<path d="M${x} 196c7 9 9 14 9 19a9 9 0 0 1-18 0c0-5 2-10 9-19z" fill="#ffd257"/><path d="M${x} 206c3 4 4 7 4 9a4 4 0 0 1-8 0c0-2 1-5 4-9z" fill="#fff6d6"/>` +
  `<rect x="${x - 22}" y="226" width="44" height="54" rx="8" fill="${color}"/><rect x="${x - 22}" y="226" width="44" height="12" rx="6" fill="#fff" opacity=".3"/>`;

// ───── Le coffre ─────
const LOCK =
  `<circle cx="256" cy="300" r="39" fill="${BAND_D}"/>` + coin(256, 300, 35, "#ffd766", "#d4962a") + `<circle cx="256" cy="294" r="9" fill="${INK}"/><path d="M250 296h12l5 21h-22z" fill="${INK}"/>`;
const strap = (x) =>
  `<rect x="${x}" y="270" width="30" height="148" fill="${BAND}"/><circle cx="${x + 15}" cy="326" r="6" fill="${BAND_D}"/><circle cx="${x + 15}" cy="386" r="6" fill="${BAND_D}"/>`;
function baseFront(defs) {
  const g = lin("#b56c33", "#874519");
  defs.push(g.def);
  return (
    `<path d="M100 270H412V396Q412 418 390 418H122Q100 418 100 396Z" fill="url(#${g.id})"/>` +
    `<path d="M100 350H412" stroke="#6f3713" stroke-width="5" opacity=".4"/>` +
    strap(146) + strap(336) +
    `<rect x="100" y="270" width="312" height="26" fill="${BAND}"/><rect x="100" y="293" width="312" height="5" fill="${BAND_D}" opacity=".65"/>` +
    LOCK
  );
}
const LID_CLOSED = "M100 270V226Q100 158 168 158H344Q412 158 412 226V270Z";
const LID_OPEN = "M118 264V190Q118 116 190 116H322Q394 116 394 190V264Z";
function lidClosed(defs) {
  const g = lin("#c98445", "#a35c29");
  defs.push(g.def, `<clipPath id="lc"><path d="${LID_CLOSED}"/></clipPath>`);
  return (
    `<path d="${LID_CLOSED}" fill="url(#${g.id})"/><g clip-path="url(#lc)">` +
    `<path d="M100 206H412" stroke="#6f3713" stroke-width="5" opacity=".35"/>` +
    `<rect x="146" y="150" width="30" height="120" fill="${BAND}"/><rect x="336" y="150" width="30" height="120" fill="${BAND}"/>` +
    `<circle cx="161" cy="204" r="6" fill="${BAND_D}"/><circle cx="351" cy="204" r="6" fill="${BAND_D}"/>` +
    `<rect x="100" y="246" width="312" height="24" fill="${BAND}"/></g>`
  );
}
function lidOpen(defs, glow = "#ffe08a") {
  const g = lin("#7d451b", "#4a240b");
  defs.push(g.def, `<clipPath id="lo"><path d="${LID_OPEN}"/></clipPath>`);
  return (
    `<path d="${LID_OPEN}" fill="url(#${g.id})" stroke="${BAND}" stroke-width="14" stroke-linejoin="round"/>` +
    `<g clip-path="url(#lo)"><rect x="150" y="116" width="24" height="150" fill="#a06a25" opacity=".55"/><rect x="338" y="116" width="24" height="150" fill="#a06a25" opacity=".55"/>` +
    `<ellipse cx="256" cy="270" rx="150" ry="110" fill="${glow}" opacity=".22"/><ellipse cx="256" cy="270" rx="110" ry="70" fill="${glow}" opacity=".25"/></g>`
  );
}
const HALO = `<radialGradient id="halo"><stop offset="0" stop-color="#fff0a8" stop-opacity=".8"/><stop offset="1" stop-color="#fff0a8" stop-opacity="0"/></radialGradient>`;
const TREASURE =
  coin(188, 248, 30) + coin(324, 250, 30) + coin(256, 230, 36) +
  gem(214, 226, 24, "#2fb6a0", "#8fe3d3") + gem(300, 222, 26, "#e5484d", "#ff9a9a") +
  coin(160, 270, 26) + coin(222, 266, 28) + coin(290, 266, 28) + coin(352, 270, 26);
const SPARKS = sparkle(206, 166, 20) + sparkle(318, 160, 26) + sparkle(442, 132, 16) + sparkle(74, 186, 13) + sparkle(256, 62, 12);
const SNOW_LID = `<path d="M152 112Q256 84 360 112 384 122 366 132 256 112 146 132 128 122 152 112Z" fill="#fff"/>`;

// ───── Déclinaisons : fond, lueur, décor (toujours là), contenu et éclats (seulement coffre ouvert) ─────
const VARIANTS = {
  // Logo de tous les jours, au choix du fond
  petrole: { bg: ["#1d6a75", "#0f4650"] },
  nuit: { bg: ["#22406e", "#0f1c36"] },
  foret: { bg: ["#1c6a48", "#0d3d2a"] },
  sable: { bg: ["#fbf3df", "#ecd9b0"], sparks: sparkle(206, 166, 20) + sparkle(318, 160, 26) },
  corail: { bg: ["#ee7a62", "#c1473a"] },
  // Thèmes de l'année
  hiver: {
    bg: ["#3f83ab", "#1d4a6e"],
    back: dots([[70, 90], [440, 70, 0.8], [56, 210, 0.7], [452, 230, 0.8], [96, 300, 0.6], [430, 320, 0.6], [256, 50, 0.7]], "#ffffff", 7),
    sparks: SNOW_LID + sparkle(318, 160, 22, "#ffffff") + sparkle(204, 172, 16, "#ffffff"),
    front: `<path d="M-40 430Q130 398 256 424T552 418V560H-40Z" fill="#fff"/><path d="M-40 468Q150 440 300 464T552 456V560H-40Z" fill="#dbe9f4"/>`,
  },
  printemps: {
    bg: ["#9bd9ae", "#56b184"],
    glow: "#eaffd0",
    contents:
      `<path d="M190 276V214M256 276V192M322 276V218M224 276Q222 256 216 244M292 276Q292 258 298 246" fill="none" stroke="#2f8f5b" stroke-width="8" stroke-linecap="round"/>` +
      leaf(170, 248, 18, -60, "#3fa56c") + leaf(344, 250, 18, 60, "#3fa56c") + leaf(276, 226, 16, 60, "#3fa56c") +
      flower(214, 236, 24, "#ffd1dc") + flower(298, 238, 24, "#ffffff") +
      flower(190, 200, 36, "#ffffff") + flower(322, 204, 36, "#ffd166", "#f08a24") + flower(256, 172, 44, "#ff8fab"),
    sparks: "",
    front: flower(74, 150, 16, "#ffffff") + flower(440, 120, 18, "#ffd1dc") + flower(60, 440, 14, "#ffffff") + flower(452, 452, 16, "#ffffff"),
  },
  ete: {
    bg: ["#46b3dc", "#bfeaf4"],
    back:
      `<circle cx="420" cy="100" r="62" fill="#fff3b0" opacity=".5"/>` + coin(420, 100, 42, "#ffd257", "#f0b030") +
      `<rect x="-40" y="336" width="592" height="230" fill="#1f9bbd"/><path d="M-40 352q74-14 148 0t148 0 148 0 148 0" fill="none" stroke="#fff" stroke-width="6" opacity=".5"/>` +
      `<path d="M-40 396Q140 366 256 384T552 374V560H-40Z" fill="#f6dca0"/>`,
    sparks: sparkle(206, 166, 20) + sparkle(318, 160, 26) + sparkle(74, 186, 13),
    front: star(92, 456, 24, "#ff8566") + `<circle cx="410" cy="462" r="9" fill="#fff"/><circle cx="436" cy="448" r="6" fill="#fff"/>`,
  },
  automne: {
    bg: ["#2f6253", "#153529"],
    glow: "#ffd48a",
    contents:
      leaf(180, 236, 40, -32, "#e2711d") + leaf(332, 236, 40, 32, "#f0a020") + leaf(256, 208, 50, 0, "#c0392b") +
      leaf(218, 250, 30, -14, "#f0a020") + leaf(296, 250, 30, 16, "#e2711d"),
    sparks: "",
    front: leaf(72, 136, 24, 40, "#e2711d") + leaf(444, 170, 22, -30, "#f0a020") + leaf(424, 70, 18, 20, "#c0392b") + leaf(66, 300, 16, -20, "#f0a020") + leaf(452, 440, 20, 60, "#e2711d") + leaf(70, 452, 18, -50, "#c0392b"),
  },
  halloween: {
    bg: ["#1c2536", "#0c1018"],
    back: `<circle cx="256" cy="190" r="168" fill="#f7dc8a" opacity=".12"/><circle cx="256" cy="190" r="136" fill="#f7dc8a"/>`,
    glow: "#b6ff7a",
    contents:
      `<path d="M220 276V204a36 36 0 0 1 72 0V276Z" fill="#fff"/><ellipse cx="243" cy="204" rx="6" ry="9" fill="#1c2536"/><ellipse cx="269" cy="204" rx="6" ry="9" fill="#1c2536"/><ellipse cx="256" cy="228" rx="7" ry="9" fill="#1c2536"/>` +
      pumpkin(176, 246, 36, true) + pumpkin(336, 250, 32),
    sparks: "",
    front: bat(76, 118, 1.5) + bat(442, 96, 1.2) + bat(430, 196, 0.8),
  },
  noel: {
    bg: ["#1c6a48", "#0d3d2a"],
    back: dots([[70, 90], [440, 80, 0.8], [56, 220, 0.7], [452, 240, 0.8], [90, 330, 0.6], [434, 340, 0.6], [80, 450, 0.7], [440, 452, 0.7]], "#ffffff", 7, 0.85),
    contents: gift(244, 176, 70, 100, "#ffffff", "#d83a3a") + gift(160, 206, 78, 70, "#d83a3a", "#ffd766") + gift(316, 214, 62, 62, "#3fbf8f", "#ffffff"),
    sparks: SNOW_LID + star(256, 60, 26, "#ffd766"),
  },
  "nouvel-an": {
    bg: ["#16284a", "#080f20"],
    back: burst(96, 112, 46, "#ffd766") + burst(426, 150, 38, "#ff8fa3") + burst(420, 56, 22, "#7fd6c8"),
    front: confetti([[70, 220, 30, "#ffd766"], [450, 250, -20, "#7fd6c8"], [86, 330, -40, "#ff8fa3"], [440, 350, 50, "#ffd766"], [200, 70, 20, "#ff8fa3"], [320, 64, -30, "#ffffff"], [60, 430, 10, "#7fd6c8"], [456, 440, -50, "#ff8fa3"], [150, 150, 60, "#ffffff"], [366, 96, 35, "#ffd766"]]),
  },
  "saint-valentin": {
    bg: ["#c93662", "#8a183c"],
    glow: "#ffd0dc",
    contents: heart(184, 246, 32, "#fff0e0") + heart(330, 244, 34, "#ffb3c1") + heart(256, 222, 50, "#ff5c7a") + heart(216, 160, 18, "#ffb3c1") + heart(302, 150, 22, "#fff0e0"),
    sparks: heart(74, 150, 18, "#ffb3c1") + heart(442, 116, 22, "#ff8fa3") + heart(256, 62, 18, "#fff0e0") + heart(440, 300, 12, "#fff0e0") + heart(70, 300, 12, "#ff8fa3"),
  },
  paques: {
    bg: ["#f6f1c4", "#c3e0a0"],
    glow: "#fff7c0",
    contents: (defs) =>
      `<g transform="rotate(-10 236 190)"><ellipse cx="236" cy="176" rx="15" ry="46" fill="#fff"/><ellipse cx="236" cy="180" rx="7" ry="32" fill="#ffc2d1"/></g>` +
      `<g transform="rotate(10 276 190)"><ellipse cx="276" cy="176" rx="15" ry="46" fill="#fff"/><ellipse cx="276" cy="180" rx="7" ry="32" fill="#ffc2d1"/></g>` +
      egg(defs, 256, 240, 34, 44, "#8fd0ea") + egg(defs, 186, 250, 30, 38, "#f7a8c0") + egg(defs, 326, 250, 30, 38, "#fbd266"),
    sparks: "",
    front: flower(70, 440, 16, "#ffffff") + flower(446, 446, 18, "#ffc2d1") + flower(440, 110, 14, "#ffffff") + flower(72, 130, 14, "#ffc2d1"),
  },
  anniversaire: {
    bg: ["#17a596", "#0a655c"],
    glow: "#fff0c0",
    contents:
      // Gâteau à deux étages, nappage qui coule, trois bougies.
      `<rect x="186" y="226" width="140" height="56" rx="10" fill="#ff9fb5"/><path d="M186 240q12 14 23 0t23 0 23 0 23 0 24 0 24 0v-14h-140z" fill="#fff3da"/>` +
      `<rect x="210" y="186" width="92" height="44" rx="9" fill="#fff3da"/><path d="M210 198q11 13 23 0t23 0 23 0 23 0v-12h-92z" fill="#ff7d9c"/>` +
      [232, 256, 280].map((x, i) => `<rect x="${x - 4}" y="160" width="8" height="28" rx="3" fill="${["#59c3a5", "#ffd257", "#6fb1ff"][i]}"/><path d="M${x} 140c5 7 6 10 6 13a6 6 0 0 1-12 0c0-3 1-6 6-13z" fill="#ffb02e"/>`).join(""),
    // Ballons et confettis.
    sparks:
      `<path d="M92 196q-8 30 6 62" fill="none" stroke="#fff" stroke-width="3" opacity=".6"/><ellipse cx="90" cy="158" rx="30" ry="38" fill="#ff6b8a"/><ellipse cx="80" cy="146" rx="7" ry="11" fill="#fff" opacity=".35"/>` +
      `<path d="M424 164q8 30 -6 60" fill="none" stroke="#fff" stroke-width="3" opacity=".6"/><ellipse cx="424" cy="128" rx="28" ry="36" fill="#ffd257"/><ellipse cx="415" cy="117" rx="6" ry="10" fill="#fff" opacity=".4"/>` +
      sparkle(256, 76, 13),
    front: confetti([[70, 300, 30, "#ffd257"], [450, 270, -20, "#ff9fb5"], [86, 410, -40, "#ffffff"], [440, 360, 50, "#ffd257"], [190, 70, 20, "#ff9fb5"], [330, 62, -30, "#ffffff"], [60, 60, 10, "#ffd257"], [456, 440, -50, "#ff9fb5"]]),
  },
  epiphanie: {
    bg: ["#2c4aa8", "#16296b"],
    back: dots([[72, 96], [444, 84, 0.8], [58, 226, 0.7], [452, 236, 0.8], [96, 330, 0.6], [432, 336, 0.6]], "#ffd766", 6, 0.8),
    contents:
      `<ellipse cx="256" cy="258" rx="104" ry="34" fill="#c98f3a"/><ellipse cx="256" cy="250" rx="104" ry="34" fill="#edbf6a"/>` +
      `<path d="M176 244l40 22M216 232l48 30M264 228l44 28M312 236l24 14M336 244l-40 22M296 232l-48 30M248 228l-44 28M200 236l-24 14" stroke="#c98f3a" stroke-width="4" stroke-linecap="round" opacity=".7"/>` +
      `<path d="M204 216L192 150L228 178L256 134L284 178L320 150L308 216Z" fill="#ffd257" stroke="#ffd257" stroke-width="8" stroke-linejoin="round"/>` +
      `<rect x="200" y="204" width="112" height="18" rx="6" fill="#e0a233"/>` +
      `<circle cx="256" cy="186" r="10" fill="#e5484d"/><circle cx="222" cy="192" r="7" fill="#2fb6a0"/><circle cx="290" cy="192" r="7" fill="#2fb6a0"/>`,
    sparks: sparkle(256, 104, 16) + sparkle(442, 150, 16) + sparkle(74, 170, 13) + star(256, 62, 14, "#ffd766"),
  },
  chandeleur: {
    bg: ["#fcefc8", "#f0cd7c"],
    glow: "#fff0b8",
    contents:
      [272, 258, 244, 230, 216].map((y, i) => `<ellipse cx="${256 + (i % 2 ? 5 : -4)}" cy="${y}" rx="96" ry="17" fill="${i % 2 ? "#e0aa58" : "#f4d08a"}"/>`).join("") +
      `<ellipse cx="252" cy="212" rx="70" ry="10" fill="#f8dfa6"/><rect x="236" y="196" width="34" height="18" rx="5" fill="#fff3b0"/>` +
      `<path d="M206 214q14 10 30 2M276 214q16 12 34 0" fill="none" stroke="#c9801f" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M226 176q-10-14 0-28M256 170q-10-16 0-32M286 176q-10-14 0-28" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".55"/>`,
    sparks: "",
  },
  "saint-patrick": {
    bg: ["#2aa35c", "#0f6236"],
    glow: "#d8ffc0",
    contents:
      clover(198, 196, 26, "#7fe0a0", -14) + clover(318, 190, 30, "#a4f0bd", 12) +
      coin(188, 250, 30) + coin(324, 252, 30) + coin(256, 234, 36) + coin(160, 270, 26) + coin(222, 266, 28) + coin(290, 266, 28) + coin(352, 270, 26),
    sparks: clover(76, 150, 15, "#a4f0bd", -20) + clover(440, 124, 18, "#7fe0a0", 16) + clover(256, 66, 13, "#a4f0bd") + sparkle(318, 150, 0),
    front: clover(64, 430, 14, "#7fe0a0", 20) + clover(450, 440, 16, "#a4f0bd", -16),
  },
  "14-juillet": {
    bg: ["#1d3272", "#0a1434"],
    back: burst(96, 112, 46, "#ffffff") + burst(426, 150, 38, "#ff6b7d") + burst(420, 56, 22, "#8fb6ff") + burst(70, 240, 20, "#ff6b7d"),
    contents: flag(206, 270, -16) + flag(300, 270, 10) + TREASURE,
    front: confetti([[70, 330, 30, "#ffffff"], [450, 260, -20, "#ff6b7d"], [86, 420, -40, "#8fb6ff"], [440, 350, 50, "#ffffff"], [200, 70, 20, "#ff6b7d"], [320, 64, -30, "#8fb6ff"], [456, 440, -50, "#ff6b7d"], [150, 160, 60, "#8fb6ff"]]),
  },
  "fete-lumieres": {
    bg: ["#1b2659", "#070b20"],
    glow: "#ffd27a",
    back: dots([[70, 96, 2.2], [442, 84, 1.8], [60, 230, 1.5], [452, 236, 2], [100, 330, 1.3], [430, 330, 1.5], [256, 56, 1.6]], "#ffd27a", 6, 0.28),
    contents: lumignon(178, "#e5484d") + lumignon(230, "#3fa7d6") + lumignon(282, "#3fbf8f") + lumignon(334, "#f4c04e"),
    sparks: sparkle(256, 150, 14) + sparkle(442, 150, 14) + sparkle(74, 170, 12) + sparkle(256, 66, 12),
  },
  rentree: {
    bg: ["#2f6c99", "#183d5c"],
    contents:
      `<g transform="rotate(16 340 280)"><rect x="322" y="150" width="36" height="130" fill="#f6ecd9"/><path d="M322 170h14M322 190h20M322 210h14M322 230h20M322 250h14" stroke="#8a6a3a" stroke-width="4"/></g>` +
      pencil(188, 96, -16, "#f4c04e") + pencil(240, 128, -4, "#e5484d") + pencil(292, 104, 8, "#59c3a5", true),
    sparks: `<path d="M60 150l34 12M66 190l28 2M430 96l26-18M444 128l30-4" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".5"/>` + sparkle(430, 210, 14) + sparkle(84, 250, 12),
  },
};

const wrap = (defs, body, rounded) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${rounded ? `<clipPath id="r"><rect width="512" height="512" rx="114"/></clipPath>` : ""}${defs.join("")}</defs>` +
  (rounded ? `<g clip-path="url(#r)">${body}</g>` : body) +
  `</svg>\n`;

/** Logo : coffre ouvert ; le couvercle fermé et la lueur sont là, invisibles, pour l'animation d'ouverture. */
function logo(v, rounded = false) {
  uid = 0;
  eggId = 0;
  const g = lin(v.bg[0], v.bg[1]);
  const defs = [g.def, HALO];
  const part = (x, fallback = "") => (typeof x === "function" ? x(defs) : (x ?? fallback));
  const body =
    `<rect width="512" height="512" fill="url(#${g.id})"/><g transform="translate(256 262) scale(1.1) translate(-256 -262)">` +
    `<g class="c-back">${part(v.back)}</g>` +
    `<g class="c-open">${lidOpen(defs, v.glow)}${part(v.contents, TREASURE)}</g>` +
    `<g class="c-halo" opacity="0"><ellipse cx="256" cy="256" rx="240" ry="120" fill="url(#halo)"/><rect x="106" y="236" width="300" height="38" fill="#fff0a8"/></g>` +
    `<g class="c-closed" opacity="0">${lidClosed(defs)}</g>` +
    baseFront(defs) +
    `<g class="c-sparks">${part(v.sparks, SPARKS)}</g><g class="c-front">${part(v.front)}</g></g>`;
  return wrap(defs, body, rounded);
}

/** Onglet du navigateur : coffre fermé, plus grand dans le cadre, sans décor. */
function onglet(v) {
  uid = 0;
  const g = lin(v.bg[0], v.bg[1]);
  const defs = [g.def];
  const body = `<rect width="512" height="512" fill="url(#${g.id})"/><g transform="translate(256 256) scale(1.36) translate(-256 -288)">${lidClosed(defs)}${baseFront(defs)}</g>`;
  return wrap(defs, body, true);
}

const manifest = (id) =>
  JSON.stringify(
    {
      id: "/",
      name: "Pécule",
      short_name: "Pécule",
      lang: "fr",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#f3f2ee",
      theme_color: "#f3f2ee",
      icons: [
        { src: `/icons/coffre/${id}-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: `/icons/coffre/${id}-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      ],
    },
    null,
    2,
  ) + "\n";

const ids = Object.keys(VARIANTS);
for (const id of ids) {
  writeFileSync(path.join(OUT, "coffre", `${id}.svg`), logo(VARIANTS[id]));
  writeFileSync(path.join(OUT, "coffre", `onglet-${id}.svg`), onglet(VARIANTS[id]));
  writeFileSync(path.join(OUT, "coffre", `${id}.webmanifest`), manifest(id));
}
// Valeurs par défaut (avant le script d'apparence, anciennes installations, notifications).
const DEFAULT = "sable";
writeFileSync(path.join(OUT, "icon.svg"), logo(VARIANTS[DEFAULT], true));
writeFileSync(path.join(OUT, "..", "manifest.webmanifest"), manifest(DEFAULT));

if (!process.argv.includes("--svg")) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    for (const id of ids) {
      await page.goto(`file://${path.join(OUT, "coffre", `${id}.svg`)}`);
      await page.screenshot({ path: path.join(OUT, "coffre", `${id}-${size}.png`) });
    }
    await page.close();
  }
  await browser.close();
  copyFileSync(path.join(OUT, "coffre", `${DEFAULT}-180.png`), path.join(OUT, "apple-touch-icon.png"));
  copyFileSync(path.join(OUT, "coffre", `${DEFAULT}-192.png`), path.join(OUT, "icon-192.png"));
  copyFileSync(path.join(OUT, "coffre", `${DEFAULT}-512.png`), path.join(OUT, "icon-512.png"));
}
console.log(`${ids.length} déclinaisons écrites dans public/icons/coffre`);
