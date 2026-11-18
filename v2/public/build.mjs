// Builds `@markup-carve/carve/v2` and `/v2/node`: one ES module each, and their declarations.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'

const shared = { bundle: true, format: 'esm', target: 'es2022', legalComments: 'none', external: ['parse5'] }

await build({ ...shared, entryPoints: ['v2/public/index.ts'], outfile: 'dist/v2/index.js', platform: 'neutral' })
await build({ ...shared, entryPoints: ['v2/public/node.ts'], outfile: 'dist/v2/node.js', platform: 'node' })

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'v2/public/tsconfig.build.json'], { stdio: 'inherit' })

// The declarations keep the `.ts` specifiers of the source; a consumer resolves `.js` under every module setting.
for (const entry of readdirSync('dist/v2/types', { recursive: true, encoding: 'utf8' })) {
  if (!entry.endsWith('.d.ts')) continue
  const path = join('dist/v2/types', entry)
  const text = readFileSync(path, 'utf8')
  const rewritten = text.replace(/(from\s+|import\()(['"])(\.{1,2}\/[^'"]*?)\.ts\2/gu, '$1$2$3.js$2')
  if (rewritten !== text) writeFileSync(path, rewritten)
}
