import { z } from "zod";
import { addCryptoEvent, cryptoEvent, cryptoEvents, deleteCryptoEvent, updateCryptoEvent, type CryptoEventRow } from "../crypto-events.ts";
import { cryptoProposals, dismissProposals, noteProposal, openProposal } from "../crypto-proposals.ts";
import { cashFlows } from "../../lib/crypto-moves.ts";
import { EVENT_KIND_INFO, EVENT_KINDS, EVENT_STATUSES, kindOf, unitPrice, validPeriod } from "../../lib/crypto-events.ts";
import { ToolError, change, day, field, longDate, money, readTool, writeTool } from "./registry.ts";
import { locale, t as tr, tk, tn } from "../../lib/i18n.ts";

/* Journal des mouvements crypto du membre : le lire, y ajouter un mouvement, le corriger, le retirer. */

const KINDS_HELP =
  "achat ou vente (crypto contre de la monnaie), echange (une crypto contre une autre), depot ou retrait (monnaie versée sur une plateforme, ou revenue à la banque), " +
  "transfert (crypto déplacée entre deux portefeuilles), staking ou fin-staking (crypto immobilisée, puis rendue), recompense (staking), interets (prêt, compte rémunéré), " +
  "minage, prime (parrainage, airdrop), autre";

const getCryptoEvents = readTool({
  name: "get_crypto_events",
  progress: tk("Lecture des mouvements crypto…"),
  description:
    "Journal des mouvements crypto de l'utilisateur, du plus récent au plus ancien : un récit qu'il tient lui-même (dépôts, achats, ventes, transferts, staking…), pas le relevé complet d'une plateforme. " +
    "events — chaque mouvement : id, date (et end_date s'il résume une période), type, title, asset, quantity, value (devise du foyer), price (cours unitaire noté), unit_price (cours noté ou déduit), fee, platform, " +
    "status (fait, ou attente pour un ordre posé et pas encore exécuté), note. Pour le tenir : add_crypto_event, update_crypto_event, delete_crypto_event. " +
    "proposals — ce que Pécule propose d'y noter et que l'utilisateur n'a encore ni noté ni écarté : une opération bancaire vers une plateforme crypto (origin banque : bank_label, account), " +
    "un solde qui a bougé entre deux synchronisations (origin synchro : entre since et date ; value = la monnaie réellement dépensée ou reçue pour un achat ou une vente, une estimation au cours du jour pour le reste ; price et fee quand le registre de l'exchange a donné le cours d'exécution et les frais exacts — la date est alors celle de l'exécution ; direction in ou out quand l'autre bout n'est pas connu). " +
    "Pour en noter une : add_crypto_event avec proposal_ref, après avoir vérifié avec l'utilisateur ce qui s'est passé ; pour en écarter : dismiss_crypto_proposals. cash — somme des dépôts et des retraits notés au journal (ce n'est pas une plus-value : le journal ne dit pas tout ce qui a été acheté).",
  input: z.object({ limit: z.number().int().min(1).max(500).optional(), status: z.enum(EVENT_STATUSES).optional().describe("Ne rendre que les mouvements dans cet état") }),
  async run({ userId }, { limit, status }) {
    const all = await cryptoEvents(userId);
    const events = all
      .filter((e) => !status || e.status === status)
      .slice(0, limit ?? 60)
      .map(({ origin: _origin, portfolio_id: _portfolio, transaction_id: _operation, ...e }) => ({ ...e, type: kindOf(e.type) ?? e.type, unit_price: unitPrice(e)?.price ?? null }));
    const proposals = (await cryptoProposals(userId)).map((p) => ({
      ref: p.ref,
      origin: p.origin,
      date: p.date,
      ...(p.since ? { since: p.since } : {}),
      type: p.type,
      asset: p.asset,
      quantity: p.quantity,
      value: p.value,
      ...(p.price != null ? { price: p.price, fee: p.fee } : {}),
      platform: p.platform,
      ...(p.fromPlatform ? { from_platform: p.fromPlatform } : {}),
      ...(p.direction ? { direction: p.direction } : {}),
      ...(p.label ? { bank_label: p.label, account: p.account } : {}),
    }));
    return { events, ...(proposals.length ? { proposals } : {}), cash: cashFlows(all) };
  },
});

