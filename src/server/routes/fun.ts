import { Router, type Request } from "express";
import { z } from "zod";
import { ActionError, userAccountsSql } from "../actions.ts";
import { funData, listBirthdays, saveBirthdays, setFunEnabled } from "../fun.ts";
import { parseBirthdays, SEASONS, type Season } from "../../lib/seasons.ts";
import { t } from "../../lib/i18n.ts";

/** Équivalences amusantes : données de l'accueil et de la fiche d'opération, et réglage du membre. Sous /api. */
export const funApi = Router();

const scopeOf = (req: Request): "foyer" | "moi" => (req.get("x-perimetre") === "moi" ? "moi" : "foyer");

// `saison` : le thème affiché par l'appareil (son réglage, ou un aperçu) ; sans thème, pas de budget de fête.
funApi.get("/fun", async (req, res) => {
  const asked = typeof req.query.saison === "string" ? req.query.saison : "";
  const season = Object.hasOwn(SEASONS, asked) ? (asked as Season) : null;
  res.json(await funData(req.user!.id, userAccountsSql(req.user!.id, scopeOf(req)), season));
});

funApi.put("/fun", async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  await setFunEnabled(req.user!.id, enabled);
  res.json({ ok: true, enabled });
});

// Anniversaires du foyer : partagés par les membres ; chaque appareil les recopie pour appliquer le thème le jour J.
funApi.get("/birthdays", async (_req, res) => {
  res.json({ birthdays: await listBirthdays() });
});

funApi.put("/birthdays", async (req, res) => {
  const { birthdays } = z
    .object({
      birthdays: z
        .array(z.object({ name: z.string().trim().min(1).max(40), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31), year: z.number().int().min(1900).max(2100).optional() }))
        .max(12),
    })
    .parse(req.body);
  const list = parseBirthdays(birthdays);
  if (list.length !== birthdays.length) throw new ActionError(400, t("Une date d'anniversaire n'existe pas."));
  await saveBirthdays(list);
  res.json({ birthdays: list });
});
