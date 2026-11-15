import { build } from 'esbuild'

await build({
  entryPoints: ['v2/cli/main.ts'],
  outfile: 'dist/cli2.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
})
