import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    root: __dirname,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      rollupOptions: {
        // 阿里云 Podman 构建环境的默认 nofile 较低；限制并发文件操作，
        // 避免包含大量图标模块时触发 EMFILE。
        maxParallelFileOps: 64,
        input: {
          app: path.resolve(__dirname, 'index.html'),
          'liquid-spectrum': path.resolve(__dirname, 'liquid-spectrum.html'),
          'water-ripple': path.resolve(__dirname, 'water-ripple.html'),
          'letter-universe': path.resolve(__dirname, 'letter-universe.html'),
          'letter-universe-v1': path.resolve(__dirname, 'letter-universe-v1.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      allowedHosts: ['.monkeycode-ai.online'],
    },
  };
});
