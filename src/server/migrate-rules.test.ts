import { describe, expect, it } from "vitest";
import { alreadyDone } from "./migrate-rules.ts";

describe("alreadyDone", () => {
  it("reconnaît une instruction de structure dont l'effet est déjà là", () => {
    for (const code of ["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME", "ER_TABLE_EXISTS_ERROR", "ER_FK_DUP_NAME", "ER_CANT_DROP_FIELD_OR_KEY"]) expect(alreadyDone(Object.assign(new Error("x"), { code })), code).toBe(true);
  });
  it("laisse passer toute autre erreur", () => {
    for (const code of ["ER_PARSE_ERROR", "ER_BAD_FIELD_ERROR", "ER_DUP_ENTRY", "ER_NO_SUCH_TABLE", "ECONNRESET"]) expect(alreadyDone(Object.assign(new Error("x"), { code })), code).toBe(false);
    expect(alreadyDone(new Error("Duplicate column name 'topic'"))).toBe(false);
    expect(alreadyDone(null)).toBe(false);
    expect(alreadyDone("ER_DUP_FIELDNAME")).toBe(false);
  });
});
