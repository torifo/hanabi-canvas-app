import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5731, strictPort: true },
  preview: { port: 5731, strictPort: true },
  // dist/ is also opened from file-like hosts (Electron / Wallpaper Engine).
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/**/*', 'assets/**/*', 'audio/**/*', 'data/**/*'],
      manifest: {
        id: './',
        name: '花火と心模様',
        short_name: 'Hanabi Canvas',
        description: '光と音に心をほどく、静かな花火のキャンバス',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#07111f',
        theme_color: '#07111f',
        categories: ['entertainment', 'lifestyle'],
        icons: [
          {
            src: 'icons/hanabi-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/hanabi-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/hanabi-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'icons/hanabi.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'icons/hanabi-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,svg,png,jpg,jpeg,webp,avif,mp3,ogg,wav,json}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'audio',
            handler: 'CacheFirst',
            options: {
              cacheName: 'hanabi-audio',
              expiration: {
                maxEntries: 16,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true
      }
    })
  ]
});
