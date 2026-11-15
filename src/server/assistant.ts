import { householdCurrency, householdTimeZone, region, today } from "./region.ts";
import { isFrance } from "../lib/countries.ts";
import { formatMoney } from "../lib/currencies.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";
import { aiClient, aiEnabled, aiModel, recordUsage } from "./ai.ts";
import { exec, one, q } from "./db.ts";
import { ActionError } from "./actions.ts";
import { invoiceVisible } from "./invoices.ts";
import { documentDetail } from "./documents.ts";
import { z } from "zod";
import { ANTHROPIC_TOOLS, MUTATING_NAMES, WRITE_NAMES, clientEffect, describeWrite, executeWrite, inputError, jsonSchema, progressLabel, runReadTool, type PendingWrite } from "./tools/index.ts";
import { shortDate } from "./tools/registry.ts";
import { dataCoverage, listMemories } from "./tools/analyse.ts";
import { funPrompt } from "./fun.ts";
import { householdSummary } from "./household.ts";
import { dataNames } from "./data-i18n.ts";
import { currentLang, langInfo, t as tr, type Lang } from "../lib/i18n.ts";
import { fold } from "../lib/markdown.ts";
import { CONTRACT_KINDS, OFFER_KINDS } from "../lib/contracts.ts";
import { manualOutline } from "../lib/manual.ts";
import type { ClientEffect } from "../lib/device-settings.ts";

/*
 * Assistant IA de Pécule : Claude (par le fournisseur réglé dans l'appli) avec les outils du registre
 * (src/server/tools). Lectures exécutées directement ; écritures enregistrées dans assistant_actions
 * et soumises à confirmation à l'écran. Réponse en flux (SSE) quand l'écran le demande.
 * La conversation est persistée (append-only) dans assistant_threads.
 */

export const assistantEnabled = aiEnabled;

const MAX_STEPS = 20;
const MAX_MESSAGES = 80;
/** Durée de validité d'une action proposée. */
const ACTION_TTL_MINUTES = 30;
/** Ce que lit l'IA est écrit en français : un montant aussi, dans sa devise. */
const frMoney = (n: number, currency: string = householdCurrency()) => formatMoney(n, currency, "fr-FR");
/** Un foyer en euros garde ses consignes mot pour mot ; un autre y lit sa devise. */
const inEuros = () => householdCurrency() === "EUR";
const frDate = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "date inconnue");

/**
 * Langue de la réponse : celle de Pécule pour ce membre. Les consignes, le référentiel et les résultats des
 * outils restent écrits en français ; seule la réponse change de langue.
 */
export function languagePrompt(lang: Lang): string {
  if (lang === "fr") return "Langue : français.";
  const info = langInfo(lang);
  return (
    `Langue : ${info.french} (${info.label}). L'utilisateur utilise Pécule en ${info.french} : écris toute ta réponse dans cette langue, quelle que soit la langue de tes consignes, de tes outils et de leurs résultats ` +
    `(titres, tableaux, légendes des graphiques et texte qui accompagne une action compris), sur le même ton familier que le tutoiement français (forme informelle de la langue). ` +
    `Traduis les noms de catégories et de postes quand tu les cites, en donnant le nom français entre parenthèses la première fois ; garde tels quels les identifiants, les libellés bancaires, les noms propres et les noms de marchands. ` +
    `Écris les montants et les dates au format habituel de cette langue, ${inEuros() ? "toujours en euros" : `toujours dans la devise du foyer (${householdCurrency()})`}. Si l'utilisateur t'écrit dans une autre langue, réponds dans la sienne.`
  );
}

