/*
 * Code d'une nouvelle catégorie : la suite des codes de son poste (B9-05, A7…), ou un nouveau numéro pour un
 * nouveau poste (B13). La lettre dit la nature : A = revenus, B = dépenses et épargne, C = mouvements internes.
 */

export type CodedCategory = { id: string; poste: string | null };

export function nextCategoryCode(all: CodedCategory[], poste: string, kind: string): string {
  const siblings = all.filter((c) => c.poste === poste).map((c) => c.id);
  const ids = new Set(all.map((c) => c.id));
  const sub = siblings.map((x) => /^([A-Z]\d+)-(\d+)$/.exec(x)).filter(Boolean) as RegExpExecArray[];
  if (sub.length && sub.every((m) => m[1] === sub[0][1])) {
    let n = Math.max(...sub.map((m) => Number(m[2]))) + 1;
    while (ids.has(`${sub[0][1]}-${String(n).padStart(2, "0")}`)) n++;
    return `${sub[0][1]}-${String(n).padStart(2, "0")}`;
  }
  const single = siblings.map((x) => /^([A-Z])(\d+)$/.exec(x)).filter(Boolean) as RegExpExecArray[];
  if (single.length === 1 && siblings.length === 1) return `${siblings[0]}-02`;
  const letter = single[0]?.[1] ?? (kind === "revenu" ? "A" : kind === "interne" ? "C" : "B");
  const nums = all
    .map((c) => new RegExp(`^${letter}(\\d+)`).exec(c.id))
    .filter(Boolean)
    .map((m) => Number(m![1]));
  let n = (nums.length ? Math.max(...nums) : 0) + 1;
  while (ids.has(`${letter}${n}`)) n++;
  return `${letter}${n}`;
}
