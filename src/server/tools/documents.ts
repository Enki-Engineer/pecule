import { z } from "zod";
import { one } from "../db.ts";
import { DOMAINS, KINDS, TOPICS, documentDetail, searchDocuments, updateDocument } from "../documents.ts";
import { agenda, createTask, setTaskDone } from "../agenda.ts";
import { ToolError, change, day, field, longDate, readTool, today, writeTool } from "./registry.ts";
import { t as tr, tk } from "../../lib/i18n.ts";
import { TOPIC_LABELS } from "../../lib/documents.ts";

/* Documents (coffre) et échéancier. */

const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
/** Date d'un texte de confirmation, dans la langue du membre. */
const frDate = (d: string | null | undefined) => (d ? longDate(d) : tr("sans date"));
/** Récurrence d'une tâche : la valeur enregistrée reste l'identifiant, on ne traduit qu'à l'affichage. */
const RECURRENCES: Record<string, string> = { mensuel: tk("mensuel"), trimestriel: tk("trimestriel"), annuel: tk("annuel") };
const recurrenceLabel = (r: string) => tr(RECURRENCES[r] ?? r);

/** Nature d'un contrat dans un texte de confirmation, dans la langue du membre. */
const topicLabel = (topic: string | null | undefined) => (topic ? (TOPIC_LABELS[topic] ?? topic) : "—");

const searchDocs = readTool({
  name: "search_documents",
  progress: tk("Recherche dans les documents…"),
  description:
    "Recherche plein texte dans le coffre de documents (avis d'impôt, contrats, baux, actes, prêts, diagnostics, relevés, fiches…), avec filtres par domaine et type. Renvoie titre, date, résumé et un extrait autour des mots cherchés. Les identifiants sensibles (IBAN, n° de Sécurité sociale…) sont masqués dans le texte.",
  input: z.object({
    query: z.string().max(100).optional().describe("Mots cherchés (titre, résumé, texte du document)"),
    domain: z.enum(DOMAINS).optional(),
    kind: z.enum(KINDS).optional(),
    topic: z.enum(TOPICS).optional().describe("Nature du contrat (assurance auto, habitation, emprunteur, santé, énergie, box, mobile, véhicule) : tous les papiers d'un même contrat, quel que soit leur type"),
    entity_type: z.string().max(16).optional().describe("property, asset, loan…"),
    entity_id: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(30).optional().describe("Défaut 10"),
  }),
  run: ({ userId }, f) =>
    searchDocuments(userId, { q: f.query, domain: f.domain, kind: f.kind, topic: f.topic, entityType: f.entity_type, entityId: f.entity_id, limit: f.limit ?? 10 }),
});

const getDoc = readTool({
  name: "get_document",
  progress: tk("Lecture du document…"),
  description: "Contenu d'un document du coffre : métadonnées, faits clés, résumé et texte (par morceaux : offset en caractères, 12 000 caractères par appel).",
  input: z.object({ document_id: z.number().int(), offset: z.number().int().min(0).optional() }),
  async run({ userId }, { document_id, offset = 0 }) {
    const d = await documentDetail(userId, document_id);
    if (!d) throw new ToolError(`Document n° ${document_id} introuvable`);
    const { text, ...meta } = d;
    return { ...meta, text: text ? text.slice(offset, offset + 12_000) : null, text_offset: offset, text_total: text?.length ?? 0 };
  },
});

const updateDoc = writeTool({
  name: "update_document",
  description: "Corrige le classement d'un document : titre, type, domaine, nature du contrat (topic, null pour l'enlever), date, échéance (expires_at), résumé, rattachement (entity_type/entity_id), private.",
  input: z.object({
    document_id: z.number().int(),
    title: z.string().min(1).max(255).optional(),
    kind: z.enum(KINDS).optional(),
    domain: z.enum(DOMAINS).optional(),
    topic: z.enum(TOPICS).nullable().optional(),
    doc_date: day.nullable().optional(),
    expires_at: day.nullable().optional(),
    summary: z.string().max(4000).nullable().optional(),
    entity_type: z.string().max(16).nullable().optional(),
    entity_id: z.string().max(64).nullable().optional(),
    private: z.boolean().optional(),
  }),
  async describe({ userId }, i) {
    const d = await documentDetail(userId, i.document_id);
    if (!d) throw new ToolError(`Document n° ${i.document_id} introuvable`);
    const details: string[] = [];
    if (i.title !== undefined) details.push(change(tr("Titre"), d.title, i.title));
    // Type et domaine : identifiants du coffre, montrés tels quels.
    if (i.kind !== undefined) details.push(change(tr("Type"), d.kind, i.kind));
    if (i.domain !== undefined) details.push(change(tr("Domaine"), d.domain, i.domain));
    if (i.topic !== undefined) details.push(change(tr("Nature du contrat"), topicLabel(d.topic), topicLabel(i.topic)));
    if (i.doc_date !== undefined) details.push(change(tr("Date"), frDate(d.doc_date), frDate(i.doc_date)));
    if (i.expires_at !== undefined) details.push(change(tr("Échéance"), frDate(d.expires_at), frDate(i.expires_at)));
    if (i.summary !== undefined) details.push(tr("Résumé réécrit"));
    if (i.entity_type !== undefined || i.entity_id !== undefined) details.push(field(tr("Rattaché à"), `${i.entity_type ?? "—"} ${i.entity_id ?? ""}`));
    if (i.private !== undefined) details.push(i.private ? tr("Visible par moi seul") : tr("Commun à la famille"));
    if (!details.length) throw new ToolError("Aucune modification demandée");
    return { label: tr("Modifier le document « {titre} »", { titre: d.title }), details };
  },
  async run({ userId }, i) {
    await updateDocument(userId, i.document_id, {
      title: i.title,
      kind: i.kind,
      domain: i.domain,
      topic: i.topic,
      docDate: i.doc_date,
      expiresAt: i.expires_at,
      summary: i.summary,
      entityType: i.entity_type,
      entityId: i.entity_id,
      private: i.private,
    });
    return "Fait : document mis à jour.";
  },
});

