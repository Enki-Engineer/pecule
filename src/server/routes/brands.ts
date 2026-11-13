import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth.ts";
import { linkedBankLogos } from "../bank-logos.ts";
import { brandMatches, createBrand, deleteBrand, listBrands, updateBrand } from "../brands.ts";

/*
 * Enseignes du foyer (Réglages → Classement → « Mes enseignes ») et logos des banques reliées. Sous /api.
 * `requireAuth` route par route : ce routeur est monté avant les autres et ne doit rien intercepter d'autre.
 * Tout membre lit et écrit les enseignes (donnée commune du foyer) ; chaque écriture est tracée au journal comme
 * toute écriture de l'API.
 */
export const brandsApi = Router();

const id = z.coerce.number().int().positive();
const brand = z.object({
  name: z.string().trim().min(2).max(80),
  pattern: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(200).nullable().optional(),
});

brandsApi.get("/brands", requireAuth, async (_req, res) => {
  res.json({ brands: await listBrands() });
});

/** Aperçu d'un motif : ce qu'il reconnaîtrait dans les opérations récentes du membre. */
brandsApi.get("/brands/match", requireAuth, async (req, res) => {
  const pattern = z.string().max(200).parse(req.query.pattern ?? "");
  res.json(await brandMatches(req.user!.id, pattern));
});

brandsApi.post("/brands", requireAuth, async (req, res) => {
  res.json({ brand: await createBrand(brand.parse(req.body)) });
});

brandsApi.patch("/brands/:id", requireAuth, async (req, res) => {
  res.json({ brand: await updateBrand(id.parse(req.params.id), brand.partial().parse(req.body)) });
});

brandsApi.delete("/brands/:id", requireAuth, async (req, res) => {
  await deleteBrand(id.parse(req.params.id));
  res.json({ ok: true });
});

/** Banques reliées par Enable Banking dont le logo peut servir de pastille (aucune en démo). */
brandsApi.get("/bank-logos", requireAuth, async (_req, res) => {
  res.json({ banks: await linkedBankLogos() });
});
