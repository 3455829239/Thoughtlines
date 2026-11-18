import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const client = fileURLToPath(new URL('./client', import.meta.url))
const modules = fileURLToPath(new URL('./node_modules', import.meta.url))

export default defineConfig({
  root: client,
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    fs: { strict: true, allow: [client, modules], deny: ['.env', '.env.*', '**/.git/**', '**/*.json', '**/*.pem', '**/*.crt'] },
  },
})
