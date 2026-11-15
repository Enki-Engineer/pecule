import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeEuro, Bitcoin, BookOpen, Building2, CalendarClock, Landmark, Sunset, TrendingUp, CreditCard, FileText, FolderOpen, LayoutDashboard, ListOrdered, PieChart, PiggyBank, Receipt, Search, Settings, Sparkles, Wallet } from "lucide-react";
import { api } from "../api.ts";
import { cn } from "../cn.ts";
import { dateFr, money, moneyIn } from "../format.ts";
import { txTitle } from "../../lib/labels.ts";
import { askAssistant } from "../assistantBus.ts";
import { t } from "../../lib/i18n.ts";
import { useEnabled } from "../modules.ts";

/** Ouvre la palette depuis n'importe où (bouton loupe, raccourci ⌘K). */
export const openPalette = () => window.dispatchEvent(new Event("pecule-palette"));

type Results = {
  transactions: { id: string; date: string; amount: number; label: string; merchant: string | null; category_name: string | null; account_name: string }[];
  invoices: { id: number; merchant: string; title: string; invoice_date: string | null; total: number | null; currency: string }[];
  accounts: { id: string; name: string; kind: string; balance: number | null }[];
  assets: { id: number; name: string; category: string; value: number | null }[];
  crypto: { symbol: string; name: string; quantity: number }[];
  documents?: { id: number; title: string; kind: string; domain: string; doc_date: string | null; snippet: string | null }[];
};

type Entry = { key: string; group: string; icon: typeof Search; label: string; hint?: string; run: () => void };

