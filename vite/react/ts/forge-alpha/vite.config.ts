import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import netlify from "@netlify/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    netlify(),
  ],
  resolve: {
    alias: {
    '@': resolve(__dirname, 'src'),
    '@xelis/sdk': resolve(__dirname, 'node_modules/@xelis/sdk/dist/esm')
    }
  }
})
