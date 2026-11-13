import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "./ui.tsx";
import { useBirthdays, useSaveBirthdays } from "../birthdays.ts";
import { useAppearance } from "../theme.ts";
import { locale, t } from "../../lib/i18n.ts";
import { parseBirthdays, type Birthday } from "../../lib/seasons.ts";

const field = "h-9 rounded-lg bg-bg px-2.5 text-sm ring-1 ring-line";
const byDate = (a: Birthday, b: Birthday) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name, "fr");
// Noms des mois et dates dans la langue du membre (2024 : année bissextile, le 29 février existe).
const monthName = (m: number) => new Date(2024, m - 1, 1).toLocaleDateString(locale(), { month: "long" });
const dayOf = (b: Birthday) => `${new Date(2024, b.month - 1, b.day).toLocaleDateString(locale(), { day: "numeric", month: "long" })}${b.year ? ` ${b.year}` : ""}`;

/** Anniversaires du foyer : le jour J, l'appli prend le thème « Anniversaire » sur tous les appareils de la famille. */
export function BirthdaySettings() {
  const birthdays = useBirthdays();
  const save = useSaveBirthdays();
  const { previewing, setPreview } = useAppearance();
  const [name, setName] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const list = birthdays.data ?? [];
  const store = (next: Birthday[], done: string) =>
    save.mutate(next, { onSuccess: () => toast.success(done), onError: (e) => toast.error(e instanceof Error ? e.message : t("Anniversaire non enregistré")) });

  function add(e: FormEvent) {
    e.preventDefault();
    const [b] = parseBirthdays([{ name, month: Number(month), day: Number(day), year: year ? Number(year) : undefined }]);
    if (!b) return void toast.error(t("Indique un prénom et une date qui existe."));
    if (year && !b.year) return void toast.error(t("L'année de naissance n'est pas valable."));
    store([...list, b].sort(byDate), t("Anniversaire de {nom} ajouté", { nom: b.name }));
    setName("");
    setDay("");
    setMonth("");
    setYear("");
  }

  return (
    <div>
      <div className="mb-2 px-1 text-[13px] font-medium">{t("Anniversaires")}</div>
      <Card className="divide-y divide-line">
        {list.map((b, i) => (
          <div key={`${b.name}-${b.month}-${b.day}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span>
              🎂 {b.name}
              <span className="ml-2 text-xs text-muted">{dayOf(b)}</span>
            </span>
            <button
              type="button"
              onClick={() => store(list.filter((_, j) => j !== i), t("Anniversaire de {nom} retiré", { nom: b.name }))}
              disabled={save.isPending}
              aria-label={t("Retirer l'anniversaire de {nom}", { nom: b.name })}
              className="press grid size-8 shrink-0 place-items-center rounded-lg text-muted"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <form onSubmit={add} className="flex flex-wrap items-center gap-2 px-4 py-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Prénom")} aria-label={t("Prénom")} maxLength={40} className={`${field} min-w-0 flex-1 basis-28`} />
          <select value={day} onChange={(e) => setDay(e.target.value)} aria-label={t("Jour")} className={field}>
            <option value="">{t("Jour")}</option>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("Mois##anniversaire")} className={field}>
            <option value="">{t("Mois##anniversaire")}</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {monthName(i + 1)}
              </option>
            ))}
          </select>
          <input
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder={t("Année")}
            aria-label={t("Année de naissance (facultative)")}
            inputMode="numeric"
            className={`${field} w-[4.75rem]`}
          />
          <button type="submit" disabled={save.isPending || birthdays.isLoading || list.length >= 12} className="press h-9 rounded-lg bg-accent px-3.5 text-sm font-semibold text-white disabled:opacity-60">
            {t("Ajouter")}
          </button>
        </form>
      </Card>
      <p className="mt-2 px-1 text-xs text-muted">
        {t("Le jour J, Pécule prend les couleurs de l'anniversaire sur tous les appareils de la famille et le souhaite sur l'accueil. La liste est partagée par le foyer ; l'année est facultative.")}{" "}
        <button type="button" onClick={() => setPreview(previewing === "anniversaire" ? null : "anniversaire")} className="font-medium text-accent">
          {previewing === "anniversaire" ? t("Arrêter l'aperçu") : t("Voir le thème")}
        </button>
      </p>
    </div>
  );
}