const PAGES: { label: string; to: string; icon: typeof Search; words: string }[] = [
  { label: t("Tableau de bord"), to: "/", icon: LayoutDashboard, words: t("accueil tableau bord") },
  { label: t("Opérations"), to: "/operations", icon: ListOrdered, words: t("operations transactions depenses") },
  { label: t("Opérations à classer"), to: "/operations?a_classer=1", icon: ListOrdered, words: t("a classer categoriser") },
  { label: t("Mois"), to: "/mois", icon: PieChart, words: t("mois budget depenses revenus solde") },
  { label: t("Factures"), to: "/factures", icon: Receipt, words: t("factures garanties tickets") },
  { label: t("Patrimoine"), to: "/patrimoine", icon: PiggyBank, words: t("patrimoine net immobilier placements credits") },
  { label: t("Crypto"), to: "/patrimoine/crypto", icon: Bitcoin, words: t("crypto bitcoin ethereum coinstats") },
  { label: t("Budget"), to: "/budget", icon: Wallet, words: t("budget frais fixes charges contrats abonnements reste a vivre revenus") },
  { label: t("Immobilier"), to: "/immobilier", icon: Building2, words: t("immobilier biens appartement maison sci loyer bail") },
  { label: t("Revenus"), to: "/revenus", icon: BadgeEuro, words: t("revenus salaire fiches de paie bulletins net brut") },
  { label: t("Impôts"), to: "/impots", icon: Landmark, words: t("impots revenu taxe fonciere avis tmi") },
  { label: t("Retraite"), to: "/retraite", icon: Sunset, words: t("retraite trimestres pension carriere") },
  { label: t("Projections"), to: "/projections", icon: TrendingUp, words: t("projections scenarios 2031 patrimoine futur") },
  { label: t("Coffre"), to: "/documents", icon: FolderOpen, words: t("documents coffre contrats avis impot bail acte diagnostic") },
  { label: t("Importer des documents"), to: "/documents", icon: FolderOpen, words: t("importer dossier documents lot bulletins avis releves depot massif") },
  { label: t("Échéancier"), to: "/echeancier", icon: CalendarClock, words: t("echeancier echeances taches a faire rappels jalons calendrier") },
  { label: t("Manuel"), to: "/manuel", icon: BookOpen, words: t("manuel aide mode d'emploi guide documentation comment faire") },
  { label: t("Réglages"), to: "/reglages", icon: Settings, words: t("reglages parametres preferences") },
  { label: `${t("Réglages")} · ${t("Compte et sécurité")}`, to: "/reglages/compte", icon: Settings, words: t("membres cles d'acces passkey face id inscription deconnexion securite") },
  { label: t("Mode démo"), to: "/reglages/demo", icon: Settings, words: t("demo demonstration montrer presenter donnees fictives discretion") },
  { label: `${t("Réglages")} · ${t("Foyer")}`, to: "/reglages/foyer", icon: Settings, words: t("foyer pays devise monnaie fuseau horaire ecrans affiches modules personnes enfant banques professionnelles") },
  { label: `${t("Réglages")} · ${t("Comptes et connexions")}`, to: "/reglages/connexions", icon: Settings, words: t("comptes connexions banque enable banking finta fichier ofx csv masque hors stats solde nom ia fournisseur cle crypto coinstats coingecko jetons applications raccourci calendrier") },
  { label: `${t("Réglages")} · ${t("Classement")}`, to: "/reglages/classement", icon: Settings, words: t("regles classement categories libelle enseignes logo commerce") },
  { label: `${t("Réglages")} · ${t("Apparence")}`, to: "/reglages/apparence", icon: Settings, words: t("theme sombre clair couleur saisons noel halloween paques") },
  { label: `${t("Réglages")} · ${t("Notifications et appareil")}`, to: "/reglages/notifications", icon: Settings, words: t("notifications alertes push appareil hors ligne ouverture instantanee") },
  { label: `${t("Réglages")} · ${t("Assistant")}`, to: "/reglages/assistant", icon: Settings, words: t("memoire assistant voix cout ia") },
  { label: `${t("Réglages")} · ${t("Suivi technique")}`, to: "/reglages/suivi", icon: Settings, words: t("alertes techniques journal audit synchronisation banque") },
];

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function CommandPalette() {
  const pages = useEnabled(PAGES);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("pecule-palette", show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pecule-palette", show);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setText("");
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), 200);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  // Le manuel se cherche aussi d'ici ; son texte n'est chargé qu'à la première ouverture de la palette.
  const [manual, setManual] = useState<typeof import("../../lib/manual.ts") | null>(null);
  useEffect(() => {
    if (open && !manual) void import("../../lib/manual.ts").then(setManual, () => undefined);
  }, [open, manual]);

  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api<Results>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
    placeholderData: (prev) => prev,
  });

  const entries = useMemo<Entry[]>(() => {
    const go = (to: string, state?: unknown) => () => {
      setOpen(false);
      navigate(to, state ? { state } : undefined);
    };
    const q = norm(text.trim());
    const out: Entry[] = pages.filter((p) => !q || norm(`${p.label} ${p.words}`).includes(q)).map((p) => ({
      // Deux entrées peuvent mener au même écran (« Coffre », « Importer des documents ») : le libellé les distingue.
      key: `p:${p.to}:${p.label}`,
      group: t("Aller à"),
      icon: p.icon,
      label: p.label,
      run: go(p.to),
    }));
    const r = debounced.length >= 2 ? search.data : undefined;
    if (r) {
      for (const tx of r.transactions)
        out.push({
          key: `t:${tx.id}`,
          group: t("Opérations"),
          icon: CreditCard,
          label: txTitle(tx),
          hint: `${dateFr(tx.date)} · ${money(Number(tx.amount))}`,
          run: go(`/operations?q=${encodeURIComponent(tx.merchant ?? debounced)}`, { openTx: tx.id }),
        });
      for (const i of r.invoices)
        out.push({
          key: `i:${i.id}`,
          group: t("Factures"),
          icon: FileText,
          label: `${i.merchant} — ${i.title}`,
          hint: [i.invoice_date && dateFr(i.invoice_date), i.total != null && moneyIn(Number(i.total), i.currency)].filter(Boolean).join(" · "),
          run: go(`/factures?id=${i.id}`),
        });
      for (const a of r.accounts)
        out.push({ key: `a:${a.id}`, group: t("Comptes"), icon: Wallet, label: a.name, hint: a.balance != null ? money(Number(a.balance)) : undefined, run: go(`/operations?compte=${encodeURIComponent(a.id)}`) });
      for (const a of r.assets) out.push({ key: `s:${a.id}`, group: t("Patrimoine"), icon: PiggyBank, label: a.name, hint: a.value != null ? money(Number(a.value)) : undefined, run: go("/patrimoine") });
      for (const d of r.documents ?? [])
        out.push({
          key: `d:${d.id}`,
          group: t("Documents"),
          icon: FolderOpen,
          label: d.title,
          hint: [d.doc_date && dateFr(d.doc_date), d.snippet?.slice(0, 60)].filter(Boolean).join(" · "),
          run: go(`/documents?id=${d.id}`),
        });
      for (const c of r.crypto) out.push({ key: `c:${c.symbol}`, group: t("Crypto"), icon: Bitcoin, label: `${c.name} (${c.symbol})`, run: go("/patrimoine/crypto") });
    }
    // Articles du manuel : les plus proches de ce qui est tapé (« comment relier ma banque »).
    if (manual && text.trim().length >= 3)
      for (const h of manual.searchManual(text, { limit: 4 }))
        out.push({
          key: `m:${h.article.id}`,
          group: t("Manuel"),
          icon: BookOpen,
          label: manual.manualText(h.article.title, undefined, false),
          hint: manual.manualText(h.theme.title, undefined, false),
          run: go(`/manuel/${h.article.id}`),
        });
    if (text.trim().length >= 3)
      out.push({
        key: "ask",
        group: t("Assistant"),
        icon: Sparkles,
        label: t("Demander à l'assistant : « {texte} »", { texte: text.trim() }),
        run: () => {
          setOpen(false);
          askAssistant(text.trim());
        },
      });
    return out;
  }, [text, debounced, search.data, navigate, pages, manual]);

  useEffect(() => {
    setActive(0);
  }, [entries.length]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/30 p-3 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label={t("Rechercher")}
        className="card flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, entries.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            entries[active]?.run();
          }
        }}
      >
        <label className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search size={18} className="text-muted" />
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("Rechercher une opération, une facture, un compte… ou poser une question")}
            className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] text-muted md:block">{t("Échap")}</kbd>
        </label>
        <div className="overflow-y-auto py-2">
          {entries.map((e, i) => (
            <div key={e.key}>
              {(i === 0 || entries[i - 1].group !== e.group) && <div className="px-4 pb-1 pt-2 text-[12.5px] font-medium text-muted">{e.group}</div>}
              <button
                type="button"
                onMouseMove={() => setActive(i)}
                onClick={e.run}
                className={cn("flex w-full items-center gap-3 px-4 py-2 text-left text-[15px]", i === active && "bg-accent-soft")}
              >
                <e.icon size={17} className={cn("shrink-0", i === active ? "text-accent" : "text-muted")} />
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                {e.hint && <span className="tnum shrink-0 text-xs text-muted">{e.hint}</span>}
                {i === active && <ArrowRight size={15} className="shrink-0 text-accent" />}
              </button>
            </div>
          ))}
          {debounced.length >= 2 && search.isFetching && <div className="px-4 py-2 text-sm text-muted">{t("Recherche…")}</div>}
          {!entries.length && <div className="px-4 py-6 text-center text-sm text-muted">{t("Aucun résultat.")}</div>}
        </div>
      </div>
    </div>
  );
}
