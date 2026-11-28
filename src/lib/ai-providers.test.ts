import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, AI_PROVIDER_INFO, AI_PROVIDER_SPEC, OLLAMA_CONTEXT, aiStatusOf, cleanContext, connectorBase, foundryResource, isLocalHost, isPublicHost, normalizeAiUrl, normalizeFoundryUrl, normalizeGatewayUrl, normalizeOllamaUrl, normalizeOpenAiUrl, resolveAiConfig } from "./ai-providers.ts";

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

describe("adresse d'un serveur de modèles", () => {
  it("Ollama : le port habituel pour un hôte nu, sans ce que Pécule ajoute lui-même", () => {
    expect(normalizeOllamaUrl("localhost")).toBe("http://localhost:11434");
    expect(normalizeOllamaUrl(" http://localhost:11434/ ")).toBe("http://localhost:11434");
    expect(normalizeOllamaUrl("192.168.1.20")).toBe("http://192.168.1.20:11434");
    expect(normalizeOllamaUrl("host.docker.internal:11434/api/chat")).toBe("http://host.docker.internal:11434");
    expect(normalizeOllamaUrl("http://ollama:8080/v1")).toBe("http://ollama:8080");
    expect(normalizeOllamaUrl("ollama.com")).toBe("https://ollama.com");
    expect(normalizeOllamaUrl("https://ollama.com/api")).toBe("https://ollama.com");
    expect(normalizeOllamaUrl("https://modeles.exemple.com/ollama/api/chat")).toBe("https://modeles.exemple.com/ollama");
  });
  it("service compatible OpenAI : l'adresse de base, « /v1 » ajouté quand il n'y a pas de chemin", () => {
    expect(normalizeOpenAiUrl("localhost:1234")).toBe("http://localhost:1234/v1");
    expect(normalizeOpenAiUrl("http://192.168.1.20:8000/v1/chat/completions")).toBe("http://192.168.1.20:8000/v1");
    expect(normalizeOpenAiUrl("https://api.exemple.com/v1/")).toBe("https://api.exemple.com/v1");
    expect(normalizeOpenAiUrl("api.exemple.com/openai/v1/models")).toBe("https://api.exemple.com/openai/v1");
    expect(normalizeAiUrl("openai-compatible", "nas.local:8080")).toBe("http://nas.local:8080/v1");
  });
  it("jamais d'identifiants dans l'adresse, ni d'autre schéma que http et https", () => {
    for (const bad of ["", "ftp://localhost", "http://alex:secret@localhost:11434", "http://"]) {
      expect(normalizeOllamaUrl(bad), bad).toBeNull();
      expect(normalizeOpenAiUrl(bad), bad).toBeNull();
    }
  });
  it("une adresse en http écrite en entier est gardée : c'est le serveur qui juge où son nom mène", () => {
    // Le nom d'un réseau privé virtuel mène à une adresse locale, et rien ne le dit dans le nom.
    expect(normalizeOllamaUrl("http://machine.reseau-prive.exemple:11434")).toBe("http://machine.reseau-prive.exemple:11434");
    expect(normalizeOllamaUrl("https://modeles.exemple.com/proxy/api/ollama")).toBe("https://modeles.exemple.com/proxy/api/ollama");
    // Écrit sans schéma, un nom qui n'a rien de local part en https.
    expect(normalizeOpenAiUrl("api.exemple.com")).toBe("https://api.exemple.com/v1");
  });
  it("reconnaît un hôte local à son nom", () => {
    for (const h of ["localhost", "ollama", "nas.local", "host.docker.internal", "serveur.lan", "127.0.0.1", "10.0.0.5", "192.168.1.20", "100.64.0.5", "[::1]", "fd00::1"]) expect(isLocalHost(h), h).toBe(true);
    for (const h of ["api.exemple.com", "ollama.com", "8.8.8.8", "169.254.169.254", "192.0.78.24", "2606:4700::1111"]) expect(isLocalHost(h), h).toBe(false);
  });
  it("OpenAI, OpenRouter et l'API Claude n'ont pas d'adresse à saisir : la leur est écrite ici", () => {
    for (const p of ["openai", "openrouter", "anthropic"] as const) {
      expect(normalizeAiUrl(p, "https://ailleurs.exemple.com"), p).toBeNull();
      expect(AI_PROVIDER_INFO[p].url, p).toBeNull();
      expect(AI_PROVIDER_SPEC[p].baseUrl, p).toMatch(/^https:\/\//);
    }
    expect(connectorBase({ provider: "openai", url: null })).toBe("https://api.openai.com/v1");
    expect(connectorBase({ provider: "ollama", url: "http://localhost:11434" })).toBe("http://localhost:11434");
  });
  it("chaque fournisseur a sa fiche, et un champ d'adresse seulement s'il en demande une", () => {
    for (const p of AI_PROVIDERS) {
      expect(AI_PROVIDER_INFO[p].label, p).toBeTruthy();
      expect(AI_PROVIDER_INFO[p].url === null, p).toBe(AI_PROVIDER_SPEC[p].address === "fixe");
    }
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

  it("OpenAI part avec un modèle ; OpenRouter attend qu'on en choisisse un", () => {
    const c = resolveAiConfig({ connectors: { openai: { key: "ok:sk-x" }, openrouter: { key: "ok:sk-or-x" } } }, host, open);
    expect(c.connectors.openai).toMatchObject({ model: "gpt-6.2-sol", url: null, ready: true, context: null });
    expect(c.connectors.openrouter).toMatchObject({ model: "", ready: false });
    expect(resolveAiConfig({ connectors: { openrouter: { key: "ok:sk-or-x", model: "editeur/modele" } } }, host, open).connectors.openrouter.ready).toBe(true);
  });

  it("Ollama et un service compatible répondent sans clé, dès qu'ils ont une adresse et un modèle", () => {
    expect(resolveAiConfig({}, host, open).connectors.ollama).toMatchObject({ ready: false, url: null, model: "", context: OLLAMA_CONTEXT.default });
    expect(resolveAiConfig({ connectors: { ollama: { url: "localhost" } } }, host, open).connectors.ollama).toMatchObject({ ready: false, url: "http://localhost:11434" });
    expect(resolveAiConfig({ connectors: { ollama: { url: "localhost", model: "modele:4b", context: 65536 } } }, host, open).connectors.ollama).toMatchObject({ ready: true, key: null, context: 65536 });
    expect(resolveAiConfig({ connectors: { "openai-compatible": { url: "localhost:1234", model: "modele-local" } } }, host, open).connectors["openai-compatible"]).toMatchObject({ ready: true, url: "http://localhost:1234/v1", context: null });
    // L'adresse de l'hébergement et son modèle ne valent que pour Foundry.
    expect(resolveAiConfig({ connectors: { ollama: { url: "localhost" } } }, host, open).connectors.ollama.model).toBe("");
  });

  it("la fenêtre de contexte reste dans ses bornes", () => {
    expect(cleanContext(65536)).toBe(65536);
    expect(cleanContext("16384")).toBe(16384);
    expect(cleanContext(100)).toBe(OLLAMA_CONTEXT.min);
    expect(cleanContext(1e9)).toBe(OLLAMA_CONTEXT.max);
    expect(cleanContext("")).toBeNull();
    expect(cleanContext("beaucoup")).toBeNull();
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
