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
            includeAssets: ['logo.png'],
            manifest: {
                name: 'SarasTech — Teacher Assistant',
                short_name: 'SarasTech',
                description: 'AI coaching assistant for teachers',
                start_url: '.',
                display: 'standalone',
                background_color: '#ffffff',
                theme_color: '#FF6B35',
                icons: [
                    { src: 'logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
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
