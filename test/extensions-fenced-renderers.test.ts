import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeTree } from '../public/index.ts'
import { encodeTree, parse, render, renderWithDiagnostics, renderWithDocumentTransforms, write } from '../src/index.ts'
import {
  abc, chart, codeCallouts, codeGroup, d2, type ExtensionBundle, fencedRender, graphviz, mathBlock, mermaid, plantuml, presets,
  vegaLite, wavedrom, withExtensions,
} from '../public/extensions.ts'

const html = (source: string, bundle: ExtensionBundle, mode?: 'static'): string =>
  render(source, { extensions: bundle.extensions, renderers: bundle.renderers, ...(mode === undefined ? {} : { mode }) })

const codes = (source: string, bundle: ExtensionBundle, mode?: 'static'): string[] =>
  renderWithDiagnostics(source, { extensions: bundle.extensions, renderers: bundle.renderers,
    ...(mode === undefined ? {} : { mode }) }).diagnostics.map((entry) => entry.code)

describe('fencedRender', () => {
  it('text mode escapes & and < but keeps > (arrow syntax)', () => {
    expect(html('```d2\na -> b & <c\n```', d2())).toBe('<pre class="d2" role="img" aria-label="d2">a -> b &amp; &lt;c</pre>')
  })

  it('graphviz claims both dot and graphviz', () => {
    expect(html('```dot\na -> b\n```', graphviz())).toBe('<pre class="graphviz" role="img" aria-label="graphviz">a -> b</pre>')
    expect(html('```graphviz\na -> b\n```', graphviz())).toBe('<pre class="graphviz" role="img" aria-label="graphviz">a -> b</pre>')
  })

  it('json mode wraps the body in a script inside a div and guards </', () => {
    expect(html('```vega-lite\n{"mark": "bar"}\n```', vegaLite())).toBe(
      '<div class="vega-lite" role="img" aria-label="vega-lite"><script type="application/json">{"mark": "bar"}</script></div>')
    const guarded = html('```chart\n{"x": "</script>"}\n```', chart())
    expect(guarded).toBe('<div class="chart" role="img" aria-label="chart"><script type="application/json">{"x": "<\\/script>"}</script></div>')
    expect(guarded.match(/<\/script>/g)).toHaveLength(1)
  })

  it('json mode guards <!-- so a <script inside the body cannot keep the element open (#5105)', () => {
    const guarded = html('```chart\n{"x": "<!--<script>", "y": "<!-- --></script>"}\n```', chart())
    expect(guarded).toBe('<div class="chart" role="img" aria-label="chart"><script type="application/json">'
      + '{"x": "<\\u0021--<script>", "y": "<\\u0021-- --><\\/script>"}</script></div>')
    expect(guarded).not.toContain('<!--')
    const body = /<script type="application\/json">(.*)<\/script>/.exec(guarded)?.[1] ?? ''
    expect(JSON.parse(body)).toEqual({ x: '<!--<script>', y: '<!-- --></script>' })
  })

  it('leaves an unclaimed language to the core renderer', () => {
    expect(html('```python\nprint(1)\n```', d2())).toBe(render('```python\nprint(1)\n```'))
  })

  it('puts the css class ahead of the author classes and keeps the attributes (C2-H-010)', () => {
    expect(html('{#c1 .tall data-theme=dark}\n```d2\na -> b\n```', d2())).toBe(
      '<pre id="c1" class="d2 tall" data-theme="dark" role="img" aria-label="d2">a -> b</pre>')
  })

  it('drops an event-handler attribute like every element (C2-H-014)', () => {
    expect(html('{#c1 onclick="alert(1)"}\n```d2\na\n```', d2())).not.toContain('onclick')
  })

  it('keeps an authored name and role and never writes a role without a name', () => {
    expect(html('{aria-label="Deploy flow"}\n```d2\na\n```', d2())).toBe(
      '<pre class="d2" aria-label="Deploy flow" role="img">a</pre>')
    expect(html('{role=figure}\n```d2\na\n```', d2())).toBe('<pre class="d2" role="figure" aria-label="d2">a</pre>')
    expect(html('```d2\na\n```', fencedRender({ language: 'd2', label: '' }))).toBe('<pre class="d2">a</pre>')
  })

  it('wraps in a figure and honors a custom tag and class', () => {
    expect(html('```d2\na\n```', fencedRender({ language: 'd2', wrapInFigure: true }))).toBe(
      '<figure class="d2-figure"><pre class="d2" role="img" aria-label="d2">a</pre></figure>')
    expect(html('```d2\na\n```', fencedRender({ language: 'd2', cssClass: 'diagram', tag: 'div' }))).toBe(
      '<div class="diagram" role="img" aria-label="diagram">a</div>')
  })

  it('abc, wavedrom and plantuml are text-mode presets; plantuml claims puml', () => {
    expect(html('```abc\nCDEF\n```', abc())).toBe('<pre class="abc" role="img" aria-label="abc">CDEF</pre>')
    expect(html('```wavedrom\n{}\n```', wavedrom())).toBe('<pre class="wavedrom" role="img" aria-label="wavedrom">{}</pre>')
    expect(html('```puml\nA <|-- B\nC --> D\n```', plantuml())).toBe(
      '<pre class="plantuml" role="img" aria-label="plantuml">A &lt;|-- B\nC --> D</pre>')
  })

  it('mermaid is byte-identical to the factory it is a preset of', () => {
    const source = '```mermaid\ngraph TD; A-->B\n```'
    expect(html(source, mermaid())).toBe(html(source, fencedRender({ language: 'mermaid' })))
  })

  it('refuses an empty language', () => {
    expect(() => fencedRender({ language: '' })).toThrow()
    expect(() => fencedRender({ language: [] })).toThrow()
  })

  it('presets() registers every bundled fence word', () => {
    const all = presets()
    expect(all.extensions.map((entry) => entry.matcher?.name)).toEqual(
      ['mermaid', 'd2', 'dot', 'graphviz', 'wavedrom', 'abc', 'plantuml', 'puml', 'vega-lite', 'chart'])
    expect(html('```dot\ndigraph { a -> b }\n```', all)).toBe(
      '<pre class="graphviz" role="img" aria-label="graphviz">digraph { a -> b }</pre>')
  })

  it('a second claim of one fence word fails at registration (C2-X-014)', () => {
    expect(() => html('```mermaid\na\n```', withExtensions(mermaid(), fencedRender({ language: 'mermaid', cssClass: 'm' }))))
      .toThrow(/duplicate/)
  })

  it('carries the claimed code block as its fallback and the fence as its source (C2-X-022, C2-X-024)', () => {
    const tree = parse('{#c1}\n```d2\na\n```', { extensions: d2().extensions })
    expect(tree.children[0]).toMatchObject({ type: 'block_extension', name: 'carve.fencedRender.d2', version: '1',
      attrs: { id: 'c1' }, props: { language: 'd2' }, source: { form: 'fence', name: 'd2', body: 'a\n' },
      fallback: [{ type: 'code_block', value: 'a\n', syntax: 'd2' }] })
    expect(tree.extensions).toEqual([{ name: 'carve.fencedRender.d2', version: '1', required: false, slots: [] }])
    expect(decodeTree(encodeTree(tree), { extensions: d2().extensions })).toEqual(tree)
  })

  it('writes the fence back (C2-X-027)', () => {
    const source = '{#c1 .x}\n```mermaid\ngraph TD; A-->B\n```\n'
    expect(write(parse(source, { extensions: mermaid().extensions }), { extensions: mermaid().extensions })).toBe(source)
  })
})

