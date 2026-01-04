export interface VMParameter {
  type: string;
  value: any;
}

// Known opaque types that need special wrapping
const OPAQUE_TYPES = new Set(['Hash', 'Address', 'PublicKey', 'Blob']);

// Type validation and conversion helpers
const TYPE_VALIDATORS = {
  'u256': (v: any) => {
    const num = typeof v === 'bigint' ? v : BigInt(v);
    if (num < 0n) throw new Error(`Value ${v} cannot be negative for u256`);
    return Number(num);
  },
  'u128': (v: any) => {
    const num = typeof v === 'bigint' ? v : BigInt(v);
    if (num < 0n) throw new Error(`Value ${v} cannot be negative for u128`);
    return Number(num);
  },
  'u64': (v: any) => {
    const num = typeof v === 'bigint' ? v : BigInt(v);
    if (num < 0n || num > 0xFFFFFFFFFFFFFFFFn) {
      throw new Error(`Value ${v} is out of range for u64`);
    }
    return Number(num);
  },
  'u32': (v: any) => {
    const num = Number(v);
    if (num < 0 || num > 0xFFFFFFFF || !Number.isInteger(num)) {
      throw new Error(`Value ${v} is not a valid u32`);
    }
    return num;
  },
  'u16': (v: any) => {
    const num = Number(v);
    if (num < 0 || num > 0xFFFF || !Number.isInteger(num)) {
      throw new Error(`Value ${v} is not a valid u16`);
    }
    return num;
  },
  'u8': (v: any) => {
    const num = Number(v);
    if (num < 0 || num > 255 || !Number.isInteger(num)) {
      throw new Error(`Value ${v} is not a valid u8`);
    }
    return num;
  },
  'boolean': (v: any) => Boolean(v),
  'bool': (v: any) => Boolean(v),
  'string': (v: any) => String(v),
  'Hash': (v: any) => {
    const str = String(v);
    if (!/^[0-9a-fA-F]{64}$/.test(str)) {
      throw new Error(`Value ${v} is not a valid 64-character hex hash`);
    }
    return str;
  },
  'Address': (v: any) => {
    const str = String(v);
    // TODO validate
    return str;
  },
  'PublicKey': (v: any) => {
    const str = String(v);
    // TODO validate
    return str;
  },
  'Blob': (v: any) => {
    const str = String(v);
    // TODO validate
    return str;
  }
} as const;

export type ValidationType = keyof typeof TYPE_VALIDATORS;

/**
 * Creates a VM-compatible parameter object for primitive types
 * @param value - The value to wrap
 * @param type - The type string (e.g., 'u64', 'Hash', 'string')
 * @param validate - Whether to validate and convert the value (default: true)
 */
export function createVMPrimitive(
  value: any, 
  type: ValidationType, 
  validate: boolean = true
): VMParameter {
  let processed_value = value;
  
  // Validate and convert value if requested
  if (validate && TYPE_VALIDATORS[type]) {
    try {
      processed_value = TYPE_VALIDATORS[type](value);
    } catch (error) {
      throw new Error(`Failed to create VM parameter for type ${type}: ${error}`);
    }
  }
  
  // Handle opaque types (Hash, Address, PublicKey)
  if (OPAQUE_TYPES.has(type)) {
    return {
      type: "primitive",
      value: {
        type: "opaque",
        value: {
          type: type,
          value: processed_value
        }
      }
    };
  }
  
  // Handle regular types
  return {
    type: "primitive",
    value: {
      type: type,
      value: processed_value
    }
  };
}

/**
 * Convenience functions for common primitive types
 */
export const VMParam = {
  hash: (value: string) => createVMPrimitive(value, 'Hash'),
  address: (value: string) => createVMPrimitive(value, 'Address'),
  publicKey: (value: string) => createVMPrimitive(value, 'PublicKey'),
  blob: (value: string) => createVMPrimitive(value, 'Blob'),
  u256: (value: bigint | number) => createVMPrimitive(value, 'u256'),
  u128: (value: bigint | number) => createVMPrimitive(value, 'u128'),
  u64: (value: number | bigint) => createVMPrimitive(value, 'u64'),
  u32: (value: number) => createVMPrimitive(value, 'u32'),
  u16: (value: number) => createVMPrimitive(value, 'u16'),
  u8: (value: number) => createVMPrimitive(value, 'u8'),
  string: (value: string) => createVMPrimitive(value, 'string'),
  boolean: (value: boolean) => createVMPrimitive(value, 'boolean'),
};

// ============================================================================
// Custom Type System (Structs & Enums)
// ============================================================================

/**
 * A type that knows how to serialize itself to VMParameter
 */
export interface SerializableType {
  readonly name: string;
  to_VMParameter(value: any): VMParameter;
}

/**
 * Enum variant schema
 */
export interface EnumVariantSchema {
  name: string;
  fields: Array<{ name: string; type: string }>;
}

/**
 * Struct field schema
 */
export interface StructFieldSchema {
  name: string;
  type: string;
}

/**
 * Define an enum type from ABI schema
 */
