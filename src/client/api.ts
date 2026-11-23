import type { Region } from "../lib/countries.ts";
import { infiniteQueryOptions, keepPreviousData, QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleId } from "../lib/modules.ts";
import type { MonthTotals } from "../lib/tx-groups.ts";
import type { LoanSummary, ScheduleRow } from "../lib/loans.ts";
import type { PayoutSummary } from "../lib/payouts.ts";
import type { AccountKind, Owner } from "../lib/labels.ts";
import { prepareFile } from "./upload.ts";
import { appLang } from "./i18n.ts";
import { seasonMode } from "./theme.ts";
import type { Lang } from "../lib/i18n.ts";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Périmètre Foyer / Moi (défini par la coquille) : envoyé à chaque requête. */
let scopeOf: () => string = () => "foyer";
export const setScopeSource = (fn: () => string) => {
  scopeOf = fn;
};

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    // X-Themes : le réglage « Thèmes de l'année » de l'appareil, que le serveur ne garde pas (l'assistant ne parle du thème du moment qu'à qui l'affiche).
    headers: { "X-Perimetre": scopeOf(), "X-Langue": appLang(), "X-Themes": seasonMode(), ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Erreur ${res.status}`);
  return data as T;
}

/**
 * POST en flux (SSE) : texte au fil de l'eau et étapes, puis le résultat final (événement « done »).
 * Sans flux (proxy qui met en tampon), le résultat arrive simplement d'un bloc à la fin.
 */
export async function apiStream<T>(path: string, body: unknown, h: { onText?: (t: string) => void; onStep?: (label: string) => void }): Promise<T> {
  const res = await fetch(`/api${path}${path.includes("?") ? "&" : "?"}stream=1`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-Perimetre": scopeOf(), "X-Langue": appLang(), "X-Themes": seasonMode(), "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data as T;
    throw new ApiError(res.status, (data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let result: T | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const d = JSON.parse(data);
      if (event === "text") h.onText?.(d.text);
      else if (event === "step") h.onStep?.(d.label);
      else if (event === "done") result = d as T;
      else if (event === "error") throw new ApiError(500, d.error ?? "L'assistant n'a pas pu répondre");
    }
  }
  if (result === undefined) throw new ApiError(500, "Réponse interrompue : réessaie.");
  return result;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // Gardées en mémoire 1 jour : condition pour qu'elles soient aussi gardées sur l'appareil (offline.tsx).
      gcTime: 86_400_000,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export type Account = {
  id: string;
  name: string;
  display_name: string | null;
  institution: string | null;
  owner: Owner;
  kind: AccountKind;
  /** Devise du compte. `balance` est dans la devise du foyer ; `balance_original` dans celle du compte, quand elle diffère. */
  currency: string;
  balance: number | null;
  balance_original: number | null;
  balance_at: string | null;
  hidden: 0 | 1;
  excluded: 0 | 1;
  source: string;
  /** Ce qui alimente le compte aujourd'hui (un compte rattaché à Enable Banking garde sa source d'origine). */
  feed?: string;
  last_tx: string | null;
};

export type Category = { id: string; name: string; group_name: string | null; poste: string | null; kind: "revenu" | "depense" | "epargne" | "interne"; sort_order: number };

export type Transaction = {
  id: string;
  account_id: string;
  /** Jour retenu pour les statistiques : le jour d'achat ou le jour d'écriture de la banque, selon le réglage du foyer. */
  date: string;
  /** Jour d'écriture de la banque (pour une carte à débit différé : le jour du prélèvement). */
  booked_date?: string | null;
  /** Jour de l'achat, quand il est connu et diffère du jour d'écriture. */
  purchase_date?: string | null;
  /** Dans la devise du foyer ; `original_*` : montant et devise du compte, quand elle diffère. */
  amount: number;
  original_amount?: number | null;
  original_currency?: string | null;
  label: string;
  merchant: string | null;
  /** Libellé de la banque (export BoursoBank), quand l'opération y a été retrouvée. */
  bank_label?: string | null;
  status: string;
  category_id: string | null;
  category_source: string | null;
  note: string | null;
  category_name: string | null;
  category_poste: string | null;
  category_kind: string | null;
  /**
   * Virement entre comptes du foyer qui franchit la vue du membre : il compte, en revenu (« recu ») ou en dépense
   * (« verse »), et la ligne porte le nom de l'apport ou du versement (`category_name`) ; `owner` : titulaire du
   * compte d'en face. Absent pour toute autre opération, mouvement interne resté neutre compris.
   */
  transfer?: { way: "recu" | "verse"; owner: string; id: string } | null;
  account_name: string;
  account_owner: Owner;
  invoice_count?: number;
  split_count?: number;
};

export type Summary = {
  month: string;
  spentThisMonth: number;
  spentPrevMonthSameDay: number;
  spentPrevMonth: number;
  topCategories: { id: string; name: string; poste: string; total: number }[];
  uncategorized: number;
  lastSync: { status: string; finished_at: string | null; started_at: string; error: string | null } | null;
};

export type MonthStats = {
  month: string;
  categories: { id: string | null; name: string | null; poste: string | null; kind: string; total: number; count: number }[];
  previous: MonthStats["categories"];
  /** Postes de dépense colorés dans les donuts (les plus lourds sur 12 mois, ordre du référentiel). */
  colored?: string[];
  daily: { day: number; total: number }[];
  dailyPrev: { day: number; total: number }[];
  months: string[];
};

export type Loan = {
  id: string;
  name: string;
  property: string;
  bank: string;
  reference: string | null;
  type: string;
  principal: number;
  disbursed: number | null;
  rate: number;
  duration_months: number;
  start_date: string;
  end_date: string;
  notes: string | null;
  summary: LoanSummary;
  schedule?: ScheduleRow[];
};

/** `region` : pays, devise et fuseau du foyer. `language` : langue de Pécule choisie par le membre (null tant qu'il n'a rien choisi) ; `admin` : administrateur de Pécule (sauvegarde complète). */
/** `setup` : installation neuve, aucun membre encore ; `setupCommand` : la commande qui, sur le serveur, donne le lien du premier démarrage. */
export type Me = {
  user: {
    id: number;
    name: string;
    demo?: boolean;
    admin?: boolean;
    language?: Lang | null;
    modulesOff?: ModuleId[];
    region?: Region;
    /** Jour retenu pour les statistiques : jour d'achat ou jour d'écriture de la banque (réglage du foyer). */
    dateBasis?: "achat" | "debit";
    /** « Moi » montre-t-il autre chose que « Foyer » pour ce membre ? Sinon le choix n'est pas proposé. */
    scopeChoice?: boolean;
    /** Le foyer compte plusieurs membres : Foyer / Moi vaut aussi pour les revenus et les impôts. */
    several?: boolean;
    /** La présentation de bienvenue attend ce membre (première connexion) : l'appli l'ouvre avant tout autre écran. */
    welcome?: boolean;
  } | null;
  demoAvailable?: boolean;
  setup?: boolean;
  setupCommand?: string;
};
/** L'identité a été lue sur le serveur depuis l'ouverture de cette page (sinon, c'est la copie gardée par l'appareil). */
let identityRead = false;
/** Membre qui a fini ou passé la présentation de bienvenue sur cette page. */
let welcomeClosedFor: number | null = null;
const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async () => {
    const me = await api<Me>("/auth/me");
    identityRead = true;
    // Présentation fermée sur cette page : le serveur le note de son côté ; une lecture partie avant sa réponse ne
    // doit pas y renvoyer le membre.
    return me.user && me.user.id === welcomeClosedFor ? { ...me, user: { ...me.user, welcome: false } } : me;
  },
  staleTime: Infinity,
});
export const useMe = () => useQuery(meQuery);
/**
 * L'identité affichée vient-elle du serveur, ou de la copie gardée par l'appareil (ouverture instantanée) ? Ce qui
 * engage — adopter la langue du membre, s'approprier les données gardées, ouvrir la présentation de bienvenue — ne
 * se décide que sur une identité lue depuis l'ouverture de la page. (Pas une comparaison de dates : l'horloge de
 * l'appareil peut reculer.)
 */
export const identityFromServer = () => identityRead;
/**
 * Présentation de bienvenue finie ou passée : l'appli s'ouvre tout de suite, le serveur le note en arrière-plan
 * (`keepalive` : même si l'onglet se ferme ; deux nouveaux essais si le réseau flanche). S'il n'y arrive pas, elle
 * se rouvrira à la prochaine ouverture de l'appli.
 */
export function closeWelcome(qc: QueryClient, userId: number) {
  welcomeClosedFor = userId;
  qc.setQueryData<Me>(["me"], (me) => (me?.user?.id === userId ? { ...me, user: { ...me.user, welcome: false } } : me));
  const note = (retries: number): void =>
    void api("/auth/welcome", { method: "PUT", json: { done: true }, keepalive: true }).catch(() => {
      // Nouvel essai seulement si c'est toujours ce membre qui est connecté ici.
      if (retries > 0) setTimeout(() => qc.getQueryData<Me>(["me"])?.user?.id === userId && note(retries - 1), 5000);
    });
  note(2);
}
/**
 * Identité de la session qui vient de s'ouvrir, lue avant de quitter l'écran de connexion : elle dit où aller (la
 * présentation de bienvenue pour un nouveau membre), et l'écran suivant l'a sous la main sans attendre.
 */
export const freshMe = (qc: QueryClient): Promise<Me | null> => qc.fetchQuery({ ...meQuery, staleTime: 0 }).catch(() => null);
/** Session en mode démo (données fictives). */
export const useDemo = () => useMe().data?.user?.demo === true;
export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: () => api<{ accounts: Account[] }>("/accounts") });
export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/summary") });
export const useCategories = () => useQuery({ queryKey: ["categories"], queryFn: () => api<{ categories: Category[] }>("/categories"), staleTime: 3600_000 });
/** Requête d'un mois (aussi pour le préchargement des mois voisins). */
export const monthQuery = (m: string) => ({ queryKey: ["month", m], queryFn: () => api<MonthStats>(`/months/${m}`) });
export const useMonth = (m: string) => useQuery({ placeholderData: keepPreviousData, ...monthQuery(m) });
export const useLoans = () => useQuery({ queryKey: ["loans"], queryFn: () => api<{ loans: Loan[] }>("/loans"), staleTime: 3600_000 });
export const useLoan = (id: string) => useQuery({ queryKey: ["loan", id], queryFn: () => api<Loan>(`/loans/${id}`), staleTime: 3600_000 });

export function useSync() {
  const qc = useQueryClient();
  const demo = useDemo();
  return useMutation({
    // En démo, pas de banque à interroger : on rafraîchit seulement l'écran.
    mutationFn: () => (demo ? Promise.resolve({ seen: 0, inserted: 0, auto: 0 }) : api<{ seen: number; inserted: number; auto: number }>("/sync", { method: "POST" })),
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; categoryId?: string | null; note?: string | null; remember?: boolean }) =>
      api<{ ok: boolean; undoId?: string }>(`/transactions/${encodeURIComponent(id)}`, { method: "PATCH", json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["month"] });
      qc.invalidateQueries({ queryKey: ["suggestions"] });
      qc.invalidateQueries({ queryKey: ["nav-counts"] });
      // L'opération se classe aussi depuis le tiroir de forage, sans quitter l'écran : la liste du
      // tiroir et les chiffres de l'écran resté dessous suivent (seules les requêtes affichées repartent).
      for (const k of ["drill", "analysis", "trend", "dashboard", "compare", "envelopes", "balance-alert"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
}

export type CategorySuggestion = { categoryId: string; name: string; poste: string | null; reason: string; score: number };
/** Catégories proposées pour une opération (règle, facture, même libellé, même marchand…). */
export const useSuggestions = (txId: string | null | undefined) =>
  useQuery({
    queryKey: ["suggestions", txId],
    queryFn: () => api<{ suggestions: CategorySuggestion[] }>(`/transactions/${encodeURIComponent(txId!)}/suggestions`),
    enabled: !!txId,
    staleTime: 30_000,
  });

export type WealthCategory = "comptes" | "epargne" | "placement" | "crypto" | "immobilier" | "autre";

export type Asset = {
  id: number;
  owner_user_id: number | null;
  name: string;
  category: WealthCategory;
  institution: string | null;
  /** versements : la valeur est le dernier versement reçu (voir `payoutMatch`). */
  valuation: "manuel" | "cotation" | "versements";
  ticker: string | null;
  quantity: number | null;
  cash: number | null;
  value: number;
  valueDate: string | null;
  invested: number | null;
  share: number;
  shareValue: number;
  liquidity: string | null;
  loanIds: string[];
  notes: string | null;
  /** Texte du libellé des versements reçus de ce placement (coupons, intérêts, ce qu'une plateforme reverse). */
  payoutMatch: string | null;
  price: number | null;
  price_change: number | null;
};

/** Versements reçus d'un placement : les douze derniers, et leur résumé. `follows` : sa valeur est le dernier versement. */
export type AssetPayouts = PayoutSummary & { match: string | null; follows: boolean; payouts: { id: string; date: string; amount: number; label: string; merchant: string | null }[] };
export const useAssetPayouts = (id: number | undefined) =>
  useQuery({ queryKey: ["asset-payouts", id], queryFn: () => api<AssetPayouts>(`/assets/${id}/payouts`), enabled: id != null });

export type CryptoPosition = {
  id: number;
  symbol: string;
  name: string;
  coingecko_id: string | null;
  quantity: number;
  manual_value: number | null;
  location: string | null;
  updated_at: string | null;
  price: number | null;
  change_24h: number | null;
  value: number | null;
  source: "manuel" | "coinstats" | "onchain";
  portfolio_id: string | null;
  synced_at: string | null;
  price_source: "coingecko" | "coinstats" | null;
};

export type CryptoSource = {
  portfolioId: string;
  parentId: string | null;
  name: string;
  type: string;
  enabled: number;
  status: "ok" | "vide" | "doublon" | "a_verifier" | "erreur";
  lines: number;
  lastTotalEur: number | null;
  lastSyncedAt: string | null;
  note: string | null;
  /** Lu par son adresse publique, sans intermédiaire (sinon : un portefeuille du compte CoinStats). */
  direct: boolean;
  /** Adresse abrégée d'un portefeuille lu directement, quand il en a une seule. */
  address: string | null;
};

export type CryptoStatus = {
  enabled: boolean;
  sources: CryptoSource[];
  lastRun: { id: number; startedAt: string; finishedAt: string | null; status: string; sources: number; lines: number; totalEur: number | null; creditsUsed: number | null; error: string | null } | null;
  archived: { id: number; symbol: string; name: string; quantity: number; manualValue: number | null; archivedAt: string; archivedReason: string | null }[];
};

export type CryptoSummary = { positions: CryptoPosition[]; total: number; change24h: number | null; pricesAt: string | null; status: CryptoStatus };

export type Wealth = {
  date: string;
  gross: number;
  debts: number;
  net: number;
  byCategory: Record<WealthCategory, number>;
  accounts: { id: string; name: string; display_name: string | null; owner: string; balance: number; share: number; institution: string | null }[];
  assets: Asset[];
  crypto: CryptoSummary;
  loans: { id: string; name: string; property: string; bank: string; end_date: string; share: number; shareRemaining: number; summary: LoanSummary }[];
  history: { date: string; gross: number; debts: number; net: number; breakdown: Partial<Record<WealthCategory, number>> | null }[];
};

export const useWealth = () => useQuery({ queryKey: ["wealth"], queryFn: () => api<Wealth>("/wealth") });
export const useCrypto = () => useQuery({ queryKey: ["crypto"], queryFn: () => api<CryptoSummary>("/crypto") });
export type TrendMonth = { month: string; revenus: number; depenses: number; epargne: number };
/** Revenus et dépenses mois par mois : les douze derniers mois, ou du mois `from` au mois `to`. */
export const useTrend = (from?: string, to?: string) =>
  useQuery({
    placeholderData: keepPreviousData,
    queryKey: from && to ? ["trend", from, to] : ["trend"],
    queryFn: () => api<{ months: TrendMonth[] }>(from && to ? `/trend?from=${from}&to=${to}` : "/trend"),
  });
export const useBalanceSeries = (days = 90) =>
  useQuery({ placeholderData: keepPreviousData, queryKey: ["balance-series", days], queryFn: () => api<{ series: { date: string; balance: number }[] }>(`/balance-series?days=${days}`) });

/* ---------- Factures ---------- */

export type InvoiceSummary = {
  id: number;
  owner_user_id: number | null;
  merchant: string;
  title: string;
  invoice_date: string | null;
  total: number | null;
  currency: string;
  warranty_until: string | null;
  source: string;
  file_mime: string | null;
  no_match: 0 | 1;
  tx_count: number;
  item_count: number;
};

export type InvoiceItem = {
  id: number;
  label: string;
  quantity: number;
  amount: number | null;
  category_id: string | null;
  category_name: string | null;
  ref: string | null;
  url: string | null;
};

export type LinkedTransaction = { id: string; date: string; amount: number; label: string; merchant: string | null; account_name: string; link_source?: string };

export type InvoiceDetail = {
  invoice: InvoiceSummary & { order_ref: string | null; invoice_number: string | null; notes: string | null; file_name: string | null; file_size: number | null };
  items: InvoiceItem[];
  transactions: LinkedTransaction[];
};

export type TransactionDetails = {
  invoices: Pick<InvoiceSummary, "id" | "merchant" | "title" | "invoice_date" | "total" | "currency" | "file_mime" | "warranty_until">[];
  items: (InvoiceItem & { invoice_id: number })[];
  splits: { id: number; amount: number; category_id: string | null; category_name: string | null; label: string | null }[];
};

export const useInvoice = (id: number | null) =>
  useQuery({ queryKey: ["invoice", id], queryFn: () => api<InvoiceDetail>(`/invoices/${id}`), enabled: id != null });
export const useTransactionDetails = (id: string | null) =>
  useQuery({ queryKey: ["transaction-details", id], queryFn: () => api<TransactionDetails>(`/transactions/${encodeURIComponent(id!)}/details`), enabled: !!id });

/** Envoie un PDF ou une photo ; Claude lit la facture, Pécule la rapproche (ou la relie à `transactionId`). */
export async function uploadInvoice(original: File, transactionId?: string) {
  const file = await prepareFile(original);
  const sp = new URLSearchParams({ name: file.name || "facture" });
  if (transactionId) sp.set("transaction", transactionId);
  return api<{ id: number; created: boolean; read: boolean }>(`/invoices?${sp}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
}

