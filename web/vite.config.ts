import { defineConfig } from 'vite';

// En desarrollo, /api se reenvía a functions/. En producción functions/ sirve también web/dist.
export default defineConfig({
  server: { port: 5173, proxy: { '/api': process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:8000' } },
  build: { target: 'es2022' },
});