async function systemPrompt(userId: number): Promise<Anthropic.TextBlockParam[]> {
  const cats = await q<{ id: string; name: string; poste: string | null; kind: string }>("SELECT id, name, poste, kind FROM categories ORDER BY sort_order, id");
  const user = await one<{ name: string }>("SELECT name FROM users WHERE id = ?", [userId]);
  const stable = `Tu es l'assistant de Pécule, l'application de suivi bancaire et patrimonial du foyer (sa composition est donnée plus bas, « Foyer »). Tu réponds dans la langue de l'utilisateur, indiquée plus bas (« Langue »), le français par défaut, et tu tutoies toujours l'utilisateur (« tu », « ton foyer », « vos » seulement pour parler de plusieurs membres ensemble), sans passer au vouvoiement.

Façon de répondre :
- Réponds complètement à la question posée, sans délayer : d'abord la réponse (le chiffre, la conclusion), puis le détail utile, puis les limites éventuelles et, si elle a un intérêt, une proposition de suite.
- Mise en forme Markdown, pour qu'on voie l'essentiel d'un coup d'œil :
  - **gras** pour le chiffre ou la conclusion qui répond à la question ; ==surlignage== pour le seul point à ne pas manquer (une fois par réponse au plus) ;
  - couleur, selon ce que cela signifie pour le foyer et non selon le signe : {+texte+} pour ce qui est favorable (économie, dépense en baisse, revenu ou patrimoine en hausse), {-texte-} pour ce qui est défavorable (dépassement, dépense en hausse, découvert, retard). Réserve-la aux écarts et aux évolutions (« {-+ 182 €-} par rapport à octobre », « {+− 12 %+} sur les courses »), jamais à un montant neutre ;
  - encadrés, une ou deux fois par réponse au plus, sur leur propre paragraphe : une ligne « > [!IMPORTANT] » (ce qu'il faut retenir), « > [!WARNING] » (un risque, une échéance proche, un découvert), « > [!TIP] » (une piste d'économie, une action conseillée) ou « > [!NOTE] » (une hypothèse, une limite des données), puis le texte sur les lignes suivantes, chacune commençant par « > ». N'écris pas de titre dans l'encadré : l'écran l'ajoute ;
  - tableaux Markdown (5 colonnes au plus) pour comparer plusieurs lignes chiffrées (mois, postes, années, biens) : montants alignés à droite (« ---: »), dernière ligne « **Total** » quand il y en a un, écarts en couleur ;
  - listes à puces ou numérotées ; titres « ### » seulement pour une réponse longue en plusieurs parties.
  Une réponse courte reste courte : une phrase avec le chiffre en gras vaut mieux qu'un tableau d'une ligne ou qu'un encadré de plus. Montants au format français (${inEuros() ? "1 234,56 €" : frMoney(1234.56)}). L'écran est un téléphone, un panneau latéral ou une fenêtre en plein écran.
- Un graphique aide à voir une évolution (plusieurs mois ou années) ou à comparer des postes : appelle show_chart avec des chiffres issus de tes outils ; il s'affiche sous ta réponse. Pas de graphique pour deux ou trois valeurs.

Méthode :
- Tes données viennent uniquement de tes outils : ne devine jamais un montant. Appelle plusieurs outils à la fois quand c'est utile.
- Total, moyenne, évolution, comparaison, « où part l'argent » : analyze_spending (exhaustif, mêmes définitions que les écrans, regroupement par mois, catégorie, poste, marchand, nature ou compte). N'additionne jamais à la main une liste partielle d'opérations. search_transactions sert à voir les opérations elles-mêmes ; sum_matching y donne la somme de toutes celles qui correspondent.
- Pour savoir ce qu'est un achat (Amazon, Cdiscount…), lis les factures reliées (champ invoices de search_transactions, get_transaction, search_invoices) avant de dire que tu ne sais pas : les articles y sont.
- Pour le contexte d'une question (bail, contrat, prêt, voyage, travaux, impôts), cherche aussi dans le coffre (search_documents) et tiens compte de « Ce que tu sais déjà ».
- Avant d'affirmer qu'une donnée n'existe pas, regarde « Données disponibles » et dis précisément ce qui manque et depuis quand. Ne propose jamais une synchronisation pour retrouver un historique ancien : la banque ne le transmet pas.
- Vérifie tes chiffres avant de répondre (période exacte, signes, doublons, mouvements internes exclus) ; si une hypothèse est nécessaire, énonce-la.
- Les débits sont négatifs dans les opérations ; analyze_spending renvoie les dépenses en positif, nettes des remboursements classés en dépense. Les catégories de type « interne » (C1, C2) sont des mouvements entre comptes du foyer : ni dépense ni revenu. Les opérations « à classer » n'ont pas de catégorie. Le patrimoine affiché est celui de l'utilisateur connecté : un bien ou un crédit commun y compte pour la quote-part enregistrée (un bien détenu à deux pour moitié, un prêt solidaire en entier).

Mémoire : « Ce que tu sais déjà » liste les faits retenus des conversations précédentes. Quand l'utilisateur te donne une information durable (contexte de vie, ce qu'est un prélèvement ou un marchand, une préférence), retiens-la avec remember sans le lui demander, et dis-le en quelques mots. forget_memory si un fait devient faux.

Actions : tu peux classer des opérations (avec une note), noter des opérations sans changer leur catégorie (set_transaction_note), créer des règles de classement, relier ou détacher une facture, corriger une facture ou le classement d'un document, ajouter ou cocher une tâche de l'échéancier, modifier ou ajouter un engagement du budget (update_commitment, add_commitment), modifier un bien immobilier — valeur estimée après une estimation ou une simulation, loyer, charges, bail (update_property) —, modifier ou ajouter un revenu du foyer — salaire, bonus de l'année, loyer perçu (update_income_source, add_income_source, les ids viennent de get_budget) —, gérer le référentiel des catégories — renommer, déplacer vers un autre poste, créer, renommer un poste (update_category, create_category, rename_poste) —, mettre à jour un placement ou une position crypto, et lancer une synchronisation. Avant de modifier, lis la valeur actuelle avec l'outil de lecture correspondant pour que la confirmation montre l'écart. Chaque action passe par un écran de confirmation : appelle directement l'outil d'écriture quand l'utilisateur le demande ou l'accepte, sans redemander son accord dans le texte ; regroupe les opérations d'une même catégorie en un seul appel. Pour classer, appuie-toi sur l'historique (search_transactions avec un libellé proche), les factures reliées et le référentiel ci-dessous ; en cas de doute, propose ton hypothèse au lieu d'agir. Tu ne peux ni faire de virement ni rien modifier en dehors de Pécule.

Factures : un bloc « [Pièce jointe] » signale une facture que l'utilisateur vient de déposer ; elle est déjà enregistrée et lue. Si elle est déjà reliée à une opération, dis-le en une phrase (opération, catégorie appliquée) et mentionne la garantie s'il y en a une. Sinon appelle find_payment_candidates : une seule candidate au même montant et au même marchand → propose link_invoice ; plusieurs → présente-les brièvement (date, libellé, montant, compte) et demande laquelle ; aucune → explique pourquoi (achat récent pas encore débité : les cartes à débit différé sont prélevées le 1er du mois suivant ; montant différent ; autre moyen de paiement) et, si l'utilisateur confirme qu'elle a été payée hors des comptes suivis, propose update_invoice avec no_payment_expected. Si la lecture est incomplète (marchand « Inconnu », pas de date ou de total), demande ce qui manque et complète avec update_invoice. Bien durable neuf sans garantie renseignée : propose la garantie légale (2 ans après l'achat).

Documents : le coffre range avis d'impôt, contrats, baux, actes, prêts, diagnostics, relevés et les fiches reprises de Notion (search_documents puis get_document pour lire le texte). Un document déposé (bloc « [Pièce jointe] » avec « Document n° ») est déjà rangé : confirme en une phrase ce que c'est, signale une échéance utile et propose un rappel (add_task) si une date compte (fin de bail, DPE, préavis, paiement). Échéancier : list_agenda (tâches, jalons, mensualités, garanties, documents qui expirent, calendrier fiscal) ; add_task pour un rappel, complete_task pour cocher. Ne recopie jamais d'IBAN, de numéro de compte, de numéro de Sécurité sociale ni d'identifiant fiscal.

Comparaison de contrats : quand l'utilisateur demande si une offre vaut mieux que ce qu'il a (devis, proposition ou nouveau contrat d'électricité, de gaz, d'assurance, de box, de mobile, de crédit ou de location d'un véhicule…), ou veut départager plusieurs offres, appelle compare_contracts : les documents déposés ou cités en offer_document_ids, le contrat en cours par commitment_id (budget) et current_document_id (coffre). Sans contrat en cours indiqué, l'outil propose des candidats : choisis celui de même nature et rappelle-le ; s'il n'y en a pas, demande le contrat, le dernier avis d'échéance ou la dernière facture, ou compare les offres entre elles. Un devis rangé par erreur dans les factures se lit par get_invoice.
- Compare à périmètre égal, et dis sur quelle base : pour l'énergie, la même consommation annuelle (celle de la dernière facture ou du contrat ; à défaut demande-la) et la même puissance, coût annuel = abonnement + consommation × prix du kWh, toutes taxes comprises ; pour une assurance, les mêmes garanties, plafonds et franchises ; pour un véhicule, la même durée, le même kilométrage et le coût total (apport, loyers, option d'achat, frais) ; pour un crédit, le coût total et le taux annuel effectif global.
- Ramène tout à un coût sur douze mois : compte les frais de dossier, de mise en service et de résiliation, et distingue un prix promotionnel du prix qui suit. Pour le contrat en cours, pars de ce qui est réellement prélevé (« paid », surtout le dernier prélèvement) plutôt que du prix du jour de la signature ; si « partial_history » est vrai, le total ne couvre pas une année.
- Réponds d'abord par le verdict en une phrase (oui, non, ou « moins cher mais couvre moins »), l'écart sur douze mois en gras et en couleur. Puis un tableau : première colonne « Critère », une colonne « Contrat actuel », une colonne par offre ; une ligne par critère qui compte (prix par mois, garanties ou caractéristiques principales, franchises, durée d'engagement et préavis, frais, prix après la promotion) et, en dernière ligne, « **Total sur 12 mois** ». « — » pour ce que le document ne dit pas : n'invente ni garantie ni prix.
- Ensuite, en quelques lignes : ce que l'offre a en moins ou en plus (une garantie absente, une franchise plus haute, un prix indexé ou révisable se disent, même si elle est moins chère), les hypothèses et ce qui manque pour trancher (encadré « > [!NOTE] »). Si une donnée décisive manque, dis laquelle au lieu de conclure.
- Si l'offre est meilleure, donne la marche à suivre : dernier jour pour résilier (« cancel_before » ; « assumed_yearly » signale une échéance déduite d'une reconduction annuelle, à vérifier), et propose un rappel (add_task). Une fois le changement fait, propose de mettre le budget à jour : update_commitment (statut resilie, end_date) pour l'ancien, add_commitment pour le nouveau.${
    isFrance(region().country)
      ? "\n- En France, rappelle la règle qui s'applique, à vérifier dans le contrat : assurances auto, habitation et complémentaire santé résiliables à tout moment après un an, le nouvel assureur s'occupant des démarches ; assurance emprunteur changeable à tout moment, à garanties équivalentes ; électricité et gaz d'un particulier : changement de fournisseur sans frais ni préavis ; box et mobile : frais de résiliation tant que court une période d'engagement."
      : ""
  }

Situation : biens immobiliers (get_property), budget du foyer avec engagements récurrents et reste à vivre (get_budget, update_commitment), impôts (get_taxes), retraite (get_retirement, privée), revenus salariaux lus dans les fiches de paie (get_payslips, privé), projections (get_projections), mouvements crypto (get_crypto_events). Les fiches d'analyse reprises de Notion sont dans le coffre (search_documents).

Aide sur Pécule : tu es aussi le guide de l'appli. Quand l'utilisateur demande comment faire quelque chose dans Pécule, où se trouve un écran, un bouton ou un réglage, ce que veut dire un chiffre affiché, ou ce que Pécule sait faire, lis le manuel (read_manual, par mots-clés ou par les identifiants du sommaire ci-dessous) avant de répondre.
- Réponds par les étapes, courtes et numérotées s'il y en a plusieurs, avec les noms de menus et de boutons exactement comme le manuel les écrit (ce sont ceux de son écran), en gras. Ne décris jamais un menu, un bouton ou un réglage de mémoire ; si le manuel n'en parle pas, dis que tu ne sais pas plutôt que d'inventer.
- Donne le lien vers l'écran ou le réglage : [Réglages → Apparence](/reglages/apparence). Seules les adresses de l'appli (elles commencent par « / ») sont cliquables ; reprends celles du manuel et de get_settings, n'en invente pas. Pour en savoir plus, renvoie à l'article : [nom de l'article](/manuel/identifiant).
- Si l'utilisateur veut que tu fasses le réglage à sa place et que tu en as l'outil, fais-le (une confirmation lui est montrée) : update_settings (langue, équivalences amusantes ; pour le foyer : jour retenu pour les achats par carte, écrans affichés), set_device_settings (sur l'appareil qu'il utilise : clair ou sombre, couleur, thèmes de l'année, densité, montants masqués, ouverture instantanée), set_balance_alert (solde bas), update_account (nom d'un compte, compte masqué ou hors statistiques), set_envelope, set_goal. get_settings donne les valeurs actuelles et l'adresse de chaque réglage.
- Ce qui touche à la sécurité ou à un service extérieur ne se règle qu'à l'écran — clés d'accès, membres, connexion d'une banque, fournisseur d'IA, notifications de l'appareil, sauvegarde, pays et devise du foyer, mode démo : explique la marche à suivre et donne le lien. Un réglage réservé à l'administrateur du foyer se dit.
- Une question sur ses chiffres (« combien ai-je dépensé ») reste une question de données : le manuel ne sert qu'à expliquer l'appli.
Sommaire du manuel (identifiant — titre) :
${manualOutline()}

Un bloc « [Contexte] » indique l'écran ouvert par l'utilisateur : « cette opération », « cette facture », « ce mois » désignent l'élément indiqué.

Référentiel des catégories (id — nom — poste — type) :
${cats.map((c) => `${c.id} — ${c.name} — ${c.poste ?? ""} — ${c.kind}`).join("\n")}`;
  const [coverage, memories, fun, household] = await Promise.all([
    dataCoverage(userId).catch(() => ""),
    listMemories(userId).catch(() => []),
    funPrompt(userId).catch(() => null),
    householdSummary(userId).catch(() => null),
  ]);
  // Noms des catégories et des postes tels que l'écran les affiche dans la langue du membre : l'assistant emploie les mêmes.
  const lang = currentLang();
  const translated = lang === "fr" ? {} : await dataNames(lang).catch(() => ({}) as Record<string, string>);
  const names = Object.keys(translated).length
    ? `Noms des catégories et des postes dans la langue de l'utilisateur (nom du référentiel → nom à employer dans ta réponse ; les identifiants ne changent pas) :\n${Object.entries(translated)
        .map(([fr, tr2]) => `${fr} → ${tr2}`)
        .join("\n")}`
    : null;
  const dynamic = [
    `Utilisateur connecté : ${user?.name ?? "?"}. Date du jour : ${today()}.`,
    household,
    languagePrompt(currentLang()),
    names,
    coverage && `Données disponibles :\n${coverage}`,
    `Ce que tu sais déjà (mémoire, n° entre crochets) :\n${memories.length ? memories.map((m) => `- [${m.id}] ${m.content}`).join("\n") : "(rien pour l'instant)"}`,
    fun,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ];
}