describe('fencedRender fallback and static mode (C2-X-035, C2-X-052)', () => {
  it('without a renderer writes the code block and reports the fallback', () => {
    const only = { extensions: d2().extensions, renderers: {} }
    expect(html('```d2\na\n```', only)).toBe('<pre><code class="language-d2">a\n</code></pre>')
    expect(codes('```d2\na\n```', only)).toContain('extension-fallback-rendered')
  })

  it('without a renderer puts the attributes on a div around the fallback, once', () => {
    expect(html('{#c1 .x}\n```d2\na\n```', { extensions: d2().extensions, renderers: {} })).toBe(
      '<div id="c1" class="x">\n  <pre><code class="language-d2">a\n</code></pre>\n</div>')
  })

  it('static mode without a host build function writes the fallback', () => {
    expect(html('```mermaid\na\n```', mermaid(), 'static')).toBe('<pre><code class="language-mermaid">a\n</code></pre>')
  })

  it('static mode with a host build function writes its output in the attributed div', () => {
    const bundle = mermaid({ build: (source) => `<svg data-n="${source.length}"></svg>` })
    expect(html('{#m}\n```mermaid\nabc\n```', bundle, 'static')).toBe(
      '<div id="m" class="mermaid" role="img" aria-label="mermaid"><svg data-n="3"></svg></div>')
    expect(codes('```mermaid\nabc\n```', bundle, 'static')).not.toContain('extension-fallback-rendered')
  })

  it('presets() passes each build function to its preset only', () => {
    const bundle = presets({ chart: () => '<img alt="c">' })
    expect(html('```chart\n{}\n```', bundle, 'static')).toBe(
      '<div class="chart" role="img" aria-label="chart"><img alt="c"></div>')
    expect(html('```d2\na\n```', bundle, 'static')).toBe('<pre><code class="language-d2">a\n</code></pre>')
  })
})

