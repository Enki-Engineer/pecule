import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { consentsWith, type BankGuideInput, type BankScope } from "../lib/onboarding.ts";

/*
 * Enable Banking vu de l'écran : l'état lu par Réglages → Comptes et connexions et par le guide « Relier ta banque »
 * (components/BankGuide.tsx), qui s'affiche aussi dans la présentation de bienvenue. Une seule lecture, partagée.
 */

type Application = { name: string; active: boolean; environment: string; redirectOk: boolean };
type Outstanding = { amount: number; realtime: number | null; debitDate: string | null; count: number; sum: number; consistent: boolean; at: string };
/** `own` : accord donné avec la clé personnelle du membre (sinon, avec celle du foyer). */
export type BankSession = { id: string; aspsp: string; country: string; userId: number; own?: boolean; validUntil: string; daysLeft: number; accounts: { id: string; name: string; kind: string; deferred: boolean; tail: string | null }[] };
export type BankState = {
  configured: boolean;
  keyUnreadable: boolean;
  appId: string | null;
  redirectUrl: string;
  application: Application | null;
  error: string | null;
  sessions: BankSession[];
  lastSyncAt: string | null;
  own: { appId: string; keyUnreadable: boolean; application: Application | null; error: string | null } | null;
  observation: boolean;
  cards: { accountId: string; name: string; tail: string | null; outstanding: Outstanding }[];
  admin: boolean;
};
export type Bank = { name: string; country: string; personal: boolean; consentDays: number };

export const BANK_STATE_KEY = ["bank", "enable-banking"] as const;
export const useBankState = (enabled = true) => useQuery({ queryKey: BANK_STATE_KEY, queryFn: () => api<BankState>("/bank/enable-banking"), enabled });

/** Pays proposés pour relier une banque (codes ISO ; le nom affiché vient du navigateur, dans la langue de Pécule). */
export const BANK_COUNTRIES = ["FR", "BE", "LU", "DE", "ES", "IT", "PT", "NL", "IE", "AT", "FI", "SE", "DK", "NO", "PL", "EE", "LV", "LT", "GR", "CY", "MT", "SI", "SK", "HR", "HU", "RO", "BG", "IS", "LI"];

/** Témoin laissé par le serveur au retour de la banque (« reliee » ou « erreur »), lu une fois puis effacé. */
export function takeBankOutcome(): string | null {
  const m = /(?:^|; )pecule_banque=([^;]+)/.exec(document.cookie);
  if (!m) return null;
  document.cookie = "pecule_banque=; Max-Age=0; path=/";
  return m[1];
}

/** Quelle application sert au membre : celle du foyer, ou la sienne (comptes à son seul nom). */
export type { BankScope };

/** Accords que le membre a donnés avec une application : la sienne, ou celle du foyer. */
export const consentsOf = (s: BankState, scope: BankScope, userId: number | undefined): BankSession[] => consentsWith(s.sessions, scope, userId);

/** Ce que le guide lit de l'état pour une application : sa clé, ce qu'Enable Banking en dit, les accords que le membre lui a donnés. */
export function guideFacts(s: BankState, scope: BankScope, userId: number | undefined): Omit<BankGuideInput, "declared"> & { application: Application | null; error: string | null } {
  const consents = consentsOf(s, scope, userId).length;
  if (scope === "moi") return { keySaved: !!s.own, keyUnreadable: !!s.own?.keyUnreadable, application: s.own?.application ?? null, error: s.own?.error ?? null, consents };
  return { keySaved: s.configured || s.keyUnreadable, keyUnreadable: s.keyUnreadable, application: s.application, error: s.error, consents };
}