/* ---------- Conversation ---------- */

export type DisplayItem = {
  role: "user" | "assistant" | "action";
  text: string;
  details?: string[];
  status?: "done" | "declined" | "error" | "expired";
  attachments?: { id: number; name: string; type?: "invoice" | "document" }[];
  /** Élément ouvert à l'écran quand le message a été écrit. */
  context?: string;
  /** Coût de la réponse (euros). */
  cost?: number;
  /** Graphiques demandés par Claude (show_chart), affichés sous la réponse. */
  charts?: Chart[];
  /** Moment du message (ISO) ; absent des conversations antérieures. */
  at?: string;
};

/* ---------- Graphiques dans la réponse (outil propre à l'assistant) ---------- */

const chartInput = z.object({
  type: z.enum(["bar", "stacked_bar", "line", "horizontal_bar"]).describe("bar : comparaison ; stacked_bar : composition ; line : évolution ; horizontal_bar : classement de libellés longs"),
  title: z.string().max(120),
  unit: z.enum(["eur", "pct", "count"]).optional().describe("Défaut : eur (un montant, dans la devise du foyer)"),
  labels: z.array(z.string().max(40)).min(1).max(36).describe("Abscisses (mois « 2026-03 », années, postes…)"),
  series: z
    .array(z.object({ name: z.string().max(40), values: z.array(z.number().nullable()) }))
    .min(1)
    .max(8)
    .describe("Une série par couleur ; autant de valeurs que de libellés (null si absent)"),
  note: z.string().max(200).optional().describe("Précision affichée sous le graphique, en mots simples (période, périmètre) ; jamais le nom d'un outil"),
});
export type Chart = z.output<typeof chartInput>;
const SHOW_CHART: Anthropic.Tool = {
  name: "show_chart",
  description:
    "Affiche un graphique sous ta réponse (barres, barres empilées, courbe, barres horizontales), avec des chiffres obtenus par tes outils. Pour une évolution sur plusieurs mois ou années, ou une comparaison de postes. Pas pour deux ou trois valeurs.",
  input_schema: jsonSchema(chartInput),
};
const ASSISTANT_TOOLS: Anthropic.Tool[] = [...ANTHROPIC_TOOLS, SHOW_CHART];

