import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // 忽略运行时数据目录：/api/market-overview 每次请求都会写
        // work/.runtime/market-temperature-history.json，若被监视会触发无限 page reload。
        ignored: ['**/work/**', '**/.runtime/**', '**/node_modules/**'],
      },
      allowedHosts: ['.monkeycode-ai.online'],
    },
  };
});
