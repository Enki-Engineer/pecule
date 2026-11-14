import { describe, expect, it } from "vitest";
import { groupHistory, historyGroup } from "./chat-history.ts";

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
