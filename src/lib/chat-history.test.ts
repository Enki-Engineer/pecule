import { describe, expect, it } from "vitest";
import { conversationText, exportFileName, groupHistory, historyGroup, type ExportWords } from "./chat-history.ts";

const now = new Date(2026, 10, 14, 9, 30);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe("historyGroup", () => {
  it("range par ancienneté, d'après le jour et non l'heure", () => {
    expect(historyGroup(at(2026, 11, 14, 0), false, now)).toBe("today");
    expect(historyGroup(at(2026, 11, 13, 23), false, now)).toBe("yesterday");
    expect(historyGroup(at(2026, 11, 9), false, now)).toBe("week");
    expect(historyGroup(at(2026, 11, 7), false, now)).toBe("month");
    expect(historyGroup(at(2026, 10, 14), false, now)).toBe("older");
  });

  it("met une conversation épinglée à part, quel que soit son âge", () => {
    expect(historyGroup(at(2025, 1, 1), true, now)).toBe("pinned");
  });
});

describe("groupHistory", () => {
  it("regroupe en gardant l'ordre reçu", () => {
    const list = [
      { id: "a", updatedAt: at(2026, 3, 1), pinned: true },
      { id: "b", updatedAt: at(2026, 11, 14), pinned: false },
      { id: "c", updatedAt: at(2026, 11, 14, 8), pinned: false },
      { id: "d", updatedAt: at(2026, 11, 13), pinned: false },
    ];
    expect(groupHistory(list, now).map((g) => [g.group, g.threads.map((t) => t.id)])).toEqual([
      ["pinned", ["a"]],
      ["today", ["b", "c"]],
      ["yesterday", ["d"]],
    ]);
  });
});

describe("export d'une conversation", () => {
  const words: ExportWords = {
    header: "Conversation exportée le 15/11/2026",
    you: "Toi",
    assistant: "Assistant",
    action: "Action",
    about: (label) => `À propos de : ${label}`,
    attachment: (name) => `Pièce jointe : ${name}`,
    chart: (title) => `Graphique : ${title}`,
    callout: (kind) => ({ important: "À retenir", warning: "Attention", tip: "Conseil", note: "À savoir" })[kind],
    stopped: "Réponse arrêtée.",
    status: { done: "faite", declined: "annulée", error: "en échec", expired: "expirée", pending: "en attente de confirmation" },
  };
  const moment = (iso: string) => iso.slice(0, 16).replace("T", " ");

  it("dit qui parle, quand, et ce que sont devenues les actions", () => {
    const text = conversationText(
      "Courses de mars",
      [
        { role: "user", text: " Combien en courses en mars ? ", at: "2026-11-15T09:30:00.000Z", context: "Épicerie de l'Île", attachments: [{ name: "ticket.pdf" }] },
        { role: "assistant", text: "412,50 € en mars.", at: "2026-11-15T09:30:12.000Z", charts: [{ title: "Courses par semaine" }, {}] },
        { role: "action", text: "Classer 3 opérations en Alimentation", details: ["Épicerie de l'Île — 12,50 €"], status: "done" },
        { role: "assistant", text: "Je regarde aussi avr", stopped: true },
      ],
      words,
      moment,
    );
    expect(text).toBe(
      [
        "Courses de mars",
        "Conversation exportée le 15/11/2026",
        "",
        "— Toi · 2026-11-15 09:30",
        "À propos de : Épicerie de l'Île",
        "Combien en courses en mars ?",
        "Pièce jointe : ticket.pdf",
        "",
        "— Assistant · 2026-11-15 09:30",
        "412,50 € en mars.",
        "Graphique : Courses par semaine",
        "Graphique : —",
        "",
        "— Action · faite",
        "Classer 3 opérations en Alimentation",
        "  · Épicerie de l'Île — 12,50 €",
        "",
        "— Assistant",
        "Je regarde aussi avr",
        "Réponse arrêtée.",
        "",
      ].join("\n"),
    );
  });

  it("rend une réponse sans sa mise en forme, comme « Copier », et garde l'adresse entière d'un écran", () => {
    const reply = [
      "## Tes courses",
      "Tu as dépensé **412,50 €** en mars, soit {-38 € de plus-} qu'en février ; ==le loyer== n'a pas bougé.",
      "",
      "> [!WARNING]",
      "> Le budget est dépassé.",
      "",
      "Le détail est dans [tes opérations](/operations?q=courses).",
    ].join("\n");
    const text = conversationText("Courses", [{ role: "assistant", text: reply }, { role: "user", text: "Et **en avril** ?" }], words, moment, "https://exemple.test");
    expect(text).toBe(
      [
        "Courses",
        "Conversation exportée le 15/11/2026",
        "",
        "— Assistant",
        "Tes courses",
        "Tu as dépensé 412,50 € en mars, soit 38 € de plus qu'en février ; le loyer n'a pas bougé.",
        "",
        "Attention :",
        "Le budget est dépassé.",
        "",
        "Le détail est dans tes opérations (https://exemple.test/operations?q=courses).",
        "",
        // Ce que le membre a écrit reste tel qu'il l'a écrit.
        "— Toi",
        "Et **en avril** ?",
        "",
      ].join("\n"),
    );
    // Sans adresse connue, un lien garde son intitulé seul ; une réponse arrêtée ne finit pas sur une marque ouverte.
    expect(conversationText("Courses", [{ role: "assistant", text: "Voir [le budget](/budget), soit {+12", stopped: true }], words, moment)).toBe(
      ["Courses", "Conversation exportée le 15/11/2026", "", "— Assistant", "Voir le budget, soit 12", "Réponse arrêtée.", ""].join("\n"),
    );
  });

  it("dit d'une action proposée qu'elle attend encore sa confirmation", () => {
    const text = conversationText("Classement", [{ role: "action", text: "Classer 2 opérations en Loisirs", details: ["Cinéma — 18,00 €"], status: "pending" }], words, moment);
    expect(text).toBe(["Classement", "Conversation exportée le 15/11/2026", "", "— Action · en attente de confirmation", "Classer 2 opérations en Loisirs", "  · Cinéma — 18,00 €", ""].join("\n"));
  });

  it("garde une conversation vide lisible et nomme le fichier sans accents ni signes", () => {
    expect(conversationText("Sans suite", [], words, moment)).toBe("Sans suite\nConversation exportée le 15/11/2026\n");
    expect(exportFileName("Où en est l'épargne de Léo ?", "2026-11-15")).toBe("pecule-conversation-ou-en-est-l-epargne-de-leo-2026-11-15.txt");
    expect(exportFileName("???", "2026-11-15")).toBe("pecule-conversation-sans-titre-2026-11-15.txt");
    expect(exportFileName("a".repeat(80), "2026-11-15")).toBe(`pecule-conversation-${"a".repeat(40)}-2026-11-15.txt`);
  });
});
