import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { devFsPlugin } from './dev/fs-middleware.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), devFsPlugin()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Cargo holds its build output open, and Vite's watcher reports EBUSY on every
      // rebuild. Nothing in there is a frontend source anyway.
      ignored: ['**/src-tauri/**'],
    },
  },
});
