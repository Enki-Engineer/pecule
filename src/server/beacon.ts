/*
 * Validateur Ethereum lu sur la Beacon Chain (nœud public, sans clé, lecture seule).
 * Un validateur « compounding » (identifiants 0x02) cumule ses récompenses dans son solde.
 */

import { t } from "../lib/i18n.ts";

const API = "https://ethereum-beacon-api.publicnode.com";

export const isValidatorId = (id: string) => /^\d{1,9}$/.test(id) || /^0x[0-9a-fA-F]{96}$/.test(id);

export async function ethValidator(id: string) {
  if (!isValidatorId(id)) throw new Error(t("Identifiant de validateur invalide (index ou clé publique 0x…)"));
  const res = await fetch(`${API}/eth/v1/beacon/states/head/validators/${id}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Beacon Chain → HTTP ${res.status}`);
  const { data } = (await res.json()) as { data: { index: string; balance: string; status: string; validator: { slashed: boolean; withdrawal_credentials: string } } };
  return {
    index: data.index,
    balance: Number(data.balance) / 1e9,
    status: data.status,
    slashed: data.validator.slashed,
    withdrawalAddress: `0x${data.validator.withdrawal_credentials.slice(-40)}`,
  };
}
