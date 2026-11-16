import { describe, expect, it } from "vitest";
import { accountGroups } from "./account-groups.ts";

const account = (id: string, kind: string, balance: number | null, more: Partial<{ owner: string; hidden: 0 | 1; excluded: 0 | 1; display_name: string | null; currency: string; balance_original: number | null }> = {}) => ({
  id,
  name: id,
  display_name: null,
  institution: "Banque de démo",
  owner: "alex",
  kind,
  currency: "EUR",
  balance,
  balance_original: null,
  hidden: 0 as const,
  excluded: 0 as const,
  ...more,
});
const card = (accountId: string, amount: number, debitAccountId: string | null) => ({ accountId, name: `Carte ${accountId}`, debitAccountId, outstanding: { amount, debitDate: "2026-11-30", count: 4 } });

describe("accountGroups", () => {
  it("range les comptes par groupe, avec un sous-total", () => {
    const groups = accountGroups({
      accounts: [account("courant", "courant", 1200.5), account("commun", "courant", -80, { owner: "joint" }), account("livret", "epargne", 5000)],
      assets: [
        { id: 1, name: "PEA", category: "placement", institution: null, shareValue: 3000 },
        { id: 2, name: "Maison", category: "immobilier", institution: null, shareValue: 200000 },
        { id: 3, name: "Épargne salariale", category: "epargne", institution: null, shareValue: 800 },
      ],
      cryptoTotal: 450.126,
      loans: [
        { id: "p1", name: "Prêt maison", bank: "Banque de démo", shareRemaining: 90000 },
        { id: "p2", name: "Prêt soldé", bank: "", shareRemaining: 0 },
      ],
    });
    expect(groups.map((g) => [g.id, g.total, g.lines.map((l) => l.name)])).toEqual([
      ["courants", 1120.5, ["courant", "commun"]],
      ["epargne", 5800, ["livret", "Épargne salariale"]],
      ["placements", 3450.13, ["PEA", "Crypto"]],
      ["credits", -90000, ["Prêt maison"]],
    ]);
  });

  it("pose chaque carte à débit différé sous le compte prélevé, et dit ce qu'il restera", () => {
    const [courants] = accountGroups({
      accounts: [account("commun", "courant", 500), account("c1", "carte", null), account("c2", "carte", null)],
      cards: [card("c1", -120.4, "commun"), card("c2", -79.6, "commun")],
    });
    expect(courants.lines).toHaveLength(1);
    expect(courants.lines[0].cards.map((c) => [c.id, c.amount])).toEqual([
      ["c1", -120.4],
      ["c2", -79.6],
    ]);
    expect(courants.lines[0].afterCards).toBe(300);
    expect(courants.total).toBe(500);
  });

  it("une carte sans compte prélevé connu a sa ligne, hors du sous-total", () => {
    const [courants] = accountGroups({ accounts: [account("courant", "courant", 100), account("c1", "carte", null)], cards: [card("c1", -40, null)] });
    expect(courants.lines.map((l) => [l.kind, l.name, l.amount])).toEqual([
      ["compte", "courant", 100],
      ["carte", "Carte c1", -40],
    ]);
    expect(courants.total).toBe(100);
  });

  it("ne montre ni un compte masqué, ni une carte sans encours", () => {
    const groups = accountGroups({ accounts: [account("courant", "courant", 100), account("secret", "courant", 9, { hidden: 1 }), account("c2", "carte", null)] });
    expect(groups).toHaveLength(1);
    expect(groups[0].lines.map((l) => l.name)).toEqual(["courant"]);
  });

  it("montre l'encours d'une carte dont le compte de carte est masqué, sous le compte prélevé", () => {
    const [courants] = accountGroups({ accounts: [account("commun", "courant", 100), account("c1", "carte", null, { hidden: 1 })], cards: [card("c1", -40, "commun")] });
    expect(courants.lines).toHaveLength(1);
    expect(courants.lines[0].cards.map((c) => c.amount)).toEqual([-40]);
    expect(courants.lines[0].afterCards).toBe(60);
  });

  it("une carte prélevée sur un compte masqué, ou inconnue des comptes du membre, ne se glisse sous aucun compte", () => {
    const groups = accountGroups({
      accounts: [account("courant", "courant", 100), account("secret", "courant", 9, { hidden: 1 }), account("c1", "carte", null)],
      cards: [card("c1", -40, "secret"), card("ailleurs", -15, "courant")],
    });
    expect(groups[0].lines.map((l) => [l.kind, l.name, l.amount])).toEqual([
      ["compte", "courant", 100],
      ["carte", "Carte c1", -40],
    ]);
    expect(groups[0].lines[0].cards).toEqual([]);
  });

  it("une carte dont le solde vient d'ailleurs que de la banque reliée garde sa ligne", () => {
    const [courants] = accountGroups({ accounts: [account("courant", "courant", 100), account("c1", "carte", -30)] });
    expect(courants.lines.map((l) => [l.kind, l.amount])).toEqual([
      ["compte", 100],
      ["carte", -30],
    ]);
    expect(courants.total).toBe(100);
  });

  it("range à part les comptes sortis des statistiques", () => {
    const groups = accountGroups({ accounts: [account("courant", "courant", 100), account("autre", "courant", 700, { excluded: 1 }), account("livret", "epargne", 50, { excluded: 1 })] });
    expect(groups.map((g) => [g.id, g.total])).toEqual([
      ["courants", 100],
      ["hors", 750],
    ]);
  });

  it("garde le solde d'origine d'un compte en devise et le nom choisi par le membre", () => {
    const [g] = accountGroups({ accounts: [account("usd", "courant", 92, { display_name: "Compte en dollars", currency: "USD", balance_original: 100 })] });
    expect(g.lines[0].name).toBe("Compte en dollars");
    expect(g.lines[0].original).toEqual({ amount: 100, currency: "USD" });
  });

  it("ne rend aucun groupe pour un foyer sans compte", () => {
    expect(accountGroups({ accounts: [] })).toEqual([]);
  });
});
