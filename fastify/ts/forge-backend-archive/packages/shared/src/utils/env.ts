// utils/env.ts
import fs from 'node:fs';

export function fromEnvOrFile(key: string): string | undefined {
  const envVal = process.env[key];
  if (envVal && envVal.length > 0) {
    return envVal;
  }

  const filePath = process.env[`${key}_FILE`];
  if (!filePath || filePath.length === 0) {
    console.warn(`[env] ${key}_FILE not set`);
    return undefined;
  }

  if (!fs.existsSync(filePath)) {
    console.warn(`[env] ${key}_FILE points to missing path: ${filePath}`);
    return undefined;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const val = raw.replace(/\r?\n/g, '').trim(); // strip CR/LF
    if (!val) {
      console.warn(`[env] ${key}_FILE is empty: ${filePath}`);
      return undefined;
    }
    return val;
  } catch (e: any) {
    console.warn(`[env] failed to read ${filePath}:`, e?.message ?? e);
    return undefined;
  }
}
