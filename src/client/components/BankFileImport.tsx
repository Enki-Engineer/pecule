import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { api, useAccounts } from "../api.ts";
import { Card, Field } from "./ui.tsx";
import { cn } from "../cn.ts";
import { dateFr, moneyIn } from "../format.ts";
import { CurrencySelect } from "./CurrencySelect.tsx";
import { ownerLabel } from "../../lib/labels.ts";
import { t, tn } from "../../lib/i18n.ts";

type Preview = {
  format: "ofx" | "qif" | "csv";
  rows: number;
  skipped: number;
  from: string | null;
  to: string | null;
  accounts: { account: string; rows: number }[];
  needsFileAccount: boolean;
  target: { id: string; name: string } | null;
  fresh: number;
  known: number;
  sample: { date: string; amount: number; label: string }[];
  /** Devise dans laquelle les montants du fichier sont lus. */
  currency?: string;
  applied: boolean;
  categorized: number;
};

const NEW = "__nouveau__";
const button = "press inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white";
const select = "card px-3 py-2 text-sm";

/**
 * Réglages → Comptes et connexions → Fichiers de la banque : pour qui ne relie aucun prestataire, ou pour
 * reprendre un historique. Le fichier (OFX, QIF, CSV) est lu par le serveur ; on voit d'abord ce qui serait ajouté.
 */
export function BankFileImport() {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const household = useQuery({ queryKey: ["household"], queryFn: () => api<{ members: { id: number; name: string }[] }>("/household"), staleTime: 3600_000 });
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState(NEW);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("courant");
  const [owner, setOwner] = useState("joint");
  const [fileAccount, setFileAccount] = useState("");
  // Devise d'un nouveau compte : vide tant qu'on ne l'a pas choisie (celle du fichier, sinon celle du foyer).
  const [currency, setCurrency] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const query = (apply: boolean, chosen = fileAccount, devise = currency) => {
    const p = new URLSearchParams();
    if (target !== NEW) p.set("compte", target);
    else {
      p.set("nom", name.trim() || t("Compte importé"));
      p.set("nature", kind);
      p.set("titulaire", owner);
      if (devise) p.set("devise", devise);
    }
    if (chosen) p.set("compteFichier", chosen);
    if (apply) p.set("appliquer", "1");
    return p.toString();
  };

  async function send(f: File, apply: boolean, chosen = fileAccount, devise = currency) {
    setBusy(true);
    try {
      const r = await api<Preview>(`/bank/import?${query(apply, chosen, devise)}`, { method: "POST", body: await f.arrayBuffer(), headers: { "Content-Type": "application/octet-stream" } });
      setPreview(r);
      if (r.applied) {
        toast.success(tn("{n} opération ajoutée", "{n} opérations ajoutées", r.fresh, { n: r.fresh }));
        setFile(null);
        if (input.current) input.current.value = "";
        await qc.invalidateQueries();
      }
    } catch (e) {
      setPreview(null);
      toast.error(e instanceof Error ? e.message : t("Import impossible"));
    } finally {
      setBusy(false);
    }
  }

  const owners = ["joint", ...(household.data?.members ?? []).map((m) => m.name.toLowerCase()), "pro", "autre"];

  return (
    <Card className="p-4">
      <p className="text-sm">{t("Dépose l'export de ta banque (OFX, QIF ou CSV) : ses opérations rejoignent le compte choisi. Tu peux redéposer un fichier qui recouvre le précédent, rien n'est ajouté deux fois.")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setPreview(null);
          }}
          className={cn(select, "min-w-0 max-w-full")}
          aria-label={t("Compte")}
        >
          <option value={NEW}>{t("Nouveau compte…")}</option>
          {(accounts.data?.accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name ?? a.name}
            </option>
          ))}
        </select>
        {target === NEW && (
          <>
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
          </>
        )}
      </div>
      {target === NEW && (
        <div className="mt-2 max-w-sm">
          <Field label={t("Nom du compte")} value={name} onChange={setName} placeholder={t("Compte courant")} />
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept=".ofx,.qfx,.qif,.csv,.txt,text/csv,text/plain,application/x-ofx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setFileAccount("");
          setPreview(null);
          if (f) void send(f, false, "");
        }}
      />
      <button type="button" className={cn(button, "mt-3", busy && "pointer-events-none opacity-60")} onClick={() => input.current?.click()}>
        <FileUp size={16} /> {file ? file.name : t("Choisir un fichier")}
      </button>

      {preview && file && !preview.applied && (
        <div className="mt-3 rounded-xl border border-line p-3 text-sm">
          {preview.needsFileAccount ? (
            <>
              <p>{t("Ce fichier mêle plusieurs comptes. Lequel va dans ce compte ?")}</p>
              <select
                value={fileAccount}
                onChange={(e) => {
                  setFileAccount(e.target.value);
                  if (e.target.value) void send(file, false, e.target.value);
                }}
                className={cn(select, "mt-2")}
                aria-label={t("Compte du fichier")}
              >
                <option value="">{t("Choisir…")}</option>
                {preview.accounts.map((a) => (
                  <option key={a.account} value={a.account}>
                    {a.account} · {tn("{n} opération", "{n} opérations", a.rows, { n: a.rows })}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <p className="font-medium">
                {tn("{n} opération à ajouter", "{n} opérations à ajouter", preview.fresh, { n: preview.fresh })}
                {preview.known > 0 && <span className="font-normal text-muted"> · {tn("{n} déjà connue", "{n} déjà connues", preview.known, { n: preview.known })}</span>}
              </p>
              <p className="text-xs text-muted">
                {preview.format.toUpperCase()}
                {preview.from && preview.to ? ` · ${t("du {debut} au {fin}", { debut: dateFr(preview.from), fin: dateFr(preview.to) })}` : ""}
                {preview.skipped > 0 ? ` · ${tn("{n} ligne illisible écartée", "{n} lignes illisibles écartées", preview.skipped, { n: preview.skipped })}` : ""}
              </p>
              {preview.sample.map((r, i) => (
                <div key={i} className="mt-1 flex items-center gap-3 border-t border-line pt-1 text-xs first:mt-2">
                  <span className="tnum shrink-0 text-muted">{dateFr(r.date)}</span>
                  <span className="min-w-0 grow truncate">{r.label}</span>
                  <span className="tnum shrink-0">{moneyIn(r.amount, preview.currency)}</span>
                </div>
              ))}
              {target === NEW && preview.currency && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                  {t("Devise du compte")}
                  <CurrencySelect
                    short
                    value={preview.currency}
                    onChange={(code) => {
                      setCurrency(code);
                      void send(file, false, fileAccount, code);
                    }}
                    className="rounded-md border border-line bg-card px-1.5 py-0.5 text-ink"
                    label={t("Devise du compte")}
                  />
                </label>
              )}
              <button type="button" className={cn(button, "mt-3", (busy || !preview.fresh) && "pointer-events-none opacity-60")} onClick={() => send(file, true)}>
                {t("Importer")}
              </button>
            </>
          )}
        </div>
      )}
      {preview?.applied && (
        <p className="mt-3 text-sm text-muted">
          {t("{n} opérations ajoutées à « {compte} », dont {auto} classées automatiquement.", { n: preview.fresh, compte: preview.target?.name ?? "", auto: preview.categorized })}
        </p>
      )}
    </Card>
  );
}
