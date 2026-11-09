/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

/**
 * vite-plugin-vuetify rewrites components to deep imports (`vuetify/components/VBtn`, ...) while
 * transforming .vue files, i.e. after Vite's dependency scan. On a cold cache they are therefore
 * discovered at runtime, the optimizer re-bundles and the page fails with "504 Outdated Optimize Dep".
 * Pre-bundle exactly the component/directive groups the sources use.
 */
function vuetifyDeepImports(): string[] {
  const root = join(dirname(createRequire(import.meta.url).resolve('vuetify/package.json')), 'lib')
  const srcDir = fileURLToPath(new URL('./src', import.meta.url))
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === '__tests__' ? [] : walk(join(d, e.name))) : e.name.endsWith('.vue') ? [join(d, e.name)] : [],
    )
  const text = walk(srcDir).map((f) => readFileSync(f, 'utf-8')).join('\n')
  const kebab = (n: string) => n.replace(/([A-Za-z0-9])([A-Z][a-z])/g, '$1-$2').toLowerCase()
  // VContainer/VRow/VCol/VSpacer all live in the VGrid group.
  const include = ['vuetify/components/transitions', 'vuetify/components/VGrid']
  const compDir = join(root, 'components')
  if (existsSync(compDir)) {
    for (const e of readdirSync(compDir, { withFileTypes: true })) {
      if (e.isDirectory() && (text.includes('<' + e.name) || text.includes('<' + kebab(e.name)))) include.push('vuetify/components/' + e.name)
    }
  }
  for (const d of ['ripple', 'click-outside', 'intersect', 'resize', 'scroll', 'touch', 'tooltip']) {
    if (text.includes('v-' + d)) include.push('vuetify/directives/' + d)
  }
  return include
}

// Tauri expects a fixed dev server port (see src-tauri/tauri.conf.json -> build.devUrl).
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  // Keep Rust/Tauri errors visible in the terminal.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      // Do not rebuild the frontend when Rust sources change.
      ignored: ['**/src-tauri/**'],
    },
  },
  optimizeDeps: { include: vuetifyDeepImports() },
  build: {
    target: ['es2022', 'chrome110', 'safari16'],
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    minify: process.env.TAURI_ENV_DEBUG ? false : undefined,
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
