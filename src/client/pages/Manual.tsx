import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Compass,
  FolderOpen,
  Landmark,
  ListOrdered,
  Palette,
  PieChart,
  PiggyBank,
  Plug,
  Receipt,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Card, Empty, PageHeader } from "../components/ui.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { askAssistant } from "../assistantBus.ts";
import { cn } from "../cn.ts";
import { useModulesOff } from "../modules.ts";
import { useCrumb } from "../shell.ts";
import { useMedia } from "../useMedia.ts";
import { t } from "../../lib/i18n.ts";
import { MANUAL, articleBody, findArticle, linkLabel, manualText, searchManual, type ManualArticle, type ManualEntry, type ManualTheme } from "../../lib/manual.ts";
import { MODULE_INFO } from "../../lib/modules.ts";

/*
 * Manuel de Pécule : les thèmes, leurs articles et une recherche. Le contenu est dans src/lib/manual/ ;
 * l'assistant lit le même. Adresses : /manuel (les thèmes), /manuel/<thème> (ses articles), /manuel/<article>,
 * et ?q= pour une recherche. Téléphone : un écran par niveau ; ordinateur : sommaire à gauche, article à droite.
 */

const ICONS: Record<string, LucideIcon> = {
  "premiers-pas": Compass,
  comptes: Plug,
  operations: ListOrdered,
  "analyse-budget": PieChart,
  factures: Receipt,
  patrimoine: PiggyBank,
  situation: Landmark,
  documents: FolderOpen,
  assistant: Sparkles,
  personnaliser: Palette,
  foyer: Users,
  securite: ShieldCheck,
};
const iconOf = (theme: ManualTheme) => ICONS[theme.id] ?? BookOpen;
/** Titre ou résumé : du texte simple, sans mise en forme. */
const plain = (text: string) => manualText(text, undefined, false);

export function Manual() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const desktop = useMedia("(min-width: 768px)");
  const entry = id ? findArticle(id) : undefined;
  const theme = entry?.theme ?? (id ? MANUAL.find((th) => th.id === id) : undefined);
  useCrumb(entry ? plain(entry.article.title) : theme ? plain(theme.title) : null);
  const hits = useMemo(() => (query.trim() ? searchManual(query, { limit: 12 }) : null), [query]);
  const setQuery = (q: string) => setParams(q ? { q } : {}, { replace: true });
  const view = { query, setQuery, hits, entry, theme };
  if (desktop) return <ManualDesktop {...view} />;
  return <ManualMobile {...view} />;
}

type View = { query: string; setQuery: (q: string) => void; hits: ManualEntry[] | null; entry?: ManualEntry; theme?: ManualTheme };

/** Adresse d'un article ou d'un thème ; la recherche en cours suit (la liste des résultats reste affichée sur ordinateur). */
const href = (id: string, query: string) => `/manuel/${id}${query ? `?q=${encodeURIComponent(query)}` : ""}`;

function SearchField({ query, setQuery, autoFocus }: { query: string; setQuery: (q: string) => void; autoFocus?: boolean }) {
  return (
    <label className="card flex items-center gap-2 px-4 py-2.5">
      <Search size={16} className="shrink-0 text-muted" />
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("Chercher dans le manuel…")}
        aria-label={t("Chercher dans le manuel…")}
        className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button type="button" onClick={() => setQuery("")} aria-label={t("Effacer")} className="shrink-0 text-muted hover:text-ink">
          <X size={16} />
        </button>
      )}
    </label>
  );
}

/** Aucun article ne répond : la question part à l'assistant, qui lit le même manuel et les données du foyer. */
function AskAssistant({ question, label }: { question: string; label: string }) {
  return (
    <button type="button" onClick={() => askAssistant(question)} className="press card flex w-full items-center gap-3 px-4 py-3 text-left">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-white">
        <Sparkles size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium md:text-[14px]">{label}</span>
        <span className="block text-[12px] text-muted">{t("Il connaît ce manuel, t'y renvoie, et peut faire certains réglages à ta place.")}</span>
      </span>
      <ChevronRight size={17} className="shrink-0 text-muted" />
    </button>
  );
}

