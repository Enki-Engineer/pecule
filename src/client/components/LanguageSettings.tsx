import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Me } from "../api.ts";
import { appLang, applyLang } from "../i18n.ts";
import { Card } from "./ui.tsx";
import { LANGS, t, type Lang } from "../../lib/i18n.ts";

/**
 * Langue de Pécule (Réglages → Apparence) : choisie par le membre, gardée sur le serveur — elle le suit sur
 * tous ses appareils, dans les réponses de l'assistant et à la voix. L'appli se recharge dans la langue choisie.
 */
export function LanguageSettings() {
  const qc = useQueryClient();
  const current = appLang();
  const [busy, setBusy] = useState<Lang | null>(null);

  async function choose(lang: Lang) {
    if (lang === current || busy) return;
    setBusy(lang);
    try {
      await api("/auth/language", { method: "PUT", json: { language: lang } });
      // L'identité gardée sur l'appareil porte tout de suite la nouvelle langue : pas d'aller-retour au rechargement.
      qc.setQueryData<Me>(["me"], (me) => (me?.user ? { ...me, user: { ...me.user, language: lang } } : me));
      applyLang(lang);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Langue non enregistrée"));
      setBusy(null);
    }
  }

  return (
    <section id="langue" className="scroll-mt-20">
      <h2 className="mb-2 px-1 text-[15px] font-semibold text-ink">{t("Langue")}</h2>
      <Card className="divide-y divide-line">
        {LANGS.map((l) => (
          <label key={l.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
            <input type="radio" name="langue" checked={(busy ?? current) === l.id} disabled={busy !== null} onChange={() => void choose(l.id)} className="size-4.5 shrink-0 accent-[var(--color-accent)]" />
            <span className="text-[15px] font-medium" lang={l.id}>
              {l.label}
            </span>
          </label>
        ))}
      </Card>
      <p className="mt-2 px-1 text-xs text-muted">
        {t("Ta langue te suit sur tous tes appareils : les écrans, les réponses de l'assistant et le mode vocal. La traduction des écrans est en cours : ce qui n'est pas encore traduit reste en français.")}
      </p>
    </section>
  );
}
