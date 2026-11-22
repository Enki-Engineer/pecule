import { describe, expect, it } from "vitest";
import { isTransferId, nameTransfers, pairTransfers, parseTransferId, transferId, transferLabel, transferName, type TransferLine } from "./transfers.ts";

const line = (id: string, accountId: string, date: string, amount: number): TransferLine => ({ id, accountId, date, amount });
const fr = (text: string, vars?: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? ""));

describe("pairTransfers", () => {
  it("rapproche un crédit et un débit du même montant sur deux comptes", () => {
    const peers = pairTransfers([line("a", "commun", "2026-03-12", 900), line("b", "camille", "2026-03-12", -900)]);
    expect([...peers]).toEqual([
      ["a", "camille"],
      ["b", "commun"],
    ]);
  });

  it("laisse sans pendant ce qui n'en a pas : montant différent, même compte, écart trop long, même sens", () => {
    expect(pairTransfers([line("a", "commun", "2026-03-12", 900), line("b", "camille", "2026-03-12", -899.99)]).size).toBe(0);
    expect(pairTransfers([line("a", "commun", "2026-03-12", 900), line("b", "commun", "2026-03-12", -900)]).size).toBe(0);
    expect(pairTransfers([line("a", "commun", "2026-03-12", 900), line("b", "camille", "2026-03-04", -900)]).size).toBe(0);
    expect(pairTransfers([line("a", "commun", "2026-03-12", -900), line("b", "camille", "2026-03-12", -900)]).size).toBe(0);
    // Le total d'une carte à débit différé, prélevé sur le compte : personne en face.
    expect(pairTransfers([line("a", "commun", "2026-04-02", -412.3)]).size).toBe(0);
  });

  it("accepte quelques jours d'écart, dans un sens comme dans l'autre", () => {
    expect(pairTransfers([line("a", "commun", "2026-03-06", 600), line("b", "alex", "2026-03-08", -600)]).get("a")).toBe("alex");
    expect(pairTransfers([line("a", "commun", "2026-03-10", 600), line("b", "alex", "2026-03-06", -600)]).get("b")).toBe("commun");
  });

  it("deux virements du même montant la même semaine : chacun retrouve le sien, le plus proche dans le temps", () => {
    // Camille vire 1 000 depuis son livret le 21, Alex 1 000 depuis son compte courant, écrit le 24 chez l'un et le 26 chez l'autre.
    const peers = pairTransfers([
      line("credit-camille", "commun", "2026-03-04", 600),
      line("credit-alex", "commun", "2026-03-06", 600),
      line("debit-alex", "alex", "2026-03-08", -600),
      line("debit-camille", "livret-camille", "2026-03-04", -600),
    ]);
    expect(peers.get("credit-camille")).toBe("livret-camille");
    expect(peers.get("credit-alex")).toBe("alex");
    expect(peers.get("debit-alex")).toBe("commun");
    expect(peers.get("debit-camille")).toBe("commun");
  });

  it("une ligne n'a qu'un pendant, et le résultat ne dépend pas de l'ordre de lecture", () => {
    const lines = [line("c1", "commun", "2026-03-05", 500), line("d1", "alex", "2026-03-05", -500), line("d2", "camille", "2026-03-05", -500)];
    const a = pairTransfers(lines);
    const b = pairTransfers([...lines].reverse());
    expect(a.size).toBe(2);
    expect(a.get("c1")).toBe("alex");
    expect(a.has("d2")).toBe(false);
    expect([...b].sort()).toEqual([...a].sort());
  });

  it("ignore une ligne de montant nul", () => {
    expect(pairTransfers([line("a", "commun", "2026-03-05", 0), line("b", "alex", "2026-03-05", 0)]).size).toBe(0);
  });
});

describe("noms des apports et des versements", () => {
  it("nomme d'après le titulaire du compte d'en face", () => {
    expect(transferName("recu", "camille", fr)).toBe("Apports de Camille");
    expect(transferName("verse", "camille", fr)).toBe("Versements à Camille");
    expect(transferName("recu", "joint", fr)).toBe("Apports du compte commun");
    expect(transferName("verse", "joint", fr)).toBe("Versements au compte commun");
    expect(transferName("recu", "pro", fr)).toBe("Apports d'un compte hors statistiques");
    expect(transferName("verse", "autre", fr)).toBe("Versements vers un compte hors statistiques");
    expect(transferName("recu", "jean-luc", fr)).toBe("Apports de Jean-Luc");
  });

  it("écrit et relit l'identifiant d'une ligne de virement", () => {
    expect(parseTransferId(transferId("recu", "camille"))).toEqual({ way: "recu", owner: "camille" });
    expect(parseTransferId(transferId("verse", "joint"))).toEqual({ way: "verse", owner: "joint" });
    for (const id of ["C1", "A1", null, undefined, "", "virement:recu:", "virement:pris:camille"]) expect(isTransferId(id)).toBe(false);
    expect(transferLabel("virement:recu:camille", fr)).toBe("Apports de Camille");
    expect(transferLabel("A1", fr)).toBeNull();
  });

  it("donne aux virements qui franchissent la vue leur propre ligne, et laisse les autres", () => {
    const rows = nameTransfers(
      [
        { id: "A1", name: "Salaire", poste: "Revenus", kind: "revenu", peer: null, total: 2400 },
        { id: "C1", name: "Transferts entre comptes", poste: "Mouvements internes", kind: "revenu", peer: "camille", total: 900 },
        { id: "C1", name: "Transferts entre comptes", poste: "Mouvements internes", kind: "depense", peer: "joint", total: -900 },
        { id: "C1", name: "Transferts entre comptes", poste: "Mouvements internes", kind: "interne", peer: null, total: -300 },
      ],
      fr,
    );
    expect(rows).toEqual([
      { id: "A1", name: "Salaire", poste: "Revenus", kind: "revenu", total: 2400 },
      { id: "virement:recu:camille", name: "Apports de Camille", poste: null, kind: "revenu", total: 900 },
      { id: "virement:verse:joint", name: "Versements au compte commun", poste: "Versements au compte commun", kind: "depense", total: -900 },
      { id: "C1", name: "Transferts entre comptes", poste: "Mouvements internes", kind: "interne", total: -300 },
    ]);
  });
});
