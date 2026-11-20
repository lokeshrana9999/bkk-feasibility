import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          map: ['maplibre-gl'],
          deck: ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/mapbox'],
        },
      },
    },
  },
});