export function defineEnum(
  name: string,
  variants: EnumVariantSchema[]
): SerializableType {
  return {
    name,
    to_VMParameter(value: any): VMParameter {
      // Find variant index by type field
      const variant_index = variants.findIndex(v => v.name === value.type);
      if (variant_index === -1) {
        throw new Error(`Unknown variant '${value.type}' for enum '${name}'`);
      }

      const variant = variants[variant_index];
      
      // Check for unknown fields
      const expected_fields = new Set(variant.fields.map(f => f.name));
      expected_fields.add('type'); // 'type' is the discriminator
      
      for (const key of Object.keys(value)) {
        if (!expected_fields.has(key)) {
          throw new Error(
            `Unknown field '${key}' for variant '${value.type}' of enum '${name}'. ` +
            `Expected fields: ${Array.from(expected_fields).filter(f => f !== 'type').join(', ')}`
          );
        }
      }
      
      const params: VMParameter[] = [
        VMParam.u8(variant_index) // Variant ID first
      ];

      // Serialize each field in order
      for (const field_schema of variant.fields) {
        const field_value = value[field_schema.name];
        
        if (field_value === undefined) {
          throw new Error(
            `Missing field '${field_schema.name}' for variant '${value.type}' of enum '${name}'`
          );
        }

        // Recursively serialize (handles nested custom types)
        params.push(createVMParameter(field_value, field_schema.type));
      }

      return {
        type: "object",
        value: params
      };
    }
  };
}

/**
 * Define a struct type from ABI schema
 */
export function defineStruct(
  name: string,
  fields: StructFieldSchema[]
): SerializableType {
  return {
    name,
    to_VMParameter(value: any): VMParameter {
      // Check for unknown fields
      const expected_fields = new Set(fields.map(f => f.name));
      
      for (const key of Object.keys(value)) {
        if (!expected_fields.has(key)) {
          throw new Error(
            `Unknown field '${key}' for struct '${name}'. ` +
            `Expected fields: ${Array.from(expected_fields).join(', ')}`
          );
        }
      }
      
      const params: VMParameter[] = [];

      // Check for missing fields and serialize
      for (const field_schema of fields) {
        const field_value = value[field_schema.name];
        
        if (field_value === undefined) {
          throw new Error(
            `Missing field '${field_schema.name}' for struct '${name}'`
          );
        }

        // Recursively serialize
        params.push(createVMParameter(field_value, field_schema.type));
      }

      return {
        type: "object",
        value: params
      };
    }
  };
}

/**
 * Type registry - simple Map for custom types
 */
class TypeRegistry {
  private types = new Map<string, SerializableType>();

  register(definition: SerializableType): SerializableType {
    this.types.set(definition.name, definition);
    return definition;
  }

  get(name: string): SerializableType | undefined {
    return this.types.get(name);
  }

  has(name: string): boolean {
    return this.types.has(name);
  }

  clear(): void {
    this.types.clear();
  }
}

export const typeRegistry = new TypeRegistry();

/**
 * Enhanced parameter creation that handles both primitive and custom types
 * @param value - The value to serialize
 * @param type - The type string (primitive or custom type name)
 * @param validate - Whether to validate primitive values (default: true)
 */
export function createVMParameter(
  value: any,
  type: string,
  validate: boolean = true
): VMParameter {
  // Try custom type first
  const custom_type = typeRegistry.get(type);
  if (custom_type) {
    return custom_type.to_VMParameter(value);
  }

  // Fall back to primitive
  if (type in TYPE_VALIDATORS) {
    return createVMPrimitive(value, type as ValidationType, validate);
  }

  throw new Error(`Unknown type: ${type}`);
}

// ============================================================================
// Contract Invocation Helpers
// ============================================================================

/**
 * Creates a deposits object for contract calls
 * @param deposits - Object mapping token hashes to amounts
 */
export function create_deposits(deposits: Record<string, number | bigint>): Record<string, { amount: number | bigint }> {
  const result: Record<string, { amount: number | bigint }> = {};
  
  for (const [token_hash, amount] of Object.entries(deposits)) {
    // Validate hash format
    if (!/^[0-9a-fA-F]{64}$/.test(token_hash)) {
      throw new Error(`Invalid token hash format: ${token_hash}`);
    }
    
    result[token_hash] = { amount };
  }
  
  return result;
}

/**
 * Creates a contract invocation object
 */
export interface ContractInvocationParams {
  contract: string;
  entry_id: number;
  parameters?: VMParameter[];
  deposits?: Record<string, number | bigint>;
  maxGas?: number;
}

export function createContractInvocation(params: ContractInvocationParams): Record<string, any> {
  const {
    contract,
    entry_id,
    parameters = [],
    deposits,
    maxGas = 50000000
  } = params;
  
  const result: any = {
    invoke_contract: {
      contract,
      maxGas,
      entry_id: entry_id,
      parameters
    }
  };
  
  if (deposits && Object.keys(deposits).length > 0) {
    result.invoke_contract.deposits = create_deposits(deposits);
  }
  
  return result;
}

/**
 * Creates a contract deployment object
 */
export interface ContractDeploymentParams {
  bytecode: string;
  hasConstructor?: boolean;
  maxGas?: number;
}

export function createContractDeployment(params: ContractDeploymentParams): Record<string, any> {
  const { bytecode, hasConstructor = false, maxGas = 50000000 } = params;
  
  const result: any = {
    deploy_contract: {
      module: bytecode,
      ...(hasConstructor && { invoke: { maxGas } })
    }
  };
  
  return result;
}