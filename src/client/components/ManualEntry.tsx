import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, useAccounts, type Account, type Transaction } from "../api.ts";
import { Field, Segmented, Sheet } from "./ui.tsx";
import { money, moneySymbol } from "../format.ts";
import { region } from "../region.ts";
import { CurrencySelect } from "./CurrencySelect.tsx";
import { ownerLabel } from "../../lib/labels.ts";
import { t } from "../../lib/i18n.ts";

/* Comptes saisis à la main (aucune banque ne les alimente) : ajouter une opération, la supprimer, tenir le solde. */

const isManual = (a: Account) => a.source === "manuel";
const today = () => new Date().toLocaleDateString("sv-SE");
const number = (text: string) => Number(text.replace(/\s/g, "").replace(",", "."));

/** Une opération saisie à la main se reconnaît à son identifiant : elle seule peut être supprimée. */
export const isManualTx = (tx: Pick<Transaction, "id">) => tx.id.startsWith("s:");

/** Bouton « Ajouter » de l'écran Opérations : n'apparaît que si le foyer a un compte saisi à la main. */
export function AddOperationButton() {
  const accounts = (useAccounts().data?.accounts ?? []).filter(isManual);
  const [open, setOpen] = useState(false);
  if (!accounts.length) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="press card flex h-9 items-center gap-1.5 px-3 text-[14px] font-medium text-accent md:h-auto md:py-1.5 md:text-[13px]">
        <Plus size={15} /> {t("Ajouter")}
      </button>
      {open && <AddOperationSheet accounts={accounts} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddOperationSheet({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState(accounts[0].id);
  const [sign, setSign] = useState<"depense" | "revenu">("depense");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const value = number(amount);
  const ready = Number.isFinite(value) && value > 0 && label.trim().length > 0 && !!date;
  // Le montant se saisit dans la devise du compte : on la rappelle quand ce n'est pas celle du foyer.
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? region().currency;

  async function save() {
    setBusy(true);
    try {
      await api("/bank/transactions", { method: "POST", json: { accountId, date, amount: sign === "depense" ? -value : value, label: label.trim() } });
      toast.success(t("Opération ajoutée"));
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Ajout impossible"));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t("Ajouter une opération")}>
      <div className="space-y-3">
        {accounts.length > 1 && (
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t("Compte")} className="card w-full px-3 py-2.5 text-[15px]">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name ?? a.name}
              </option>
            ))}
          </select>
        )}
        <Segmented
          value={sign}
          onChange={setSign}
          options={[
            { value: "depense", label: t("Dépense") },
            { value: "revenu", label: t("Revenu") },
          ]}
        />
        <Field label={currency === region().currency ? t("Montant") : `${t("Montant")} (${moneySymbol(currency)})`} value={amount} onChange={setAmount} placeholder="0,00" />
        <Field text label={t("Libellé")} value={label} onChange={setLabel} placeholder={t("Boulangerie, loyer, salaire…")} />
        <label className="card block px-4 py-3">
          <span className="block text-xs text-muted">{t("Date")}</span>
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="tnum w-full bg-transparent text-[17px] font-medium outline-none" />
        </label>
        <p className="px-1 text-xs text-muted">{t("L'opération est classée comme les autres (règles, libellés déjà classés) ; tu peux ensuite changer sa catégorie. Si le compte a un solde, il suit.")}</p>
        <button type="button" onClick={save} disabled={!ready || busy} className="press w-full rounded-xl bg-accent py-3 text-[15px] font-semibold text-white disabled:opacity-50">
          {t("Ajouter l'opération")}
        </button>
      </div>
    </Sheet>
  );
}

