// Decodes a VM "map" of [Hash] -> [u64] coming from contract_event
// Payload shape example (your JSON):
// { type:"map", value: [ [ {type:"Hash", value:"..."}, {type:"u64", value:"..."} ], ... ] }

import { VMParameter } from "../utils/xvmSerializer";

export type LpReserve = { assetHash: string; amountU64: bigint };

export function decodeVmMapLpReserves(vm: VMParameter): LpReserve[] {
  if (!vm || vm.type !== "map" || !Array.isArray(vm.value)) return [];

  const out: LpReserve[] = [];
  for (const pair of vm.value as any[]) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;

    const [k, v] = pair as [VMParameter, VMParameter];

    const hash =
      k?.type === "Hash" ? String(k.value)
      : k?.type === "primitive" && k?.value?.type === "opaque" && k?.value?.value?.type === "Hash"
        ? String(k.value.value.value)
        : null;

    const amt =
      v?.type === "u64" ? BigInt(v.value)
      : v?.type === "primitive" && v?.value?.type === "u64"
        ? BigInt(v.value.value)
        : null;

    if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) continue;
    if (amt == null || amt < 0n) continue;

    out.push({ assetHash: hash.toLowerCase(), amountU64: amt });
  }
  return out;
}
