import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "../db/schema/index.ts";
import { brandOf } from "../../lib/brands.ts";
import { autoMatch } from "../../lib/invoices.ts";
import { labelKey } from "../../lib/labels.ts";
import { natureOf } from "../../lib/nature.ts";
import { DEMO_TABLES, buildDemoData, tablesToClear } from "./data.ts";

const T = "2026-11-10";
const TODAY = new Date(`${T}T12:00:00Z`);
const USERS = [
  { id: 1, name: "Alex" },
  { id: 2, name: "Camille" },
];
const d = buildDemoData(TODAY, USERS);
const daysBefore = (n: number) => new Date(Date.parse(`${T}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const ids = <T, K>(rows: T[], f: (r: T) => K) => new Set(rows.map(f));

/** Toutes les valeurs texte d'un objet (fichiers compris, lus en latin1). */
function texts(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Buffer.isBuffer(v)) out.push(v.toString("latin1"));
  else if (Array.isArray(v)) for (const x of v) texts(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) texts(x, out);
  return out;
}

describe("données de démo", () => {
  it("sont déterministes pour un même jour et changent avec le jour", () => {
    const again = buildDemoData(new Date(`${T}T21:30:00Z`), USERS); // 22 h 30 à Paris : même jour
    expect(JSON.stringify(again)).toBe(JSON.stringify(d));
    const tomorrow = buildDemoData(new Date("2026-11-11T12:00:00Z"), USERS);
    expect(tomorrow.transactions[0].id).not.toBe(d.transactions[0].id);
  });

  it("ne contiennent aucun nom, lieu ni identifiant réel", () => {
    // La liste des mots interdits est celle du garde-fou, gardée hors du dépôt (elle révélerait ce qu'elle protège).
    const list = path.resolve("data/garde-fou/mots.txt");
    const forbidden = existsSync(list)
      ? readFileSync(list, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
          .map((src) => new RegExp(src, "iu"))
      : [];
    const hits = texts(d).filter((s) => forbidden.some((re) => re.test(s)));
    expect(hits).toEqual([]);
    expect(texts(d).filter((s) => /\bFR\d{2}[ ]?\d{4}/.test(s))).toEqual([]);
  });

  it("respectent les colonnes du schéma (noms et longueurs)", () => {
    for (const key of DEMO_TABLES) {
      const cols = getTableColumns(schema[key]) as Record<string, { length?: number; notNull: boolean; hasDefault: boolean }>;
      for (const row of d[key] as Record<string, unknown>[])
        for (const [k, v] of Object.entries(row)) {
          expect(cols[k], `${key}.${k}`).toBeDefined();
          if (typeof v === "string" && cols[k].length) expect(v.length, `${key}.${k} = ${v}`).toBeLessThanOrEqual(cols[k].length!);
        }
    }
  });

  it("vident toutes les tables du schéma sauf les logos, et n'alimentent que des tables", () => {
    const names = tablesToClear().map((t) => t.name);
    expect(names).not.toContain("logos");
    expect(names).not.toContain("tx_lines");
    for (const n of ["sessions", "passkeys", "app_kv", "audit_log", "alerts", "assistant_threads", "push_subscriptions", "sync_runs", "users"]) expect(names).toContain(n);
    for (const key of DEMO_TABLES) expect(names).toContain(getTableName(schema[key]));
  });

  it("ne datent aucune opération après le jour (ni avant l'historique)", () => {
    for (const t of d.transactions) {
      expect(t.date <= T && t.date >= "2025-09-01", t.label).toBe(true);
      const card = /^(?:Carte|Avoir) (\d{2}) (\d{2}) (\d{2}) /.exec(t.label);
      if (card) expect(`20${card[3]}-${card[2]}-${card[1]}` <= t.date, t.label).toBe(true);
    }
    for (const rows of [d.balances.map((b) => b.date), d.wealthSnapshots.map((w) => w.date), d.cryptoEvents.map((e) => e.date), d.payslips.map((p) => p.payDate!), d.invoices.map((i) => i.invoiceDate!), d.documents.map((x) => x.docDate!)])
      for (const date of rows) expect(date <= T).toBe(true);
    expect(d.balances.at(-1)!.date).toBe(T);
  });

  it("reprennent les membres reçus, sans id en dur", () => {
    const other = buildDemoData(TODAY, [
      { id: 7, name: "Alex" },
      { id: 12, name: "Camille" },
    ]);
    expect(other.users).toEqual([
      { id: 7, name: "Alex" },
      { id: 12, name: "Camille" },
    ]);
    for (const key of DEMO_TABLES)
      for (const row of other[key] as Record<string, unknown>[])
        for (const col of ["ownerUserId", "userId"]) if (row[col] != null) expect([7, 12], `${key}.${col}`).toContain(row[col]);
    expect(new Set(other.accounts.map((a) => a.owner))).toEqual(new Set(["joint", "alex", "camille"]));
  });

  it("ne référencent que des catégories qui existent", () => {
    const cats = ids(d.categories, (c) => c.id);
    const postes = ids(d.categories, (c) => c.poste);
    const used = [...d.transactions.map((t) => t.categoryId), ...d.rules.map((r) => r.categoryId), ...d.commitments.map((c) => c.categoryId), ...d.invoiceItems.map((i) => i.categoryId), ...d.transactionSplits.map((s) => s.categoryId)];
    for (const c of used) if (c != null) expect(cats).toContain(c);
    for (const e of d.envelopes) expect(e.scope === "poste" ? postes : cats).toContain(e.ref);
    expect(d.categories).toHaveLength(46);
  });

  it("pointent toujours vers une ligne générée (clés étrangères)", () => {
    const accounts = ids(d.accounts, (a) => a.id);
    const txs = ids(d.transactions, (t) => t.id);
    const invoices = ids(d.invoices, (i) => i.id);
    const items = ids(d.invoiceItems, (i) => i.id);
    const docs = ids(d.documents, (x) => x.id);
    const loans = ids(d.loans, (l) => l.id);
    const assets = ids(d.assets, (a) => a.id);
    const props = ids(d.properties, (p) => p.id);
    const users = ids(d.users, (u) => u.id);
    for (const t of d.transactions) expect(accounts).toContain(t.accountId);
    for (const b of d.balances) expect(accounts).toContain(b.accountId);
    for (const r of [...d.invoiceItems, ...d.invoiceFiles, ...d.invoiceTransactions]) expect(invoices).toContain(r.invoiceId);
    for (const r of [...d.invoiceTransactions, ...d.transactionSplits]) expect(txs).toContain(r.transactionId);
    for (const s of d.transactionSplits) if (s.invoiceItemId != null) expect(items).toContain(s.invoiceItemId);
    for (const f of d.documentFiles) expect(docs).toContain(f.documentId);
    for (const r of [...d.taxReturns, ...d.propertyTaxes, ...d.payslips]) if (r.documentId != null) expect(docs).toContain(r.documentId);
    for (const s of d.loanSchedule) expect(loans).toContain(s.loanId);
    for (const r of [...d.properties, ...d.assets]) for (const l of (r.loanIds ?? "").split(",").filter(Boolean)) expect(loans).toContain(l);
    for (const r of [...d.properties, ...d.goals]) if (r.assetId != null) expect(assets).toContain(r.assetId);
    for (const r of [...d.commitments, ...d.propertyTaxes]) if (r.propertyId != null) expect(props).toContain(r.propertyId);
    for (const r of [...d.documents, ...d.agendaItems, ...d.facts]) {
      if (r.entityType === "property") expect(props).toContain(r.entityId);
      if (r.entityType === "loan") expect(loans).toContain(r.entityId);
      if (r.entityType === "retirement") expect(users).toContain(Number(r.entityId));
    }
    expect(ids(d.transactions, (t) => t.id).size).toBe(d.transactions.length);
    expect(ids(d.transactions, (t) => t.fintaId).size).toBe(d.transactions.length);
    expect(ids(d.balances, (b) => `${b.accountId}|${b.date}`).size).toBe(d.balances.length);
    expect(ids(d.wealthSnapshots, (w) => `${w.userId}|${w.date}`).size).toBe(d.wealthSnapshots.length);
    expect(ids(d.rules, (r) => r.pattern).size).toBe(d.rules.length);
  });

  it("ont des volumes, des soldes et des mois plausibles", () => {
    const kind = new Map(d.categories.map((c) => [c.id, c.kind]));
    const months = new Map<string, { n: number; net: number }>();
    for (const t of d.transactions) {
      const m = months.get(t.date.slice(0, 7)) ?? { n: 0, net: 0 };
      const k = t.categoryId ? kind.get(t.categoryId) : t.amount < 0 ? "depense" : "revenu";
      m.n++;
      if (k === "revenu" || k === "depense") m.net += t.amount;
      months.set(t.date.slice(0, 7), m);
    }
    const full = [...months].filter(([m]) => m < T.slice(0, 7));
    expect(full).toHaveLength(14);
    for (const [m, x] of full) expect(x.n, m).toBeGreaterThanOrEqual(120);
    for (const [m, x] of full) expect(x.n, m).toBeLessThanOrEqual(180);
    expect(full.filter(([, x]) => x.net > 0).length).toBeGreaterThanOrEqual(11);
    expect(full.filter(([, x]) => x.net < 500).length).toBeGreaterThanOrEqual(1);

    for (const a of d.accounts) {
      const series = d.balances.filter((b) => b.accountId === a.id);
      expect(series.at(-1)!.balance).toBe(a.balance);
      expect(Math.min(...series.map((b) => b.balance))).toBeGreaterThan(0);
      if (a.name.startsWith("Livret A")) expect(Math.max(...series.map((b) => b.balance))).toBeLessThan(22_950);
      if (a.name.startsWith("LDDS")) expect(Math.max(...series.map((b) => b.balance))).toBeLessThan(12_000);
    }
    const net = d.wealthSnapshots.filter((w) => w.userId === 1).map((w) => w.net);
    expect(net.at(-1)!).toBeGreaterThan(net[0]);
  });

  it("laissent une quinzaine d'opérations récentes à classer et quelques-unes en attente", () => {
    const unc = d.transactions.filter((t) => !t.categoryId);
    expect(unc.length).toBeGreaterThanOrEqual(12);
    for (const t of unc) expect(t.date >= daysBefore(45) && t.categorySource == null).toBe(true);
    expect(unc.filter((t) => t.date >= daysBefore(30)).length).toBeGreaterThanOrEqual(10);
    const pending = d.transactions.filter((t) => t.status === "pending");
    expect(pending.length).toBeGreaterThan(0);
    for (const t of pending) expect(t.date >= daysBefore(2)).toBe(true);
    expect(new Set(d.transactions.map((t) => t.categorySource))).toEqual(new Set(["regle", "manuel", "auto", "facture", null]));
  });

  it("écrivent les libellés comme la banque : clé, nature, logo", () => {
    for (const t of d.transactions) expect(t.labelKey).toBe(labelKey(t.label, t.merchant));
    const nat = (re: RegExp) => d.transactions.filter((t) => re.test(t.label)).map((t) => natureOf(t.label, t.amount));
    expect(new Set(nat(/^Carte /))).toEqual(new Set(["carte"]));
    expect(new Set(nat(/^Prlv Sepa /))).toEqual(new Set(["prelevement"]));
    expect(new Set(nat(/^Retrait Dab /))).toEqual(new Set(["retrait"]));
    expect(new Set(nat(/^\d{7} Ech/))).toEqual(new Set(["prelevement"]));
    const cards = d.transactions.filter((t) => t.label.startsWith("Carte "));
    // Logo de marque : au moins un achat carte sur trois, et plus de la moitié des montants.
    const branded = cards.filter((t) => brandOf(t.merchant, t.label));
    expect(branded.length / cards.length).toBeGreaterThan(0.3);
    expect(branded.reduce((s, t) => s + t.amount, 0) / cards.reduce((s, t) => s + t.amount, 0)).toBeGreaterThan(0.5);
    for (const name of ["Carrefour", "Netflix", "EDF", "Free", "Amazon", "SNCF", "Deliveroo", "IKEA", "Vinci Autoroutes", "Decathlon"])
      expect(d.transactions.some((t) => brandOf(t.merchant, t.label)?.name === name), name).toBe(true);
  });

  it("gardent des règles et des engagements qui retrouvent leurs opérations", () => {
    for (const r of d.rules) expect(d.transactions.some((t) => (t.labelKey ?? "").includes(r.pattern)), r.pattern).toBe(true);
    for (const t of d.transactions.filter((x) => x.categorySource === "regle"))
      expect(d.rules.some((r) => (t.labelKey ?? "").includes(r.pattern) && r.categoryId === t.categoryId) || d.commitments.some((c) => c.label === t.merchant), t.label).toBe(true);
    for (const c of d.commitments.filter((x) => x.status === "actif" && (x.matchPattern || x.labelRegex))) {
      const recent = d.transactions.filter((t) => t.amount < 0 && t.date >= daysBefore(90));
      const found = c.labelRegex ? recent.some((t) => t.merchant === c.label && new RegExp(c.labelRegex!).test(t.label.toLowerCase())) : recent.some((t) => (t.labelKey ?? "").includes(c.matchPattern!));
      expect(found, c.label).toBe(true);
    }
  });

  it("relient les factures à des opérations que le rapprochement aurait choisies", () => {
    expect(d.invoiceTransactions.length).toBeGreaterThanOrEqual(8);
    for (const link of d.invoiceTransactions) {
      const inv = d.invoices.find((i) => i.id === link.invoiceId)!;
      const tx = d.transactions.find((t) => t.id === link.transactionId)!;
      expect(autoMatch({ invoice_date: inv.invoiceDate!, total: inv.total!, merchant: inv.merchant }, [tx]), inv.title).toBe(tx.id);
      const items = d.invoiceItems.filter((i) => i.invoiceId === inv.id).reduce((s, i) => s + i.amount!, 0);
      expect(Math.round(items * 100)).toBe(Math.round(inv.total! * 100));
      const splits = d.transactionSplits.filter((s) => s.transactionId === tx.id);
      if (splits.length) expect(Math.round(splits.reduce((s, x) => s + x.amount, 0) * 100)).toBe(Math.round(tx.amount * 100));
    }
    expect(d.invoices.some((i) => !d.invoiceTransactions.some((l) => l.invoiceId === i.id) && i.invoiceDate! >= daysBefore(7))).toBe(true);
  });

  it("paient les salaires des bulletins et produisent des PDF valides", () => {
    const alex = d.accounts.find((a) => a.owner === "alex" && a.kind === "courant")!;
    for (const p of d.payslips) expect(d.transactions.some((t) => t.accountId === alex.id && t.date === p.payDate && t.amount === p.netPaid && t.categoryId === "A1"), p.period).toBe(true);
    expect(d.payslips).toHaveLength(12);
    expect(d.payslips.find((p) => p.period === "2026-03")!.bonus).toBeGreaterThan(0);
    const files: Buffer[] = [...d.documentFiles.map((f) => f.content), ...d.invoiceFiles.map((f) => f.content)];
    for (const f of files) {
      const s = f.toString("latin1");
      expect(s.startsWith("%PDF-1.4")).toBe(true);
      const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
      expect(s.slice(xref, xref + 4)).toBe("xref");
    }
  });
});
