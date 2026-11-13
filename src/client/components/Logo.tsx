import { useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  Baby,
  Banknote,
  BedDouble,
  Briefcase,
  Car,
  CircleHelp,
  Coffee,
  Gift,
  HeartPulse,
  House,
  Landmark,
  PawPrint,
  PiggyBank,
  Plane,
  Repeat,
  Shapes,
  Shirt,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Ticket,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { brandOf } from "../../lib/brands.ts";
import { cn } from "../cn.ts";

/*
 * Logos officiels (banques, plateformes crypto, cryptos, marchands) servis par /api/logos, avec un
 * repli si le logo est introuvable : icône du poste pour une opération, initiales pour le reste.
 */

const failed = new Set<string>();
const SIZES = { sm: "size-7 rounded-md", md: "size-9 rounded-[10px]", lg: "size-10 rounded-xl" } as const;
export type LogoSize = keyof typeof SIZES;

/** Image d'un logo (clé « d:<domaine> » ou « coin:<id> ») ; `fallback` s'il n'existe pas. */
export function LogoImg({ logoKey, alt, size = "lg", fallback, className }: { logoKey: string | null; alt: string; size?: LogoSize; fallback: ReactNode; className?: string }) {
  const [broken, setBroken] = useState(() => !logoKey || failed.has(logoKey));
  if (!logoKey || broken) return <>{fallback}</>;
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-line", SIZES[size], className)}>
      {/* Décoratif : le nom de la marque est écrit à côté (sinon les lecteurs d'écran le liraient deux fois). */}
      <img
        src={`/api/logos/${encodeURIComponent(logoKey)}`}
        alt=""
        aria-hidden
        data-brand={alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="size-full object-cover"
        onError={() => {
          failed.add(logoKey);
          setBroken(true);
        }}
      />
    </span>
  );
}

/** Pastille de repli : initiales ou icône sur fond neutre. */
export function Tile({ size = "lg", tone = "neutral", children, className }: { size?: LogoSize; tone?: "neutral" | "warn" | "pos" | "accent"; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center text-[12px] font-bold",
        SIZES[size],
        tone === "warn" ? "bg-warn/10 text-warn" : tone === "pos" ? "bg-pos/10 text-pos" : tone === "accent" ? "bg-accent-soft text-accent" : "bg-bg text-muted ring-1 ring-line",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Icône d'un poste ou d'une catégorie (opération sans marque reconnue). */
export function categoryIcon(poste: string | null | undefined, name?: string | null, kind?: string | null): LucideIcon {
  const n = (name ?? "").toLowerCase();
  const p = (poste ?? "").toLowerCase();
  if (kind === "interne" || p.startsWith("mouvements")) return n.includes("espèces") ? Banknote : ArrowLeftRight;
  if (kind === "revenu" || p === "revenus") return ArrowDownLeft;
  if (/restaurant|livraison/.test(n)) return UtensilsCrossed;
  if (/boulangerie|café/.test(n)) return Coffee;
  if (/abonnement/.test(n)) return Repeat;
  if (/voyage/.test(n)) return Plane;
  if (/hébergement/.test(n)) return BedDouble;
  if (/cadeau/.test(n)) return Gift;
  if (/vêtement/.test(n)) return Shirt;
  if (/esthétique/.test(n)) return Sparkles;
  if (p.startsWith("logement")) return House;
  if (p.startsWith("transport")) return Car;
  if (p.startsWith("alimentation")) return ShoppingBasket;
  if (p.startsWith("famille")) return Baby;
  if (p.startsWith("animaux")) return PawPrint;
  if (p.startsWith("santé")) return HeartPulse;
  if (p.startsWith("impôts")) return Landmark;
  if (p.startsWith("epargne") || p.startsWith("épargne")) return PiggyBank;
  if (p.startsWith("loisirs")) return Ticket;
  if (p.includes("entreprise")) return Briefcase;
  if (p.startsWith("frais")) return Banknote;
  if (p.startsWith("divers")) return Shapes;
  return CircleHelp;
}

/** Logo d'une opération : la marque reconnue, sinon l'icône de son poste (« à classer » en orange). */
export function TxLogo({
  t,
  size = "lg",
}: {
  t: { label: string; merchant: string | null; category_name?: string | null; category_poste?: string | null; category_kind?: string | null; amount?: number };
  size?: LogoSize;
}) {
  const brand = t.category_kind === "interne" ? null : brandOf(t.merchant, t.label);
  const Icon = t.category_name ? categoryIcon(t.category_poste, t.category_name, t.category_kind) : CircleHelp;
  const px = size === "sm" ? 15 : size === "md" ? 17 : 18;
  const fallback = (
    <Tile size={size} tone={t.category_name ? (t.category_kind === "revenu" ? "pos" : "neutral") : "warn"}>
      <Icon size={px} strokeWidth={2} />
    </Tile>
  );
  return <LogoImg logoKey={brand ? `d:${brand.domain}` : null} alt={brand?.name ?? ""} size={size} fallback={fallback} />;
}

/** Logo d'une marque d'après un ou plusieurs textes (banque, créancier, plateforme) ; initiales sinon. */
export function BrandLogo({
  texts,
  initials,
  icon: Icon,
  size = "lg",
  tone = "accent",
}: {
  texts: (string | null | undefined)[];
  initials?: string;
  /** Icône de repli (à la place des initiales) quand aucune marque n'est reconnue. */
  icon?: LucideIcon;
  size?: LogoSize;
  tone?: "neutral" | "accent";
}) {
  const brand = brandOf(...texts);
  const label = initials ?? (texts.find(Boolean) ?? "?").replace(/^\p{Extended_Pictographic}\s*/u, "").slice(0, 2).toUpperCase();
  const px = size === "sm" ? 15 : size === "md" ? 17 : 18;
  return <LogoImg logoKey={brand ? `d:${brand.domain}` : null} alt={brand?.name ?? ""} size={size} fallback={<Tile size={size} tone={tone}>{Icon ? <Icon size={px} strokeWidth={2} /> : label}</Tile>} />;
}

/** Icône d'un type d'engagement du budget (repli des engagements sans fournisseur reconnu). */
export const commitmentIcon = (type: string): LucideIcon =>
  ({ credit: Landmark, assurance: ShieldCheck, abonnement: Repeat, taxe: Landmark, garde: Baby, budget: Wallet } as Record<string, LucideIcon>)[type] ?? Shapes;

/** Logo d'une crypto (CoinGecko), symbole sinon. */
export function CoinLogo({ coingeckoId, symbol, size = "lg" }: { coingeckoId: string | null | undefined; symbol: string; size?: LogoSize }) {
  return (
    <LogoImg
      logoKey={coingeckoId ? `coin:${coingeckoId}` : null}
      alt={symbol}
      size={size}
      className="rounded-full"
      fallback={
        <Tile size={size} tone="accent" className="rounded-full text-[9px]">
          {symbol.toUpperCase().slice(0, 4)}
        </Tile>
      }
    />
  );
}
