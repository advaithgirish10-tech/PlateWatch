import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app wires itself to the page once (initApp in src/app/platewatch.js). Swapping new code into an open page
// would leave the old copy running beside it (after logging in, it sent people back to the login page), so script
// and markup changes reload the whole page. Stylesheet changes still update in place.
const fullReloadOnCodeChange = {
  name: 'platewatch-full-reload',
  handleHotUpdate({ file, server }) {
    if (/\/src\/.*\.(jsx?|html)$/.test(file)) {
      server.ws.send({ type: 'full-reload' });
      return [];
    }
  },
};

export default defineConfig({
  plugins: [react(), fullReloadOnCodeChange],
  server: {
    port: 5173,
    open: true,
    // the backend (server/, `npm run dev` there) answers /api on the same origin, as in production
    proxy: { '/api': 'http://localhost:3000' },
  },
  preview: { proxy: { '/api': 'http://localhost:3000' } },
});
