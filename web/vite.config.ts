import path from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { stravaApiPlugin } from './server/stravaApiPlugin.ts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/** GitHub Pages project site: https://ebacson.github.io/qtrchallenge/ */
const PAGES_BASE = '/qtrchallenge/'

/** Emit real HTML files for OAuth deep links (GH Pages has no SPA rewrite). */
function spaDeepLinkPages(): Plugin {
  return {
    name: 'spa-deep-link-pages',
    closeBundle() {
      const dist = path.join(rootDir, 'dist')
      const indexHtml = path.join(dist, 'index.html')
      const targets = ['strava/callback']
      for (const route of targets) {
        const dir = path.join(dist, route)
        mkdirSync(dir, { recursive: true })
        copyFileSync(indexHtml, path.join(dir, 'index.html'))
      }
      copyFileSync(indexHtml, path.join(dist, '404.html'))
    },
  }
}

export default defineConfig(({ mode, command }) => {
  const isProdBuild = command === 'build'
  return {
    root: rootDir,
    envDir: rootDir,
    base: isProdBuild ? PAGES_BASE : '/',
    plugins: [
      react(),
      ...(isProdBuild ? [spaDeepLinkPages()] : []),
      // Strava proxy only for local `vite` / `vite preview` — not available on static Pages.
      ...(command === 'serve' ? [stravaApiPlugin(() => loadEnv(mode, rootDir, ''))] : []),
    ],
    server: {
      port: 5173,
      strictPort: true,
    },
  }
})
