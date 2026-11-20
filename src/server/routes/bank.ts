import { region } from "../region.ts";
import { one } from "../db.ts";
import { changeAccountCurrency } from "../currency-change.ts";
import { raw, Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ActionError } from "../actions.ts";
import { requireAdmin } from "../auth.ts";
import { isDemo } from "../demo-context.ts";
import { listMembers } from "../members.ts";
import { ebAdopt, ebBanks, ebCards, ebCompare, ebForget, ebRemoveSession, ebSaveKey, ebStartAuth, ebStatus } from "../enable-banking.ts";
import { readEnableBankingNow } from "../bank-sync.ts";
import { cardsWithAccounts } from "../balance.ts";
import { CURRENCIES } from "../../lib/currencies.ts";
import { addManualTransaction, createManualAccount, deleteManualTransaction, importBankFile, setManualBalance } from "../bank-files.ts";
import { logAudit } from "../journal.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Réglages → Comptes et connexions → Enable Banking : Enable Banking (lecture des comptes par l'interface
 * officielle des banques). Sous /api, pour un membre connecté ; interdit en démo (BLOCKED, demo.ts). La clé
 * privée n'est jamais renvoyée ni journalisée : sa route est hors de l'audit automatique (qui garde le corps
 * des demandes) et trace elle-même le changement.
 */
export const bankApi = Router();

function member(req: Request, res: Response, next: NextFunction) {
  // Jamais depuis une session de démo : clés et accords bancaires vivent dans la vraie base.
  if (isDemo() || req.user?.demo) return res.status(403).json({ error: t("Indisponible en mode démo") });
  if (req.user?.via !== "session" && req.user?.via !== "api") return res.status(403).json({ error: t("Réservé à un membre connecté") });
  next();
}

/** Lecture à la demande : les banques limitent les lectures par jour. */
const syncLimiter = rateLimit({
  windowMs: 24 * 3600_000,
  limit: 6,
  keyGenerator: () => "enablebanking",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: () => ({ error: t("Trop de lectures aujourd'hui : la banque en limite le nombre. Réessaie demain.") }),
});

const state = async (req: Request) => ({ ...(await ebStatus(req.user!.id)), cards: await ebCards(), admin: !!req.user?.admin });

bankApi.get("/bank/enable-banking", member, async (req, res) => {
  res.json(await state(req));
});

/** Encours des cartes à débit différé, tel que lu à la dernière synchronisation (accueil, tableau de bord). */
bankApi.get("/bank/cards", member, async (req, res) => {
  res.json({ cards: await cardsWithAccounts(req.user!.id) });
});

/** Période d'observation : chaque compte lu, face au compte en service qui porte les mêmes opérations. */
bankApi.get("/bank/enable-banking/compare", member, async (_req, res) => {
  res.json({ accounts: await ebCompare() });
});

/**
 * Bascule (administrateur) : les comptes en observation alimentent désormais les comptes en service qui portent
 * les mêmes opérations. À blanc par défaut ; `{ "apply": true }` pour l'appliquer.
 */
bankApi.post("/bank/enable-banking/adopt", requireAdmin, async (req, res) => {
  // `map` : cible imposée pour un compte lu (« eb:… » → compte de Pécule), quand le comparatif ne peut pas la trouver.
  const { apply, map } = z.object({ apply: z.boolean().optional(), map: z.record(z.string().max(64), z.string().max(64)).optional() }).parse(req.body ?? {});
  const result = await ebAdopt({ apply, map });
  if (result.applied) await logAudit("bascule Enable Banking", null, result.accounts.map((a) => ({ compte: a.target?.id, rattachees: a.attached, redatees: a.redated, retablies: a.restored, ajoutees: a.added })));
  res.json(result);
});

/**
 * Qui est visé par une clé : `scope: "foyer"` (administrateur seulement) ou `"moi"` (la clé personnelle du membre).
 * L'administrateur peut aussi enregistrer la clé personnelle d'un autre membre (`userId`).
 */
async function keyTarget(req: Request, scope: "foyer" | "moi", userId?: number): Promise<number | undefined> {
  if (userId !== undefined && userId !== req.user!.id) {
    if (!req.user!.admin) throw new ActionError(403, t("Réservé à l'administrateur de Pécule"));
    if (!(await listMembers()).some((m) => m.id === userId)) throw new ActionError(404, t("Utilisateur introuvable"));
    return userId;
  }
  if (scope === "moi" || userId !== undefined) return req.user!.id;
  if (!req.user!.admin) throw new ActionError(403, t("Réservé à l'administrateur de Pécule"));
  return undefined;
}

bankApi.put("/bank/enable-banking/key", member, async (req, res) => {
  const body = z.object({ appId: z.string().trim().min(10).max(80), privateKey: z.string().min(100).max(10_000), scope: z.enum(["foyer", "moi"]).default("foyer"), userId: z.number().int().optional() }).parse(req.body);
  const target = await keyTarget(req, body.scope, body.userId);
  await ebSaveKey(body.appId, body.privateKey, target);
  await logAudit(target === undefined ? "clé Enable Banking enregistrée" : "clé Enable Banking personnelle enregistrée", body.appId);
  res.json(await state(req));
});

bankApi.delete("/bank/enable-banking", member, async (req, res) => {
  const scope = z.enum(["foyer", "moi"]).default("foyer").parse(req.query.scope);
  const target = await keyTarget(req, scope);
  await ebForget(target);
  await logAudit(target === undefined ? "clé Enable Banking retirée" : "clé Enable Banking personnelle retirée");
  res.json(await state(req));
});

