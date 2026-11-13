import { useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, useDemo } from "./api.ts";
import { brandOf, setCustomBrands, type CustomBrand } from "../lib/brands.ts";

/*
 * Enseignes du foyer et logos des banques reliées, côté écran. La liste des enseignes est chargée une fois
 * (app.tsx), confiée au référentiel (`setCustomBrands`), et un petit signal fait redessiner les logos déjà affichés
 * quand elle change — sans recharger les écrans.
 */

export type { CustomBrand };

/* ---------- Enseignes du foyer ---------- */

let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Confie la liste au référentiel ; si elle a changé, les logos affichés se redessinent. */
export function adoptBrands(list: CustomBrand[]): void {
  if (!setCustomBrands(list)) return;
  version++;
  for (const l of listeners) l();
}

/** À appeler dans un composant qui lit `brandOf` : il se redessine quand les enseignes du foyer changent. */
export const useBrandsVersion = () => useSyncExternalStore(subscribe, () => version);

const brandsQuery = { queryKey: ["brands"], queryFn: () => api<{ brands: CustomBrand[] }>("/brands"), staleTime: 10 * 60_000 };
export const useBrands = (enabled = true) => useQuery({ ...brandsQuery, enabled });

export type BrandMatch = { pattern: string | null; count: number; samples: string[] };

/** Aperçu d'un motif : ce qu'il reconnaît dans les opérations des douze derniers mois (rien tant qu'il fait moins de 3 caractères). */
export const useBrandMatch = (pattern: string) =>
  useQuery({
    placeholderData: keepPreviousData,
    queryKey: ["brands", "match", pattern],
    queryFn: () => api<BrandMatch>(`/brands/match?pattern=${encodeURIComponent(pattern)}`),
    enabled: pattern.length >= 3,
    staleTime: 60_000,
  });

export type BrandInput = { name: string; pattern: string; domain: string | null };
export const saveBrand = (id: number | null, body: BrandInput) => api<{ brand: CustomBrand }>(id == null ? "/brands" : `/brands/${id}`, { method: id == null ? "POST" : "PATCH", json: body });
export const removeBrand = (id: number) => api<{ ok: true }>(`/brands/${id}`, { method: "DELETE" });

/* ---------- Banques reliées par Enable Banking ---------- */

type LinkedBank = { name: string; country: string; key: string; institutions: string[] };

const useLinkedBankLogos = () => {
  const demo = useDemo();
  return useQuery({ queryKey: ["bank-logos"], queryFn: () => api<{ banks: LinkedBank[] }>("/bank-logos"), enabled: !demo, staleTime: 30 * 60_000 });
};

/**
 * Clé du logo d'Enable Banking pour un nom de banque ou d'établissement, s'il désigne une banque reliée : par son
 * nom (celui de la banque chez Enable Banking, ou celui que portent ses comptes), sinon parce que c'est la même marque.
 */
export function useBankLogoKey(bank: string | null): string | null {
  const banks = useLinkedBankLogos().data?.banks;
  if (!bank || !banks?.length) return null;
  const wanted = bank.trim().toLowerCase();
  const names = (b: LinkedBank) => [b.name, ...b.institutions];
  const byName = banks.find((b) => names(b).some((n) => n.trim().toLowerCase() === wanted));
  if (byName) return byName.key;
  const domain = brandOf(bank)?.domain;
  return (domain ? banks.find((b) => names(b).some((n) => brandOf(n)?.domain === domain)) : undefined)?.key ?? null;
}