/** Dans la fiche d'une opération saisie à la main : la supprimer (demande confirmation). */
export function DeleteManualOperation({ tx, onDone }: { tx: Transaction; onDone: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!isManualTx(tx)) return null;
  async function remove() {
    if (!confirm(t("Supprimer cette opération saisie à la main ({montant}) ?", { montant: money(tx.amount) }))) return;
    setBusy(true);
    try {
      await api(`/bank/transactions/${encodeURIComponent(tx.id)}`, { method: "DELETE" });
      toast.success(t("Opération supprimée"));
      // La fiche se ferme d'abord : elle ne redemande pas le détail d'une opération qui n'existe plus.
      onDone();
      await qc.invalidateQueries({ predicate: (q) => !(q.queryKey[1] === tx.id && (q.queryKey[0] === "transaction-details" || q.queryKey[0] === "suggestions")) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Suppression impossible"));
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={remove} disabled={busy} className="press mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-sm text-neg disabled:opacity-50">
      <Trash2 size={15} /> {t("Supprimer cette opération")}
    </button>
  );
}

export const isManualAccount = isManual;

/**
 * Réglages → Comptes et connexions : devise d'un compte saisi à la main. La changer relit ses montants et son solde dans la
 * nouvelle devise (un compte créé dans la mauvaise) ; ils sont ensuite ramenés à la devise du foyer.
 */
export function ManualCurrency({ a }: { a: Account }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!isManual(a)) return null;
  async function change(currency: string) {
    if (currency === a.currency) return;
    if (!confirm(t("Passer ce compte en {devise} ? Ses montants et son solde, tels qu'ils ont été saisis, seront lus dans cette devise.", { devise: currency }))) return;
    setBusy(true);
    try {
      await api(`/bank/accounts/${encodeURIComponent(a.id)}/currency`, { method: "PUT", json: { currency } });
      toast.success(t("Devise du compte enregistrée"));
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Réglage non enregistré"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className={busy ? "flex items-center gap-1.5 opacity-50" : "flex items-center gap-1.5"}>
      {t("Devise")}
      <CurrencySelect short value={a.currency} onChange={change} className="rounded-md border border-line bg-card px-1.5 py-0.5 text-ink" label={t("Devise du compte")} />
    </label>
  );
}

/** Réglages → Comptes et connexions : solde d'un compte saisi à la main, tenu par son titulaire. */
export function ManualBalance({ a }: { a: Account }) {
  const qc = useQueryClient();
  // Le solde se tient dans la devise du compte.
  const held = a.balance_original ?? a.balance;
  const shown = held == null ? "" : Number(held).toFixed(2).replace(".", ",");
  const [text, setText] = useState(shown);
  if (!isManual(a)) return null;
  async function save() {
    if (text.trim() === shown) return;
    const value = text.trim() === "" ? null : number(text);
    if (value !== null && !Number.isFinite(value)) return setText(shown);
    try {
      await api(`/bank/accounts/${encodeURIComponent(a.id)}/balance`, { method: "PUT", json: { balance: value } });
      toast.success(t("Solde enregistré"));
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Réglage non enregistré"));
      setText(shown);
    }
  }
  return (
    <label className="flex items-center gap-1.5">
      {t("Solde")}
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={save} inputMode="decimal" placeholder="—" aria-label={t("Solde du compte")} className="tnum w-24 rounded-md border border-line bg-card px-2 py-0.5 text-right text-ink" />
      {moneySymbol(a.currency)}
    </label>
  );
}

/** Réglages → Comptes et connexions : créer un compte tenu à la main (espèces, compte d'une banque qu'on ne relie pas). */
export function NewManualAccount() {
  const qc = useQueryClient();
  const household = useQuery({ queryKey: ["household"], queryFn: () => api<{ members: { id: number; name: string }[] }>("/household"), staleTime: 3600_000 });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("courant");
  const [owner, setOwner] = useState("joint");
  const [balance, setBalance] = useState("");
  const [currency, setCurrency] = useState(region().currency);
  const [busy, setBusy] = useState(false);
  const owners = ["joint", ...(household.data?.members ?? []).map((m) => m.name.toLowerCase()), "pro", "autre"];
  const select = "card px-3 py-2 text-sm";
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="press mt-2 flex items-center gap-1.5 px-1 text-sm font-medium text-accent">
        <Plus size={15} /> {t("Créer un compte à la main")}
      </button>
    );

  async function create() {
    const value = balance.trim() === "" ? null : number(balance);
    if (value !== null && !Number.isFinite(value)) return toast.error(t("Solde illisible"));
    setBusy(true);
    try {
      await api("/bank/accounts", { method: "POST", json: { name: name.trim(), kind, owner, balance: value, currency } });
      toast.success(t("Compte créé"));
      await qc.invalidateQueries();
      setOpen(false);
      setName("");
      setBalance("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Création impossible"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-2 space-y-2 p-4">
      <p className="text-sm text-muted">{t("Un compte tenu à la main : aucune banque ne l'alimente, tu y ajoutes ses opérations (écran Opérations) ou tu y importes un fichier.")}</p>
      <div className="max-w-sm">
        <Field text label={t("Nom du compte")} value={name} onChange={setName} placeholder={t("Compte courant")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={select} aria-label={t("Nature du compte")}>
          <option value="courant">{t("Compte courant")}</option>
          <option value="epargne">{t("Épargne")}</option>
          <option value="carte">{t("Carte")}</option>
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className={select} aria-label={t("Titulaire")}>
          {owners.map((o) => (
            <option key={o} value={o}>
              {ownerLabel(o)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          {t("Solde")}
          <input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0,00" aria-label={t("Solde du compte")} className="tnum w-28 rounded-md border border-line bg-card px-2 py-1.5 text-right text-ink" />
        </label>
        <CurrencySelect short value={currency} onChange={setCurrency} className={select} label={t("Devise du compte")} />
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={create} disabled={busy || !name.trim()} className="press rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {t("Créer le compte")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="press text-sm text-muted">
          {t("Annuler")}
        </button>
      </div>
    </div>
  );
}
