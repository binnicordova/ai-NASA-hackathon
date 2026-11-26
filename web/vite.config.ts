import { defineConfig } from 'vite';

// En desarrollo, /api se reenvía a functions/. En producción functions/ sirve también web/dist.
// Dos páginas: la app (index.html) y la ficha imprimible del distrito (sheet.html, que functions/ sirve en /d/<ubigeo>).
export default defineConfig({
  server: { port: 5173, proxy: { '/api': process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:8000' } },
  build: { target: 'es2022', rollupOptions: { input: { main: 'index.html', sheet: 'sheet.html' } } },
});