const listAgenda = readTool({
  name: "list_agenda",
  progress: tk("Lecture de l'échéancier…"),
  description:
    "Échéancier : tâches à faire (en retard comprises) et jalons saisis, plus les échéances calculées (mensualités et fins de crédits, fins de garantie, documents qui expirent, renouvellements de contrats, calendrier fiscal indicatif). Par défaut les 90 prochains jours.",
  input: z.object({ days: z.number().int().min(1).max(3650).optional().describe("Horizon en jours, défaut 90"), include_done: z.boolean().optional() }),
  async run({ userId }, f) {
    const from = today();
    return { from, to: plusDays(from, f.days ?? 90), entries: await agenda(userId, from, plusDays(from, f.days ?? 90), { includeDone: f.include_done }) };
  },
});

const addTask = writeTool({
  name: "add_task",
  description: "Ajoute une tâche à faire (à cocher, récurrence possible) ou un jalon (date à retenir) dans l'échéancier.",
  input: z.object({
    kind: z.enum(["tache", "jalon"]).optional(),
    title: z.string().min(1).max(255),
    due_date: day.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    domain: z.enum(DOMAINS).optional(),
    entity_type: z.string().max(16).nullable().optional(),
    entity_id: z.string().max(64).nullable().optional(),
    amount: z.number().nullable().optional(),
    recurrence: z.enum(["mensuel", "trimestriel", "annuel"]).nullable().optional(),
    private: z.boolean().optional(),
  }),
  describe: async (_ctx, i) => ({
    label: i.kind === "jalon" ? tr("Ajouter le jalon « {titre} »", { titre: i.title }) : tr("Ajouter la tâche « {titre} »", { titre: i.title }),
    details: [
      field(tr("Date"), frDate(i.due_date)),
      ...(i.recurrence ? [field(tr("Récurrence"), recurrenceLabel(i.recurrence))] : []),
      ...(i.notes ? [i.notes.slice(0, 160)] : []),
      ...(i.private ? [tr("Visible par moi seul")] : []),
    ],
  }),
  async run({ userId }, i) {
    const id = await createTask(userId, {
      kind: i.kind,
      title: i.title,
      dueDate: i.due_date,
      notes: i.notes,
      domain: i.domain,
      entityType: i.entity_type,
      entityId: i.entity_id,
      amount: i.amount,
      recurrence: i.recurrence,
      private: i.private,
      source: "assistant",
    });
    return `Fait : ajouté à l'échéancier (n° ${id}).`;
  },
});

const completeTask = writeTool({
  name: "complete_task",
  description: "Coche (done=true) ou décoche une tâche de l'échéancier (id = champ id de list_agenda). Une tâche récurrente cochée crée la suivante.",
  input: z.object({ task_id: z.number().int(), done: z.boolean() }),
  async describe({ userId }, i) {
    const t = await one<{ title: string; due_date: string | null; recurrence: string | null }>(
      "SELECT title, due_date, recurrence FROM agenda_items WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)",
      [i.task_id, userId],
    );
    if (!t) throw new ToolError("Tâche introuvable");
    return {
      label: i.done ? tr("Cocher « {titre} »", { titre: t.title }) : tr("Décocher « {titre} »", { titre: t.title }),
      details: [field(tr("Échéance"), frDate(t.due_date)), ...(i.done && t.recurrence ? [tr("Prochaine occurrence créée ({recurrence})", { recurrence: recurrenceLabel(t.recurrence) })] : [])],
    };
  },
  async run({ userId }, i) {
    const r = await setTaskDone(userId, i.task_id, i.done);
    return `Fait${r.next ? ` (occurrence suivante n° ${r.next})` : ""}.`;
  },
});

export const documentsTools = [searchDocs, getDoc, listAgenda, updateDoc, addTask, completeTask];
