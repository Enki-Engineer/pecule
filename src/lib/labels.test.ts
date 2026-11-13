import { describe, expect, it } from "vitest";
import { groupByOwner, OWNER_ORDER, ownerLabel } from "./labels.ts";

describe("groupByOwner / ownerLabel", () => {
  it("place les personnes du foyer entre le compte commun et « autre », « pro »", () => {
    const list = [{ owner: "pro" }, { owner: "camille" }, { owner: "joint" }, { owner: "alex" }, { owner: "autre" }];
    expect(groupByOwner(list, OWNER_ORDER).map((g) => g.owner)).toEqual(["joint", "alex", "camille", "autre", "pro"]);
    expect(ownerLabel("alex")).toBe("Alex");
    expect(ownerLabel("jean-luc")).toBe("Jean-Luc");
    expect(ownerLabel("joint")).toBe("Compte commun");
  });
});
