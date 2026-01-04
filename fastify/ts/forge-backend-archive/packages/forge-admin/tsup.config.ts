import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server/index.ts'],
  platform: 'node',
  target: 'node20',
  format: ['esm'],
  splitting: false,
  clean: true,
  outDir: 'dist/server',
  sourcemap: true
});