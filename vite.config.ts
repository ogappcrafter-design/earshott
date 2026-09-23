import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

/** Tester build swaps the on-device Whisper queue for a lightweight stub (keeps the page under 1 MB). */
const testerQueue = (): Plugin => ({
  name: 'earshot-tester-queue',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer && /transcribe[\\/]queue$/.test(source) && !importer.includes('queue.tester')) {
      return path.resolve(__dirname, 'src/transcribe/queue.tester.ts');
    }
    return null;
  },
});

export default defineConfig(({ mode }) => {
  const tester = mode === 'tester';
  return {
    plugins: tester ? [react(), testerQueue(), viteSingleFile()] : [react()],
    base: './',
    define: tester ? { 'import.meta.env.VITE_TESTER': JSON.stringify('1') } : {},
    worker: { format: 'es' },
    build: tester
      ? { target: 'es2022', outDir: 'dist-tester', assetsInlineLimit: 100_000_000, cssCodeSplit: false }
      : { target: 'es2022', sourcemap: 'hidden', chunkSizeWarningLimit: 2000 },
    optimizeDeps: { exclude: ['@huggingface/transformers'] },
    test: { environment: 'node' },
  } as any;
});