bankApi.get("/bank/enable-banking/banks", member, async (req, res) => {
  const country = z.string().regex(/^[A-Za-z]{2}$/).parse(req.query.pays ?? region().country);
  res.json({ banks: await ebBanks(country) });
});

bankApi.post("/bank/enable-banking/connect", member, async (req, res) => {
  // `userId` : l'administrateur prépare l'accord d'un autre membre, qui le validera lui-même auprès de sa banque.
  // `from` : la demande part de la présentation de bienvenue, où le retour de la banque ramène.
  const body = z.object({ aspsp: z.string().min(1).max(120), country: z.string().regex(/^[A-Za-z]{2}$/), userId: z.number().int().optional(), from: z.enum(["bienvenue"]).optional() }).parse(req.body);
  const who = body.userId !== undefined && body.userId !== req.user!.id ? await keyTarget(req, "moi", body.userId) : req.user!.id;
  res.json({ url: await ebStartAuth(who!, body.aspsp, body.country.toUpperCase(), body.from) });
});

bankApi.delete("/bank/enable-banking/sessions/:id", member, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const session = (await ebStatus(req.user!.id)).sessions.find((s) => s.id === id);
  if (!session) return res.status(404).json({ error: t("Accord introuvable") });
  // Chacun retire ses propres accords ; l'administrateur, tous.
  if (session.userId !== req.user!.id && !req.user!.admin) return res.status(403).json({ error: t("Cet accord a été donné par un autre membre") });
  await ebRemoveSession(id);
  res.json(await state(req));
});

bankApi.post("/bank/enable-banking/sync", member, syncLimiter, async (req, res) => {
  const result = await readEnableBankingNow();
  res.json({ result, ...(await state(req)) });
});

/* ---------- Sans prestataire : fichier de la banque, compte saisi à la main ---------- */

const newAccount = z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(["courant", "carte", "epargne"]), owner: z.string().trim().min(2).max(80), institution: z.string().trim().max(120).nullable().optional(), currency: z.enum(CURRENCIES).nullable().optional() });

/** Crée un compte qu'aucune source n'alimente (opérations importées d'un fichier, ou solde suivi à la main). */
bankApi.post("/bank/accounts", member, async (req, res) => {
  const body = newAccount.extend({ balance: z.number().nullable().optional() }).parse(req.body);
  res.json(await createManualAccount(body, body.balance));
});

/** Solde d'un compte saisi à la main (null : inconnu). */
bankApi.put("/bank/accounts/:id/balance", member, async (req, res) => {
  const { balance } = z.object({ balance: z.number().finite().min(-1e9).max(1e9).nullable() }).parse(req.body);
  res.json(await setManualBalance(String(req.params.id), balance));
});

/** Devise d'un compte saisi à la main, créé dans la mauvaise : ses montants sont relus dans la nouvelle. */
bankApi.put("/bank/accounts/:id/currency", member, async (req, res) => {
  const { currency } = z.object({ currency: z.enum(CURRENCIES) }).parse(req.body);
  const id = String(req.params.id);
  const account = await one<{ source: string }>("SELECT source FROM accounts WHERE id = ?", [id]);
  if (!account) throw new ActionError(404, t("Compte introuvable"));
  // La devise d'un compte alimenté par une banque vient d'elle.
  if (account.source !== "manuel") throw new ActionError(400, t("La devise d'un compte alimenté par une banque est celle que la banque donne."));
  res.json(await changeAccountCurrency(id, currency));
});

/** Opération saisie à la main dans un compte saisi à la main ; sa suppression (elle seule peut être supprimée). */
bankApi.post("/bank/transactions", member, async (req, res) => {
  const body = z
    .object({ accountId: z.string().min(1).max(64), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.number().finite().min(-1e9).max(1e9), label: z.string().trim().min(1).max(255), categoryId: z.string().max(16).nullable().optional() })
    .parse(req.body);
  res.json(await addManualTransaction(body));
});

bankApi.delete("/bank/transactions/:id", member, async (req, res) => {
  res.json(await deleteManualTransaction(String(req.params.id)));
});

/**
 * Import d'un fichier d'opérations (OFX, QIF, CSV), corps brut. `compte` : compte qui les reçoit, ou `nom`,
 * `nature`, `titulaire` (et `devise`, sinon celle du fichier ou du foyer) pour en créer un ; `compteFichier` : lequel des comptes d'un fichier qui en mêle
 * plusieurs ; `appliquer=1` pour écrire (sinon, aperçu de ce qui serait ajouté).
 */
bankApi.post("/bank/import", member, raw({ type: () => true, limit: "12mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ActionError(400, t("Fichier vide"));
  const query = z
    .object({ compte: z.string().max(64).optional(), nom: z.string().max(120).optional(), nature: z.enum(["courant", "carte", "epargne"]).optional(), titulaire: z.string().max(80).optional(), devise: z.enum(CURRENCIES).optional(), compteFichier: z.string().max(64).optional(), appliquer: z.string().optional() })
    .parse(req.query);
  // Texte en UTF-8, sinon l'encodage Windows des anciens exports.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(req.body);
  } catch {
    text = new TextDecoder("windows-1252").decode(req.body);
  }
  res.json(
    await importBankFile(text, {
      accountId: query.compte,
      create: !query.compte && query.nom ? newAccount.parse({ name: query.nom, kind: query.nature ?? "courant", owner: query.titulaire ?? "autre", currency: query.devise }) : undefined,
      fileAccount: query.compteFichier,
      apply: query.appliquer === "1",
    }),
  );
});
