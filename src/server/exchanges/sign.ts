/* Signatures HMAC des exchanges : la même empreinte, écrite en hexadécimal ou en base 64 selon l'exchange. */

import { createHmac } from "node:crypto";

export const hmacHex = (message: string, secret: string, algorithm: "sha256" | "sha384" = "sha256") => createHmac(algorithm, secret).update(message).digest("hex");
export const hmacBase64 = (message: string, secret: string) => createHmac("sha256", secret).update(message).digest("base64");

let last = 0;
/** Heure en millisecondes, toujours croissante : sert aussi de numéro d'ordre à une requête signée. */
export function nextMillis(): number {
  last = Math.max(last + 1, Date.now());
  return last;
}
