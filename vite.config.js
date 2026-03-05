import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Deploy this admin app under https://<your-domain>/admin/
  base: '/admin/',
  plugins: [react()],
})