function parseChart(input: unknown): Chart {
  const c = chartInput.parse(input);
  for (const s of c.series) if (s.values.length !== c.labels.length) throw new Error(`La série « ${s.name} » a ${s.values.length} valeurs pour ${c.labels.length} libellés`);
  return c;
}
type Write = PendingWrite & { actionId: string; fingerprint: string };
type Pending = { reads: Anthropic.ToolResultBlockParam[]; writes: Write[] };
type Thread = {
  id: string;
  userId: number;
  /** Titre donné par le membre ; sinon la conversation porte sa première question. */
  title: string | null;
  pinned: boolean;
  messages: Anthropic.MessageParam[];
  display: DisplayItem[];
  pending: Pending | null;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

/** Titre affiché d'une conversation : celui du membre, sinon sa première question. */
const threadTitle = (title: string | null, display: DisplayItem[]) =>
  title?.trim() || (display.find((d) => d.role === "user")?.text ?? tr("Conversation")).replace(/\s+/g, " ").trim().slice(0, 120);

export type AssistantEvent = { type: "text"; text: string } | { type: "step"; label: string };
type Emit = (e: AssistantEvent) => void;

async function loadThread(userId: number, id?: string): Promise<Thread> {
  if (id) {
    const row = await one<{ id: string; title: string | null; pinned: number; messages: string; display: string; pending: string | null; input_tokens: number; output_tokens: number; cost: number | null }>(
      `SELECT t.*, (SELECT SUM(u.cost_eur) FROM ai_usage u WHERE u.thread_id = t.id) AS cost FROM assistant_threads t WHERE t.id = ? AND t.user_id = ?`,
      [id, userId],
    );
    if (row)
      return {
        id: row.id,
        userId,
        title: row.title,
        pinned: !!row.pinned,
        messages: JSON.parse(row.messages),
        display: JSON.parse(row.display),
        pending: row.pending ? JSON.parse(row.pending) : null,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cost: Number(row.cost ?? 0),
      };
  }
  return { id: randomUUID(), userId, title: null, pinned: false, messages: [], display: [], pending: null, inputTokens: 0, outputTokens: 0, cost: 0 };
}

async function saveThread(t: Thread) {
  await exec(
    `INSERT INTO assistant_threads (id, user_id, messages, display, pending, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE messages = VALUES(messages), display = VALUES(display), pending = VALUES(pending),
       input_tokens = VALUES(input_tokens), output_tokens = VALUES(output_tokens)`,
    [t.id, t.userId, JSON.stringify(t.messages), JSON.stringify(t.display), t.pending ? JSON.stringify(t.pending) : null, t.inputTokens, t.outputTokens],
  );
}

export const publicThread = (t: Thread) => ({
  threadId: t.id,
  title: threadTitle(t.title, t.display),
  pinned: t.pinned,
  display: t.display,
  // Anciennes conversations (avant la table des actions) : pas d'identifiant d'action.
  pending: t.pending ? t.pending.writes.map((w) => ({ id: w.actionId ?? null, label: w.label, details: w.details })) : null,
  cost: Math.round(t.cost * 10000) / 10000,
});
export type PublicThread = ReturnType<typeof publicThread> & { effects?: ClientEffect[] };

const toolResult = (id: string, content: unknown, isError = false): Anthropic.ToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  content: (typeof content === "string" ? content : JSON.stringify(content)).slice(0, 30_000),
  ...(isError ? { is_error: true } : {}),
});

