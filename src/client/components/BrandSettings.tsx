import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDemo } from "../api.ts";
import { removeBrand, saveBrand, useBrandMatch, useBrands, type CustomBrand } from "../api-brands.ts";
import { Card, Field } from "./ui.tsx";
import { LogoImg, Tile } from "./Logo.tsx";
import { brandInitials, cleanDomain, customPattern } from "../../lib/brands.ts";
import { t, tn } from "../../lib/i18n.ts";

/*
 * Réglages → Classement → « Mes enseignes » : les enseignes que le foyer ajoute au référentiel des marques
 * (commerce de quartier, artisan, association). Un nom, les mots du libellé qui la font reconnaître, et son site
 * si elle en a un (pour le logo). Dès l'enregistrement, ses opérations portent son logo ou ses initiales partout.
 */

/** Logo d'une enseigne du foyer : l'icône de son site, sinon ses initiales. */
function BrandMark({ brand }: { brand: Pick<CustomBrand, "name" | "domain"> }) {
  return (
    <LogoImg
      logoKey={brand.domain ? `d:${brand.domain}` : null}
      alt={brand.name}
      size="md"
      fallback={
        <Tile size="md" tone="accent">
          {brandInitials(brand.name)}
        </Tile>
      }
    />
  );
}

/** Saisie d'une enseigne (ajout ou modification), avec l'aperçu de ce que ses mots reconnaissent. */
function BrandForm({ brand, onDone }: { brand: CustomBrand | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(brand?.name ?? "");
  const [pattern, setPattern] = useState(brand?.pattern ?? "");
  const [domain, setDomain] = useState(brand?.domain ?? "");
  const [busy, setBusy] = useState(false);
  // L'aperçu suit la saisie avec un léger retard (une requête par pause, pas par lettre).
  const [typed, setTyped] = useState(pattern);
  useEffect(() => {
    const timer = setTimeout(() => setTyped(pattern), 350);
    return () => clearTimeout(timer);
  }, [pattern]);
  const clean = customPattern(typed);
  const match = useBrandMatch(clean ?? "");
  const found = clean && match.data?.pattern === clean ? match.data : null;
  const siteInvalid = !!domain.trim() && !cleanDomain(domain);
  const ready = name.trim().length >= 2 && !!customPattern(pattern) && !siteInvalid && !busy;

  const preview = !pattern.trim()
    ? t("Écris-les comme dans le libellé de la banque : quelques mots suffisent, dans n'importe quel ordre.")
    : !customPattern(pattern)
      ? t("Écris au moins un mot de trois lettres du libellé à reconnaître.")
      : !found
        ? t("Recherche dans tes opérations…")
        : found.count
          ? tn("Reconnue dans {n} opération des douze derniers mois : {exemples}.", "Reconnue dans {n} opérations des douze derniers mois : {exemples}.", found.count, { exemples: found.samples.join(", ") })
          : t("Aucune opération des douze derniers mois ne contient ces mots.");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await saveBrand(brand?.id ?? null, { name: name.trim(), pattern, domain: domain.trim() || null });
      await qc.invalidateQueries({ queryKey: ["brands"] });
      toast.success(t("Enseigne enregistrée"));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Enregistrement impossible"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <Field label={t("Nom de l'enseigne")} value={name} onChange={setName} text placeholder={t("Ex. : Boulangerie du marché")} />
      <Field label={t("Mots du libellé à reconnaître")} value={pattern} onChange={setPattern} text placeholder={t("Ex. : boulangerie marche")} />
      <p className={found && !found.count ? "px-1 text-xs text-warn" : "px-1 text-xs text-muted"} role="status">
        {preview}
      </p>
      <Field label={t("Son site, pour le logo (facultatif)")} value={domain} onChange={setDomain} text placeholder={t("exemple.fr")} />
      {siteInvalid && <p className="px-1 text-xs text-neg">{t("Ce site n'a pas la forme d'une adresse (exemple.fr).")}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={!ready} className="press rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? t("Enregistrement…") : t("Enregistrer")}
        </button>
        <button type="button" onClick={onDone} className="press rounded-xl bg-card px-4 py-2.5 text-sm font-semibold text-muted ring-1 ring-line">
          {t("Annuler")}
        </button>
      </div>
    </form>
  );
}

export function BrandSettings() {
  const qc = useQueryClient();
  const demo = useDemo();
  const list = useBrands();
  // Enseigne en cours de modification, « new » pour un ajout, null quand le formulaire est fermé.
  const [editing, setEditing] = useState<CustomBrand | "new" | null>(null);
  const brands = list.data?.brands ?? [];

  async function remove(b: CustomBrand) {
    if (!confirm(t("Retirer l'enseigne « {nom} » ? Ses opérations gardent leur catégorie.", { nom: b.name }))) return;
    try {
      await removeBrand(b.id);
      await qc.invalidateQueries({ queryKey: ["brands"] });
      toast.success(t("Enseigne retirée"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Suppression impossible"));
    }
  }

  return (
    <Card className="p-4">
      <p className="text-sm">
        {t("Un commerce de quartier, un artisan, une association : donne-lui un nom et, s'il a un site, son logo. Pécule le reconnaîtra dans tes opérations comme une grande enseigne.")}
      </p>
      {brands.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {brands.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-2.5">
              <BrandMark brand={b} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{b.name}</span>
                <span className="block truncate text-xs text-muted">
                  {t("reconnue par « {mots} »", { mots: b.pattern })}
                  {b.domain ? ` · ${b.domain}` : ""}
                </span>
              </span>
              <button type="button" onClick={() => setEditing(b)} aria-label={t("Modifier l'enseigne {nom}", { nom: b.name })} className="press shrink-0 rounded-lg p-2 text-muted hover:bg-bg hover:text-ink">
                <Pencil size={15} />
              </button>
              <button type="button" onClick={() => remove(b)} aria-label={t("Retirer l'enseigne {nom}", { nom: b.name })} className="press shrink-0 rounded-lg p-2 text-muted hover:bg-neg/10 hover:text-neg">
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <BrandForm key={editing === "new" ? "new" : editing.id} brand={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" onClick={() => setEditing("new")} className="press mt-3 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white">
          <Plus size={16} /> {t("Ajouter une enseigne")}
        </button>
      )}
      {demo && <p className="mt-3 text-xs text-muted">{t("En mode démo, le logo d'un site n'est pas téléchargé : l'enseigne garde ses initiales.")}</p>}
    </Card>
  );
}
