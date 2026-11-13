/*
 * Staking EGLD lu sur la blockchain MultiversX (API publique, sans clé, lecture seule) :
 * stake actif + récompenses à réclamer + montants en cours de retrait, tous fournisseurs confondus.
 */

const API = "https://api.multiversx.com";
const DENOM = 1e18;

export const isMultiversXAddress = (a: string) => /^erd1[02-9ac-hj-np-z]{58}$/.test(a);

type Delegation = { userActiveStake?: string; claimableRewards?: string; userUndelegatedList?: { amount: string }[] };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`MultiversX ${path.split("/").slice(0, 2).join("/")} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** EGLD délégués par l'adresse, détaillés. */
export async function egldStaking(address: string) {
  if (!isMultiversXAddress(address)) throw new Error("Adresse MultiversX invalide");
  const [current, legacy] = await Promise.all([
    get<Delegation[]>(`/accounts/${address}/delegation`),
    get<Delegation & { userWaitingStake?: string; userWithdrawOnlyStake?: string; userUnstakedStake?: string }>(`/accounts/${address}/delegation-legacy`).catch(() => null),
  ]);
  const n = (v?: string) => Number(v ?? 0) / DENOM;
  let active = 0;
  let rewards = 0;
  let undelegating = 0;
  for (const d of current) {
    active += n(d.userActiveStake);
    rewards += n(d.claimableRewards);
    for (const u of d.userUndelegatedList ?? []) undelegating += n(u.amount);
  }
  if (legacy) {
    active += n(legacy.userActiveStake) + n(legacy.userWaitingStake);
    rewards += n(legacy.claimableRewards);
    undelegating += n(legacy.userUnstakedStake) + n(legacy.userWithdrawOnlyStake);
  }
  return { active, rewards, undelegating, total: active + rewards + undelegating };
}
