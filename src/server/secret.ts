import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Chiffrement (AES-256-GCM) des secrets gardés en base : la clé de chiffrement dérive
 * d'un secret du serveur qui ne vit que dans les variables d'environnement, si bien qu'une copie de la base
 * (sauvegarde, export) ne livre pas les secrets. Changer ce secret rend les valeurs illisibles : `open`
 * renvoie alors null et il faut les ressaisir.
 */
export function createSealer(secret: string, salt = "pecule-secret-v1") {
  let derived: Buffer | null = null;
  // Dérivation à la demande : scrypt coûte quelques dizaines de millisecondes, une seule fois.
  const key = () => (derived ??= scryptSync(secret, salt, 32));
  return {
    seal(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key(), iv);
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
    },
    open(sealed: string): string | null {
      try {
        const [version, iv, tag, data] = sealed.split(":");
        if (version !== "v1" || !iv || !tag || data === undefined) return null;
        const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}
