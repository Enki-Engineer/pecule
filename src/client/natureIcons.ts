import { ArrowDownLeft, ArrowLeftRight, Banknote, CreditCard, Landmark, Repeat, Send, Undo2, type LucideIcon } from "lucide-react";
import type { Nature } from "../lib/nature.ts";

/* La nature d'une opération se reconnaît à son icône : colonne du tableau des opérations, choix du filtre sur téléphone. */
export const NATURE_ICONS: Record<Nature, LucideIcon> = {
  carte: CreditCard,
  prelevement: Repeat,
  virement: Send,
  retrait: Banknote,
  frais: Landmark,
  interne: ArrowLeftRight,
  remboursement: Undo2,
  entree: ArrowDownLeft,
};
