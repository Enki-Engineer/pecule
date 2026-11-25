import { describe, expect, it } from "vitest";
import { passkeyBlock, passkeyFailure } from "./passkey-check.ts";

const page = (origin: string, more: Partial<{ secure: boolean; webauthn: boolean; expected: string | null }> = {}) => ({ origin, secure: true, webauthn: true, ...more });

describe("passkeyBlock", () => {
  it("ne voit rien à redire en https sur un nom, ni sur localhost", () => {
    expect(passkeyBlock(page("https://pecule.exemple.fr", { expected: "https://pecule.exemple.fr" }))).toBeNull();
    expect(passkeyBlock(page("http://localhost:3000", { expected: "http://localhost:3000" }))).toBeNull();
    // Un serveur d'avant, qui ne dit pas son adresse : rien à comparer.
    expect(passkeyBlock(page("https://pecule.exemple.fr"))).toBeNull();
  });

  it("dit d'abord que la page n'est pas ouverte à l'adresse de l'installation", () => {
    expect(passkeyBlock(page("http://127.0.0.1:3000", { expected: "http://localhost:3000" }))).toBe("adresse");
    expect(passkeyBlock(page("http://192.168.1.20:3000", { secure: false, expected: "http://localhost:3000" }))).toBe("adresse");
    expect(passkeyBlock(page("https://www.exemple.fr", { expected: "https://pecule.exemple.fr" }))).toBe("adresse");
  });

  it("refuse une adresse IP, même jugée sûre par le navigateur", () => {
    expect(passkeyBlock(page("http://127.0.0.1:3000", { expected: "http://127.0.0.1:3000" }))).toBe("ip");
    expect(passkeyBlock(page("https://192.168.1.20", { expected: "https://192.168.1.20" }))).toBe("ip");
    expect(passkeyBlock(page("http://192.168.1.20:3000", { secure: false, expected: "http://192.168.1.20:3000" }))).toBe("ip");
  });

  it("refuse le http sur un nom du réseau, puis un navigateur sans clés d'accès", () => {
    expect(passkeyBlock(page("http://nas.local:3000", { secure: false, expected: "http://nas.local:3000" }))).toBe("http");
    expect(passkeyBlock(page("https://pecule.exemple.fr", { webauthn: false }))).toBe("navigateur");
  });
});

describe("passkeyFailure", () => {
  const error = (name: string, message = "", code?: string) => Object.assign(new Error(message), { name, code });

  it("distingue l'annulation du refus du navigateur, par le temps écoulé", () => {
    expect(passkeyFailure(error("NotAllowedError", "The operation either timed out or was not allowed."), 6200)).toBe("annule");
    expect(passkeyFailure(error("NotAllowedError", "The operation either timed out or was not allowed."), 40)).toBe("refus");
    expect(passkeyFailure(error("AbortError"), 3000)).toBe("annule");
  });

  it("reconnaît un certificat que le navigateur n'accepte pas", () => {
    expect(passkeyFailure(error("NotAllowedError", "WebAuthn is not supported on sites with TLS certificate errors."), 12)).toBe("certificat");
  });

  it("reconnaît une adresse qui ne convient pas", () => {
    expect(passkeyFailure(error("SecurityError", "This is an invalid domain."), 5)).toBe("adresse");
    expect(passkeyFailure(error("SecurityError", "192.168.1.20 is an invalid domain", "ERROR_INVALID_DOMAIN"), 5)).toBe("adresse");
    expect(passkeyFailure(error("SecurityError", 'The RP ID "localhost" is invalid for this domain', "ERROR_INVALID_RP_ID"), 5)).toBe("adresse");
  });

  it("reconnaît une clé déjà là, et un appareil qui n'en garde pas", () => {
    expect(passkeyFailure(error("InvalidStateError", "The authenticator was previously registered", "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"), 900)).toBe("existe");
    expect(passkeyFailure(error("NotSupportedError"), 900)).toBe("appareil");
  });

  it("laisse passer tel quel ce qui n'est pas un refus du navigateur", () => {
    expect(passkeyFailure(new Error("Lien d'inscription invalide ou expiré"), 120)).toBe("autre");
    expect(passkeyFailure("texte", 120)).toBe("autre");
    expect(passkeyFailure(null, 120)).toBe("autre");
  });
});
