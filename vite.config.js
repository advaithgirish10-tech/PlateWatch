import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // the backend (server/, `npm run dev` there) answers /api on the same origin, as in production
    proxy: { '/api': 'http://localhost:3000' },
  },
  preview: { proxy: { '/api': 'http://localhost:3000' } },
});
