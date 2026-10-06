import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Pure logic shared with the Edge Functions lives under supabase/functions/_shared/core
export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  resolve: {
    alias: { '@core': fileURLToPath(new URL('./supabase/functions/_shared/core', import.meta.url)) },
  },
})
