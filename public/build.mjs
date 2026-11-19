// Builds `@markup-carve/carve`, `@markup-carve/carve/node`, `@markup-carve/carve/extensions`, `@markup-carve/carve/import`
// and `@markup-carve/carve/export`: one ES module each, and their declarations. The import entry keeps its Markdown
// and Djot libraries external, as package dependencies.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'

const shared = { bundle: true, format: 'esm', target: 'es2022', legalComments: 'none', external: ['parse5'] }

await build({ ...shared, entryPoints: ['public/index.ts'], outfile: 'dist/index.js', platform: 'neutral' })
await build({ ...shared, entryPoints: ['public/node.ts'], outfile: 'dist/node.js', platform: 'node' })
await build({ ...shared, entryPoints: ['public/extensions.ts'], outfile: 'dist/extensions.js', platform: 'neutral' })
await build({ ...shared, entryPoints: ['public/formats.ts'], outfile: 'dist/import.js', platform: 'neutral',
  external: ['parse5', 'micromark', 'micromark-extension-*', '@djot/djot'] })
await build({ ...shared, entryPoints: ['public/export.ts'], outfile: 'dist/export.js', platform: 'neutral' })

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'public/tsconfig.build.json'], { stdio: 'inherit' })

// The declarations keep the `.ts` specifiers of the source; a consumer resolves `.js` under every module setting.
for (const entry of readdirSync('dist/types', { recursive: true, encoding: 'utf8' })) {
  if (!entry.endsWith('.d.ts')) continue
  const path = join('dist/types', entry)
  const text = readFileSync(path, 'utf8')
  const rewritten = text.replace(/(from\s+|import\()(['"])(\.{1,2}\/[^'"]*?)\.ts\2/gu, '$1$2$3.js$2')
  if (rewritten !== text) writeFileSync(path, rewritten)
}
