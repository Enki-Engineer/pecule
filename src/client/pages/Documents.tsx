import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, ExternalLink, FolderUp, ListChecks, Lock, Plus, Search, Sparkles, TableProperties, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { api, invalidateDocuments, invalidateInvoices, uploadToInbox, useDemo, useDocument, useMe, type DocDetail, type DocSummary } from "../api.ts";
import { useProperties } from "../api-situation.ts";
import { Card, Empty, ErrorBox, Field, PageHeader, Sheet, Spinner, Tabs } from "../components/ui.tsx";
import { dateFr } from "../format.ts";
import { DOMAIN_LABELS, KIND_LABELS } from "../../lib/documents.ts";
import { FileIcon } from "./Invoices.tsx";
import { Batch } from "./Import.tsx";
import { droppedFiles, pickedFiles, startImport, type BatchLine, type Picked, type Progress } from "../importer.ts";
import { useAssistantEntity } from "../assistantContext.ts";
import { askAssistant } from "../assistantBus.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { ContextMenu, useContextMenu } from "../components/ContextMenu.tsx";
import { Copy, FileDown, MessageSquare, PanelRight } from "lucide-react";
import { FilePreview } from "../components/FilePreview.tsx";
import { useMedia } from "../useMedia.ts";
import { t, tn } from "../../lib/i18n.ts";

/*
 * Coffre : tous les papiers du foyer au même endroit. En haut, on dépose (un fichier, plusieurs, un dossier entier) ;
 * chaque fichier est rangé, reconnu, lu par l'IA quand Pécule sait le lire, et ses données sont proposées à la
 * relecture (rien n'est écrit dans les écrans avant la validation). En dessous, la liste de ce que le coffre contient,
 * et les imports déjà faits. Un lot se relit à la même adresse (« ?lot=… »). Les factures d'achat déposées ici partent
 * dans Factures.
 */

const PAGE = 60;
const today = () => new Date().toLocaleDateString("sv-SE");
const DOMAINS = Object.entries(DOMAIN_LABELS);


/** Bien auquel un document est rattaché : sa ville (plus courte), sinon son nom, lus dans la liste des biens gardée en cache. */
function PropertyName({ id }: { id: string | null }) {
  const p = useProperties().data?.properties.find((x) => x.id === id);
  return (
    <span className="block truncate" title={p?.name}>
      {p?.city ?? p?.name ?? id ?? "—"}
    </span>
  );
}

/** Colonnes du coffre (ordinateur). */
const DOC_COLUMNS: Column<DocSummary>[] = [
  {
    key: "title",
    header: t("Document"),
    sort: (d) => d.title,
    className: "max-w-0 w-full",
    cell: (d) => (
      <span className="block min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{d.title}</span>
          {d.owner_user_id != null && <Lock size={11} className="shrink-0 text-muted" aria-label={t("Privé")} />}
        </span>
        {d.snippet && <span className="block truncate text-[12px] text-muted">{d.snippet}</span>}
      </span>
    ),
  },
  { key: "kind", header: t("Type"), width: "150px", sort: (d) => KIND_LABELS[d.kind] ?? d.kind, cell: (d) => <span className="whitespace-nowrap text-muted">{KIND_LABELS[d.kind] ?? d.kind}</span> },
  { key: "domain", header: t("Domaine"), width: "110px", hideBelow: "lg", sort: (d) => DOMAIN_LABELS[d.domain] ?? d.domain, cell: (d) => <span className="text-muted">{DOMAIN_LABELS[d.domain] ?? d.domain}</span> },
  {
    key: "entity",
    header: t("Rattaché à"),
    width: "120px",
    hideBelow: "xl",
    sort: (d) => d.entity_id,
    cell: (d) => <span className="text-muted">{d.entity_type === "property" ? <PropertyName id={d.entity_id} /> : d.entity_id ? t("n° {id}", { id: d.entity_id }) : "—"}</span>,
  },
  { key: "date", header: t("Date"), width: "100px", sort: (d) => d.doc_date, cell: (d) => <span className="tnum text-muted">{d.doc_date ? dateFr(d.doc_date) : "—"}</span> },
  {
    key: "expires",
    header: t("Échéance"),
    width: "110px",
    hideBelow: "lg",
    sort: (d) => d.expires_at,
    cell: (d) =>
      d.expires_at ? <span className={clsx("tnum", d.expires_at < today() ? "text-neg" : "text-accent")}>{dateFr(d.expires_at)}</span> : <span className="text-muted">—</span>,
  },
];

