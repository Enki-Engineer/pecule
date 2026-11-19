import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Asset, type AssetPayouts as Payouts } from "../api.ts";
import { Card, Field, Segmented } from "./ui.tsx";
import { dateFr, money, pct } from "../format.ts";
import { payoutYield } from "../../lib/payouts.ts";
import { t, tn } from "../../lib/i18n.ts";

/**
 * Versements reçus d'un placement, dans sa fiche : coupons d'une obligation, intérêts, ce qu'une plateforme
 * reverse. Le membre indique un texte du libellé de ces entrées d'argent ; la fiche en montre le dernier, le total
 * par année et le rendement sur douze mois. Pour un portefeuille vidé à chaque versement, la valeur du placement
 * peut suivre le dernier versement. `p` : ce que le serveur lit dans les opérations (undefined : en cours de lecture).
 */
export function AssetPayouts({ asset, p, onNavigate }: { asset: Asset; p: Payouts | undefined; onNavigate: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [follow, setFollow] = useState<"saisie" | "versement">("saisie");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setText(p?.match ?? "");
    setFollow(p?.follows ? "versement" : "saisie");
  }, [p?.match, p?.follows]);
  useEffect(() => {
    setEditing(false);
  }, [asset.id]);
  if (!p) return null;
  const quoted = asset.valuation === "cotation";

  async function save(body: { payoutMatch: string | null; followPayouts: boolean }) {
    setBusy(true);
    try {
      await api(`/assets/${asset.id}`, { method: "PATCH", json: body });
      await Promise.all([qc.invalidateQueries({ queryKey: ["wealth"] }), qc.invalidateQueries({ queryKey: ["asset-payouts", asset.id] })]);
      toast.success(body.payoutMatch ? t("Versements suivis") : t("Suivi arrêté"));
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    } finally {
      setBusy(false);
    }
  }

  if (!p.match && !editing)
    return (
      <button type="button" onClick={() => setEditing(true)} className="press mt-3 w-full rounded-xl bg-accent-soft py-3 text-[14px] font-semibold text-accent">
        {t("Suivre les versements reçus")}
      </button>
    );

  if (editing)
    return (
      <section className="mt-5 space-y-3">
        <h3 className="px-1 text-[15px] font-semibold">{t("Versements reçus")}</h3>
        <p className="px-1 text-[13px] leading-relaxed text-muted">
          {t("Coupons, intérêts, ce qu'une plateforme te reverse : indique un texte présent dans le libellé de ces entrées d'argent, Pécule les retrouve dans tes opérations.")}
        </p>
        <Field label={t("Texte du libellé")} value={text} onChange={setText} text placeholder={t("Nom de l'émetteur, de la plateforme…")} />
        <Segmented
          value={follow}
          onChange={setFollow}
          options={[
            { value: "saisie", label: t("Valeur saisie") },
            { value: "versement", label: t("Valeur = dernier versement"), disabled: quoted, title: quoted ? t("Un placement coté suit déjà son cours") : undefined },
          ]}
        />
        <p className="px-1 text-xs leading-relaxed text-muted">
          {follow === "versement"
            ? t("Pour un portefeuille vidé à chaque versement : sa valeur devient le dernier versement reçu et se met à jour seule. C'est une estimation de ce qu'il contient entre deux versements.")
            : t("La valeur reste celle que tu saisis : les versements sont ce que le placement rapporte.")}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(false)} className="press flex-1 rounded-xl bg-line/70 py-3 font-semibold">
            {t("Annuler")}
          </button>
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => save({ payoutMatch: text.trim(), followPayouts: follow === "versement" })}
            className="press flex-[2] rounded-xl bg-accent py-3 font-semibold text-white disabled:opacity-40"
          >
            {t("Suivre ces versements")}
          </button>
        </div>
        {p.match && (
          <button type="button" disabled={busy} onClick={() => save({ payoutMatch: null, followPayouts: false })} className="press w-full py-2 text-[14px] font-medium text-muted">
            {t("Ne plus suivre")}
          </button>
        )}
      </section>
    );

  const rate = p.follows ? null : payoutYield(p, asset.value);
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h3 className="min-w-0 truncate text-[15px] font-semibold">
          {t("Versements reçus")} <span className="font-normal text-muted">· « {p.match} »</span>
        </h3>
        <button type="button" onClick={() => setEditing(true)} className="press shrink-0 text-[13px] font-medium text-accent">
          {t("Modifier")}
        </button>
      </div>
      {!p.count ? (
        <Card className="p-4 text-sm text-muted">{t("Aucune entrée d'argent ne porte ce texte pour l'instant.")}</Card>
      ) : (
        <>
          <Card className="divide-y divide-line text-sm">
            {p.last && (
              <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-muted">{t("Dernier versement")}</span>
                <span className="tnum text-right font-semibold">
                  {money(p.last.amount)} <span className="font-normal text-muted">· {dateFr(p.last.date)}</span>
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="text-muted">{t("Sur douze mois")}</span>
              <span className="tnum text-right font-semibold">
                {money(p.last12)}
                {rate != null && <span className="font-normal text-muted"> · {t("{taux} de la valeur", { taux: pct(rate, 1) })}</span>}
              </span>
            </div>
            {p.years.map((y) => (
              <div key={y.year} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-muted">
                  {y.year} <span className="text-xs">· {tn("{n} versement", "{n} versements", y.count)}</span>
                </span>
                <span className="tnum font-medium">{money(y.total)}</span>
              </div>
            ))}
            {p.years.length > 1 && (
              <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-muted">{t("Depuis le début")}</span>
                <span className="tnum font-semibold">{money(p.total)}</span>
              </div>
            )}
          </Card>
          <Link to={`/operations?q=${encodeURIComponent(p.match ?? "")}`} onClick={onNavigate} className="press mt-2 block px-1 py-1 text-[13px] font-medium text-accent">
            {t("Voir ces opérations")}
          </Link>
        </>
      )}
      {p.follows && (
        <p className="mt-2 px-1 text-xs leading-relaxed text-muted">{t("La valeur de ce placement est son dernier versement : une estimation de ce qu'il contient entre deux versements.")}</p>
      )}
    </section>
  );
}