const fields = {
  date: day.describe("Jour du mouvement ; le premier jour s'il résume une période"),
  end_date: day.nullable().optional().describe("Dernier jour, quand le mouvement résume une période (récompenses cumulées, série de virements) ; null pour un seul jour"),
  type: z.enum(EVENT_KINDS).describe(KINDS_HELP),
  title: z.string().min(2).max(255).describe("Titre court, dans la langue de l'utilisateur (ex. « Achat de 0,02 BTC »)"),
  asset: z.string().max(120).nullable().optional().describe("Crypto concernée, par son symbole (ex. « BTC ») ; la monnaie pour un dépôt ou un retrait"),
  quantity: z.number().nullable().optional().describe("Quantité de cette crypto reçue ou cédée, frais déduits (montant de monnaie pour un dépôt ou un retrait)"),
  value: z.number().nullable().optional().describe("Montant du mouvement, dans la devise du foyer"),
  price: z.number().min(0).nullable().optional().describe("Cours unitaire auquel le mouvement s'est fait, dans la devise du foyer (ex. le cours limite d'un ordre)"),
  fee: z.number().min(0).nullable().optional().describe("Frais, dans la devise du foyer"),
  platform: z.string().max(60).nullable().optional().describe("Plateforme ou portefeuille (ex. « Coinbase ») ; le nom exact d'un portefeuille relié y rattache le mouvement"),
  status: z.enum(EVENT_STATUSES).optional().describe("fait (défaut) ; attente : ordre posé et pas encore exécuté, retrait en cours d'examen"),
  note: z.string().max(4000).nullable().optional().describe("Ce qu'il faut retenir : pourquoi, d'où viennent les fonds, références de l'ordre"),
};

const quantityText = (n: number, asset: string | null | undefined) => `${n.toLocaleString(locale(), { maximumFractionDigits: 10 })}${asset ? ` ${asset}` : ""}`;
const periodText = (date: string, end: string | null | undefined) => (end && end !== date ? tr("du {debut} au {fin}", { debut: longDate(date), fin: longDate(end) }) : longDate(date));
const kindText = (type: string | null) => {
  const kind = kindOf(type);
  return kind ? tr(EVENT_KIND_INFO[kind].label) : (type ?? "—");
};
const statusText = (status: string) => (status === "attente" ? tr("En attente##mouvement") : tr("Fait##mouvement"));

/** Une période qui finit avant de commencer se refuse avant la confirmation, pas après. */
function period(date: string, end: string | null | undefined) {
  if (!validPeriod(date, end)) throw new ToolError("end_date précède date : la fin d'une période ne peut pas précéder son début");
}

type Shown = { date: string; end_date?: string | null; type: string | null; asset?: string | null; quantity?: number | null; value?: number | null; price?: number | null; fee?: number | null; platform?: string | null; status?: string };

/** Ce qu'un mouvement porte, ligne par ligne : c'est ce que le membre confirme. */
function lines(e: Shown): string[] {
  return [
    field(tr("Date"), periodText(e.date, e.end_date)),
    field(tr("Genre##mouvement"), kindText(e.type)),
    e.platform ? field(tr("Plateforme"), e.platform) : null,
    e.quantity != null ? field(tr("Quantité"), quantityText(e.quantity, e.asset)) : e.asset ? field(tr("Crypto"), e.asset) : null,
    e.value != null ? field(tr("Montant"), money(e.value)) : null,
    e.price != null ? field(tr("Cours"), money(e.price)) : null,
    e.fee != null ? field(tr("Frais"), money(e.fee)) : null,
    e.status === "attente" ? statusText("attente") : null,
  ].filter((x): x is string => !!x);
}

const addEvent = writeTool({
  name: "add_crypto_event",
  description:
    "Ajoute un mouvement au journal crypto de l'utilisateur (achat, vente, dépôt, transfert, staking…). Le journal est un récit : un mouvement peut résumer une période (end_date). " +
    "Ne note que ce que l'utilisateur a dit ou ce qu'un outil a rendu : jamais un cours, une quantité ou des frais estimés sans le dire dans la note. " +
    "Un ordre posé et pas encore exécuté se note avec status « attente », puis se met à jour par update_crypto_event quand il passe. Ne change aucune position : le journal raconte, il ne compte pas.",
  input: z.object({ ...fields, proposal_ref: z.string().max(191).optional().describe("ref d'une proposition de get_crypto_events : le mouvement la solde (elle ne sera plus proposée)") }),
  async describe({ userId }, i) {
    period(i.date, i.end_date);
    if (i.proposal_ref && !(await openProposal(userId, i.proposal_ref))) throw new ToolError("Proposition inconnue ou déjà traitée : relis get_crypto_events");
    return { label: tr("Ajouter au journal crypto : « {titre} »", { titre: i.title }), details: [...lines(i), ...(i.proposal_ref ? [tr("D'après une proposition de Pécule")] : [])] };
  },
  async run({ userId }, i) {
    const event = { date: i.date, endDate: i.end_date, type: i.type, title: i.title, asset: i.asset, quantity: i.quantity, value: i.value, price: i.price, fee: i.fee, platform: i.platform, status: i.status, note: i.note };
    const id = i.proposal_ref ? await noteProposal(userId, i.proposal_ref, event, "assistant") : await addCryptoEvent(userId, event, "assistant");
    return `Fait : mouvement ajouté au journal (id ${id}).`;
  },
});

async function existing(userId: number, id: number): Promise<CryptoEventRow> {
  const e = await cryptoEvent(userId, id);
  if (!e) throw new ToolError("Mouvement introuvable : prends son id dans get_crypto_events");
  return e;
}

