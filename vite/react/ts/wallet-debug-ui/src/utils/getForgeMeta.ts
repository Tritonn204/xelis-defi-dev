import { vmParam } from '@/utils/xvmSerializer';
import { genericTransformer } from '@/utils/types';

export async function getForgeMetaForAssets(
  factoryContract: string,
  assetHashes: string[],
  getContractData: (opts: any) => Promise<any>
): Promise<Record<string, any>> {
  const result: Record<string, any> = {};

  for (const hash of assetHashes) {
    try {
      const raw = await getContractData({
        contract: factoryContract,
        key: vmParam.hash(hash),
      });

      const data = genericTransformer(raw)?.data?.value;
      if (data) {
        result[hash] = data;
      }
    } catch (err) {
      // Not forge asset or invalid data
    }
  }

  return result;
}