describe('mathBlock', () => {
  it('renders a math fence as a display math div', () => {
    expect(html('```math\nx^2\n```', mathBlock())).toBe('<div class="math display">\\[x^2\\]</div>')
  })

  it('escapes &, < and > like core math', () => {
    expect(html('```math\na<b & c>d\n```', mathBlock())).toBe('<div class="math display">\\[a&lt;b &amp; c&gt;d\\]</div>')
  })

  it('takes another language and leaves other fences to the core', () => {
    expect(html('```tex\nx\n```', mathBlock({ language: 'tex' }))).toBe('<div class="math display">\\[x\\]</div>')
    expect(html('```js\nx\n```', mathBlock())).toBe(render('```js\nx\n```'))
  })

  it('is inert when not registered', () => {
    expect(render('```math\nx\n```')).toBe('<pre><code class="language-math">x\n</code></pre>')
  })

  it('keeps the author attributes after the math classes', () => {
    expect(html('{#e1 .big data-n=1}\n```math\nx\n```', mathBlock())).toBe(
      '<div id="e1" class="math display big" data-n="1">\\[x\\]</div>')
  })

  it('static mode uses the host build function, or the fallback without one', () => {
    const build = (tex: string, display: boolean): string => `<math display="${display ? 'block' : 'inline'}">${tex}</math>`
    expect(html('```math\nx\n```', mathBlock({ build }), 'static')).toBe(
      '<div class="math display"><math display="block">x</math></div>')
    expect(html('```math\nx\n```', mathBlock(), 'static')).toBe('<pre><code class="language-math">x\n</code></pre>')
  })
})

const FENCE = '```'
const group = '::: code-group\n```js [NPM]\nnpm i\n```\n\n```sh\nyarn add\n```\n:::\n'
const pre = (language: string, value: string): string => `<pre><code class="language-${language}">${value}\n</code></pre>`

