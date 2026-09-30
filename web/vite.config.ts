import path from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { stravaApiPlugin } from './server/stravaApiPlugin.ts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/** GitHub Pages with custom domain (CNAME): https://quangtrirunners.online/ */
const PAGES_BASE = '/'

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
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        // Giữ public/manifest.webmanifest (display: browser) để OAuth Strava vẫn chạy trong Safari
        manifest: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,ico,webmanifest}'],
          globIgnores: ['404.html', 'strava/**'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'google-fonts-css' },
            },
            {
              urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
      // Strava proxy only for local `vite` / `vite preview` — not available on static Pages.
      ...(command === 'serve' ? [stravaApiPlugin(() => loadEnv(mode, rootDir, ''))] : []),
    ],
    server: {
      port: 5173,
      strictPort: true,
    },
  }
})
