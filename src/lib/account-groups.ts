/*
 * Carte « Comptes » du tableau de bord : les comptes rangés comme sur l'appli d'une banque — comptes courants (chacun
 * avec ses cartes à débit différé), épargne, placements, crédits — avec un sous-total par groupe. Règles pures ; les
 * montants sont ceux des autres écrans (soldes des comptes, part du membre pour un bien ou un crédit).
 */

export type GroupId = "courants" | "epargne" | "placements" | "credits" | "hors";

/** Une carte à débit différé sous son compte : ce qui sera prélevé, et quand. */
export type CardLine = { id: string; name: string; amount: number; debitDate: string | null; count: number };

export type AccountLine = {
  key: string;
  kind: "compte" | "carte" | "actif" | "crypto" | "credit";
  /** Compte de Pécule derrière la ligne (un compte ou une carte) : ses opérations, sa prévision de solde. */
  accountId: string | null;
  name: string;
  institution: string | null;
  owner: string | null;
  amount: number | null;
  /** Solde tel que la banque l'écrit, quand le compte est dans une autre devise que celle du foyer. */
  original: { amount: number; currency: string } | null;
  cards: CardLine[];
  /** Solde une fois les cartes à débit différé prélevées (seulement quand le compte en porte). */
  afterCards: number | null;
};

export type AccountGroup = { id: GroupId; total: number; lines: AccountLine[] };

type AccountIn = { id: string; name: string; display_name: string | null; institution: string | null; owner: string; kind: string; currency: string; balance: number | null; balance_original: number | null; hidden: 0 | 1 | boolean; excluded: 0 | 1 | boolean };
type CardIn = { accountId: string; name: string; debitAccountId?: string | null; outstanding: { amount: number; debitDate: string | null; count: number } };
type AssetIn = { id: number; name: string; category: string; institution: string | null; shareValue: number };
type LoanIn = { id: string; name: string; bank: string; shareRemaining: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function accountGroups(input: { accounts: AccountIn[]; cards?: CardIn[]; assets?: AssetIn[]; cryptoTotal?: number; cryptoLabel?: string; loans?: LoanIn[] }): AccountGroup[] {
  const shown = input.accounts.filter((a) => !a.hidden);
  const byId = new Map(shown.map((a) => [a.id, a]));
  const known = new Map(input.accounts.map((a) => [a.id, a]));
  // L'encours d'une carte se montre même si son compte de carte est masqué (masquer retire une ligne de la liste, pas
  // ce qui sera prélevé) : sous le compte prélevé quand le membre le voit, sinon sur une ligne à part.
  const cards = (input.cards ?? []).filter((c) => known.has(c.accountId));
  const read = new Set(cards.map((c) => c.accountId));
  const cardLine = (c: CardIn): CardLine => ({ id: c.accountId, name: c.name, amount: c.outstanding.amount, debitDate: c.outstanding.debitDate, count: c.outstanding.count });
  const attached = (id: string) => cards.filter((c) => c.debitAccountId === id && byId.get(id)?.kind !== "carte").map(cardLine);

  const line = (a: AccountIn): AccountLine => {
    const own = a.kind === "carte" ? [] : attached(a.id);
    return {
      key: `compte:${a.id}`,
      kind: a.kind === "carte" ? "carte" : "compte",
      accountId: a.id,
      name: a.display_name ?? a.name,
      institution: a.institution,
      owner: a.owner,
      amount: a.balance,
      original: a.balance_original != null ? { amount: a.balance_original, currency: a.currency } : null,
      cards: own,
      afterCards: own.length && a.balance != null ? r2(a.balance + own.reduce((s, c) => s + c.amount, 0)) : null,
    };
  };
  // Carte lue à la banque sans compte prélevé connu (ou prélevée sur un compte que le membre ne voit pas) : une ligne à part.
  const loose = cards
    .filter((c) => !c.debitAccountId || !byId.has(c.debitAccountId) || byId.get(c.debitAccountId)!.kind === "carte")
    .map((c): AccountLine => ({ ...line(known.get(c.accountId)!), kind: "carte", name: c.name, amount: c.outstanding.amount, original: null, cards: [cardLine(c)], afterCards: null }));
  // Une carte dont l'encours n'est lu nulle part n'apporte rien ; celle qui est lue à la banque est déjà rangée.
  const plain = shown.filter((a) => !(a.kind === "carte" && (a.balance == null || read.has(a.id))));
  const counted = plain.filter((a) => !a.excluded);
  const sum = (lines: AccountLine[]) => r2(lines.filter((l) => l.kind !== "carte").reduce((s, l) => s + (l.amount ?? 0), 0));

  const asset = (x: AssetIn): AccountLine => ({ key: `actif:${x.id}`, kind: "actif", accountId: null, name: x.name, institution: x.institution, owner: null, amount: x.shareValue, original: null, cards: [], afterCards: null });
  const assets = input.assets ?? [];
  const groups: AccountGroup[] = [];
  const push = (id: GroupId, lines: AccountLine[]) => {
    if (lines.length) groups.push({ id, total: sum(lines), lines });
  };

  push("courants", [...counted.filter((a) => a.kind !== "epargne").map(line), ...loose.filter((l) => !known.get(l.accountId!)!.excluded)]);
  push("epargne", [...counted.filter((a) => a.kind === "epargne").map(line), ...assets.filter((x) => x.category === "epargne").map(asset)]);
  push("placements", [
    ...assets.filter((x) => x.category === "placement").map(asset),
    ...(input.cryptoTotal ? [{ key: "crypto", kind: "crypto" as const, accountId: null, name: input.cryptoLabel ?? "Crypto", institution: null, owner: null, amount: r2(input.cryptoTotal), original: null, cards: [], afterCards: null }] : []),
  ]);
  push(
    "credits",
    (input.loans ?? [])
      .filter((l) => l.shareRemaining > 0)
      .map((l) => ({ key: `credit:${l.id}`, kind: "credit" as const, accountId: null, name: l.name, institution: l.bank || null, owner: null, amount: -r2(l.shareRemaining), original: null, cards: [], afterCards: null })),
  );
  // Comptes sortis des statistiques du membre : montrés à part, leur total ne se mêle à aucun chiffre de l'écran.
  push("hors", [...plain.filter((a) => a.excluded).map(line), ...loose.filter((l) => known.get(l.accountId!)!.excluded)]);
  return groups;
}
