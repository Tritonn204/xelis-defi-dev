import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  target: 'node20',
  format: ['esm'],
  splitting: false,
  clean: true,
  outDir: 'dist',

  // Bundle these so ESM/CJS interop is normalized (fixes `to(...)` etc.)
  noExternal: [
    '@forge-backend/shared',
    '@xelis/sdk',
    'await-to-js'
  ],
  
  // But DO NOT bundle the WS layers; let Node load them (avoids dynamic require in ESM)
  external: [
    'isomorphic-ws', 
    'ws'
  ],
});
