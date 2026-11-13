import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { api, type Account } from "../api.ts";
import { BankBadge } from "./ui.tsx";
import { ManualBalance, ManualCurrency } from "./ManualEntry.tsx";
import { cn } from "../cn.ts";
import { dateFr, money, moneyIn } from "../format.ts";
import { region } from "../region.ts";
import { brandOf } from "../../lib/brands.ts";
import { ownerLabel } from "../../lib/labels.ts";
import { t, tn } from "../../lib/i18n.ts";

/*
 * Les comptes qu'un connecteur alimente : une ligne par compte (banque, nom, nature, titulaire, solde). On touche une
 * ligne pour régler le compte : son nom, « masqué », « hors statistiques », et pour un compte tenu à la main sa
 * devise et son solde. Les comptes masqués se rangent sous une ligne repliée, pour ne pas noyer les autres.
 */

/** Ce qu'une carte à débit différé doit encore prélever (d'après la banque). */
export type CardNote = { count: number; debitDate: string | null };

const KIND = (kind: string) => (kind === "carte" ? t("Carte") : kind === "epargne" ? t("Épargne") : t("Compte courant"));

export function AccountList({ accounts, cards, empty }: { accounts: Account[]; cards?: Map<string, CardNote>; empty?: string }) {
  const [showHidden, setShowHidden] = useState(false);
  const shown = accounts.filter((a) => !a.hidden);
  const hidden = accounts.filter((a) => a.hidden);
  if (!accounts.length) return empty ? <p className="px-4 pb-4 text-sm text-muted">{empty}</p> : null;
  return (
    <div>
      <ul className="divide-y divide-line">
        {shown.map((a) => (
          <AccountRow key={a.id} a={a} card={cards?.get(a.id)} />
        ))}
      </ul>
      {hidden.length > 0 && (
        <>
          <button type="button" onClick={() => setShowHidden((v) => !v)} aria-expanded={showHidden} className={cn("press flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-muted", shown.length > 0 && "border-t border-line")}>
            <ChevronRight size={15} className={cn("transition-transform", showHidden && "rotate-90")} />
            {tn("{n} compte masqué", "{n} comptes masqués", hidden.length, { n: hidden.length })}
          </button>
          {showHidden && (
            <ul className="divide-y divide-line border-t border-line">
              {hidden.map((a) => (
                <AccountRow key={a.id} a={a} card={cards?.get(a.id)} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function AccountRow({ a, card }: { a: Account; card?: CardNote }) {
  const [open, setOpen] = useState(false);
  const title = a.display_name ?? a.name;
  // Un compte fermé d'une autre banque que celle qui l'a apporté porte souvent son nom : le logo le suit.
  const bank = brandOf(title)?.name ?? a.institution;
  const foreign = a.currency !== region().currency;
  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
        <BankBadge bank={bank} size="md" />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[15px] font-medium", !!a.hidden && "text-muted")}>{title}</span>
          <span className="block truncate text-xs text-muted">
            {KIND(a.kind)} · {ownerLabel(a.owner)}
            {card ? ` · ${tn("{n} achat", "{n} achats", card.count, { n: card.count })}${card.debitDate ? ` · ${t("prélevé le {date}", { date: dateFr(card.debitDate) })}` : ""}` : a.last_tx ? ` · ${t("dernière opération le {date}", { date: dateFr(a.last_tx) })}` : ` · ${t("aucune opération")}`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {a.balance != null && <span className={cn("tnum block text-[15px] font-medium", Number(a.balance) < 0 && "text-neg")}>{money(Number(a.balance))}</span>}
          {foreign && a.balance_original != null && <span className="tnum block text-xs text-muted">{moneyIn(Number(a.balance_original), a.currency)}</span>}
          {!!a.excluded && <span className="block text-[11px] font-medium text-muted">{t("hors statistiques")}</span>}
        </span>
        <ChevronDown size={16} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <AccountEditor a={a} />}
    </li>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 shrink-0 accent-[var(--color-accent)]" />
    </label>
  );
}

function AccountEditor({ a }: { a: Account }) {
  const qc = useQueryClient();
  const [name, setName] = useState(a.display_name ?? "");
  const patch = (body: Record<string, unknown>) =>
    api(`/accounts/${encodeURIComponent(a.id)}`, { method: "PATCH", json: body })
      .then(() => qc.invalidateQueries({ queryKey: ["accounts"] }))
      .catch((e) => toast.error(e instanceof Error ? e.message : t("Réglage non enregistré")));
  return (
    <div className="bg-bg/60 px-4 pb-3 pt-1 md:pl-[4.25rem]">
      <label className="block py-2">
        <span className="block text-xs font-medium text-muted">{t("Nom affiché")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== (a.display_name ?? "") && patch({ displayName: name || null })}
          placeholder={a.name}
          className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-[16px] md:text-sm"
        />
        {a.display_name && a.display_name !== a.name && <span className="mt-1 block text-xs text-muted">{t("Nom donné par la banque : {nom}", { nom: a.name })}</span>}
      </label>
      <Toggle checked={!!a.hidden} onChange={(v) => patch({ hidden: v })} label={t("Masqué##compte")} hint={t("Retiré de ton accueil ; ses opérations restent comptées.")} />
      <Toggle checked={!!a.excluded} onChange={(v) => patch({ excluded: v })} label={t("Hors statistiques")} hint={t("Exclu de tes totaux et de tes opérations à classer.")} />
      {a.source === "manuel" && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-2 text-sm text-muted">
          <ManualCurrency a={a} />
          <ManualBalance a={a} />
        </div>
      )}
      <Link to={`/operations?compte=${encodeURIComponent(a.id)}`} className="press mt-1 inline-block py-1 text-[13px] font-medium text-accent">
        {t("Voir ses opérations")}
      </Link>
    </div>
  );
}
