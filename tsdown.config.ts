/**
 * Standalone build for dsh-session-ref:
 * - Host half   → lib/index.js (ESM, loaded by the host Loader).
 * - Browser half → lib/client.js (CJS closure factory registered through
 *   window.__ModuleLoader__.load; externals resolved from the loader module
 *   table the web shell seeds).
 *
 * The host half imports @deepseek-ai/dsh-session-reference (parse helpers) and
 * @deepseek-ai/dsh-llm (types) — dependencies are resolved from the plugin's
 * own node_modules at runtime by the host Loader. The browser half keeps every
 * @deepseek-ai import type-only (erased) so the client purity gate passes;
 * only react / react/jsx-runtime are value imports, resolved from the platform
 * seed list.
 */

import { defineConfig } from 'tsdown'

const ID = 'dsh-session-ref'

/** Loader module-table entries the shell shares (mirrors the harness platform seed list). */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Externals resolved from the loader module table: platform seed + the runtime store exemption. */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

export default defineConfig([
  {
    // Host half: ESM lib/index.js consumed by the host Loader.
    name: ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    outputOptions: {
      entryFileNames: 'index.js',
    },
  },
  {
    // Browser half: CJS closure factory registered via window.__ModuleLoader__.load.
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: (id: string) => (CLIENT_EXTERNALS.includes(id) ? null : true),
    },
    plugins: [{
      name: 'dsh-session-ref-client-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        throw new Error(`client bundle purity: "${source}" is not a loader module-table entry — cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)`)
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
