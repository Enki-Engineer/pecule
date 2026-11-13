import {
  BadgeEuro,
  Bitcoin,
  Building2,
  CalendarClock,
  FolderOpen,
  FolderUp,
  Landmark,
  LayoutDashboard,
  ListOrdered,
  PieChart,
  PiggyBank,
  Receipt,
  Sunset,
  Target,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { t } from "../lib/i18n.ts";

/* Plan de l'appli : menu latéral (ordinateur) et menu « Tout Pécule » (iPhone). */

export type Counts = { uncategorized: number; invoicesToMatch: number; tasksOverdue: number; alerts: number };
export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; count?: keyof Counts };
export const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", label: t("Tableau de bord"), icon: LayoutDashboard, end: true }] },
  {
    title: t("Au quotidien"),
    items: [
      { to: "/operations", label: t("Opérations"), icon: ListOrdered, count: "uncategorized" },
      { to: "/mois", label: t("Analyse"), icon: PieChart },
      { to: "/budget", label: t("Budget"), icon: Wallet },
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
      { to: "/importer", label: t("Importer"), icon: FolderUp },
      { to: "/echeancier", label: t("Échéancier"), icon: CalendarClock, count: "tasksOverdue" },
    ],
  },
];

