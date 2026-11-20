import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp, Landmark, LayoutGrid, Presentation, Route, Sparkles, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { api, useAccounts, useMe } from "../api.ts";
import { enterDemo } from "../demo.ts";
import { Card } from "./ui.tsx";
import { currencyName } from "./CurrencySelect.tsx";
import { countryName } from "./HouseholdSettings.tsx";
import { region } from "../region.ts";
import { guessRegion, isFrance } from "../../lib/countries.ts";
import { FRENCH_MODULES } from "../../lib/modules.ts";
import { t } from "../../lib/i18n.ts";

const KEY = "pecule.bienvenue.vu";

/**
 * « Bien démarrer » : tant que le foyer n'a aucun compte, l'accueil propose les premiers pas — une source
 * (banque ou fichier), les écrans utiles, l'assistant —, la démo pour voir l'appli remplie, et la présentation de
 * bienvenue pour qui l'a passée (pages/Onboarding.tsx). La carte disparaît d'elle-même au premier compte, ou quand
 * on la ferme (sur cet appareil).
 */
export function Welcome() {
  const qc = useQueryClient();
  const me = useMe();
  const accounts = useAccounts();
  const [seen, setSeen] = useState(() => localStorage.getItem(KEY) === "1");
  const [busy, setBusy] = useState(false);
  const user = me.data?.user;
  if (seen || !user || user.demo || !accounts.data || accounts.data.accounts.length > 0) return null;

  const close = () => {
    localStorage.setItem(KEY, "1");
    setSeen(true);
  };
  async function demo() {
    setBusy(true);
    try {
      await enterDemo(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Mode démo indisponible"));
      setBusy(false);
    }
  }

  // Installation neuve : le pays et la devise sont ceux de la France tant que personne ne les a réglés. Si le
  // navigateur en indique d'autres, on le propose à l'administrateur (rien n'est appliqué sans son geste).
  const now = region();
  const guess = guessRegion(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.languages);
  const suggest = user.admin && (guess.country !== now.country || guess.currency !== now.currency);
  async function adopt() {
    setBusy(true);
    try {
      const current = await api<{ modulesOff: string[] }>("/household");
      await api("/household", { method: "PUT", json: { country: guess.country, timeZone: guess.timeZone, ...(isFrance(guess.country) ? {} : { modulesOff: [...new Set([...current.modulesOff, ...FRENCH_MODULES])] }) } });
      if (guess.currency !== now.currency) await api("/household/currency", { method: "PUT", json: { currency: guess.currency } });
      toast.success(t("Pays et devise enregistrés"));
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Réglage non enregistré"));
    } finally {
      setBusy(false);
    }
  }

  const steps: { to: string; icon: LucideIcon; title: string; hint: string }[] = [
    { to: "/reglages/connexions?c=banque", icon: Landmark, title: t("Relier une banque"), hint: t("Par l'interface officielle de ta banque, en lecture seule (Enable Banking, gratuit pour un usage personnel).") },
    { to: "/reglages/connexions?c=fichiers", icon: FileUp, title: t("Importer un fichier de ta banque"), hint: t("L'export OFX, QIF ou CSV de ton espace client : aucun service à relier.") },
    { to: "/reglages/foyer", icon: LayoutGrid, title: t("Régler ton foyer"), hint: t("Pays, devise, et les écrans utiles : immobilier, crypto, impôts, retraite… ne garde que ce qui te sert.") },
    { to: "/reglages/connexions?c=ia", icon: Sparkles, title: t("Brancher l'assistant"), hint: t("Facultatif : avec ta propre clé d'IA, Pécule lit tes factures et répond à tes questions.") },
  ];

  return (
    <Card className="relative p-4 md:p-5">
      <button type="button" onClick={close} aria-label={t("Fermer")} className="press absolute right-2 top-2 grid size-9 place-items-center rounded-full text-muted">
        <X size={17} />
      </button>
      <h2 className="pr-8 text-[17px] font-semibold">{t("Bien démarrer")}</h2>
      <p className="mt-0.5 pr-8 text-sm text-muted">{t("Pécule est installé et ton foyer est créé. Donne-lui ses premières opérations : tout le reste en découle.")}</p>
      {suggest && (
        <div className="mt-3 rounded-xl border border-line bg-bg p-3 text-sm">
          <p>
            {t("Pécule est réglé sur : {pays}, {devise}. Ton navigateur indique plutôt : {pays2}, {devise2}.", { pays: countryName(now.country), devise: currencyName(now.currency), pays2: countryName(guess.country), devise2: currencyName(guess.currency) })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" onClick={adopt} disabled={busy} className="press font-medium text-accent disabled:opacity-60">
              {t("Utiliser : {pays}, {devise}", { pays: countryName(guess.country), devise: currencyName(guess.currency) })}
            </button>
            <Link to="/reglages/foyer" className="press text-muted underline">
              {t("Choisir moi-même")}
            </Link>
          </div>
        </div>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {steps.map((s) => (
          <Link key={s.to} to={s.to} className="press flex items-start gap-3 rounded-xl border border-line p-3 hover:border-accent/40">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <s.icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-medium">{s.title}</span>
              <span className="block text-xs text-muted">{s.hint}</span>
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link to="/bienvenue" className="press flex items-center gap-2 text-sm font-medium text-accent">
          <Route size={16} /> {t("Revoir la présentation")}
        </Link>
        {me.data?.demoAvailable && (
          <button type="button" onClick={demo} disabled={busy} className="press flex items-center gap-2 text-sm font-medium text-accent disabled:opacity-60">
            <Presentation size={16} /> {t("Voir Pécule rempli, avec une famille fictive")}
          </button>
        )}
      </div>
    </Card>
  );
}
