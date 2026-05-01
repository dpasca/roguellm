import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/static/game2/',
  build: {
    outDir: '../static/game2',
    emptyOutDir: true,
    manifest: true
  },
  server: {
    strictPort: true
  }
}));
