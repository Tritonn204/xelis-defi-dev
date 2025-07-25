// Base types for the nested structure
export interface TypedValue<T = any> {
  type: string;
  value: T;
}

// Type mapping for known types
export const TYPE_MAPPINGS = {
  'u64': (v: any) => BigInt(v),
  'u128': (v: any) => BigInt(v),
  'u256': (v: any) => BigInt(v),
  'u32': (v: any) => Number(v),
  'u16': (v: any) => Number(v),
  'u8': (v: any) => Number(v),
  'i64': (v: any) => BigInt(v),
  'i32': (v: any) => Number(v),
  'bool': (v: any) => Boolean(v),
  'string': (v: any) => String(v),
  'Hash': (v: any) => String(v),
  'Address': (v: any) => String(v),
  'PublicKey': (v: any) => String(v)
} as const;

export type KnownType = keyof typeof TYPE_MAPPINGS;

// Metadata for parsing
export interface ParseMetadata {
  unknownTypes: string[];
  errors: Array<{ path: string; message: string }>;
}

// Track parsing context
export interface ParseContext {
  path: string[];
  unknownTypes: Set<string>;
  errors: Array<{ path: string; error: Error }>;
  preserveTypes?: boolean;
  inMap?: boolean; // Track if we're inside a map
}

// Extract the deepest type and value
export function extractDeepTypeAndValue(data: any): { type: string; value: any } {
  let current = data;
  let finalType = '';
  
  while (current && typeof current === 'object' && 'type' in current && 'value' in current) {
    finalType = current.type;
    current = current.value;
  }
  
  return { 
    type: finalType || typeof current,
    value: current
  };
}

// Parse typed value with conversion
export function parseTypedValue(data: any, context?: ParseContext): any {
  const { type, value } = extractDeepTypeAndValue(data);
  
  // Try to convert using known type converters
  const converter = TYPE_MAPPINGS[type as KnownType];
  
  let convertedValue = value;
  if (converter) {
    try {
      convertedValue = converter(value);
    } catch (error) {
      if (context) {
        context.errors.push({
          path: context.path.join('.'),
          error: error as Error
        });
      }
    }
  } else if (context && type) {
    // Track unknown types
    context.unknownTypes.add(type);
  }
  
  // If preserving types and NOT in a map, return typed structure
  if (context?.preserveTypes && !context?.inMap) {
    return {
      type,
      value: convertedValue
    };
  }
  
  return convertedValue;
}

// Parse arrays
export function parseArray(arr: any[], context?: ParseContext): any[] {
  return arr.map((item, index) => {
    const subContext = context ? {
      ...context,
      path: [...context.path, `[${index}]`]
    } : undefined;
    return parseValue(item, subContext);
  });
}

// Parse maps - preserve type information at map level only
export function parseMap(mapData: any[], context?: ParseContext): any {
  const result: Record<string, any> = {};
  
  // Get key and value types from the first entry if available
  let keyType = 'unknown';
  let valueType = 'unknown';
  
  if (mapData.length > 0) {
    const [firstKey, firstValue] = mapData[0];
    const keyInfo = extractDeepTypeAndValue(firstKey);
    const valueInfo = extractDeepTypeAndValue(firstValue);
    
    keyType = keyInfo.type;
    valueType = valueInfo.type;
  }
  
  // Parse all entries - mark that we're in a map to avoid nested type info
  const mapContext = context ? { ...context, inMap: true } : { 
    path: [], 
    unknownTypes: new Set(), 
    errors: [],
    inMap: true 
  };
  
  for (const [key, value] of mapData) {
    const keyContext = {
      ...mapContext,
      path: [...mapContext.path, 'key']
    };
    
    const valueContext = {
      ...mapContext,
      path: [...mapContext.path, 'value']
    };
    
    const parsedKey = parseTypedValue(key, keyContext);
    const parsedValue = parseValue(value, valueContext);
    
    // Use string representation of key for object keys
    const keyString = String(parsedKey);
    result[keyString] = parsedValue;
  }
  
  // If preserving types, wrap in typed structure with mapTypes
  if (context?.preserveTypes) {
    return {
      type: 'map',
      mapTypes: [keyType, valueType],
      value: result
    };
  }
  
  // Store type information as metadata (legacy mode)
  Object.defineProperty(result, '_mapTypes', {
    value: [keyType, valueType],
    enumerable: false
  });
  
  return result;
}

