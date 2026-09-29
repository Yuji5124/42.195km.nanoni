import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 3 つのゲームを 1 つのリポジトリでビルドする
//   index.html      … 42.195km、なのに。 / 1500m、なのに。
//   800m/index.html … 800m、なのに。（新作・独立したコード: 800m/src）
//   trampoline/index.html … トランポリン、なのに。（trampoline/src。会場・観客・侍・音・エフェクトは src の部品を使う）
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
      },
    },
  },
});