/** Après une modification de facture : listes, détails et statistiques (la ventilation a pu changer). */
export const invalidateInvoices = (qc: QueryClient) =>
  Promise.all(
    ["invoices", "invoice", "transaction-details", "transactions", "summary", "month", "trend"].map((k) => qc.invalidateQueries({ queryKey: [k] })),
  );

/* ---------- Documents et échéancier (phase 13) ---------- */

export type DocSummary = {
  id: number;
  owner_user_id: number | null;
  title: string;
  kind: string;
  domain: string;
  /** Nature du contrat (assurance auto, énergie…) : l'étiquette du coffre. */
  topic: string | null;
  entity_type: string | null;
  entity_id: string | null;
  doc_date: string | null;
  expires_at: string | null;
  summary: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  source: string;
  created_at: string;
  snippet?: string | null;
};
export type DocDetail = DocSummary & { facts: { label: string; value: string }[]; text: string | null; text_length: number; has_file: number | null };

export type AgendaEntry = {
  key: string;
  date: string | null;
  title: string;
  kind: "tache" | "jalon" | "echeance";
  domain: string;
  source: "saisie" | "pret" | "garantie" | "document" | "impots" | "contrat";
  id?: number;
  status?: string;
  recurrence?: string | null;
  amount?: number | null;
  notes?: string | null;
  link?: string;
  overdue?: boolean;
  /** Écran Échéancier : ligne saisie visible de son seul auteur ; jour où une tâche a été cochée ; cochée depuis peu. */
  private?: boolean;
  doneAt?: string | null;
  recent?: boolean;
};