/* ---------- Actions proposées (table assistant_actions) ---------- */

/** Empreinte d'une action : outil + paramètres (clés triées). */
function fingerprint(name: string, input: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
  return createHash("sha256").update(JSON.stringify([name, canon(input)])).digest("hex");
}

async function proposeActions(t: Thread, writes: PendingWrite[]): Promise<Write[]> {
  const out: Write[] = [];
  for (const w of writes) {
    const fp = fingerprint(w.name, w.input);
    // Même action déjà faite récemment (Claude qui repropose ce qui vient d'être fait) : on le signale.
    const dup = await one<{ at: number | null }>(
      `SELECT UNIX_TIMESTAMP(decided_at) AS at FROM assistant_actions
       WHERE user_id = ? AND fingerprint = ? AND status = 'done' AND decided_at > NOW() - INTERVAL 1 DAY ORDER BY decided_at DESC LIMIT 1`,
      [t.userId, fp],
    ).catch(() => undefined);
    // Affiché à l'écran avec l'action : dans la langue du membre (« le 07/11 à 14:32 » en français).
    // Jour et heure dans le fuseau du foyer.
    const at = dup?.at ? new Date(Number(dup.at) * 1000) : null;
    const warning = at
      ? tr("Attention : action identique déjà faite le {jour} à {heure}", { jour: shortDate(today(at)), heure: at.toLocaleTimeString("fr-FR", { timeZone: householdTimeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })
      : tr("Attention : action identique déjà faite récemment");
    const details = dup ? [...w.details, warning] : w.details;
    const actionId = randomUUID();
    await exec(
      `INSERT INTO assistant_actions (id, thread_id, user_id, tool_use_id, tool, input, label, details, fingerprint, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL ${ACTION_TTL_MINUTES} MINUTE)`,
      [actionId, t.id, t.userId, w.id, w.name, JSON.stringify(w.input ?? {}), w.label.slice(0, 255), JSON.stringify(details), fp],
    );
    out.push({ ...w, details, actionId, fingerprint: fp });
  }
  return out;
}

const settle = (actionId: string | undefined, status: string, result?: string) =>
  actionId
    ? exec("UPDATE assistant_actions SET status = ?, result = ?, decided_at = COALESCE(decided_at, NOW()) WHERE id = ?", [status, result?.slice(0, 4000) ?? null, actionId])
    : Promise.resolve();

/**
 * Passe l'action de « pending » à « running » de façon atomique (un double clic ne l'exécute pas
 * deux fois), seulement si elle est encore valide et que ses paramètres sont ceux qui ont été montrés.
 */
async function claim(t: Thread, w: Write): Promise<"ok" | "expired"> {
  if (!w.actionId) return "ok";
  const r = await exec(
    `UPDATE assistant_actions SET status = 'running', decided_at = NOW()
     WHERE id = ? AND thread_id = ? AND user_id = ? AND status = 'pending' AND expires_at > NOW() AND fingerprint = ?`,
    [w.actionId, t.id, t.userId, fingerprint(w.name, w.input)],
  );
  if (r.affectedRows === 1) return "ok";
  const row = await one<{ status: string; expired: number }>("SELECT status, expires_at <= NOW() AS expired FROM assistant_actions WHERE id = ?", [w.actionId]);
  if (row?.status === "pending" && row.expired) {
    await settle(w.actionId, "expired");
    return "expired";
  }
  throw new ActionError(409, tr("Cette action est déjà en cours de traitement ou a changé : recharge la conversation."));
}

/* ---------- Boucle ---------- */

/**
 * Copie des messages avec un point de cache sur le dernier bloc : chaque étape relit la conversation
 * déjà envoyée au tarif du cache au lieu du plein tarif (les messages stockés restent intacts).
 */
function withCacheMarker(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages.at(-1);
  if (!last || typeof last.content === "string" || !last.content.length) return messages;
  const blocks = [...last.content];
  const tail = blocks[blocks.length - 1];
  if (tail.type === "thinking" || tail.type === "redacted_thinking") return messages;
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: "ephemeral" } } as typeof tail;
  return [...messages.slice(0, -1), { ...last, content: blocks } as Anthropic.MessageParam];
}

