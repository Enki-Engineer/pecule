import {
  BadgeEuro,
  Bitcoin,
  Building2,
  CalendarClock,
  FolderOpen,
  Landmark,
  LayoutDashboard,
  ListOrdered,
  PieChart,
  PiggyBank,
  Receipt,
  Sunset,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { t, tn } from "../lib/i18n.ts";

/* Plan de l'appli : menu latéral (ordinateur) et menu « Tout Pécule » (iPhone). */

export type Counts = { uncategorized: number; invoicesToMatch: number; tasksOverdue: number; alerts: number; lowBalance: number };
/** Où mène un clic sur un compteur du menu : l'écran déjà filtré sur ce qu'il compte, et le libellé du lien. */
export const COUNT_LINKS: Record<keyof Counts, { to: string; label: (n: number) => string }> = {
  uncategorized: { to: "/operations?a_classer=1", label: (n) => tn("Voir l'opération à classer", "Voir les {n} opérations à classer", n) },
  invoicesToMatch: { to: "/factures?filtre=a_rapprocher", label: (n) => tn("Voir la facture à rapprocher", "Voir les {n} factures à rapprocher", n) },
  tasksOverdue: { to: "/echeancier?retard=1", label: (n) => tn("Voir la tâche en retard", "Voir les {n} tâches en retard", n) },
  lowBalance: { to: "/soldes", label: (n) => tn("Voir le compte signalé", "Voir les {n} comptes signalés", n) },
  alerts: { to: "/reglages/suivi", label: (n) => tn("Voir l'alerte à traiter", "Voir les {n} alertes à traiter", n) },
};
export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; count?: keyof Counts };
export const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", label: t("Tableau de bord"), icon: LayoutDashboard, end: true }] },
  {
    title: t("Au quotidien"),
    items: [
      { to: "/operations", label: t("Opérations"), icon: ListOrdered, count: "uncategorized" },
      { to: "/mois", label: t("Analyse"), icon: PieChart },
      { to: "/budget", label: t("Budget"), icon: Wallet },
      { to: "/soldes", label: t("Soldes à venir"), icon: TrendingDown, count: "lowBalance" },
      { to: "/factures", label: t("Factures"), icon: Receipt, count: "invoicesToMatch" },
    ],
  },
  {
    title: t("Patrimoine"),
    items: [
      { to: "/patrimoine", label: t("Vue d'ensemble"), icon: PiggyBank, end: true },
      { to: "/immobilier", label: t("Immobilier"), icon: Building2 },
      { to: "/patrimoine/crypto", label: t("Crypto"), icon: Bitcoin },
      { to: "/objectifs", label: t("Objectifs"), icon: Target },
      { to: "/projections", label: t("Projections"), icon: TrendingUp },
    ],
  },
  {
    title: t("Situation"),
    items: [
      { to: "/revenus", label: t("Revenus"), icon: BadgeEuro },
      { to: "/impots", label: t("Impôts"), icon: Landmark },
      { to: "/retraite", label: t("Retraite"), icon: Sunset },
    ],
  },
  {
    title: t("Documents"),
    items: [
      { to: "/documents", label: t("Coffre"), icon: FolderOpen },
      { to: "/echeancier", label: t("Échéancier"), icon: CalendarClock, count: "tasksOverdue" },
    ],
  },
];

