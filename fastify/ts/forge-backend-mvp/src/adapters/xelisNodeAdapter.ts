import DaemonWS from '@xelis/sdk/daemon/websocket';
import * as types from '@xelis/sdk/daemon/types';

import { responseTransformers } from '../utils/types';
import { GetContractDataResult } from '@xelis/sdk/daemon/types';

import type { MessageEvent } from 'ws';

export class XelisNodeAdapter {
  private daemon: DaemonWS;

  private constructor(daemon: DaemonWS) {
    this.daemon = daemon;
  }

  static async connect(url: string) {
    const d = new DaemonWS();
    await d.connect(url);
    // sanity check like FE
    await d.methods.getInfo();
    return new XelisNodeAdapter(d);
  }

  async close() {
    try { await this.daemon.close(); } catch {}
  }

  // env-driven like FE context
  async getRouterContract(): Promise<string | undefined> {
    return process.env.ROUTER_CONTRACT || undefined;
  }
  async getFactoryContract(): Promise<string | undefined> {
    return process.env.FACTORY_CONTRACT || undefined;
  }

  // Mirrors FE: direct dataCall + transformer
  async getContractData(params: types.GetContractDataPrams): Promise<types.GetContractDataResult> {
    // IMPORTANT: params.key must be a VM param (VMParam.hash(...))
    const raw = await this.daemon.dataCall('get_contract_data', params) as GetContractDataResult;
    return responseTransformers.contractDataTransformer(raw) as types.GetContractDataResult;
  }

  async getContractAssets(contract: string): Promise<string[]> {
    const res = await this.daemon.dataCall('get_contract_assets', { contract });
    return res as string[];
  }

  async getAsset(params: types.GetAssetParams): Promise<types.AssetData> {
    return await this.daemon.dataCall('get_asset', params) as types.AssetData;
  }

  async getAssetSupply(params: types.GetAssetParams) {
    return await this.daemon.dataCall('get_asset_supply', params);
  }

  onContractEvent(
    contract: string,
    id: number,
    handler: (data: types.ContractEvent & types.RPCEventResult) => void,
  ) {
    return this.daemon.methods.onContractEvent(
      contract,
      id,
      (_evt: MessageEvent, data?: types.ContractEvent & types.RPCEventResult, err?: Error) => {
        if (err) {
          return;
        }
        if (data) handler(data);
      },
    );
  }
}
