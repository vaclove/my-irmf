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
    // Fixed dev port: always 5173, never fall back to 5174+. If 5173 is taken,
    // Vite errors out instead of silently picking another port.
    port: 5173,
    strictPort: true,
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