export function Documents() {
  const [params, setParams] = useSearchParams();
  const lot = Number(params.get("lot")) || null;
  const demo = useDemo();
  // Un lot ouvert prend la place de la liste : on le relit, puis on revient au coffre.
  if (lot && !demo) return <Batch id={lot} onBack={() => setParams({ vue: "imports" }, { replace: true })} />;
  return <Vault />;
}

function Vault() {
  const desktop = useMedia("(min-width: 1024px)");
  const wide = useMedia("(min-width: 768px)");
  const demo = useDemo();
  const [params, setParams] = useSearchParams();
  const domain = params.get("domaine") ?? undefined;
  const openId = params.get("id") ? Number(params.get("id")) : null;
  const view = params.get("vue") === "imports" && !demo ? "imports" : "documents";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const ctx = useContextMenu();
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  // Imports déjà faits (hors démo, où l'import d'un lot n'existe pas) : onglet « Imports » et rappel de ce qui reste à relire.
  const batches = useQuery({ queryKey: ["imports"], queryFn: () => api<{ batches: BatchLine[] }>("/imports"), enabled: !demo });
  const lines = batches.data?.batches ?? [];
  const toReview = lines.filter((b) => b.status !== "annule" && Number(b.to_review) > 0);

  const list = useInfiniteQuery({
    // Filtres, recherche : la liste reste affichée pendant le chargement de la suivante (pas de squelette).
    placeholderData: keepPreviousData,
    queryKey: ["documents", { domain, q: debounced }],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ limit: String(PAGE), offset: String(pageParam) });
      if (domain) sp.set("domain", domain);
      if (debounced) sp.set("q", debounced);
      return api<{ documents: DocSummary[]; hasMore: boolean }>(`/documents?${sp}`);
    },
    getNextPageParam: (last, all) => (last.hasMore ? all.length * PAGE : undefined),
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.documents) ?? [], [list.data]);
  const groups = useMemo(() => {
    if (debounced) return [{ title: t("Résultats"), items: rows }];
    const out: { title: string; items: DocSummary[] }[] = [];
    for (const d of rows) {
      const title = d.doc_date?.slice(0, 4) ?? t("Sans date");
      const last = out.at(-1);
      if (last?.title === title) last.items.push(d);
      else out.push({ title, items: [d] });
    }
    return out;
  }, [rows, debounced]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const openBatch = (id: number) => setParams({ lot: String(id) });
  const deposit = { onBatch: openBatch, onDocument: (id: number) => setParam("id", String(id)) };

  return (
    <>
      <PageHeader title={t("Coffre")} subtitle={t("Tous tes papiers au même endroit : dépose, Pécule range et lit")} right={wide ? undefined : <AddDocumentButton {...deposit} />} />
      {wide && <DropZone {...deposit} />}
      {toReview.slice(0, 3).map((b) => (
        <button key={b.id} type="button" onClick={() => openBatch(b.id)} className="press card mb-3 flex w-full items-center gap-3 px-4 py-3 text-left md:py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-warn/15 text-warn">
            <ListChecks size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{t("Import « {nom} »", { nom: b.name })}</span>
            <span className="block text-xs text-muted">{tn("{n} fichier attend ta relecture", "{n} fichiers attendent ta relecture", Number(b.to_review), { n: Number(b.to_review) })}</span>
          </span>
          <span className="shrink-0 text-[13px] font-medium text-accent">{t("Relire")}</span>
          <ChevronRight size={16} className="shrink-0 text-muted" />
        </button>
      ))}
      {lines.length > 0 && (
        <Tabs
          value={view}
          options={[
            { value: "documents", label: t("Documents") },
            { value: "imports", label: t("Imports"), count: lines.length },
          ]}
          onChange={(v) => setParam("vue", v === "imports" ? "imports" : null)}
        />
      )}
      {view === "imports" ? <ImportsList lines={lines} onOpen={openBatch} /> : (
      <>
      <div className="sticky top-[calc(44px+env(safe-area-inset-top))] z-20 -mx-4 bg-bg/90 px-4 pb-3 pt-1 backdrop-blur-xl md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
        <label className="card flex items-center gap-2 px-4 py-3 md:px-3 md:py-1.5">
          <Search size={18} className="text-muted md:size-[15px]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Chercher dans le texte des documents…")}
            className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted md:text-[13px]"
            enterKeyHint="search"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label={t("Effacer")}>
              <X size={18} className="text-muted" />
            </button>
          )}
        </label>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {DOMAINS.filter(([k]) => k !== "autre").map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setParam("domaine", domain === k ? null : k)}
              className={clsx("press flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm shadow-sm md:rounded-md md:border md:px-2.5 md:py-1 md:text-[12.5px] md:shadow-none", domain === k ? "bg-accent font-medium text-white md:border-accent md:bg-accent-soft md:text-accent" : "bg-card text-muted ring-1 ring-line md:border-line md:ring-0 md:hover:text-ink")}
            >
              {label}
              {domain === k && <X size={14} />}
            </button>
          ))}
        </div>
      </div>

      {list.error && <ErrorBox error={list.error} />}
      {list.isLoading ? (
        <Spinner />
      ) : desktop && rows.length ? (
        <>
          <DataTable
            rows={rows}
            columns={DOC_COLUMNS}
            rowKey={(d) => String(d.id)}
            selectedKey={openId != null ? String(openId) : null}
            onRowClick={(d) => setParam("id", String(d.id))}
            onContextMenu={(d, e) =>
              ctx.open(e, [
                { label: t("Ouvrir la fiche"), icon: <PanelRight size={14} />, onSelect: () => setParam("id", String(d.id)) },
                { label: t("Ouvrir le fichier"), icon: <FileDown size={14} />, disabled: !d.file_mime, onSelect: () => window.open(`/api/documents/${d.id}/file`, "_blank", "noopener") },
                "separator",
                { label: t("Demander à l'assistant"), icon: <MessageSquare size={14} />, onSelect: () => askAssistant(t("Résume-moi le document « {titre} » et ce qu'il implique pour nous.", { titre: d.title })) },
                { label: t("Copier le titre"), icon: <Copy size={14} />, onSelect: () => navigator.clipboard.writeText(d.title).then(() => toast.success(t("Titre copié"))) },
              ])
            }
            initialSort={debounced ? null : { key: "date", dir: "desc" }}
          />
          <ContextMenu menu={ctx.menu} onClose={ctx.close} />
          {list.hasNextPage && (
            <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="mt-3 w-full rounded-md py-2 text-[13px] font-medium text-accent hover:bg-accent-soft">
              {list.isFetchingNextPage ? t("Chargement…") : t("Afficher plus")}
            </button>
          )}
        </>
      ) : rows.length === 0 ? (
        <Empty>{debounced ? t("Aucun document ne contient ces mots.") : wide ? t("Le coffre est vide. Glisse un fichier ou un dossier dans la zone ci-dessus : Pécule le range.") : t("Le coffre est vide. Ajoute un PDF ou une photo : Pécule le range.")}</Empty>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">{g.title}</h2>
              <Card className="divide-y divide-line">
                {g.items.map((d) => (
                  <DocRow key={d.id} d={d} onClick={() => setParam("id", String(d.id))} />
                ))}
              </Card>
            </section>
          ))}
          {list.hasNextPage && (
            <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="press card w-full py-3 font-medium text-accent">
              {list.isFetchingNextPage ? t("Chargement…") : t("Afficher plus")}
            </button>
          )}
        </div>
      )}

      </>
      )}

      {openId != null && <DocumentSheet id={openId} onClose={() => setParam("id", null)} />}
    </>
  );
}

