import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Game2 does not use Phaser physics; keep the runtime surface but avoid bundling Arcade/Matter.
const phaserNoPhysics = fileURLToPath(new URL('./node_modules/phaser/src/phaser-no-physics.js', import.meta.url));
const phaserSpectorStub = fileURLToPath(new URL('./src/vendor/phaserSpectorStub.ts', import.meta.url));

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/static/game2/',
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: {
      phaser: phaserNoPhysics,
      phaser3spectorjs: phaserSpectorStub
    }
  },
  build: {
    outDir: '../static/game2',
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'phaser-no-physics',
              test: /node_modules[\\/]phaser[\\/]/,
              priority: 2
            }
          ]
        }
      }
    }
  },
  server: {
    strictPort: true
  }
}));
