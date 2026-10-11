import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'app/out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'app/src/main/index.ts'),
          parser: resolve(__dirname, 'app/src/main/ingest/parser-process.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'app/out/preload', rollupOptions: { input: { index: resolve(__dirname, 'app/src/preload/index.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'app/src/renderer'),
    plugins: [react()],
    build: { outDir: resolve(__dirname, 'app/out/renderer'), rollupOptions: { input: resolve(__dirname, 'app/src/renderer/index.html') } }
  }
})
