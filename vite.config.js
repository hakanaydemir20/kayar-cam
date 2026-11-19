import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { localCodexAnalysis } from './local/codexAnalysis.js';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), localCodexAnalysis()],
  build: {
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
    target: 'es2020',
  },
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 60000,
  },
});
