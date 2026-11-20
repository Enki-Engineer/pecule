import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MCP_CLIENTS, RELAYS, knownClient } from "../lib/mcp-clients.ts";
import { CLAUDE_CALLBACK, canWrite, cleanClientName, clientDocumentUrl, clientIdentity, grantedScope, isLoopback, pkceMatches, redirectAllowed, redirectMatches, resourceMatches, validChallenge, validateClientDocument } from "./oauth-rules.ts";

describe("adresses de retour", () => {
  it("admet celles des assistants reconnus et les boucles locales, rien d'autre", () => {
    expect(redirectAllowed(CLAUDE_CALLBACK)).toBe(true);
    for (const client of MCP_CLIENTS) for (const uri of client.redirects) expect(redirectAllowed(uri), uri).toBe(true);
    expect(redirectAllowed("http://localhost:3118/callback")).toBe(true);
    expect(redirectAllowed("http://127.0.0.1/callback")).toBe(true);
    expect(redirectAllowed("https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(redirectAllowed("https://claude.ai.evil.example/api/mcp/auth_callback")).toBe(false);
    expect(redirectAllowed("https://evil.example/callback")).toBe(false);
    expect(redirectAllowed("http://localhost.evil.example/callback")).toBe(false);
    expect(redirectAllowed("monappli://retour")).toBe(false);
    expect(redirectAllowed("pas une url")).toBe(false);
  });
  it("reconnaît une boucle locale, quels que soient son port et son chemin (RFC 8252)", () => {
    for (const uri of ["http://localhost:1/callback", "http://127.0.0.1:7777/oauth/callback", "http://127.0.0.1:33418", "http://127.0.0.1:33418/", "http://[::1]:5173/auth/retour", "http://localhost/"]) expect(isLoopback(uri), uri).toBe(true);
    for (const uri of [
      "https://localhost/callback",
      "http://user@localhost/callback",
      "http://localhost:3118/callback?x=1",
      "http://localhost:3118/callback#x",
      "http://127.0.0.2/callback",
      "http://192.168.1.10:8080/callback",
      "http://0.0.0.0/callback",
      "http://localhost.evil.example/callback",
      "http://[::2]/callback",
    ])
      expect(isLoopback(uri), uri).toBe(false);
  });
  it("lit une adresse comme le navigateur la suivra : les formes piégées ne trompent ni l'un ni l'autre", () => {
    // Écritures détournées de la boucle locale : elles y mènent vraiment (le navigateur les lit de la même façon).
    for (const uri of ["http://LOCALHOST/cb", "http://127.1/cb", "http://2130706433/cb", "http://0x7f.0.0.1/cb", "http://[0:0:0:0:0:0:0:1]/cb"]) expect(isLoopback(uri), uri).toBe(true);
    // Ce qui ressemble à une boucle locale mais mène ailleurs, ou porte de quoi tromper, est refusé.
    for (const uri of [
      "http://localhost@evil.example/cb",
      "http://evil.example\\@localhost/cb",
      "http://localhost./cb",
      "http://[::ffff:127.0.0.1]/cb",
      "http://localhost#@evil.example",
      "http://localhost:99999/cb",
      "//localhost/cb",
      "javascript:alert(1)",
      "data:text/html,x",
    ])
      expect(redirectAllowed(uri), uri).toBe(false);
    // Le chemin comparé est celui que le navigateur suivra, une fois l'adresse lue.
    expect(redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:5000/callback/../ailleurs")).toBe(false);
    expect(redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:5000/%63allback")).toBe(false);
    expect(redirectMatches(["http://127.0.0.1/callback"], "http://127.1:5000/callback")).toBe(true);
    // Une adresse d'assistant reconnu ne souffre aucune variante.
    for (const uri of ["https://CLAUDE.AI/api/mcp/auth_callback", "https://claude.ai:443/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback/", "https://claude.ai/api/mcp/../mcp/auth_callback", "https://claude.ai@evil.example/api/mcp/auth_callback"])
      expect(redirectAllowed(uri), uri).toBe(false);
  });
  it("compare strictement, sauf le port d'une boucle locale", () => {
    expect(redirectMatches([CLAUDE_CALLBACK], CLAUDE_CALLBACK)).toBe(true);
    expect(redirectMatches(["http://localhost/callback", "http://127.0.0.1/callback"], "http://localhost:53124/callback")).toBe(true);
    expect(redirectMatches(["http://127.0.0.1:7777/oauth/callback"], "http://127.0.0.1:50211/oauth/callback")).toBe(true);
    // Le port est libre ; l'hôte et le chemin sont ceux que le client a enregistrés.
    expect(redirectMatches(["http://localhost/callback"], "http://127.0.0.1:53124/callback")).toBe(false);
    expect(redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:53124/oauth/callback")).toBe(false);
    expect(redirectMatches([CLAUDE_CALLBACK], "http://localhost:53124/callback")).toBe(false);
    expect(redirectMatches(["https://evil.example/cb"], "https://evil.example/cb")).toBe(false);
  });
});

describe("assistants reconnus", () => {
  const all = MCP_CLIENTS.flatMap((c) => c.redirects);
  it("chaque adresse de retour est exacte : ni jokers, ni paramètres, ni http hors d'une appli de bureau", () => {
    expect(MCP_CLIENTS.find((c) => c.name === "Claude")?.redirects).toContain(CLAUDE_CALLBACK);
    for (const uri of all) {
      const u = new URL(uri);
      expect(uri, uri).not.toMatch(/[*?#\s]/);
      expect(u.username + u.password, uri).toBe("");
      // https chez l'éditeur, ou le schéma propre à son appli de bureau ; jamais http, et jamais une boucle locale (admise pour tous).
      expect(u.protocol, uri).not.toBe("http:");
      expect(isLoopback(uri), uri).toBe(false);
      if (u.protocol === "https:") expect(u.hostname, uri).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    }
    expect(new Set(all).size, "une adresse ne désigne qu'un assistant").toBe(all.length);
    // Une adresse relais renvoie le code vers une cible nommée dans la demande : elle ne s'inscrit jamais.
    for (const relay of RELAYS) {
      expect(all, relay).not.toContain(relay);
      expect(redirectAllowed(relay), relay).toBe(false);
    }
    expect(RELAYS).toContain("https://vscode.dev/redirect");
    expect(new Set(MCP_CLIENTS.map((c) => c.name)).size).toBe(MCP_CLIENTS.length);
  });
  it("retrouve l'assistant d'une adresse, à la lettre près", () => {
    expect(knownClient(CLAUDE_CALLBACK)?.name).toBe("Claude");
    expect(knownClient(`${CLAUDE_CALLBACK}/`)).toBeNull();
    expect(knownClient("http://localhost:3118/callback")).toBeNull();
  });
  it("nomme le client d'après l'adresse où le membre retournera, pas d'après ce qu'il dit de lui-même", () => {
    // Un client qui se dit « ChatGPT » mais revient chez Claude est Claude ; un programme local garde le nom qu'il se donne.
    expect(clientIdentity(CLAUDE_CALLBACK, "ChatGPT")).toEqual({ known: true, name: "Claude" });
    expect(clientIdentity("http://127.0.0.1:7777/oauth/callback", "  Gemini\u0007 <b>CLI</b>  ")).toEqual({ known: false, name: "Gemini b CLI /b" });
    // Ni caractère invisible (sens d'écriture inversé, largeur nulle), ni guillemet : le nom s'affiche comme une citation.
    expect(cleanClientName("Cla\u202Eedu\u200B « Claude » \"x\"")).toBe("Cla edu Claude x");
    expect(clientIdentity("http://localhost:3118/callback", "")).toEqual({ known: false, name: null });
    expect(clientIdentity("http://localhost:3118/callback", undefined)).toEqual({ known: false, name: null });
    // Une appli de bureau ouverte par son schéma : son nom est celui de la liste, mais rien ne prouve qui recevra le retour.
    expect(clientIdentity("cursor://anysphere.cursor-mcp/oauth/callback", "Autre chose")).toEqual({ known: false, name: "Cursor" });
    expect(clientIdentity("https://chatgpt.com/connector_platform_oauth_redirect", "Autre chose")).toEqual({ known: true, name: "ChatGPT" });
    expect(cleanClientName("x".repeat(200))).toHaveLength(60);
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
  it("accepte un client et ne garde que ses adresses de retour admises", () => {
    expect(validateClientDocument(url, { client_id: url, client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK, "https://autre.example/cb"] })).toEqual({ name: "Claude", redirectUris: [CLAUDE_CALLBACK] });
    // Un programme de l'ordinateur décrit par son éditeur : ses boucles locales (le document de Codex, tel que publié).
    const codex = "https://chatgpt.com/oauth/codex/client.json";
    expect(validateClientDocument(codex, { client_id: codex, client_name: "Codex", application_type: "native", redirect_uris: ["http://127.0.0.1/callback", "http://localhost/callback"] })).toEqual({
      name: "Codex",
      redirectUris: ["http://127.0.0.1/callback", "http://localhost/callback"],
    });
    expect(validateClientDocument(codex, { client_id: codex, redirect_uris: ["http://127.0.0.1/callback"] })).toMatchObject({ name: "chatgpt.com" });
  });
  it("n'admet comme adresse de document qu'une adresse https avec un chemin, sans identifiants ni fragment", () => {
    expect(clientDocumentUrl(url)?.hostname).toBe("claude.ai");
    for (const id of [
      "http://claude.ai/x",
      "https://claude.ai/",
      "https://claude.ai",
      "https://alex:secret@claude.ai/x",
      "https://claude.ai/x#frag",
      "pcl_abc",
      "claude.ai/x",
      // Écritures non canoniques : elles désigneraient le même document sous un autre identifiant, ou un hôte voisin à un accent près.
      "https://CLAUDE.AI/x",
      "https://claude.ai:443/x",
      "https://claude.ai/a/../x",
      "https://chätgpt.com/oauth/client.json",
      "https://[::ffff:127.0.0.1]/x ",
    ]) {
      expect(clientDocumentUrl(id), id).toBeNull();
      expect(validateClientDocument(id, { client_id: id, redirect_uris: [CLAUDE_CALLBACK] }), id).toBe("client_id invalide");
    }
  });
  it("refuse un document illisible, qui ne correspond pas, ou sans adresse de retour admise", () => {
    expect(validateClientDocument(url, null)).toBe("document du client illisible");
    expect(validateClientDocument(url, { client_id: "https://claude.ai/autre", redirect_uris: [CLAUDE_CALLBACK] })).toBe("le document ne correspond pas au client_id");
    expect(validateClientDocument(url, { client_id: url, redirect_uris: ["https://autre.example/cb"] })).toBe("aucune adresse de retour admise");
    // N'importe quel hôte peut publier un document : il n'y gagne aucune adresse de retour de son choix.
    const evil = "https://evil.example/client.json";
    expect(validateClientDocument(evil, { client_id: evil, client_name: "Claude", redirect_uris: ["https://evil.example/cb", "monappli://retour"] })).toBe("aucune adresse de retour admise");
  });
});
