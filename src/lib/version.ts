/*
 * Versions de Pécule (versionnage sémantique) et mises à jour : fonctions pures, partagées par le serveur, l'écran
 * et les tests. La version en service se lit côté serveur (`src/server/version.ts`).
 */

/** Dépôt qui publie les versions de Pécule (une copie du projet règle le sien par UPDATE_REPO). */
export const DEFAULT_REPO = "Enki-Engineer/pecule";
/** Image Docker publiée à chaque version (étiquettes : la version, sa série mineure, sa série majeure, `latest`). */
export const DOCKER_IMAGE = "ghcr.io/enki-engineer/pecule";

export type Version = { major: number; minor: number; patch: number; pre: string | null };

/** Lit « 1.22.0 », « v1.22.0 » ou « 2.0.0-rc.1 » ; `null` pour tout le reste. */
export function parseVersion(text: string | null | undefined): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec((text ?? "").trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null } : null;
}

/** Une version sans son « v » de tête (« v1.22.0 » → « 1.22.0 ») ; `null` si ce n'en est pas une. */
export function cleanVersion(text: string | null | undefined): string | null {
  const v = parseVersion(text);
  return v ? `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ""}` : null;
}

/** Ordre des préversions : champ par champ, un nombre avant un mot, la plus courte d'abord. */
function comparePre(a: string, b: string): number {
  const x = a.split(".");
  const y = b.split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    const nx = /^\d+$/.test(x[i]);
    const ny = /^\d+$/.test(y[i]);
    if (nx && ny) {
      if (Number(x[i]) !== Number(y[i])) return Number(x[i]) < Number(y[i]) ? -1 : 1;
    } else if (nx !== ny) return nx ? -1 : 1;
    else if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/** -1 si `a` précède `b`, 1 si elle la suit, 0 si elles se valent. Une version illisible précède toutes les autres. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (const k of ["major", "minor", "patch"] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  // « 2.0.0-rc.1 » précède « 2.0.0 ».
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return comparePre(x.pre, y.pre);
}

export type UpdateState =
  /** Rien de plus récent n'est publié (ou rien n'est publié du tout). */
  | { kind: "a-jour" }
  /** Une version plus récente est publiée et s'installe directement. */
  | { kind: "disponible"; version: string }
  /** La version publiée ne reprend pas une base aussi ancienne : passer d'abord par `palier`. */
  | { kind: "palier"; version: string; palier: string };

/**
 * Où en est une installation en version `current` quand la dernière publiée est `latest`. `depuis` est la plus
 * ancienne version depuis laquelle `latest` se met à jour directement (ses migrations plus anciennes sont repliées
 * dans le schéma de départ) : une installation restée en deçà doit d'abord passer par elle.
 */
export function updateState(current: string, latest: string | null | undefined, depuis?: string | null): UpdateState {
  const version = cleanVersion(latest);
  // Une préversion n'est jamais proposée ; une version illisible non plus.
  if (!version || parseVersion(version)!.pre || compareVersions(version, current) <= 0) return { kind: "a-jour" };
  const palier = cleanVersion(depuis);
  if (palier && compareVersions(current, palier) < 0) return { kind: "palier", version, palier };
  return { kind: "disponible", version };
}

/**
 * Recolle les lignes d'un texte Markdown coupé à la marge : GitHub, dans les notes d'une version, garde chaque retour
 * à la ligne. Un paragraphe ou un élément de liste redevient une seule ligne ; titres, listes, tableaux, citations
 * et blocs de code gardent leur découpage.
 */
export function unwrapMarkdown(text: string): string {
  const out: string[] = [];
  let fenced = false;
  const starts = /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~)/;
  for (const line of text.split(/\r?\n/)) {
    const fence = /^\s*(```|~~~)/.test(line);
    const prev = out[out.length - 1];
    const glue = !fenced && !fence && line.trim() !== "" && prev !== undefined && prev.trim() !== "" && !starts.test(line) && !/^\s*(#{1,6}\s|\||```|~~~)/.test(prev);
    if (glue) out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
    else out.push(line);
    if (fence) fenced = !fenced;
  }
  return out.join("\n");
}

/**
 * La section d'une version dans CHANGELOG.md (« ## 1.22.0 » jusqu'au titre suivant), sans son titre ; `null` si elle
 * n'y est pas. Sert de notes à la version publiée.
 */
export function changelogSection(changelog: string, version: string): string | null {
  const wanted = cleanVersion(version);
  if (!wanted) return null;
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s/.test(l) && cleanVersion(l.replace(/^##\s+/, "").split(/\s/)[0]) === wanted);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body || null;
}
