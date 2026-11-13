import { describe, expect, it } from "vitest";
import { aiStatusOf, foundryResource, isPublicHost, normalizeAiUrl, normalizeFoundryUrl, normalizeGatewayUrl, resolveAiConfig } from "./ai-providers.ts";

const open = (s: string) => (s.startsWith("ok:") ? s.slice(3) : null);

describe("adresse d'une ressource Foundry", () => {
  it("accepte le nom de la ressource, un hôte nu et l'adresse copiée du portail", () => {
    const want = "https://ma-ressource.services.ai.azure.com/anthropic";
    expect(normalizeFoundryUrl("Ma-Ressource")).toBe(want);
    expect(normalizeFoundryUrl("ma-ressource.services.ai.azure.com")).toBe(want);
    expect(normalizeFoundryUrl("https://ma-ressource.services.ai.azure.com/anthropic/v1/messages")).toBe(want);
    expect(normalizeFoundryUrl(" https://ma-ressource.services.ai.azure.com/anthropic/ ")).toBe(want);
  });
  it("garde le chemin d'une passerelle d'entreprise", () => {
    expect(normalizeFoundryUrl("https://apim.exemple.com/claude/anthropic/v1")).toBe("https://apim.exemple.com/claude/anthropic");
  });
  it("refuse le vide, le http en clair, une machine locale et une adresse IP", () => {
    for (const bad of ["", "   ", "http://ma-ressource.services.ai.azure.com", "https://localhost/anthropic", "https://127.0.0.1/anthropic", "https://[::1]/anthropic", "https://cle@exemple.com", "ftp://exemple.com"])
      expect(normalizeFoundryUrl(bad), bad).toBeNull();
  });
  it("retrouve le nom de la ressource, sauf derrière une passerelle", () => {
    expect(foundryResource("https://ressource-ia-0001.services.ai.azure.com/anthropic")).toBe("ressource-ia-0001");
    expect(foundryResource("https://apim.exemple.com/claude/anthropic")).toBeNull();
    expect(foundryResource(null)).toBeNull();
  });
});

describe("adresse d'une passerelle compatible", () => {
  it("retire ce que le SDK ajoute lui-même", () => {
    expect(normalizeGatewayUrl("https://passerelle.exemple.com/")).toBe("https://passerelle.exemple.com");
    expect(normalizeGatewayUrl("passerelle.exemple.com/api/v1/messages")).toBe("https://passerelle.exemple.com/api");
    expect(normalizeGatewayUrl("https://passerelle.exemple.com:8443/v1")).toBe("https://passerelle.exemple.com:8443");
  });
  it("refuse ce qui n'est pas un nom de domaine public en https", () => {
    for (const bad of ["http://passerelle.exemple.com", "https://192.168.1.10", "https://serveur", "https://nas.local", "https://api.internal"]) expect(normalizeGatewayUrl(bad), bad).toBeNull();
  });
  it("l'API Claude en direct n'a pas d'adresse", () => {
    expect(normalizeAiUrl("anthropic", "https://passerelle.exemple.com")).toBeNull();
  });
});

describe("hôte public", () => {
  it("un nom de domaine, rien d'autre", () => {
    expect(isPublicHost("api.exemple.com")).toBe(true);
    for (const h of ["localhost", "serveur", "10.0.0.1", "169.254.169.254", "::1", "nas.local", "app.localhost"]) expect(isPublicHost(h), h).toBe(false);
  });
});

describe("configuration effective", () => {
  const host = { foundryResource: "ressource-ia-0001", foundryKey: "cle-hebergement", model: "claude-opus-5-5" };

  it("sans réglage : Foundry avec les valeurs de l'hébergement", () => {
    const c = resolveAiConfig({}, host, open);
    expect(c.provider).toBe("foundry");
    expect(c.connectors.foundry).toMatchObject({ url: "https://ressource-ia-0001.services.ai.azure.com/anthropic", urlSource: "hebergement", key: "cle-hebergement", keySource: "hebergement", model: "claude-opus-5-5", ready: true });
    expect(c.connectors.anthropic.ready).toBe(false);
    expect(c.connectors.compatible.ready).toBe(false);
  });

  it("sans réglage ni hébergement : rien n'est prêt", () => {
    const c = resolveAiConfig({}, {}, open);
    expect(c.connectors.foundry.ready).toBe(false);
    expect(aiStatusOf(c).enabled).toBe(false);
  });

  it("ce qui est enregistré prime sur l'hébergement", () => {
    const c = resolveAiConfig({ connectors: { foundry: { url: "https://autre.services.ai.azure.com/anthropic", key: "ok:cle-reglages", model: "claude-sonnet-5-5" } } }, host, open);
    expect(c.connectors.foundry).toMatchObject({ url: "https://autre.services.ai.azure.com/anthropic", urlSource: "reglages", key: "cle-reglages", keySource: "reglages", model: "claude-sonnet-5-5" });
  });

  it("une clé devenue illisible laisse la main à celle de l'hébergement, et se signale", () => {
    const c = resolveAiConfig({ connectors: { foundry: { key: "illisible" }, anthropic: { key: "illisible" } } }, host, open);
    expect(c.connectors.foundry).toMatchObject({ key: "cle-hebergement", keySource: "hebergement", keyUnreadable: true, ready: true });
    expect(c.connectors.anthropic).toMatchObject({ key: null, keyUnreadable: true, ready: false });
  });

  it("les valeurs de l'hébergement ne servent qu'à Foundry", () => {
    const c = resolveAiConfig({ provider: "anthropic", connectors: { anthropic: { key: "ok:sk-ant-x" } } }, host, open);
    expect(c.provider).toBe("anthropic");
    expect(c.connectors.anthropic).toMatchObject({ key: "sk-ant-x", url: null, model: "claude-opus-5-5", ready: true });
  });

  it("une passerelle demande une clé et une adresse", () => {
    expect(resolveAiConfig({ connectors: { compatible: { key: "ok:k" } } }, host, open).connectors.compatible.ready).toBe(false);
    expect(resolveAiConfig({ connectors: { compatible: { key: "ok:k", url: "https://passerelle.exemple.com" } } }, host, open).connectors.compatible.ready).toBe(true);
  });

  it("un fournisseur inconnu en base revient à Foundry", () => {
    expect(resolveAiConfig({ provider: "ailleurs" }, host, open).provider).toBe("foundry");
  });

  it("l'état envoyé à l'écran ne contient aucune clé", () => {
    const status = aiStatusOf(resolveAiConfig({ connectors: { anthropic: { key: "ok:sk-ant-secret" } } }, host, open));
    expect(JSON.stringify(status)).not.toMatch(/sk-ant-secret|cle-hebergement/);
    expect(status.connectors.find((c) => c.id === "anthropic")).toMatchObject({ keySet: true, keySource: "reglages", active: false });
    expect(status.connectors.find((c) => c.id === "foundry")).toMatchObject({ keySet: true, keySource: "hebergement", active: true });
  });
});
