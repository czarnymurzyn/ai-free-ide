import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    // node-pty is a native module: it must stay external and be loaded from
    // node_modules at runtime rather than bundled into the main chunk.
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared, '@main': resolve('src/main') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },

  renderer: {
    // Relative base so the built renderer resolves its assets over file://.
    // An absolute base silently breaks every asset request once packaged.
    base: './',
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: { '@shared': shared, '@renderer': resolve('src/renderer') }
    },
    // Monaco's language services run in web workers, bundled locally.
    // Nothing is ever fetched from a CDN.
    worker: {
      format: 'es'
    },
    build: {
      target: 'esnext',
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
