import { 
  // deepTransform,
  createTransformer,
  getMapTypes,
  isMap
} from './data';
import * as types from '@xelis/sdk/daemon/types';

// Generic transformer - now preserves types by default
export const genericTransformer = createTransformer<Record<string, any>>({ preserveTypes: true });

// Legacy transformer without type preservation
export const legacyTransformer = createTransformer<Record<string, any>>({ preserveTypes: false });

// Helper to check if data is a version + map structure - updated
export function isVersionMapPattern(data: any): boolean {
  if (Array.isArray(data) && data.length === 2) {
    // Check for typed version
    const version = data[0];
    const versionValue = version?.type && version?.value !== undefined ? version.value : version;
    
    return typeof versionValue === 'bigint' && isMap(data[1]);
  }
  return false;
}

// Helper to check if data is a balance map - updated
export function isBalanceMap(data: any): boolean {
  const mapTypes = getMapTypes(data);
  return !!(
    mapTypes && 
    mapTypes[0] === 'Hash' && 
    ['u64', 'u128', 'u256'].includes(mapTypes[1])
  );
}

// Extract value from typed or untyped data
export function extractValue(data: any): any {
  if (data && typeof data === 'object' && 'type' in data && 'value' in data) {
    return data.value;
  }
  return data;
}

// Extract XVM data structure - updated to handle typed structures
export function extractXVMData(response: any): {
  version?: bigint;
  versionType?: string;
  map?: Record<string, any>;
  mapTypes?: [string, string];
  isBalanceMap?: boolean;
} {
  const result: any = {};
  
  // Look for the XVM data structure
  const data = response?.data;
  if (!data) return result;
  
  // Check if it's the version + map pattern
  if (Array.isArray(data) && data.length === 2) {
    // First element should be version
    const versionData = data[0];
    if (versionData?.type && versionData?.value !== undefined) {
      result.version = versionData.value;
      result.versionType = versionData.type;
    } else if (typeof versionData === 'bigint') {
      result.version = versionData;
    }
    
    // Second element should be map
    const mapData = data[1];
    if (isMap(mapData)) {
      result.map = mapData.value || mapData;
      result.mapTypes = getMapTypes(mapData);
      
      if (result.mapTypes && 
          result.mapTypes[0] === 'Hash' && 
          ['u64', 'u128', 'u256'].includes(result.mapTypes[1])) {
        result.isBalanceMap = true;
      }
    }
  } 
  // Check if it's just a map
  else if (isMap(data)) {
    result.map = data.value || data;
    result.mapTypes = getMapTypes(data);
    
    if (result.mapTypes && 
        result.mapTypes[0] === 'Hash' && 
        ['u64', 'u128', 'u256'].includes(result.mapTypes[1])) {
      result.isBalanceMap = true;
    }
  }
  
  return result;
}

// Helper to get balances - works with both typed and untyped
export function getBalances(data: any): Record<string, bigint> | null {
  const xvmData = extractXVMData(data);
  if (!xvmData.isBalanceMap || !xvmData.map) return null;
  
  // Values are already parsed as bigints, no need to extract
  return xvmData.map;
}

// Helper to get a specific balance
export function getBalance(data: any, address: string): bigint | undefined {
  const balances = getBalances(data);
  return balances ? balances[address] : undefined;
}

// Helper to reconstruct typed values based on mapTypes
export function reconstructTypedMap(map: Record<string, any>, mapTypes: [string, string]): Record<string, any> {
  const [_keyType, valueType] = mapTypes;
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(map)) {
    result[key] = {
      type: valueType,
      value: value
    };
  }
  
  return result;
}

export const responseTransformers = {
  // Custom transformer for contract data - preserves types
  contractDataTransformer: (response: types.GetContractDataResult) => {
    const transformed = genericTransformer(response);
    return transformed;
  },
  
  // Legacy transformer without type preservation
  contractDataLegacyTransformer: (response: types.GetContractDataResult) => {
    const transformed = legacyTransformer(response);
    return transformed;
  }
}