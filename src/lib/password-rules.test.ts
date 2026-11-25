import { describe, expect, it } from "vitest";
import { PASSWORD_MAX, passwordProblem } from "./password-rules.ts";

describe("passwordProblem", () => {
  it("demande douze caractères au moins, et accepte une phrase", () => {
    expect(passwordProblem("onze-lettre")).toBe("court");
    expect(passwordProblem("le chat dort sur le toit")).toBeNull();
    expect(passwordProblem("Tr0ub4dor&3xyz")).toBeNull();
  });

  it("compte les caractères, pas les octets", () => {
    expect(passwordProblem("éàèùçâêîôûäë")).toBeNull();
  });

  it("refuse un mot de passe démesuré", () => {
    expect(passwordProblem("ab cd ef gh ".repeat(40))).toBe("long");
    expect(passwordProblem(`${"abcdefgh".repeat(PASSWORD_MAX / 8)}`)).toBeNull();
  });

  it("refuse ce qui se devine : un caractère répété, le prénom suivi de chiffres", () => {
    expect(passwordProblem("aaaaaaaaaaaaaa")).toBe("simple");
    expect(passwordProblem("121212121212")).toBe("simple");
    expect(passwordProblem("Camille12345678", "Camille")).toBe("simple");
    expect(passwordProblem("camille-2024-!!", " Camille ")).toBe("simple");
    expect(passwordProblem("Camille aime les pommes", "Camille")).toBeNull();
  });
});