/** Boucle Claude : exécute les lectures, s'arrête sur une écriture (confirmation) ou sur la réponse finale. */
/** Vrai pendant une tâche de fond lancée sans personne devant l'écran (voir `runUnattended`). */
const unattended = new AsyncLocalStorage<boolean>();
/** Exécute une conversation de fond : les outils qui modifient des données sans confirmation y sont refusés. */
export const runUnattended = <T>(fn: () => Promise<T>): Promise<T> => unattended.run(true, fn);

async function runLoop(t: Thread, emit?: Emit) {
  const system = await systemPrompt(t.userId);
  let cost = 0;
  const charts: Chart[] = [];
  const finish = (item: DisplayItem) => t.display.push({ ...item, at: new Date().toISOString(), cost: Math.round(cost * 10000) / 10000, ...(charts.length ? { charts: charts.splice(0) } : {}) });
  // Réponse déjà écrite pendant la boucle : Claude rédige parfois toute sa réponse puis, dans le même tour, demande
  // un graphique ou retient un fait, et n'a plus rien à ajouter au tour suivant. Ce texte fait partie de la réponse.
  // Une annonce avant une lecture (« je regarde tes opérations ») n'est pas gardée — sauf si rien d'autre n'a été écrit.
  const written: string[] = [];
  let announced = "";
  const answer = (text: string) => [...written, text].filter(Boolean).join("\n\n");
  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = aiClient().messages.stream({
      model: aiModel(),
      max_tokens: 32000,
      system,
      tools: ASSISTANT_TOOLS,
      messages: withCacheMarker(t.messages),
      thinking: { type: "adaptive" },
      output_config: { effort: env.AI_ASSISTANT_EFFORT },
    });
    if (emit) {
      let thinking = false;
      stream.on("thinking", () => {
        if (thinking) return;
        thinking = true;
        emit({ type: "step", label: tr("Réflexion…") });
      });
      stream.on("text", (delta) => {
        thinking = false;
        emit({ type: "text", text: delta });
      });
    }
    const response = await stream.finalMessage();
    const u = response.usage;
    t.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    t.outputTokens += u.output_tokens;
    const c = await recordUsage("assistant", aiModel(), u, t.id);
    cost += c;
    t.cost += c;
    t.messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") return finish({ role: "assistant", text: tr("Je ne peux pas répondre à cette demande.") });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason === "tool_use" && uses.length) {
      if (emit && text) emit({ type: "text", text: "\n\n" });
      const reads = uses.filter((u) => !WRITE_NAMES.has(u.name) && u.name !== "show_chart");
      const chartResults = uses
        .filter((u) => u.name === "show_chart")
        .map((u) => {
          try {
            charts.push(parseChart(u.input));
            return toolResult(u.id, "Graphique affiché sous ta réponse.");
          } catch (e) {
            return toolResult(u.id, inputError(e), true);
          }
        });
      const writes = uses.filter((u) => WRITE_NAMES.has(u.name));
      if (text && !writes.length) {
        if (reads.every((u) => MUTATING_NAMES.has(u.name))) written.push(text);
        else announced = text;
      }
      if (emit) for (const r of reads) emit({ type: "step", label: tr(progressLabel(r.name)) });
      const readResults = [
        ...chartResults,
        ...(await Promise.all(
          reads.map(async (u) => {
            try {
              // Tâche de fond (résumé du lundi) : rien n'est retenu ni oublié sans le membre devant l'écran.
              if (unattended.getStore() && MUTATING_NAMES.has(u.name)) return toolResult(u.id, "Indisponible dans une tâche de fond : à faire dans une conversation avec l'utilisateur.", true);
              return toolResult(u.id, await runReadTool({ userId: t.userId }, u.name, u.input));
            } catch (e) {
              return toolResult(u.id, inputError(e), true);
            }
          }),
        )),
      ];
      if (writes.length) {
        if (emit) emit({ type: "step", label: tr("Préparation de l'action…") });
        const described = await Promise.all(writes.map((w) => describeWrite({ userId: t.userId }, w)));
        const invalid = described.filter((d) => d.invalid).map((d) => toolResult(d.id, d.invalid, true));
        const valid = described.filter((d) => !d.invalid);
        if (!valid.length) {
          t.messages.push({ role: "user", content: [...readResults, ...invalid] });
          continue;
        }
        t.pending = { reads: [...readResults, ...invalid], writes: await proposeActions(t, valid) };
        if (answer(text)) finish({ role: "assistant", text: answer(text) });
        return;
      }
      t.messages.push({ role: "user", content: readResults });
      continue;
    }
    return finish({ role: "assistant", text: answer(text) || announced || (response.stop_reason === "max_tokens" ? tr("Réponse trop longue, interrompue.") : "…") });
  }
  finish({ role: "assistant", text: answer(tr("Je n'ai pas réussi à terminer en un nombre raisonnable d'étapes. Reformule ou découpe la demande.")) });
}

/**
 * Résout l'action en attente (acceptée ou refusée) et prépare les résultats d'outils. `effects` reçoit ce que
 * l'écran doit faire après une action exécutée (réglage de l'appareil à appliquer, identité à relire).
 */
