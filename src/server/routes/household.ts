import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth.ts";
import { householdSettings, saveHouseholdSettings } from "../household.ts";
import { listMembers } from "../members.ts";
import { MODULES } from "../../lib/modules.ts";
import { COUNTRIES, isTimeZone } from "../../lib/countries.ts";
import { CURRENCIES } from "../../lib/currencies.ts";
import { changeHouseholdCurrency, currencyChangePreview } from "../currency-change.ts";
import { dateBasis, setDateBasis } from "../stat-dates.ts";
import { ActionError } from "../actions.ts";
import { t } from "../../lib/i18n.ts";

/** Le foyer : ses membres et ses réglages (personnes sans connexion, banques professionnelles, écrans retirés). Sous /api. */
export const householdApi = Router();

householdApi.get("/household", async (_req, res) => {
  res.json({ members: await listMembers(), ...(await householdSettings()) });
});

householdApi.put("/household", requireAdmin, async (req, res) => {
  const names = z.array(z.string().trim().min(1).max(80)).max(20);
  const body = z
    .object({
      people: names.optional(),
      proInstitutions: names.optional(),
      modulesOff: z.array(z.enum(MODULES)).optional(),
      country: z.string().refine((c) => Object.hasOwn(COUNTRIES, c)).optional(),
      timeZone: z.string().refine(isTimeZone).optional(),
    })
    .parse(req.body);
  res.json({ members: await listMembers(), ...(await saveHouseholdSettings(body)) });
});

/** Ce que changerait une nouvelle devise du foyer : opérations et soldes recalculés, montants saisis gardés tels quels. */
householdApi.get("/household/currency/:currency", requireAdmin, async (req, res) => {
  res.json(await currencyChangePreview(z.enum(CURRENCIES).parse(req.params.currency)));
});

/** Change la devise du foyer et recalcule les opérations et les soldes à partir de la devise de chaque compte. */
householdApi.put("/household/currency", requireAdmin, async (req, res) => {
  const { currency } = z.object({ currency: z.enum(CURRENCIES) }).parse(req.body);
  const result = await changeHouseholdCurrency(currency);
  res.json({ members: await listMembers(), ...(await householdSettings()), ...result });
});

/**
 * Jour retenu pour les statistiques : le jour d'achat ou le jour d'écriture de la banque (src/server/stat-dates.ts).
 * C'est une définition des chiffres du foyer, la même pour tous ses membres : l'administrateur la choisit. En démo,
 * chacun peut l'essayer (la base de démo est jetable).
 */
householdApi.get("/household/date-basis", async (_req, res) => {
  res.json({ dateBasis: await dateBasis() });
});

householdApi.put("/household/date-basis", async (req, res) => {
  if (!req.user?.admin && !req.user?.demo) throw new ActionError(403, t("Réservé à l'administrateur du foyer"));
  const { basis } = z.object({ basis: z.enum(["achat", "debit"]) }).parse(req.body);
  res.json({ dateBasis: await setDateBasis(basis) });
});
