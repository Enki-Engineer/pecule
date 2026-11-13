import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLAUDE_CALLBACK, canWrite, grantedScope, isLoopback, pkceMatches, redirectAllowed, redirectMatches, resourceMatches, validChallenge, validateClientDocument } from "./oauth-rules.ts";

describe("adresses de retour", () => {
  it("admet celle de Claude et les boucles locales /callback, rien d'autre", () => {
    expect(redirectAllowed(CLAUDE_CALLBACK)).toBe(true);
    expect(redirectAllowed("http://localhost:3118/callback")).toBe(true);
    expect(redirectAllowed("http://127.0.0.1/callback")).toBe(true);
    expect(redirectAllowed("https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(redirectAllowed("https://claude.ai.evil.example/api/mcp/auth_callback")).toBe(false);
    expect(redirectAllowed("https://evil.example/callback")).toBe(false);
    expect(redirectAllowed("http://localhost:3118/autre")).toBe(false);
    expect(redirectAllowed("http://localhost.evil.example/callback")).toBe(false);
    expect(redirectAllowed("pas une url")).toBe(false);
  });
  it("compare strictement, sauf le port d'une boucle locale", () => {
    expect(redirectMatches([CLAUDE_CALLBACK], CLAUDE_CALLBACK)).toBe(true);
    expect(redirectMatches(["http://localhost/callback", "http://127.0.0.1/callback"], "http://localhost:53124/callback")).toBe(true);
    expect(redirectMatches(["http://localhost/callback"], "http://127.0.0.1:53124/callback")).toBe(false);
    expect(redirectMatches([CLAUDE_CALLBACK], "http://localhost:53124/callback")).toBe(false);
    expect(redirectMatches(["https://evil.example/cb"], "https://evil.example/cb")).toBe(false);
  });
  it("reconnaît une boucle locale", () => {
    expect(isLoopback("http://localhost:1/callback")).toBe(true);
    expect(isLoopback("https://localhost/callback")).toBe(false);
    expect(isLoopback("http://user@localhost/callback")).toBe(false);
  });
});

describe("PKCE", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  it("accepte le bon vérifieur et refuse les autres", () => {
    expect(validChallenge(challenge)).toBe(true);
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches(`${verifier}x`, challenge)).toBe(false);
    expect(pkceMatches("trop-court", challenge)).toBe(false);
    expect(validChallenge("abc")).toBe(false);
  });
});

describe("ressource et portées", () => {
  const mcp = "https://pecule.example/api/mcp";
  it("n'admet que le serveur MCP de Pécule", () => {
    expect(resourceMatches(undefined, mcp)).toBe(true);
    expect(resourceMatches("https://pecule.example/api/mcp/", mcp)).toBe(true);
    expect(resourceMatches("https://PECULE.example/api/mcp", mcp)).toBe(true);
    expect(resourceMatches("https://autre.example/api/mcp", mcp)).toBe(false);
    expect(resourceMatches("https://pecule.example", mcp)).toBe(false);
  });
  it("n'accorde les actions que sur accord explicite", () => {
    expect(canWrite(grantedScope(false))).toBe(false);
    expect(canWrite(grantedScope(true))).toBe(true);
  });
});

describe("document d'identité du client", () => {
  const url = "https://claude.ai/oauth/mcp-oauth-client-metadata";
  it("accepte un client de Claude et ne garde que les adresses admises", () => {
    expect(validateClientDocument(url, { client_id: url, client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK, "https://autre.example/cb"] })).toEqual({ name: "Claude", redirectUris: [CLAUDE_CALLBACK] });
  });
  it("refuse un hôte inconnu, un document qui ne correspond pas ou sans adresse admise", () => {
    expect(validateClientDocument("https://evil.example/client.json", { client_id: "https://evil.example/client.json", redirect_uris: [CLAUDE_CALLBACK] })).toBe("client non reconnu");
    expect(validateClientDocument("http://claude.ai/x", {})).toBe("client non reconnu");
    expect(validateClientDocument(url, { client_id: "https://claude.ai/autre", redirect_uris: [CLAUDE_CALLBACK] })).toBe("le document ne correspond pas au client_id");
    expect(validateClientDocument(url, { client_id: url, redirect_uris: ["https://autre.example/cb"] })).toBe("aucune adresse de retour admise");
  });
});
