import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// Read package.json to get version
const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'))

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  server: {
    host: '0.0.0.0',
    // Allow the dev port and API proxy target to be overridden via env
    // (e.g. Conductor parallel workspaces); defaults preserve local behavior.
    port: Number(process.env.CLIENT_PORT) || 5173,
    proxy: {
      '/api': {
        target: process.env.SERVER_URL || 'http://localhost:3001',
        changeOrigin: true,
        credentials: true
      },
      '/auth': {
        target: process.env.SERVER_URL || 'http://localhost:3001',
        changeOrigin: true,
        credentials: true
      }
    }
  }
})