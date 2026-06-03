import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_HOST = process.env.API_HOST || 'localhost';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/profile':  { target: `http://${API_HOST}:8000`, changeOrigin: true },
      '/health':   { target: `http://${API_HOST}:8000`, changeOrigin: true },
      '/ws':       { target: `ws://${API_HOST}:8000`,  ws: true, changeOrigin: true },
    },
  },
});
