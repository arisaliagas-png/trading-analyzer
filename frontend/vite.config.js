import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend is served by the backend (Express) from /frontend/dist in production.
// In dev you can run `npm run dev` (port 5173) with the backend on 5000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/ws': 'http://localhost:5000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
