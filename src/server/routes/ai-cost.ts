import { Router } from "express";
import { z } from "zod";
import { MAX_BUDGET, MAX_PRICE, saveAiBudget, setModelPrice } from "../ai-cost.ts";
import { usageReport } from "../ai-usage.ts";
import { requireAdmin } from "../auth.ts";
import { kick } from "../imports/batches.ts";
import { logAudit } from "../journal.ts";

/*
 * Réglages → Coût de l'IA : ce que l'IA a coûté (tout le foyer), le plafond du mois et le tarif d'un modèle.
 * Sous /api, membre connecté. Le plafond et les tarifs sont des réglages du foyer, gardés dans la vraie base :
 * réservés à l'administrateur, et interdits en démo (« /ai/ » est dans BLOCKED, demo.ts). Comme le fournisseur
 * d'IA, ces écritures sont hors de l'audit automatique et se tracent elles-mêmes.
 */
export const aiCostApi = Router();

aiCostApi.get("/assistant/usage", async (req, res) => {
  const month = z.string().regex(/^\d{4}-\d{2}$/).optional().catch(undefined).parse(req.query.mois);
  res.json({ ...(await usageReport(req.user!.id, month)), admin: !!req.user!.admin && !req.user!.demo });
});

aiCostApi.put("/ai/budget", requireAdmin, async (req, res) => {
  const body = z.object({ monthly: z.number().min(0).max(MAX_BUDGET).nullable().optional(), pauseBackground: z.boolean().optional() }).parse(req.body);
  const saved = await saveAiBudget({ ...(body.monthly !== undefined ? { monthly: body.monthly || null } : {}), ...(body.pauseBackground !== undefined ? { pauseBackground: body.pauseBackground } : {}) });
  void logAudit("PUT /api/ai/budget", null, { plafond: saved.monthly ?? "aucun", pause: saved.pauseBackground });
  // Un plafond relevé ou retiré : les imports en attente reprennent.
  kick();
  res.json(saved);
});

aiCostApi.put("/ai/prices", requireAdmin, async (req, res) => {
  const rate = z.number().min(0).max(MAX_PRICE);
  const body = z.object({ model: z.string().trim().min(1).max(64), price: z.object({ input: rate, output: rate }).nullable() }).parse(req.body);
  const recomputed = await setModelPrice(body.model, body.price);
  void logAudit("PUT /api/ai/prices", body.model, body.price ? { entree: body.price.input, sortie: body.price.output, recalcules: recomputed } : { tarif: "retiré" });
  res.json({ recomputed });
});
