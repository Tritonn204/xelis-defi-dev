import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import netlify from "@netlify/vite-plugin";
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    netlify(),
    visualizer({ 
      open: true,
      gzipSize: true,
      filename: 'dist/stats.html'
    })
  ],
  resolve: {
    alias: {
    '@': resolve(__dirname, 'src'),
    '@xelis/sdk': resolve(__dirname, 'node_modules/@xelis/sdk/dist/esm')
    }
  }
})
