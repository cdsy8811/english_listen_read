import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/admin/app.js'],
            refresh: true,
        }),
        vue({
            template: {
                transformAssetUrls: {
                    base: null,
                    includeAbsolute: false,
                },
            },
        }),
    ],
    resolve: {
        alias: {
            '@admin': path.resolve(__dirname, 'resources/js/admin'),
        },
    },
    server: {
        host: '127.0.0.1',
        cors: true,
    },
    build: {
        sourcemap: false,
        chunkSizeWarningLimit: 1500,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return;
                    if (id.includes('element-plus') || id.includes('@element-plus')) return 'vendor-element';
                    if (id.includes('echarts') || id.includes('zrender')) return 'vendor-echarts';
                    if (id.includes('vue') || id.includes('pinia')) return 'vendor-vue';
                    return 'vendor';
                },
            },
        },
    },
});