describe('codeGroup', () => {
  it('css mode writes radios, labels and named panels, the first selected', () => {
    expect(html(group, codeGroup())).toBe('<div class="code-group" role="group" aria-label="Code examples">' +
      '<input type="radio" name="codegroup-1" id="codegroup-1-tab-1" class="code-group-radio" checked>' +
      '<label for="codegroup-1-tab-1" class="code-group-label">NPM</label>' +
      '<input type="radio" name="codegroup-1" id="codegroup-1-tab-2" class="code-group-radio">' +
      '<label for="codegroup-1-tab-2" class="code-group-label">sh</label>' +
      `<div class="code-group-panel" role="group" aria-label="NPM">${pre('js', 'npm i')}</div>` +
      `<div class="code-group-panel" role="group" aria-label="sh">${pre('sh', 'yarn add')}</div></div>`)
  })

  it('aria mode writes tab buttons bound to hidden panels', () => {
    expect(html(group, codeGroup({ mode: 'aria' }))).toBe('<div class="code-group" role="tablist" aria-label="Code examples">' +
      '<button type="button" role="tab" id="codegroup-1-tab-1" aria-selected="true" aria-controls="codegroup-1-panel-1" ' +
      'class="code-group-label">NPM</button>' +
      '<button type="button" role="tab" id="codegroup-1-tab-2" aria-selected="false" aria-controls="codegroup-1-panel-2" ' +
      'class="code-group-label" tabindex="-1">sh</button>' +
      `<div role="tabpanel" id="codegroup-1-panel-1" aria-labelledby="codegroup-1-tab-1" class="code-group-panel">${pre('js', 'npm i')}</div>` +
      '<div role="tabpanel" id="codegroup-1-panel-2" aria-labelledby="codegroup-1-tab-2" class="code-group-panel" hidden>' +
      `${pre('sh', 'yarn add')}</div></div>`)
  })

  it('refuses an unknown mode', () => {
    expect(() => codeGroup({ mode: 'js' as 'css' })).toThrow(/mode/)
  })

  it('selects the first marked block and drops the mark from its code', () => {
    const output = html('::: code-group\n```js\na\n```\n\n{selected}\n```sh\nb\n```\n:::\n', codeGroup())
    expect(output).toContain('id="codegroup-1-tab-2" class="code-group-radio" checked>')
    expect(output).not.toContain('selected')
  })

  it('labels a panel by its bracket label, title, language, then position', () => {
    const output = html('::: code-group\n```js "Script"\na\n```\n\n```\nb\n```\n:::\n', codeGroup())
    expect(output).toContain('aria-label="Script"')
    expect(output).toContain('aria-label="Code 2"')
  })

  it('keeps the author attributes and an authored name; extra classes follow the wrapper class', () => {
    expect(html(`{#g .wide aria-label="Install"}\n${group}`, codeGroup())).toMatch(
      /^<div id="g" class="code-group wide" aria-label="Install" role="group">/)
  })

  it('takes the group name from the labels option or the factory option', () => {
    expect(render(group, { ...codeGroup(), labels: { codeGroup: 'Beispiele' } })).toContain('aria-label="Beispiele"')
    expect(html(group, codeGroup({ groupLabel: 'Shells' }))).toContain('aria-label="Shells"')
  })

  it('numbers groups in document order and avoids authored ids', () => {
    const output = html(`[x]{#codegroup-1}\n\n${group}\n${group}`, codeGroup())
    expect(output).toContain('name="codegroup-2"')
    expect(output).toContain('name="codegroup-3"')
  })

  it('uses the highlighter for the panel code', () => {
    const highlighter = (code: string, language: string | undefined): string => `<x-${language ?? 'none'}>${code}</x-${language ?? 'none'}>`
    expect(html(group, codeGroup({ highlighter }))).toContain('<x-js>npm i</x-js>')
  })

  it('leaves a div with other blocks or no code a core div', () => {
    const mixed = '::: code-group\nText.\n\n```js\na\n```\n:::\n'
    expect(html(mixed, codeGroup())).toBe(render(mixed))
    expect(html('::: code-group\nText.\n:::\n', codeGroup())).toBe(render('::: code-group\nText.\n:::\n'))
  })

  it('static mode writes one headed section per panel and no controls', () => {
    expect(html(group, codeGroup(), 'static')).toBe('<div class="code-group" role="group" aria-label="Code examples">' +
      `<section class="code-group-panel"><h3 class="code-group-label">NPM</h3>${pre('js', 'npm i')}</section>` +
      `<section class="code-group-panel"><h3 class="code-group-label">sh</h3>${pre('sh', 'yarn add')}</section></div>`)
  })

  it('falls back to the code blocks and writes the div back', () => {
    const only = { extensions: codeGroup().extensions, renderers: {} }
    expect(html(group, only)).toBe(`${pre('js', 'npm i')}\n${pre('sh', 'yarn add')}`)
    expect(write(parse(group, { extensions: only.extensions }), { extensions: only.extensions })).toBe(group)
  })
})

const callouts = (source: string, mode?: 'static', bundle: ExtensionBundle = codeCallouts()): string =>
  renderWithDocumentTransforms(source, bundle.transforms ?? [], { extensions: bundle.extensions, renderers: bundle.renderers,
    ...(mode === undefined ? {} : { mode }) }).html

