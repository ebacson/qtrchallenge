import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { stravaApiPlugin } from './server/stravaApiPlugin.ts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/** GitHub Pages project site: https://ebacson.github.io/qtrchallenge/web/ */
const PAGES_BASE = '/qtrchallenge/web/'

export default defineConfig(({ mode, command }) => {
  const isProdBuild = command === 'build'
  return {
    root: rootDir,
    envDir: rootDir,
    base: isProdBuild ? PAGES_BASE : '/',
    plugins: [
      react(),
      // Strava proxy only for local `vite` / `vite preview` — not available on static Pages.
      ...(command === 'serve' ? [stravaApiPlugin(() => loadEnv(mode, rootDir, ''))] : []),
    ],
    server: {
      port: 5173,
      strictPort: true,
    },
  }
})
