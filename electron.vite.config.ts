import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import pkg from './package.json'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // Trois preloads : celui de la fenêtre principale, celui de l'overlay CS2 (ses envois cs2:* seulement) et celui de la
    // fenêtre cachée de capture des clips.
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts'), overlay: resolve('src/preload/overlay.ts'), clipsRecorder: resolve('src/preload/clipsRecorder.ts') }
      }
    }
  },
  renderer: {
    // Page de l'overlay CS2 (index.html, JS sans framework) ; public/ apporte la V3 et la page de capture des clips.
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // electron-vite ne compresse pas l'interface par défaut.
    build: { minify: true }
  }
})
