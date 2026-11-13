import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { Card } from "./ui.tsx";
import { dateFr } from "../format.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

type Result = { rows: number; matched: number; labelled: number; named: number; categorized: number; ambiguous: number; propagated: number; from: string; to: string };

/** Texte d'un fichier : UTF-8, sinon l'encodage Windows des anciens exports. */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

const n = (v: number) => v.toLocaleString(locale());

/** Réglages → Classement : dépôt de l'export CSV de BoursoBank pour nommer et classer les opérations que Finta ne nomme pas. */
export function BankLabelsImport() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function send(file: File) {
    setBusy(true);
    try {
      const r = await api<Result>("/bank-labels/import", { method: "POST", body: await readText(file), headers: { "Content-Type": "text/csv" } });
      setResult(r);
      toast.success(`${tn("{n} opération nommée", "{n} opérations nommées", r.named + r.propagated, { n: n(r.named + r.propagated) })}, ${tn("{n} classée", "{n} classées", r.categorized, { n: n(r.categorized) })}`);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Import impossible"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  // Une seule phrase à traduire ; « {lien} » y marque la place du lien (le nom du menu de la banque reste tel quel).
  const [beforeLink, afterLink = ""] = t("Sur BoursoBank : {lien}, tous les comptes, format CSV. Tu peux redéposer le même fichier : rien n'est compté deux fois, et un nom déjà posé n'est jamais remplacé.").split("{lien}");
  return (
    <Card className="p-4">
      <p className="text-sm">
        {t("Pour un prélèvement ou un virement, la synchronisation ne transmet souvent qu'une référence. L'export de BoursoBank porte le nom du créancier : dépose-le ici pour nommer ces opérations et les classer comme celles du même nom.")}
      </p>
      <p className="mt-2 text-xs text-muted">
        {beforeLink}
        <a href="https://clients.boursobank.com/budget/exporter-mouvements" target="_blank" rel="noreferrer" className="text-accent underline">
          Exporter les opérations
        </a>
        {afterLink}
      </p>
      <input ref={input} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="press mt-3 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        <FileUp size={16} />
        {busy ? t("Import en cours…") : t("Déposer l'export CSV")}
      </button>
      {result && (
        <ul className="mt-3 space-y-1 text-sm">
          <li>
            {tn("{n} ligne lue, du {debut} au {fin}", "{n} lignes lues, du {debut} au {fin}", result.rows, { n: n(result.rows), debut: dateFr(result.from), fin: dateFr(result.to) })}
          </li>
          <li>
            {tn("{n} opération retrouvée dans Pécule", "{n} opérations retrouvées dans Pécule", result.matched, { n: n(result.matched) })}
            {result.labelled > 0 && ` (${tn("{n} nouveau libellé", "{n} nouveaux libellés", result.labelled, { n: n(result.labelled) })})`}
          </li>
          <li>
            {tn("{n} nommée d'après la banque", "{n} nommées d'après la banque", result.named, { n: n(result.named) })}
            {result.propagated > 0 && `, ${tn("{n} autre par ressemblance", "{n} autres par ressemblance", result.propagated, { n: n(result.propagated) })}`}
          </li>
          <li>{tn("{n} classée grâce à son nom", "{n} classées grâce à leur nom", result.categorized, { n: n(result.categorized) })}</li>
          {result.ambiguous > 0 && <li className="text-muted">{tn("{n} laissée de côté : plusieurs lignes de l'export pouvaient convenir", "{n} laissées de côté : plusieurs lignes de l'export pouvaient convenir", result.ambiguous, { n: n(result.ambiguous) })}</li>}
        </ul>
      )}
    </Card>
  );
}
