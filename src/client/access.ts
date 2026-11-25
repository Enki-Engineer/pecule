import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { passkeyBlock, passkeyFailure, type PasskeyBlock } from "../lib/passkey-check.ts";
import { t } from "../lib/i18n.ts";

/*
 * Comment on entre dans cette installation (côté écran) : ce que le serveur en dit, ce que la page permet, et les
 * mots pour le dire. Une clé d'accès ne sert qu'à l'adresse de l'installation, en https sur un nom de domaine ou sur
 * http://localhost ; ailleurs, l'écran le dit avant le geste et propose le mot de passe.
 */

/**
 * `address` : l'adresse où l'installation est servie ; `password` : le mot de passe est admis ; `passwordLogin` : un
 * membre au moins en a un (l'écran de connexion le propose). Pour le membre connecté : ses clés d'accès (`passkeys`),
 * son mot de passe (`hasPassword`), et si l'administrateur exige la clé d'accès (`passkeysOnly`).
 */
export type Access = { address: string; password: boolean; passwordLogin: boolean; passkeysOnly?: boolean; passkeys?: number; hasPassword?: boolean };

export const useAccess = () => useQuery({ queryKey: ["access"], queryFn: () => api<Access>("/auth/access"), staleTime: 300_000 });

/** Ce qui empêche une clé d'accès de servir sur cette page ; `null` si rien ne s'y oppose. */
export const pageBlock = (access?: Access | null): PasskeyBlock | null =>
  passkeyBlock({ origin: window.location.origin, secure: window.isSecureContext, webauthn: typeof window.PublicKeyCredential !== "undefined", expected: access?.address });

/** Pourquoi une clé d'accès ne peut pas servir ici, dit avant le geste. */
export function blockText(block: PasskeyBlock, address?: string): string {
  if (block === "adresse") return t("Cette page est ouverte à {ici}, mais cette installation de Pécule est servie à {adresse} : c'est à cette adresse qu'on se connecte.", { ici: window.location.origin, adresse: address ?? "" });
  if (block === "ip") return t("Une clé d'accès ne peut pas servir sur une adresse IP : il lui faut un nom (un nom de domaine en https, ou http://localhost sur la machine elle-même).");
  if (block === "http") return t("Une clé d'accès demande une adresse en https (ou http://localhost sur la machine elle-même) : en http, le navigateur la refuse.");
  return t("Ce navigateur ne sait pas se servir d'une clé d'accès.");
}

/**
 * Le geste de la clé d'accès (création ou connexion), avec un refus qui dit sa cause : annulé par la personne, refusé
 * de lui-même par le navigateur, certificat non reconnu, adresse qui ne convient pas.
 */
export async function withPasskey<T>(gesture: () => Promise<T>, address?: string): Promise<T> {
  const started = performance.now();
  try {
    return await gesture();
  } catch (e) {
    const kind = passkeyFailure(e, performance.now() - started);
    const text =
      kind === "annule"
        ? t("Opération annulée.")
        : kind === "refus"
          ? t("Le navigateur a refusé sans rien te demander : à cette adresse ou sur cet appareil, une clé d'accès ne peut pas servir.")
          : kind === "certificat"
            ? t("Le navigateur ne fait pas confiance au certificat de cette adresse : une clé d'accès ne peut pas y servir. Il faut un certificat reconnu, celui d'un vrai nom de domaine.")
            : kind === "adresse"
              ? address
                ? t("Une clé d'accès ne vaut qu'à l'adresse de cette installation : {adresse}", { adresse: address })
                : t("Une clé d'accès ne peut pas servir à cette adresse.")
              : kind === "existe"
                ? t("Cet appareil a déjà une clé d'accès pour Pécule.")
                : kind === "appareil"
                  ? t("Cet appareil ne sait pas garder de clé d'accès.")
                  : null;
    if (text) throw new Error(text, { cause: e });
    throw e;
  }
}

/** Nom donné à la clé d'accès créée sur cet appareil. */
export const deviceName = () =>
  /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Mac/.test(navigator.userAgent) ? "Mac" : /Android/.test(navigator.userAgent) ? "Android" : /Windows/.test(navigator.userAgent) ? "Windows" : /Linux/.test(navigator.userAgent) ? "Linux" : t("Appareil");
