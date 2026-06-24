// Static render mode demo: one Carve document, rendered twice.
//
//   node examples/static-mode-demo.mjs
//
// Run `npm run build` first (this imports the compiled output in dist/).
// Writes two files next to this script and prints both to stdout, so you can
// see the same source yield a live INTERACTIVE page (clickable tabs, a
// client-script mermaid <pre>, KaTeX-ready math) versus a flattened,
// self-contained STATIC page (labeled sections, a build-rendered SVG, math
// rendered server-side) - the artifact behind the graceful-degradation rules.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  carveToHtml,
  chart,
  codeGroup,
  details,
  mathBlock,
  mermaid,
  spoiler,
  tabs,
} from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

const source = `# Install Carve

:::: tabs
::: tab [npm]
\`\`\` sh
npm i @markup-carve/carve
\`\`\`
:::
::: tab [pnpm]
\`\`\` sh
pnpm add @markup-carve/carve
\`\`\`
:::
::::

::: details "Why two package managers?"
Pick whichever your project already uses.
:::

The ending: :spoiler[the converter is just a function].

A flow diagram:

\`\`\` mermaid
graph TD; Source --> Parse --> Render
\`\`\`

And the identity it preserves:

$$\`\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}\`
`

const extensions = [tabs(), codeGroup(), details(), spoiler(), mermaid(), chart(), mathBlock()]

// Interactive: the default online form.
const interactive = carveToHtml(source, { extensions, mode: 'interactive' })

// Static: self-contained, no client scripts. We supply build-time renderers
// for the client-script constructs (mermaid + math); a real pipeline would
// call mermaid-cli / KaTeX here. Anything without a renderer degrades to
// source rather than going blank.
const stubSvg = (src) => `<svg role="img" aria-label="mermaid diagram"><!-- ${src.length} chars of source pre-rendered --></svg>`
const stubMath = (tex, display) =>
  `<math display="${display ? 'block' : 'inline'}"><mtext>${tex}</mtext></math>`

const staticHtml = carveToHtml(source, {
  extensions,
  mode: 'static',
  renderers: { mermaid: stubSvg, math: stubMath },
})

const interactivePath = join(here, 'static-mode-demo.interactive.html')
const staticPath = join(here, 'static-mode-demo.static.html')
writeFileSync(interactivePath, interactive + '\n')
writeFileSync(staticPath, staticHtml + '\n')

console.log('=== INTERACTIVE (mode: "interactive") ===\n')
console.log(interactive)
console.log('\n\n=== STATIC (mode: "static", with mermaid + math renderers) ===\n')
console.log(staticHtml)
console.log(`\n\nWrote:\n  ${interactivePath}\n  ${staticPath}`)