export const useDocument = (id: number | null) => useQuery({ queryKey: ["document", id], queryFn: () => api<DocDetail>(`/documents/${id}`), enabled: id != null });
/** `recentDone` (jours) : joint les tâches cochées depuis peu, marquées `recent` (écran Échéancier, « Fait récemment »). */
export const useAgenda = (days = 365, done = false, recentDone = 0) =>
  useQuery({
    placeholderData: keepPreviousData,
    queryKey: ["agenda", days, done, recentDone],
    queryFn: () => {
      const from = new Date().toLocaleDateString("sv-SE");
      const to = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
      return api<{ from: string; to: string; entries: AgendaEntry[] }>(`/agenda?from=${from}&to=${to}${done ? "&done=1" : ""}${recentDone ? `&faits=${recentDone}` : ""}`);
    },
  });

export type Ingested = { type: "invoice" | "document"; id: number; created: boolean; title: string };

/** Dépose un fichier : Claude le reconnaît ; facture → Factures, sinon → coffre de documents (ou force). */
export async function uploadToInbox(original: File, force?: "invoice" | "document") {
  const file = await prepareFile(original);
  const sp = new URLSearchParams({ name: file.name || "document" });
  if (force) sp.set("force", force);
  return api<Ingested>(`/${force === "document" ? "documents" : "inbox"}?${sp}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
}

export const invalidateDocuments = (qc: QueryClient) => Promise.all(["documents", "document", "agenda", "dashboard"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

/* ---------- Listes paginées (Opérations, Factures) : mêmes options pour l'écran et le préchargement ---------- */

export type TxFilters = { account?: string; category?: string; poste?: string; month?: string; nature?: string; uncategorized: boolean; q: string };
const TX_PAGE = 80;
/** Filtres de la liste, tels que le serveur les lit. */
function txParams(f: TxFilters, extra: Record<string, string> = {}) {
  const sp = new URLSearchParams(extra);
  if (f.account) sp.set("account", f.account);
  if (f.category) sp.set("category", f.category);
  if (f.poste) sp.set("poste", f.poste);
  if (f.month) sp.set("month", f.month);
  if (f.nature) sp.set("nature", f.nature);
  if (f.uncategorized) sp.set("uncategorized", "1");
  if (f.q) sp.set("q", f.q);
  return sp;
}
export const transactionListQuery = (f: TxFilters) =>
  infiniteQueryOptions({
    queryKey: ["transactions", f],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<{ transactions: Transaction[]; hasMore: boolean }>(`/transactions?${txParams(f, { limit: String(TX_PAGE), offset: String(pageParam) })}`),
    getNextPageParam: (last, all) => (last.hasMore ? all.length * TX_PAGE : undefined),
  });
/** Toutes les opérations d'un mois de la liste filtrée (mois déplié sur ordinateur), lues par tranches de 500. */
export const transactionMonthRowsQuery = (f: TxFilters, month: string) =>
  queryOptions({
    queryKey: ["transactions", "month-rows", f, month],
    queryFn: async () => {
      const rows: Transaction[] = [];
      for (;;) {
        const page = await api<{ transactions: Transaction[]; hasMore: boolean }>(`/transactions?${txParams({ ...f, month }, { limit: "500", offset: String(rows.length) })}`);
        rows.push(...page.transactions);
        if (!page.hasMore || !page.transactions.length) return rows;
      }
    },
  });
/** Bilan d'un mois de la liste filtrée (toutes ses opérations, chargées ou non). */
export type TxMonth = MonthTotals & { month: string };
/** Bilan mois par mois de la liste filtrée, et postes colorés (les mêmes que sur l'anneau des dépenses). */
export const transactionMonthsQuery = (f: TxFilters) =>
  queryOptions({
    queryKey: ["transactions", "months", f],
    queryFn: () => api<{ months: TxMonth[]; colored: string[] }>(`/transactions/months?${txParams(f)}`),
  });
/** Liste d'opérations sans filtre (premier écran d'Opérations). */
export const DEFAULT_TX_FILTERS: TxFilters = { account: undefined, category: undefined, poste: undefined, month: undefined, nature: undefined, uncategorized: false, q: "" };

const INVOICE_PAGE = 100;
export const invoiceListQuery = (filtre: string | undefined, q: string) =>
  infiniteQueryOptions({
    queryKey: ["invoices", { filtre, q }],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ limit: String(INVOICE_PAGE), offset: String(pageParam) });
      if (filtre) sp.set("filtre", filtre);
      if (q) sp.set("q", q);
      return api<{ invoices: InvoiceSummary[]; hasMore: boolean }>(`/invoices?${sp}`);
    },
    getNextPageParam: (last, all) => (last.hasMore ? all.length * INVOICE_PAGE : undefined),
  });