const updateEvent = writeTool({
  name: "update_crypto_event",
  description:
    "Corrige ou complète un mouvement du journal crypto (event_id = id de get_crypto_events) : seuls les champs donnés changent, null vide un champ. " +
    "Sert aussi à dire qu'un ordre en attente est passé (status « fait », avec sa date, sa quantité, son cours et ses frais).",
  input: z.object({ event_id: z.number().int(), ...z.object(fields).partial().shape }),
  async describe({ userId }, i) {
    const e = await existing(userId, i.event_id);
    const details: string[] = [];
    const after = { ...e, ...Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)) } as CryptoEventRow;
    period(after.date, after.end_date);
    if (i.title !== undefined && i.title !== e.title) details.push(change(tr("Titre"), e.title, i.title));
    if (i.date !== undefined || i.end_date !== undefined) details.push(change(tr("Date"), periodText(e.date, e.end_date), periodText(after.date, after.end_date)));
    if (i.type !== undefined) details.push(change(tr("Genre##mouvement"), kindText(e.type), kindText(i.type)));
    if (i.platform !== undefined) details.push(change(tr("Plateforme"), e.platform ?? "—", i.platform ?? "—"));
    if (i.quantity !== undefined || i.asset !== undefined)
      details.push(change(tr("Quantité"), e.quantity != null ? quantityText(e.quantity, e.asset) : (e.asset ?? "—"), after.quantity != null ? quantityText(after.quantity, after.asset) : (after.asset ?? "—")));
    if (i.value !== undefined) details.push(change(tr("Montant"), e.value != null ? money(e.value) : "—", i.value != null ? money(i.value) : "—"));
    if (i.price !== undefined) details.push(change(tr("Cours"), e.price != null ? money(e.price) : "—", i.price != null ? money(i.price) : "—"));
    if (i.fee !== undefined) details.push(change(tr("Frais"), e.fee != null ? money(e.fee) : "—", i.fee != null ? money(i.fee) : "—"));
    if (i.status !== undefined) details.push(change(tr("État##mouvement"), statusText(e.status), statusText(i.status)));
    if (i.note !== undefined && !i.note) details.push(tr("Note effacée"));
    if (!details.length && i.note == null) throw new ToolError("Rien à changer : donne au moins un champ");
    return { label: tr("Modifier dans le journal crypto : « {titre} »", { titre: e.title }), details };
  },
  async run({ userId }, i) {
    await updateCryptoEvent(userId, i.event_id, { date: i.date, endDate: i.end_date, type: i.type, title: i.title, asset: i.asset, quantity: i.quantity, value: i.value, price: i.price, fee: i.fee, platform: i.platform, status: i.status, note: i.note });
    return "Fait : mouvement mis à jour.";
  },
});

const deleteEvent = writeTool({
  name: "delete_crypto_event",
  description: "Retire un mouvement du journal crypto (event_id = id de get_crypto_events). Ne change aucune position.",
  input: z.object({ event_id: z.number().int() }),
  async describe({ userId }, i) {
    const e = await existing(userId, i.event_id);
    return { label: tr("Supprimer du journal crypto : « {titre} »", { titre: e.title }), details: lines(e) };
  },
  async run({ userId }, i) {
    await deleteCryptoEvent(userId, i.event_id);
    return "Fait : mouvement supprimé.";
  },
});

const dismissProposal = writeTool({
  name: "dismiss_crypto_proposals",
  description:
    "Écarte des propositions du journal crypto (proposal_refs = ref de get_crypto_events) : elles ne seront plus montrées. À faire quand l'utilisateur dit que le mouvement est déjà noté, ou qu'il ne veut pas le noter. Ne retire rien du journal.",
  input: z.object({ proposal_refs: z.array(z.string().max(191)).min(1).max(30) }),
  async describe({ userId }, i) {
    const open = await cryptoProposals(userId);
    const chosen = i.proposal_refs.map((ref) => open.find((p) => p.ref === ref));
    if (chosen.some((p) => !p)) throw new ToolError("Proposition inconnue ou déjà traitée : relis get_crypto_events");
    return {
      label: tn("Écarter {n} proposition du journal crypto", "Écarter {n} propositions du journal crypto", chosen.length),
      details: chosen.map((p) =>
        [longDate(p!.date), kindText(p!.type), p!.quantity != null && p!.origin === "synchro" ? quantityText(p!.quantity, p!.asset) : null, p!.platform, p!.value != null ? money(p!.value) : null, p!.label].filter(Boolean).join(" · "),
      ),
    };
  },
  async run({ userId }, i) {
    const n = await dismissProposals(userId, i.proposal_refs);
    return `Fait : ${n} proposition${n > 1 ? "s" : ""} écartée${n > 1 ? "s" : ""}.`;
  },
});

export const journalCryptoTools = [getCryptoEvents, addEvent, updateEvent, deleteEvent, dismissProposal];
