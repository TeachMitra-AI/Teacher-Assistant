import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// The API base is injected at build time via VITE_API_BASE (see .env.example).
// In dev it defaults to the local backend proxy.
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icon.svg'],
            manifest: {
                name: 'शिक्षक सहायक — Teacher Assistant',
                short_name: 'शिक्षक सहायक',
                description: 'AI coaching assistant for teachers',
                start_url: '.',
                display: 'standalone',
                background_color: '#ffffff',
                theme_color: '#FF6B35',
                icons: [
                    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
                ],
            },
            workbox: {
                // Cache the app shell; never cache API POSTs.
                navigateFallback: 'index.html',
                runtimeCaching: [
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.pathname.startsWith('/api/');
                        },
                        handler: 'NetworkOnly',
                    },
                ],
            },
        }),
    ],
    server: {
        port: 5173,
    },
});