// Main parsing function - modified to preserve types
export function parseValue(data: any, context?: ParseContext): any {
  if (data === null || data === undefined) {
    return null;
  }
  
  if (typeof data !== 'object') {
    return data;
  }
  
  if ('type' in data && 'value' in data) {
    const { type, value } = data;
    
    switch (type) {
      case 'map':
        return parseMap(value, context);
      case 'array':
        const parsedArray = parseArray(value, context);
        return context?.preserveTypes && !context?.inMap ? { type: 'array', value: parsedArray } : parsedArray;
      case 'object':
        const parsedObject = parseArray(value, context);
        return context?.preserveTypes && !context?.inMap ? { type: 'object', value: parsedObject } : parsedObject;
      case 'option':
        const parsedOption = value ? parseValue(value, context) : null;
        return context?.preserveTypes && !context?.inMap ? { type: 'option', value: parsedOption } : parsedOption;
      case 'result':
        const parsedResult = {
          ok: value.ok,
          value: parseValue(value.value, context)
        };
        return context?.preserveTypes && !context?.inMap ? { type: 'result', value: parsedResult } : parsedResult;
      case 'default':
      case 'opaque':
        // These are wrapper types, continue parsing
        return parseValue(value, context);
      default:
        // For typed values, parse with conversion
        return parseTypedValue(data, context);
    }
  }
  
  // Handle plain arrays
  if (Array.isArray(data)) {
    return parseArray(data, context);
  }
  
  // Handle plain objects
  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(data)) {
      const subContext = context ? {
        ...context,
        path: [...context.path, key]
      } : undefined;
      
      result[key] = parseValue(value, subContext);
    }
    
    return result;
  }
  
  return data;
}

// Deep transform function with type preservation option
export function deepTransform<T extends Record<string, unknown>>(
  data: T, 
  options?: { preserveTypes?: boolean }
): {
  parsed: T;
  metadata: ParseMetadata;
} {
  const context: ParseContext = {
    path: [],
    unknownTypes: new Set(),
    errors: [],
    preserveTypes: options?.preserveTypes
  };

  const parsed: Record<string, unknown> = { ...data };

  for (const key of Object.keys(parsed)) {
    context.path = [key];
    parsed[key] = parseValue(parsed[key], context);
  }

  return {
    parsed: parsed as T,
    metadata: {
      unknownTypes: Array.from(context.unknownTypes),
      errors: context.errors.map(e => ({
        path: e.path,
        message: e.error.message
      }))
    }
  };
}

// Helper to get map types - updated to handle new structure
export function getMapTypes(data: any): [string, string] | null {
  if (data && typeof data === 'object') {
    // Check for preserved type structure
    if (data.type === 'map' && data.mapTypes) {
      return data.mapTypes;
    }
    // Check for legacy structure
    const mapTypes = (data as any)._mapTypes;
    if (Array.isArray(mapTypes) && mapTypes.length === 2) {
      return mapTypes as [string, string];
    }
  }
  return null;
}

// Helper to check if data is a map - updated
export function isMap(data: any): boolean {
  return (data?.type === 'map' && data.value) || !!getMapTypes(data);
}

// Create a transformer function with options
export function createTransformer<T extends Record<string, any>>(options?: { preserveTypes?: boolean }) {
  return (response: T): T & { _metadata?: ParseMetadata } => {
    const { parsed, metadata } = deepTransform(response, options);
    
    // Add metadata if there's anything to report
    if (metadata.unknownTypes.length > 0 || metadata.errors.length > 0) {
      (parsed as any)._metadata = metadata;
    }
    
    return parsed;
  };
}