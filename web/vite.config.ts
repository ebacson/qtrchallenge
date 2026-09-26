import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { stravaApiPlugin } from './server/stravaApiPlugin.ts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  // Always load from web/ (config dir), not process.cwd() — avoids missing
  // .env.local when `vite` is started from the monorepo root.
  return {
    root: rootDir,
    envDir: rootDir,
    plugins: [react(), stravaApiPlugin(() => loadEnv(mode, rootDir, ''))],
    server: {
      port: 5173,
      strictPort: true,
    },
  }
})
