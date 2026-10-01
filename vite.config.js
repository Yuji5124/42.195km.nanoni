import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 複数のゲームを 1 つのリポジトリでビルドする
//   index.html      … 42.195km、なのに。 / 1500m、なのに。
//   800m/index.html … 800m、なのに。
//   trampoline/index.html … トランポリン、なのに。
//   soccer/index.html … サッカー、なのに。
//   boxing/index.html … ボクシング、なのに。
//   nanoni-generator/index.html … 「なのに。」発想ジェネレーター
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        m800: resolve(import.meta.dirname, '800m/index.html'),
        tramp: resolve(import.meta.dirname, 'trampoline/index.html'),
        soccer: resolve(import.meta.dirname, 'soccer/index.html'),
        boxing: resolve(import.meta.dirname, 'boxing/index.html'),
        nanoniGenerator: resolve(import.meta.dirname, 'nanoni-generator/index.html'),
      },
    },
  },
});