describe('codeCallouts', () => {
  const sample = '```js\nlet a = 1 <1>\nlet b = 2 <2>\n```\n<1> First\n<2> Second *b*\n'

  it('renders the markers as bubbles and binds the following list', () => {
    expect(callouts(sample)).toBe('<pre><code class="language-js">let a = 1 <b class="callout" data-callout="1">1</b>\n' +
      'let b = 2 <b class="callout" data-callout="2">2</b>\n</code></pre>\n' +
      '<ol class="callouts"><li value="1">First</li><li value="2">Second <strong>b</strong></li></ol>')
  })

  it('keeps a non-sequential number and escapes the code around the marker', () => {
    expect(callouts('```\nif a < b && c <7>\n```\n<7> Seven\n')).toBe(
      '<pre><code>if a &lt; b &amp;&amp; c <b class="callout" data-callout="7">7</b>\n</code></pre>\n' +
      '<ol class="callouts"><li value="7">Seven</li></ol>')
  })

  it('only a trailing marker counts', () => {
    expect(callouts('```\na <1> b\n```\n')).toBe('<pre><code>a &lt;1&gt; b\n</code></pre>')
  })

  it('binds no list without a marker or when a line is no item', () => {
    expect(callouts('```\na\n```\n<1> First\n')).toBe(render('```\na\n```\n<1> First\n'))
    expect(callouts('```\na <1>\n```\n<1> First\nplain\n')).toContain('<p>&lt;1&gt; First\nplain</p>')
  })

  it('carries authored attributes onto the list and the code', () => {
    expect(callouts('{#c}\n```\na <1>\n```\n\n{#l .x}\n<1> One\n')).toBe(
      '<pre id="c"><code>a <b class="callout" data-callout="1">1</b>\n</code></pre>\n' +
      '<ol id="l" class="callouts x"><li value="1">One</li></ol>')
  })

  it('works inside containers', () => {
    expect(callouts('> ```\n> a <1>\n> ```\n> <1> One\n')).toContain('<ol class="callouts"><li value="1">One</li></ol>')
    expect(callouts('- ```\n  a <1>\n  ```\n')).toContain('<b class="callout" data-callout="1">1</b>')
  })

  it('writes the same self-contained HTML in static mode', () => {
    expect(callouts(sample, 'static')).toBe(callouts(sample))
  })

  it('is inert when not registered, and leaves the authored tree alone', () => {
    expect(render(sample)).toContain('<p>&lt;1&gt; First')
    const tree = parse(sample)
    const copy = structuredClone(tree)
    const bundle = codeCallouts()
    renderWithDocumentTransforms(tree, bundle.transforms ?? [], { extensions: bundle.extensions, renderers: bundle.renderers })
    expect(tree).toEqual(copy)
  })

  it('without renderers writes the core code block and paragraph', () => {
    expect(callouts(sample, undefined, { ...codeCallouts(), renderers: {} })).toBe(render(sample))
  })
})

describe('the group together', () => {
  it('composes: a diagram fence is no callout candidate and a group panel keeps its code', () => {
    const all = withExtensions(presets(), mathBlock(), codeGroup(), codeCallouts())
    const source = `${FENCE}mermaid\nA <1>\n${FENCE}\n\n${group}\n${FENCE}math\nx\n${FENCE}\n`
    const output = renderWithDocumentTransforms(source, all.transforms ?? [], { extensions: all.extensions, renderers: all.renderers }).html
    expect(output).toContain('<pre class="mermaid" role="img" aria-label="mermaid">A &lt;1></pre>')
    expect(output).toContain('<div class="code-group"')
    expect(output).toContain('<div class="math display">\\[x\\]</div>')
  })

  it('a code group keeps a panel whose code has callouts, and its selection', () => {
    const all = withExtensions(codeGroup(), codeCallouts())
    const source = '::: code-group\n```js\na\n```\n\n{selected}\n```sh\nb <1>\n```\n:::\n'
    const output = renderWithDocumentTransforms(source, all.transforms ?? [], { extensions: all.extensions, renderers: all.renderers }).html
    expect(output).toContain('id="codegroup-1-tab-2" class="code-group-radio" checked>')
    expect(output).toContain('<div class="code-group-panel" role="group" aria-label="sh"><pre><code class="language-sh">' +
      'b <b class="callout" data-callout="1">1</b>\n</code></pre></div>')
    expect(output).not.toContain('selected')
  })
})

describe('docs/fenced-renderers.md', () => {
  it('runs every example', async () => {
    const root = join(import.meta.dirname, '..')
    const guide = readFileSync(join(root, 'docs/fenced-renderers.md'), 'utf8')
    const core = JSON.stringify(pathToFileURL(join(root, 'public/index.ts')).href)
    const extensions = JSON.stringify(pathToFileURL(join(root, 'public/extensions.ts')).href)
    const dir = mkdtempSync(join(tmpdir(), 'carve-fenced-'))
    const examples = [...guide.matchAll(/^```ts\n([\s\S]*?)^```$/gmu)].map((match) => match[1] ?? '')
    expect(examples).toHaveLength(3)
    for (const [index, example] of examples.entries()) {
      const file = join(dir, `example-${index}.ts`)
      writeFileSync(file, example.replaceAll("'@markup-carve/carve/extensions'", extensions).replaceAll("'@markup-carve/carve'", core))
      await import(pathToFileURL(file).href)
    }
  })
})
