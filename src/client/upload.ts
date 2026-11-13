/*
 * Préparation d'un fichier avant envoi : les photos (HEIC de l'iPhone compris, quand le navigateur
 * sait le décoder — Safari) sont converties en JPEG et réduites, pour que Claude puisse les lire
 * et que le fichier reste léger. Les PDF partent tels quels.
 */

const MAX_SIDE = 2400;
const JPEG_QUALITY = 0.85;
const KEEP_AS_IS = 1.5 * 1024 * 1024;

const isHeic = (f: File) => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

export async function prepareFile(file: File): Promise<File> {
  const image = file.type.startsWith("image/") || isHeic(file);
  if (!image) return file;
  // Photo déjà lisible et légère : inutile de la recompresser.
  if (!isHeic(file) && ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= KEEP_AS_IS) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;
    const name = `${file.name.replace(/\.[a-z0-9]+$/i, "") || "photo"}.jpg`;
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    // Format que ce navigateur ne sait pas décoder (HEIC hors Safari) : envoyé tel quel, conservé sans lecture.
    return file;
  }
}
