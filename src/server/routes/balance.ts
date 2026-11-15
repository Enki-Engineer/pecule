import { Router } from "express";
import { z } from "zod";
import { balanceForecast, saveBalanceRule } from "../balance.ts";
import { MAX_BALANCE_DAYS } from "../../lib/balance.ts";

/** Solde bas : la règle du membre et la prévision de ses comptes. Sous /api. */
export const balanceApi = Router();

balanceApi.get("/balance-alert", async (req, res) => {
  res.json(await balanceForecast(req.user!.id));
});

const patch = z.object({
  enabled: z.boolean().optional(),
  threshold: z.number().min(-10_000_000).max(10_000_000).optional(),
  days: z.number().int().min(1).max(MAX_BALANCE_DAYS).optional(),
  accounts: z.record(z.string().max(64), z.object({ watch: z.boolean().optional(), threshold: z.number().min(-10_000_000).max(10_000_000).nullable().optional() })).optional(),
});

balanceApi.put("/balance-alert", async (req, res) => {
  const body = patch.parse(req.body);
  // Seuls les comptes que le membre voit se règlent : un identifiant inconnu n'entre pas dans sa règle.
  const known = new Set((await balanceForecast(req.user!.id, 0)).accounts.map((a) => a.id));
  const accounts = body.accounts ? Object.fromEntries(Object.entries(body.accounts).filter(([id]) => known.has(id))) : undefined;
  await saveBalanceRule(req.user!.id, { ...body, accounts });
  res.json(await balanceForecast(req.user!.id));
});
