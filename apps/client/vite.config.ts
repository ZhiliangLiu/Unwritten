import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { appearanceAttributes, DEFAULT_APPEARANCE } from '@unwritten/contracts';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const CORE_DEV_ORIGIN = 'http://127.0.0.1:4317';
const BOOT_SCRIPT_PATH = fileURLToPath(new URL('./src/theme/boot.inline.js', import.meta.url));
const ROUTES_DIR = new URL('./src/routes', import.meta.url);

function bootScriptPlugin(): Plugin {
  return {
    name: 'unwritten-boot-script',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.server) return html;
        const script = readFileSync(BOOT_SCRIPT_PATH, 'utf8');
        return html
          .replace('<html lang="zh-CN">', `<html lang="zh-CN" ${appearanceAttributes(DEFAULT_APPEARANCE)}>`)
          .replace('<head>', `<head><script>${script}</script>`);
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'boot.inline.js', source: readFileSync(BOOT_SCRIPT_PATH, 'utf8') });
    },
  };
}

export default defineConfig({
  plugins: [
    ...(existsSync(ROUTES_DIR) ? [tanstackRouter({ target: 'react', autoCodeSplitting: true })] : []),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    bootScriptPlugin(),
  ],
  css: { transformer: 'lightningcss', lightningcss: { drafts: { customMedia: true } } },
  build: { outDir: 'dist', emptyOutDir: true, cssMinify: 'lightningcss', modulePreload: { polyfill: false } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: CORE_DEV_ORIGIN,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest) => {
            proxyRequest.setHeader('origin', CORE_DEV_ORIGIN);
          });
        },
      },
    },
  },
});