function ArticleRows({ entries, query, withTheme, current }: { entries: readonly ManualEntry[]; query: string; withTheme?: boolean; current?: string }) {
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {entries.map(({ article, theme }) => (
        <Link key={article.id} to={href(article.id, query)} aria-current={article.id === current ? "page" : undefined} className={cn("press flex items-center gap-3 px-4 py-3", article.id === current && "bg-bg")}>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium md:text-[14px]">{plain(article.title)}</span>
            <span className="block text-[12.5px] text-muted">
              {withTheme && <span className="font-medium">{plain(theme.title)} · </span>}
              {plain(article.summary)}
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-muted" />
        </Link>
      ))}
    </Card>
  );
}

function Results({ hits, query }: { hits: ManualEntry[]; query: string }) {
  return (
    <div className="space-y-3">
      {hits.length ? <ArticleRows entries={hits} query={query} withTheme /> : <Empty>{t("Aucun article ne contient ces mots.")}</Empty>}
      <AskAssistant question={query.trim()} label={t("Poser la question à l'assistant")} />
    </div>
  );
}

function ThemeCards({ themes }: { themes: readonly ManualTheme[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {themes.map((th) => {
        const Icon = iconOf(th);
        return (
          <Link key={th.id} to={`/manuel/${th.id}`} className="press card flex items-start gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold md:text-[15px]">{plain(th.title)}</span>
              <span className="block text-[12.5px] text-muted">{plain(th.hint)}</span>
            </span>
            <ChevronRight size={17} className="mt-1 shrink-0 text-muted" />
          </Link>
        );
      })}
    </div>
  );
}

function Article({ article, theme }: { article: ManualArticle; theme: ManualTheme }) {
  const off = useModulesOff();
  const removed = article.module && off.includes(article.module) ? article.module : null;
  const title = plain(article.title);
  return (
    <article className="space-y-4">
      {removed && (
        <Card className="p-4 text-sm">
          {t("L'écran « {nom} » est retiré de l'appli pour ton foyer : ce que décrit cet article n'est pas affiché.", { nom: t(MODULE_INFO[removed].label) })}{" "}
          <Link to="/reglages/foyer" className="font-medium text-accent">
            {t("Le remettre : Réglages → Foyer")}
          </Link>
        </Card>
      )}
      <Card className="p-5 md:p-6">
        <Markdown text={articleBody(article)} className="text-[15px] md:text-[14.5px]" />
      </Card>
      {!!article.links?.length && (
        <div className="flex flex-wrap gap-2">
          {article.links.map((l) => (
            <Link key={l.to} to={l.to} className="press flex items-center gap-1.5 rounded-full bg-card px-3.5 py-2 text-[14px] font-medium text-accent ring-1 ring-line md:py-1.5 md:text-[13px]">
              {linkLabel(l)} <ArrowUpRight size={14} className="shrink-0" />
            </Link>
          ))}
        </div>
      )}
      <AskAssistant question={t("Dans Pécule, à propos de « {titre} » : ", { titre: title })} label={t("Une question sur ce sujet ? Demande à l'assistant")} />
      <p className="px-1 text-[12.5px] text-muted">
        {t("Thème :")}{" "}
        <Link to={`/manuel/${theme.id}`} className="font-medium text-accent">
          {plain(theme.title)}
        </Link>
      </p>
    </article>
  );
}

const SUBTITLE = t("Tout ce que Pécule sait faire, thème par thème");

function ManualMobile({ query, setQuery, hits, entry, theme }: View) {
  if (entry)
    return (
      <>
        <PageHeader title={plain(entry.article.title)} subtitle={plain(entry.article.summary)} />
        <Article article={entry.article} theme={entry.theme} />
      </>
    );
  if (theme)
    return (
      <>
        <PageHeader title={plain(theme.title)} subtitle={plain(theme.hint)} />
        <ArticleRows entries={theme.articles.map((article) => ({ article, theme }))} query="" />
      </>
    );
  return (
    <>
      <PageHeader title={t("Manuel")} subtitle={SUBTITLE} />
      <div className="space-y-4">
        <SearchField query={query} setQuery={setQuery} />
        {hits ? (
          <Results hits={hits} query={query} />
        ) : (
          <>
            <ThemeCards themes={MANUAL} />
            <AskAssistant question={t("Comment faire dans Pécule pour ")} label={t("Demander à l'assistant")} />
          </>
        )}
      </div>
    </>
  );
}

function ManualDesktop({ query, setQuery, hits, entry, theme }: View) {
  return (
    <>
      <PageHeader title={t("Manuel")} subtitle={SUBTITLE} />
      <div className="grid grid-cols-[264px_minmax(0,1fr)] gap-8">
        <nav className="sticky top-20 max-h-[calc(100vh-6rem)] self-start overflow-y-auto pb-4 pr-1" aria-label={t("Sommaire du manuel")}>
          <SearchField query={query} setQuery={setQuery} />
          <div className="mt-3">
            {hits ? (
              <>
                <div className="px-3 pb-1 text-[12.5px] font-medium text-muted">{t("Résultats")}</div>
                {hits.map(({ article }) => (
                  <NavRow key={article.id} to={href(article.id, query)} label={plain(article.title)} active={article.id === entry?.article.id} />
                ))}
                {!hits.length && <div className="px-3 py-2 text-[13px] text-muted">{t("Aucun article ne contient ces mots.")}</div>}
              </>
            ) : (
              MANUAL.map((th) => {
                const Icon = iconOf(th);
                const open = th.id === theme?.id;
                return (
                  <div key={th.id} className="mb-1">
                    <Link
                      to={`/manuel/${th.id}`}
                      className={cn("flex h-9 items-center gap-2.5 rounded-xl px-3 text-[14px] font-medium", open && !entry ? "bg-card font-semibold text-ink" : open ? "text-ink" : "text-muted hover:bg-card/70 hover:text-ink")}
                    >
                      <Icon size={15} className="shrink-0" />
                      <span className="flex-1 truncate">{plain(th.title)}</span>
                    </Link>
                    {open && th.articles.map((a) => <NavRow key={a.id} to={`/manuel/${a.id}`} label={plain(a.title)} active={a.id === entry?.article.id} nested />)}
                  </div>
                );
              })
            )}
          </div>
        </nav>
        <div className="min-w-0 max-w-[820px] space-y-5 pb-10">
          {entry ? (
            <>
              <div>
                <h2 className="text-[20px] font-semibold tracking-tight">{plain(entry.article.title)}</h2>
                <p className="text-[14px] text-muted">{plain(entry.article.summary)}</p>
              </div>
              <Article article={entry.article} theme={entry.theme} />
            </>
          ) : theme ? (
            <>
              <div>
                <h2 className="text-[20px] font-semibold tracking-tight">{plain(theme.title)}</h2>
                <p className="text-[14px] text-muted">{plain(theme.hint)}</p>
              </div>
              <ArticleRows entries={theme.articles.map((article) => ({ article, theme }))} query="" />
            </>
          ) : hits ? (
            <Results hits={hits} query={query} />
          ) : (
            <>
              <ThemeCards themes={MANUAL} />
              <AskAssistant question={t("Comment faire dans Pécule pour ")} label={t("Demander à l'assistant")} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function NavRow({ to, label, active, nested }: { to: string; label: string; active: boolean; nested?: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-8 items-center rounded-xl py-1.5 pr-3 text-[13.5px] leading-snug",
        nested ? "pl-[38px]" : "pl-3",
        active ? "bg-card font-semibold text-ink shadow-[0_1px_1px_rgb(20_20_19/0.04),0_6px_16px_-10px_rgb(20_20_19/0.18)]" : "text-muted hover:bg-card/70 hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}