/* ---------- Dépôt ---------- */

type DepositTargets = { onBatch: (id: number) => void; onDocument?: (id: number) => void };

/**
 * Dépôt au coffre, même logique partout. Un lot (plusieurs fichiers, un dossier) ouvre un import : chaque fichier est
 * rangé, lu et proposé à la relecture. Un fichier seul choisi au téléphone (`quick`), ou tout dépôt en démo (où
 * l'import d'un lot n'existe pas), est rangé tout de suite.
 */
function useDeposit({ onBatch, onDocument }: DepositTargets) {
  const qc = useQueryClient();
  const demo = useDemo();
  const [progress, setProgress] = useState<Progress | "rangement" | null>(null);

  async function fileNow(file: File) {
    const r = await uploadToInbox(file);
    await Promise.all([invalidateDocuments(qc), invalidateInvoices(qc)]);
    if (r.type === "invoice") toast.success(t("C'est une facture : rangée dans Factures (« {titre} »)", { titre: r.title }));
    else toast.success(r.created ? t("Rangé : « {titre} »", { titre: r.title }) : t("Document déjà dans le coffre"));
    if (r.type === "document") onDocument?.(r.id);
  }

  async function deposit(picked: Picked[], quick = false) {
    if (!picked.length || progress) return;
    try {
      if (demo || (quick && picked.length === 1)) {
        setProgress("rangement");
        for (const p of picked.slice(0, 5)) await fileNow(p.file);
        return;
      }
      const name = picked[0].path.includes("/") ? picked[0].path.split("/")[0] : picked.length === 1 ? picked[0].path : t("Fichiers du {date}", { date: dateFr(new Date().toLocaleDateString("sv-SE")) });
      const batch = await startImport(name, picked, setProgress);
      void qc.invalidateQueries({ queryKey: ["imports"] });
      onBatch(batch.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Envoi impossible"));
    } finally {
      setProgress(null);
    }
  }
  return { progress, deposit, demo };
}

const progressLabel = (p: Progress | "rangement") =>
  p === "rangement" ? t("Rangement…") : p.step === "empreintes" ? t("Préparation des fichiers… {a} sur {b}", { a: p.done, b: p.total }) : t("Envoi… {a} sur {b}", { a: p.done, b: p.total });

/** Zone de dépôt (ordinateur) : on y glisse des fichiers ou un dossier, depuis n'importe où dans la page. */
function DropZone(targets: DepositTargets) {
  const { progress, deposit, demo } = useDeposit(targets);
  const folder = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const run = useRef(deposit);
  run.current = deposit;
  // Toute la page reçoit le dépôt (pas besoin de viser la zone) ; le panneau de l'assistant garde le sien.
  useEffect(() => {
    let depth = 0;
    const mine = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files") && !!(e.target as Element | null)?.closest?.(".main-content");
    const enter = (e: DragEvent) => {
      if (!mine(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!mine(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const hover = (e: DragEvent) => {
      if (mine(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setOver(false);
      if (!mine(e) || e.defaultPrevented) return;
      e.preventDefault();
      void droppedFiles(e.dataTransfer!).then((picked) => run.current(picked));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", hover);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", hover);
      window.removeEventListener("drop", drop);
    };
  }, []);
  const pick = (list: FileList | null, input: HTMLInputElement | null) => {
    if (list?.length) void deposit(pickedFiles(list));
    if (input) input.value = "";
  };
  const ratio = progress && progress !== "rangement" && progress.total ? progress.done / progress.total : null;
  return (
    <section
      aria-label={t("Déposer des documents")}
      className={clsx(
        "relative mb-5 flex items-center gap-4 overflow-hidden rounded-xl border-2 border-dashed px-5 py-4 transition-[border-color,background-color,transform] duration-150",
        over ? "scale-[1.005] border-accent bg-accent-soft" : "border-line bg-card/60 hover:border-accent/50",
      )}
    >
      <span className={clsx("grid size-12 shrink-0 place-items-center rounded-xl transition-colors", over ? "bg-accent text-white" : "bg-accent-soft text-accent")}>
        <FolderUp size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{over ? t("Dépose : Pécule s'occupe du reste") : demo ? t("Glisse ici un fichier") : t("Glisse ici un dossier ou des fichiers")}</p>
        <p className="mt-0.5 max-w-3xl text-[12.5px] leading-snug text-muted">
          {demo
            ? t("PDF ou photo : le fichier est rangé tout de suite. L'import d'un dossier entier, avec lecture des données, n'est pas proposé en mode démo.")
            : t("PDF, photos, exports de la banque : chaque fichier est rangé, et Pécule lit ceux qu'il reconnaît (bulletins de paie, avis d'impôt, relevés, contrats, factures) pour te proposer leurs données. Rien n'est écrit sans ta validation.")}
        </p>
        {ratio != null && (
          <div className="mt-2 h-1 max-w-md overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
        )}
      </div>
      {progress ? (
        <p className="shrink-0 text-[13px] font-medium text-accent" role="status">
          {progressLabel(progress)}
        </p>
      ) : (
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button type="button" onClick={() => files.current?.click()} className="press flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white shadow-[0_1px_2px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]">
            <Plus size={15} /> {demo ? t("Choisir un fichier") : t("Choisir des fichiers")}
          </button>
          {!demo && (
            <button type="button" onClick={() => folder.current?.click()} className="press rounded-md border border-line bg-card px-3 py-1.5 text-[13px] font-medium hover:text-accent">
              {t("Choisir un dossier")}
            </button>
          )}
        </div>
      )}
      {/* @ts-expect-error webkitdirectory : attribut du sélecteur de dossier, absent des types de React */}
      <input ref={folder} type="file" webkitdirectory="" multiple className="hidden" onChange={(e) => pick(e.target.files, e.target)} />
      <input ref={files} type="file" multiple={!demo} className="hidden" onChange={(e) => pick(e.target.files, e.target)} />
    </section>
  );
}

/** Imports déjà faits : un lot se rouvre pour relire, valider ou annuler ce qu'il a apporté. */
function ImportsList({ lines, onOpen }: { lines: BatchLine[]; onOpen: (id: number) => void }) {
  if (!lines.length) return <Empty>{t("Aucun import pour l'instant.")}</Empty>;
  return (
    <>
      <Card className="divide-y divide-line">
        {lines.map((b) => (
          <button key={b.id} type="button" onClick={() => onOpen(b.id)} className="press flex w-full items-center gap-3 px-4 py-3 text-left md:py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium md:text-[14px]">{b.name}</span>
              <span className="block text-xs text-muted">
                {dateFr(b.created_at.slice(0, 10))} · {tn("{n} fichier", "{n} fichiers", Number(b.files), { n: Number(b.files) })}
                {b.status === "annule" ? ` · ${t("annulé")}` : Number(b.to_review) > 0 ? ` · ${t("{n} à relire", { n: Number(b.to_review) })}` : ""}
              </span>
            </span>
            <ChevronRight size={17} className="shrink-0 text-muted" />
          </button>
        ))}
      </Card>
      <p className="mt-3 px-1 text-xs text-muted">
        {t("Chaque fichier est rangé au coffre. Ceux que Pécule sait lire donnent une proposition, que tu relis avant qu'elle ne soit écrite dans tes écrans ; tout import peut être annulé. La lecture passe par ton fournisseur d'IA : le coût est estimé avant, mesuré ensuite, et plafonné par lot.")}
      </p>
    </>
  );
}

function DocRow({ d, onClick }: { d: DocSummary; onClick: () => void }) {
  const expired = d.expires_at && d.expires_at < today();
  return (
    <button type="button" onClick={onClick} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
      <FileIcon mime={d.file_mime ?? "application/pdf"} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{d.title}</div>
        <div className="flex items-center gap-1 truncate text-xs text-muted">
          <span>{KIND_LABELS[d.kind] ?? d.kind}</span>
          <span>· {DOMAIN_LABELS[d.domain] ?? d.domain}</span>
          {d.doc_date && <span>· {dateFr(d.doc_date)}</span>}
          {d.owner_user_id != null && <Lock size={11} className="shrink-0" aria-label={t("Privé")} />}
          {d.expires_at && <CalendarClock size={12} className={clsx("shrink-0", expired ? "text-neg" : "text-accent")} aria-label={t("Échéance")} />}
        </div>
        {d.snippet && <div className="mt-0.5 line-clamp-2 text-xs text-muted">{d.snippet}</div>}
      </div>
    </button>
  );
}

/** Bouton « Ajouter » (téléphone) : une photo ou un PDF est rangé tout de suite, plusieurs fichiers ouvrent un import. */
function AddDocumentButton(targets: DepositTargets) {
  const { progress, deposit, demo } = useDeposit(targets);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple={!demo}
        accept="application/pdf,image/*,.txt,.md,.csv,.ofx,.qfx,.qif"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void deposit(pickedFiles(e.target.files), true);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={!!progress}
        onClick={() => input.current?.click()}
        className="press flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[14px] font-semibold text-white shadow-[0_1px_2px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] disabled:opacity-50"
      >
        {progress ? <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Plus size={16} />}
        {progress ? (progress === "rangement" ? t("Rangement…") : t("Envoi…")) : t("Ajouter")}
      </button>
    </>
  );
}

/** Types de documents dont Pécule sait tirer des données (import massif) ; hors démo. */
const EXTRACTABLE = new Set(["bulletin", "avis_impot", "taxe_fonciere", "pret", "acte", "bail", "releve", "assurance", "contrat"]);

function DocumentSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useDocument(id);
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const [showText, setShowText] = useState(false);
  const navigate = useNavigate();
  const d = detail.data;
  // Lecture du document par l'extracteur de son type : la proposition se relit dans le lot ouvert pour lui.
  async function extract() {
    try {
      const r = await api<{ batchId: number }>("/imports/from-document", { method: "POST", json: { documentId: id } });
      navigate(`/documents?lot=${r.batchId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Lecture impossible"));
    }
  }
  useAssistantEntity(d ? { type: "document", id: String(d.id), label: `${t("Document")} · ${d.title}` } : null);

  async function call(path: string, init: Parameters<typeof api>[1], ok?: string) {
    try {
      await api(path, init);
      await invalidateDocuments(qc);
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
      return false;
    }
  }

  async function remove() {
    if (!confirm(t("Supprimer ce document et son fichier ?"))) return;
    if (await call(`/documents/${id}`, { method: "DELETE" }, t("Document supprimé"))) onClose();
  }

  return (
    <Sheet open onClose={onClose} title={t("Document")}>
      {detail.error && <ErrorBox error={detail.error} />}
      {!d ? (
        <Spinner />
      ) : editing ? (
        <EditDocument d={d} isMine={d.owner_user_id === me.data?.user?.id} onDone={() => setEditing(false)} onSave={(body) => call(`/documents/${id}`, { method: "PATCH", json: body }, t("Document mis à jour"))} />
      ) : (
        <>
          <Card className="mb-3 p-4">
            <div className="text-[15px] font-semibold">{d.title}</div>
            <div className="mt-0.5 text-sm text-muted">
              {KIND_LABELS[d.kind] ?? d.kind} · {DOMAIN_LABELS[d.domain] ?? d.domain}
              {d.doc_date && ` · ${dateFr(d.doc_date)}`}
              {d.owner_user_id != null && t(" · privé")}
            </div>
            {d.expires_at && (
              <div className={clsx("mt-3 flex items-center gap-1.5 text-sm", d.expires_at >= today() ? "text-accent" : "text-neg")}>
                <CalendarClock size={15} />
                {d.expires_at >= today() ? t("Échéance le {date}", { date: dateFr(d.expires_at) }) : t("Échu depuis le {date}", { date: dateFr(d.expires_at) })}
              </div>
            )}
            {d.summary && <p className="mt-3 text-sm leading-relaxed">{d.summary}</p>}
          </Card>

          {d.facts.length > 0 && (
            <Card className="mb-3 divide-y divide-line">
              {d.facts.map((f, i) => (
                <div key={i} className="flex justify-between gap-4 px-4 py-2 text-sm">
                  <span className="text-muted">{f.label}</span>
                  <span className="text-right font-medium">{f.value}</span>
                </div>
              ))}
            </Card>
          )}

          {d.has_file && d.file_mime ? <FilePreview url={`/api/documents/${id}/file`} mime={d.file_mime} /> : null}

          <div className="mb-3 flex gap-2">
            {d.has_file ? (
              <a href={`/api/documents/${id}/file`} target="_blank" rel="noreferrer" className="press flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-white">
                <ExternalLink size={17} /> {t("Ouvrir")}
              </a>
            ) : null}
            <button type="button" onClick={() => setEditing(true)} className="press flex-1 rounded-xl bg-card py-3 font-semibold ring-1 ring-line">
              {t("Modifier")}
            </button>
          </div>
          {d.has_file && EXTRACTABLE.has(d.kind) && !me.data?.user?.demo && (
            <button type="button" onClick={extract} className="press mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-card py-2.5 text-sm font-semibold ring-1 ring-line">
              <TableProperties size={16} /> {t("Extraire les données vers mes écrans")}
            </button>
          )}
          <button
            type="button"
            onClick={() => askAssistant(t("Résume le document n° {id} « {titre} » et dis-moi ce que je dois retenir ou faire.", { id: d.id, titre: d.title }))}
            className="press mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-soft py-2.5 text-sm font-semibold text-accent"
          >
            <Sparkles size={16} /> {t("Demander à l'assistant")}
          </button>

          {d.text && (
            <section className="mb-2">
              <button type="button" onClick={() => setShowText((s) => !s)} className="px-1 text-[12.5px] font-medium text-muted">
                {showText ? t("Masquer le texte") : t("Texte extrait ({n} k caractères)", { n: Math.round(d.text_length / 1000) })}
              </button>
              {showText && <pre className="card mt-1.5 max-h-96 overflow-y-auto whitespace-pre-wrap p-4 font-sans text-xs leading-relaxed">{d.text}</pre>}
            </section>
          )}

          <button type="button" onClick={remove} className="mt-4 flex w-full items-center justify-center gap-1.5 py-2 text-sm text-neg">
            <Trash2 size={15} /> {t("Supprimer le document")}
          </button>
        </>
      )}
    </Sheet>
  );
}

function EditDocument({ d, isMine, onDone, onSave }: { d: DocDetail; isMine: boolean; onDone: () => void; onSave: (body: unknown) => Promise<boolean> }) {
  const [title, setTitle] = useState(d.title);
  const [kind, setKind] = useState(d.kind);
  const [domain, setDomain] = useState(d.domain);
  const [docDate, setDocDate] = useState(d.doc_date ?? "");
  const [expires, setExpires] = useState(d.expires_at ?? "");
  const [summary, setSummary] = useState(d.summary ?? "");
  const [priv, setPriv] = useState(d.owner_user_id != null);
  const select = "card block w-full px-4 py-3 text-[16px] outline-none";
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await onSave({ title, kind, domain, docDate: docDate || null, expiresAt: expires || null, summary: summary || null, private: priv });
        if (ok) onDone();
      }}
    >
      <Field label={t("Titre")} value={title} onChange={setTitle} text />
      <label className="block">
        <span className="px-1 text-xs text-muted">{t("Type")}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("Type de document")} className={select}>
          {Object.entries(KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="px-1 text-xs text-muted">{t("Domaine")}</span>
        <select value={domain} onChange={(e) => setDomain(e.target.value)} aria-label={t("Domaine")} className={select}>
          {DOMAINS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="card block px-4 py-3">
          <span className="block text-xs text-muted">{t("Date")}</span>
          <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="w-full bg-transparent text-[16px] outline-none" />
        </label>
        <label className="card block px-4 py-3">
          <span className="block text-xs text-muted">{t("Échéance")}</span>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="w-full bg-transparent text-[16px] outline-none" />
        </label>
      </div>
      <label className="card block px-4 py-3">
        <span className="block text-xs text-muted">{t("Résumé")}</span>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} className="w-full resize-none bg-transparent text-[15px] outline-none" />
      </label>
      {(isMine || d.owner_user_id == null) && (
        <label className="card flex items-center justify-between px-4 py-3 text-[15px]">
          {t("Visible par moi seul")}
          <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="size-5 accent-[var(--color-accent)]" />
        </label>
      )}
      <div className="flex gap-2 pt-2">
        <button type="submit" className="press flex-1 rounded-xl bg-accent py-3 font-semibold text-white">
          {t("Enregistrer")}
        </button>
        <button type="button" onClick={onDone} className="press flex-1 rounded-xl bg-card py-3 font-semibold text-muted ring-1 ring-line">
          {t("Annuler")}
        </button>
      </div>
    </form>
  );
}