async function resolvePending(t: Thread, approve: boolean, reason?: string, effects?: ClientEffect[]): Promise<Anthropic.ToolResultBlockParam[]> {
  if (!t.pending) return [];
  const results = [...t.pending.reads];
  for (const w of t.pending.writes) {
    if (!approve) {
      await settle(w.actionId, "declined");
      results.push(toolResult(w.id, reason ?? "Refusé par l'utilisateur : ne pas réessayer sans nouvelle demande."));
      t.display.push({ role: "action", text: w.label, details: w.details, status: "declined" });
      continue;
    }
    if ((await claim(t, w)) === "expired") {
      results.push(toolResult(w.id, "Action expirée (confirmée trop tard) : rien n'a été fait. La reproposer si l'utilisateur le souhaite toujours.", true));
      t.display.push({ role: "action", text: w.label, details: w.details, status: "expired" });
      continue;
    }
    try {
      const out = await executeWrite({ userId: t.userId }, w, "assistant");
      await settle(w.actionId, "done", out);
      const effect = clientEffect(w);
      if (effect) effects?.push(effect);
      results.push(toolResult(w.id, out));
      t.display.push({ role: "action", text: w.label, details: w.details, status: "done" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await settle(w.actionId, "error", msg);
      results.push(toolResult(w.id, `Échec : ${msg}`, true));
      t.display.push({ role: "action", text: w.label, details: w.details, status: "error" });
    }
  }
  t.pending = null;
  return results;
}

/* ---------- Pièces jointes et contexte ---------- */

/** Types de documents qui se comparent : une offre, ou un contrat en cours. */
const COMPARABLE_KINDS = new Set<string>([...OFFER_KINDS, ...CONTRACT_KINDS]);

export type ScreenContext = { path: string; screen?: string; entity?: { type: string; id: string; label?: string } };

async function attachmentBlocks(userId: number, invoiceIds: number[], documentIds: number[]) {
  const blocks: Anthropic.TextBlockParam[] = [];
  const attachments: { id: number; name: string; type: "invoice" | "document" }[] = [];
  for (const id of invoiceIds) {
    const i = await one<{ id: number; merchant: string; title: string; invoice_date: string | null; total: number | null; currency: string; warranty_until: string | null; no_match: number; file_name: string | null; items: number; txs: number }>(
      `SELECT i.id, i.merchant, i.title, i.invoice_date, i.total, i.currency, i.warranty_until, i.no_match, i.file_name,
              (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS items,
              (SELECT COUNT(*) FROM invoice_transactions it WHERE it.invoice_id = i.id) AS txs
       FROM invoices i WHERE i.id = ? AND ${invoiceVisible(userId)}`,
      [id],
    );
    if (!i) throw new ActionError(404, tr("Facture n° {id} introuvable", { id }));
    const incomplete = i.merchant === "Inconnu" || !i.invoice_date || i.total == null;
    const payment = i.txs ? `déjà reliée à ${i.txs} opération(s)` : i.no_match ? "aucune opération attendue" : "pas encore reliée à une opération";
    blocks.push({
      type: "text",
      text:
        `[Pièce jointe] Facture n° ${i.id} déposée à l'instant (fichier « ${i.file_name ?? "?"} »), enregistrée dans Pécule : ${i.merchant} · « ${i.title} » · ${frDate(i.invoice_date)}` +
        `${i.total != null ? ` · ${frMoney(Number(i.total), i.currency)}` : " · total inconnu"} · ${i.items} article(s) · garantie : ${i.warranty_until ? `jusqu'au ${frDate(i.warranty_until)}` : "non renseignée"} · paiement : ${payment}` +
        `${incomplete ? " · lecture automatique incomplète" : ""}.`,
    });
    attachments.push({ id: i.id, name: i.title || i.file_name || tr("Facture {id}", { id: i.id }), type: "invoice" });
  }
  for (const id of documentIds) {
    const d = await documentDetail(userId, id);
    if (!d) throw new ActionError(404, tr("Document n° {id} introuvable", { id }));
    const facts = d.facts.map((f) => `${f.label} : ${f.value}`).join(" ; ");
    blocks.push({
      type: "text",
      text:
        `[Pièce jointe] Document n° ${d.id} déposé à l'instant (fichier « ${d.file_name ?? "?"} ») et rangé dans le coffre : « ${d.title} » · type ${d.kind} · domaine ${d.domain}` +
        ` · date ${frDate(d.doc_date)}${d.expires_at ? ` · échéance ${frDate(d.expires_at)}` : ""}${d.summary ? `\nRésumé : ${d.summary}` : ""}${facts ? `\nFaits clés : ${facts}` : ""}` +
        `\n(texte complet : get_document ; corriger le classement : update_document ; ajouter un rappel : add_task${COMPARABLE_KINDS.has(d.kind) ? " ; le comparer à un contrat en cours ou à une autre offre : compare_contracts" : ""})`,
    });
    attachments.push({ id: d.id, name: d.title, type: "document" });
  }
  return { blocks, attachments };
}

function contextBlock(c: ScreenContext): { block: Anthropic.TextBlockParam; label?: string } {
  const where = `${c.screen ? `l'écran « ${c.screen} »` : "un écran"} (${c.path})`;
  const what = c.entity ? ` ; élément ouvert : ${c.entity.type} id=${c.entity.id}${c.entity.label ? ` (${c.entity.label})` : ""}` : "";
  return { block: { type: "text", text: `[Contexte] L'utilisateur est sur ${where}${what}.` }, label: c.entity?.label };
}

/** Message dicté en mode vocal : la réponse sera lue à voix haute, elle doit donc se dire, pas se lire. */
const VOICE_BLOCK: Anthropic.TextBlockParam = {
  type: "text",
  text:
    "[Mode vocal] L'utilisateur te parle et ta réponse sera lue à voix haute. Réponds comme à l'oral : deux à quatre phrases courtes, la réponse d'abord, " +
    `en texte brut uniquement : aucun astérisque, aucun gras, aucun titre, aucun tableau, aucune liste, aucun encadré, aucune couleur, aucun surlignage, aucun graphique (pas de show_chart). Montants arrondis à ${inEuros() ? "l'euro" : "l'unité"}, dits simplement. ` +
    "S'il y a beaucoup de lignes, donne l'essentiel (le total, les deux ou trois plus gros postes) et propose le détail à l'écran. " +
    "Le message vient d'une transcription : un mot mal compris se devine d'après le contexte ; si la question reste ambiguë, demande une précision en une phrase. " +
    "Si tu proposes une action, dis en une phrase ce que tu vas faire : l'utilisateur pourra confirmer ou annuler de vive voix (l'écran lui dit les mots à prononcer, ne les donne pas toi-même).",
};

/* ---------- Points d'entrée ---------- */

export async function sendMessage(
  userId: number,
  threadId: string | undefined,
  text: string,
  opts: { invoiceIds?: number[]; documentIds?: number[]; context?: ScreenContext; voice?: boolean; emit?: Emit } = {},
) {
  const t = await loadThread(userId, threadId);
  if (t.messages.length > MAX_MESSAGES) {
    t.display.push({ role: "assistant", text: tr("Cette conversation est longue : commencez-en une nouvelle pour continuer.") });
    return publicThread(t);
  }
  const { blocks, attachments } = await attachmentBlocks(userId, opts.invoiceIds ?? [], opts.documentIds ?? []);
  const ctx = opts.context ? contextBlock(opts.context) : null;
  // Un nouveau message pendant une confirmation vaut refus de l'action proposée.
  const pendingResults = await resolvePending(t, false, "L'utilisateur a écrit un nouveau message au lieu de confirmer : action annulée.");
  t.messages.push({ role: "user", content: [...pendingResults, ...(ctx ? [ctx.block] : []), ...blocks, ...(opts.voice ? [VOICE_BLOCK] : []), { type: "text", text }] });
  t.display.push({ role: "user", text, at: new Date().toISOString(), ...(attachments.length ? { attachments } : {}), ...(ctx?.label ? { context: ctx.label } : {}) });
  // Le fil doit exister avant d'y rattacher des actions proposées.
  await saveThread(t);
  try {
    await runLoop(t, opts.emit);
  } finally {
    await saveThread(t);
  }
  return publicThread(t);
}

export async function confirmPending(userId: number, threadId: string, approve: boolean, actionIds?: string[], emit?: Emit) {
  const t = await loadThread(userId, threadId);
  if (!t.pending) return publicThread(t);
  // L'écran confirme ce qu'il a affiché : si l'action a changé entre-temps (autre onglet), on refuse.
  const shown = t.pending.writes.map((w) => w.actionId ?? "");
  if (actionIds && (actionIds.length !== shown.length || actionIds.some((id, i) => id !== shown[i])))
    throw new ActionError(409, tr("L'action proposée a changé : recharge la conversation."));
  // Effets des actions exécutées : rendus une fois, avec cette réponse (jamais gardés dans la conversation).
  const effects: ClientEffect[] = [];
  const results = await resolvePending(t, approve, undefined, effects);
  t.messages.push({ role: "user", content: results });
  await saveThread(t);
  try {
    await runLoop(t, emit);
  } finally {
    await saveThread(t);
  }
  return { ...publicThread(t), ...(effects.length ? { effects } : {}) };
}

export async function getThread(userId: number, threadId: string) {
  return publicThread(await loadThread(userId, threadId));
}

/** Conversations gardées en mémoire pour une recherche dans leur texte. */
const SEARCH_SCAN = 400;

/**
 * Conversations de l'utilisateur : les épinglées d'abord, puis les plus récentes. `search` cherche, sans tenir compte
 * des accents ni de la casse, chacun de ses mots dans le titre et dans le texte des messages.
 */
export async function listThreads(userId: number, { limit = 30, search = "" }: { limit?: number; search?: string } = {}) {
  const words = fold(search).split(/\s+/).filter(Boolean).slice(0, 8);
  const rows = await q<{ id: string; title: string | null; pinned: number; display: string; created: number; updated: number; cost: number | null }>(
    `SELECT t.id, t.title, t.pinned, t.display, UNIX_TIMESTAMP(t.created_at) AS created, UNIX_TIMESTAMP(t.updated_at) AS updated,
            (SELECT SUM(u.cost_eur) FROM ai_usage u WHERE u.thread_id = t.id) AS cost
     FROM assistant_threads t WHERE t.user_id = ? ORDER BY t.pinned DESC, t.updated_at DESC LIMIT ?`,
    [userId, words.length ? SEARCH_SCAN : limit],
  );
  const iso = (seconds: number) => new Date(Number(seconds) * 1000).toISOString();
  const out = [];
  for (const r of rows) {
    const display = JSON.parse(r.display) as DisplayItem[];
    const title = threadTitle(r.title, display);
    if (words.length) {
      const text = fold(`${title}\n${display.map((d) => d.text).join("\n")}`);
      if (!words.every((w) => text.includes(w))) continue;
    }
    out.push({
      id: r.id,
      title,
      pinned: !!r.pinned,
      messages: display.filter((d) => d.role === "user").length,
      createdAt: iso(r.created),
      updatedAt: iso(r.updated),
      cost: Math.round(Number(r.cost ?? 0) * 10000) / 10000,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Renomme ou épingle une conversation. La date de dernière activité ne bouge pas : ranger une conversation
 * ne la fait pas remonter en tête de l'historique. Un titre vide rend à la conversation sa première question.
 */
export async function updateThread(userId: number, threadId: string, patch: { title?: string; pinned?: boolean }) {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    values.push(patch.title.replace(/\s+/g, " ").trim().slice(0, 160) || null);
  }
  if (patch.pinned !== undefined) {
    sets.push("pinned = ?");
    values.push(patch.pinned ? 1 : 0);
  }
  if (!sets.length) return;
  const r = await exec(`UPDATE assistant_threads SET ${sets.join(", ")}, updated_at = updated_at WHERE id = ? AND user_id = ?`, [...values, threadId, userId]);
  // « affectedRows » vaut 0 quand rien ne change : on vérifie que la conversation existe.
  if (!r.affectedRows && !(await one("SELECT 1 AS x FROM assistant_threads WHERE id = ? AND user_id = ?", [threadId, userId]))) throw new ActionError(404, tr("Conversation introuvable"));
}

/** Supprime une conversation et ses actions proposées ; le coût déjà compté (ai_usage) reste dans les totaux. */
export async function deleteThread(userId: number, threadId: string) {
  const r = await exec("DELETE FROM assistant_threads WHERE id = ? AND user_id = ?", [threadId, userId]);
  if (!r.affectedRows) throw new ActionError(404, tr("Conversation introuvable"));
}
