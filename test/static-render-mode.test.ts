import { describe, expect, it } from 'vitest'

import {
  carveToHtml,
  chart,
  codeGroup,
  details,
  graphviz,
  plantuml,
  fencedRender,
  mathBlock,
  mermaid,
  spoiler,
  tabs,
} from '../src/index.js'

// A document exercising every interactive construct the static mode flattens.
const TABS_SRC = [
  ':::: tabs',
  '::: tab [Installation]',
  '`npm i @markup-carve/carve`',
  ':::',
  '::: tab [Usage]',
  '`carveToHtml(src)`',
  ':::',
  '::::',
].join('\n')

const exts = () => [
  tabs(),
  codeGroup(),
  details(),
  spoiler(),
  mermaid(),
  chart(),
  graphviz(),
  plantuml(),
  mathBlock(),
]

describe('static render mode — option plumbing', () => {
  it('rejects an unknown mode value', () => {
    expect(() => carveToHtml('# Hi', { mode: 'print' as 'static' })).toThrow(/unknown render mode/)
  })

  it('omitting mode is interactive (non-breaking, unchanged output)', () => {
    const omitted = carveToHtml(TABS_SRC, { extensions: exts() })
    const explicit = carveToHtml(TABS_SRC, { extensions: exts(), mode: 'interactive' })
    expect(omitted).toBe(explicit)
  })
})

describe('static render mode — tabs / code-group flatten to labeled sections', () => {
  it('interactive tabs emit clickable radio widgets', () => {
    const html = carveToHtml(TABS_SRC, { extensions: exts(), mode: 'interactive' })
    expect(html).toContain('<input type="radio"')
    expect(html).toContain('<label')
    // Labels are tab headers, not section headings, in interactive mode.
    expect(html).not.toContain('<section')
  })

  it('static tabs emit each panel as a <section> headed by its [label]', () => {
    const html = carveToHtml(TABS_SRC, { extensions: exts(), mode: 'static' })
    expect(html).not.toContain('<input type="radio"')
    expect(html).toContain('<section class="tabs-panel">')
    expect(html).toContain('<h3 class="tabs-label">Installation</h3>')
    expect(html).toContain('<h3 class="tabs-label">Usage</h3>')
    // Both panels' content survives.
    expect(html).toContain('npm i @markup-carve/carve')
    expect(html).toContain('carveToHtml(src)')
  })

  it('static code-group emits each code panel as a labeled <section>', () => {
    const src = [
      ':::: code-group',
      '``` js [npm]',
      'npm i carve',
      '```',
      '``` sh [pnpm]',
      'pnpm add carve',
      '```',
      '::::',
    ].join('\n')
    const html = carveToHtml(src, { extensions: exts(), mode: 'static' })
    expect(html).not.toContain('<input type="radio"')
    expect(html).toContain('<section class="code-group-panel">')
    expect(html).toContain('<h3 class="code-group-label">npm</h3>')
    expect(html).toContain('<h3 class="code-group-label">pnpm</h3>')
    expect(html).toContain('npm i carve')
    expect(html).toContain('pnpm add carve')
  })
})

describe('static render mode — details / spoiler reveal', () => {
  it('details is a native <details> disclosure in both modes; static adds open', () => {
    const src = '::: details "More info"\nHidden body.\n:::'
    const live = carveToHtml(src, { extensions: exts(), mode: 'interactive' })
    expect(live).toContain('<details>')
    expect(live).toContain('<summary>More info</summary>')

    const flat = carveToHtml(src, { extensions: exts(), mode: 'static' })
    expect(flat).toContain('<details open>')
    expect(flat).toContain('<summary>More info</summary>')
    expect(flat).toContain('Hidden body.')
  })

  it('static spoiler reveals inline + block content (no blur)', () => {
    const inline = carveToHtml('Plot: :spoiler[the butler did it].', {
      extensions: exts(),
      mode: 'static',
    })
    expect(inline).toContain('<span class="spoiler spoiler-revealed">the butler did it</span>')

    const block = carveToHtml('::: spoiler "Ending"\nEveryone lives.\n:::', {
      extensions: exts(),
      mode: 'static',
    })
    expect(block).not.toContain('<details')
    expect(block).toContain('<section class="spoiler spoiler-revealed">')
    expect(block).toContain('<h3 class="spoiler-title">Ending</h3>')
    expect(block).toContain('Everyone lives.')

    const labeled = carveToHtml('::: spoiler "End" [Build]\nOver.\n:::', {
      extensions: exts(),
      mode: 'static',
    })
    expect(labeled).toContain('<h3 class="spoiler-title">End</h3>')
    expect(labeled).toContain('<p class="div-label">Build</p>')
  })
})

describe('static render mode — mermaid (no-renderer source vs with-renderer image)', () => {
  const SRC = '``` mermaid\ngraph TD; A --> B\n```'

  it('interactive mermaid is the client-hydration <pre class="mermaid">', () => {
    const html = carveToHtml(SRC, { extensions: exts(), mode: 'interactive' })
    expect(html).toBe('<pre class="mermaid">graph TD; A --> B</pre>')
  })

  it('static mermaid WITHOUT a renderer degrades to escaped source <pre><code>', () => {
    const html = carveToHtml(SRC, { extensions: exts(), mode: 'static' })
    expect(html).toContain('<pre class="mermaid"><code class="language-mermaid">')
    expect(html).toContain('graph TD; A --&gt; B')
    // Content preserved, never blank.
    expect(html).not.toBe('')
  })

  it('static mermaid source fallback preserves author fence attributes', () => {
    // `{#d1 .bordered}` on the fence must survive the degradation path
    // (anchors / styling), not be dropped.
    const html = carveToHtml('{#d1 .bordered}\n``` mermaid\nA --> B\n```', {
      extensions: exts(),
      mode: 'static',
    })
    expect(html).toContain('<pre id="d1" class="mermaid bordered">')
  })

  it('static mermaid WITH a stub renderer emits the injected SVG inside the attributed wrapper', () => {
    const html = carveToHtml(SRC, {
      extensions: exts(),
      mode: 'static',
      renderers: { mermaid: (src) => `<svg data-src="${src.length}"><!--diagram--></svg>` },
    })
    // The renderer receives the verbatim diagram source ("graph TD; A --> B"),
    // and its output is wrapped in the same `<pre class="mermaid">` element the
    // interactive / fallback paths use, so author attributes can ride along.
    expect(html).toBe('<div class="mermaid"><svg data-src="17"><!--diagram--></svg></div>')
  })

  it('static mermaid WITH a renderer carries author fence attributes onto the wrapper', () => {
    // `{#diagram .wide}` on the fence must land on the wrapping element of the
    // renderer output, exactly as it does on the source-fallback path - the
    // P2 codex flagged was the renderer path dropping these attributes.
    const html = carveToHtml('{#diagram .wide}\n``` mermaid\nA --> B\n```', {
      extensions: exts(),
      mode: 'static',
      renderers: { mermaid: () => '<svg><!--d--></svg>' },
    })
    expect(html).toBe('<div id="diagram" class="mermaid wide"><svg><!--d--></svg></div>')
  })
})

describe('static render mode — chart', () => {
  const SRC = '``` chart\n{"type":"bar"}\n```'

  it('static chart without a renderer keeps the JSON source as a <pre><code>', () => {
    const html = carveToHtml(SRC, { extensions: exts(), mode: 'static' })
    expect(html).toContain('<pre class="chart"><code class="language-chart">')
    // Element text content: only & < > are escaped (quotes are safe here).
    expect(html).toContain('{"type":"bar"}')
    // No live <script> in static mode.
    expect(html).not.toContain('<script')
  })

  it('static chart with a stub renderer emits the injected image inside the attributed wrapper', () => {
    const html = carveToHtml(SRC, {
      extensions: exts(),
      mode: 'static',
      renderers: { chart: () => '<img alt="chart" src="chart.png">' },
    })
    // json-mode default wrapper is `<div class="chart">`; the image rides inside
    // it so author attributes survive the renderer path.
    expect(html).toBe('<div class="chart"><img alt="chart" src="chart.png"></div>')
  })

  it('static chart with a renderer carries author fence attributes onto the wrapper', () => {
    const html = carveToHtml('{#c1 .boxed}\n``` chart\n{"type":"bar"}\n```', {
      extensions: exts(),
      mode: 'static',
      renderers: { chart: () => '<img alt="chart" src="chart.png">' },
    })
    expect(html).toBe('<div id="c1" class="chart boxed"><img alt="chart" src="chart.png"></div>')
  })
})

describe('static render mode — graphviz', () => {
  const SRC = '``` graphviz\ndigraph { A -> B }\n```'

  it('static graphviz without a renderer degrades to escaped source <pre><code>', () => {
    const html = carveToHtml(SRC, { extensions: exts(), mode: 'static' })
    expect(html).toContain('<pre class="graphviz"><code class="language-graphviz">')
    expect(html).toContain('digraph { A -&gt; B }')
    expect(html).not.toContain('<script')
  })

  it('static graphviz with a stub renderer emits the injected image inside the wrapper', () => {
    const html = carveToHtml(SRC, {
      extensions: exts(),
      mode: 'static',
      renderers: { graphviz: () => '<img alt="graphviz" src="graph.svg">' },
    })
    expect(html).toBe('<div class="graphviz"><img alt="graphviz" src="graph.svg"></div>')
  })

  it('the dot alias consults the same graphviz renderer key', () => {
    const html = carveToHtml('``` dot\ndigraph { A -> B }\n```', {
      extensions: exts(),
      mode: 'static',
      renderers: { graphviz: () => '<img alt="graphviz" src="graph.svg">' },
    })
    expect(html).toBe('<div class="graphviz"><img alt="graphviz" src="graph.svg"></div>')
  })
})

describe('static render mode — plantuml', () => {
  const SRC = '``` plantuml\n@startuml\nA -> B\n@enduml\n```'

  it('static plantuml without a renderer degrades to escaped source <pre><code>', () => {
    const html = carveToHtml(SRC, { extensions: exts(), mode: 'static' })
    expect(html).toContain('<pre class="plantuml"><code class="language-plantuml">')
    expect(html).not.toContain('<script')
  })

  it('static plantuml with a stub renderer emits the injected image inside the wrapper', () => {
    const html = carveToHtml(SRC, {
      extensions: exts(),
      mode: 'static',
      renderers: { plantuml: () => '<img alt="plantuml" src="uml.svg">' },
    })
    expect(html).toBe('<div class="plantuml"><img alt="plantuml" src="uml.svg"></div>')
  })

  it('the puml alias consults the same plantuml renderer key', () => {
    const html = carveToHtml('``` puml\nA -> B\n```', {
      extensions: exts(),
      mode: 'static',
      renderers: { plantuml: () => '<img alt="plantuml" src="uml.svg">' },
    })
    expect(html).toBe('<div class="plantuml"><img alt="plantuml" src="uml.svg"></div>')
  })
})

describe('static render mode — open map: a custom fence word is static-capable', () => {
  it('a custom fence class is keyed against the open renderers map', () => {
    // No spec change, no canonical key: a custom `myuml` fence renders
    // statically via its css class, exactly like the canonical presets.
    const ext = fencedRender({ language: 'myuml' })
    const html = carveToHtml('``` myuml\nA -> B\n```', {
      extensions: [ext],
      mode: 'static',
      renderers: { myuml: () => '<img alt="myuml" src="my.svg">' },
    })
    expect(html).toBe('<div class="myuml"><img alt="myuml" src="my.svg"></div>')
  })

  it('a custom fence with no matching renderer degrades to escaped source', () => {
    const ext = fencedRender({ language: 'myuml' })
    const html = carveToHtml('``` myuml\nA -> B\n```', { extensions: [ext], mode: 'static' })
    expect(html).toContain('<pre class="myuml"><code class="language-myuml">')
    expect(html).not.toContain('<img')
  })
})

describe('static render mode — math (SSR via renderer vs source)', () => {
  it('interactive display math keeps \\[…\\] for client KaTeX', () => {
    const html = carveToHtml('$$`\\frac{a}{b}`', { extensions: exts(), mode: 'interactive' })
    expect(html).toContain('<span class="math display">\\[\\frac{a}{b}\\]</span>')
  })

  it('static inline math without a renderer keeps the \\(…\\) source', () => {
    const html = carveToHtml('Euler: $`e^{i\\pi}`.', { extensions: exts(), mode: 'static' })
    expect(html).toContain('<span class="math inline">\\(e^{i\\pi}\\)</span>')
  })

  it('static inline math WITH a stub renderer emits server-side MathML', () => {
    const html = carveToHtml('Euler: $`e^{i\\pi}`.', {
      extensions: exts(),
      mode: 'static',
      renderers: { math: (tex, display) => `<math data-display="${display}">${tex}</math>` },
    })
    expect(html).toContain('<span class="math inline"><math data-display="false">e^{i\\pi}</math></span>')
  })

  it('static math-block fence with a stub renderer emits SSR inside the math div', () => {
    const html = carveToHtml('``` math\n\\int_0^1 x^2\n```', {
      extensions: exts(),
      mode: 'static',
      renderers: { math: (tex, display) => `<math data-display="${display}">SSR</math>` },
    })
    expect(html).toBe('<div class="math display"><math data-display="true">SSR</math></div>')
  })

  it('static math-block fence without a renderer keeps the \\[…\\] source', () => {
    const html = carveToHtml('``` math\n\\int_0^1 x^2\n```', { extensions: exts(), mode: 'static' })
    expect(html).toBe('<div class="math display">\\[\\int_0^1 x^2\\]</div>')
  })
})

describe('core caption floor — unconsumed div [label]', () => {
  it('a bare labeled div renders <p class="div-label"> (no extension active)', () => {
    expect(carveToHtml('::: [Notes]\nBody.\n:::')).toBe(
      '<div>\n  <p class="div-label">Notes</p>\n  <p>Body.</p>\n</div>',
    )
  })

  it('escapes the label text', () => {
    const html = carveToHtml('::: [<b>x</b>]\nBody.\n:::')
    expect(html).toContain('<p class="div-label">&lt;b&gt;x&lt;/b&gt;</p>')
  })

  it('escapes a labeled div in the Markdown renderer (no live HTML)', async () => {
    const { carveToMarkdown } = await import('../src/index.js')
    const md = carveToMarkdown('::: [<img src=x onerror=alert(1)>]\nBody.\n:::')
    // HTML metacharacters escaped, not emitted live.
    expect(md).not.toContain('<img')
    expect(md).toContain('&lt;img')
  })

  it('a labeled admonition renders title first, then the label floor', () => {
    const html = carveToHtml('::: tip "Pro Tip" [Build]\nSave often.\n:::')
    const titleIdx = html.indexOf('admonition-title')
    const labelIdx = html.indexOf('div-label')
    expect(titleIdx).toBeGreaterThan(-1)
    expect(labelIdx).toBeGreaterThan(titleIdx)
    expect(html).toContain('<p class="div-label">Build</p>')
  })

  it('a labeled-but-empty div still surfaces the floor', () => {
    expect(carveToHtml('::: [Only]\n:::')).toBe(
      '<div>\n  <p class="div-label">Only</p>\n</div>',
    )
  })

  it('a group extension consumes the label, so no floor is double-rendered', () => {
    // With tabs active the wrapper is consumed; the panel labels become the
    // tab headers, not div-label captions.
    const html = carveToHtml(TABS_SRC, { extensions: exts(), mode: 'interactive' })
    expect(html).not.toContain('div-label')
  })
})

describe('static render mode — dispatch & attribute correctness', () => {
  it('static details carries author attributes onto the native <details open> tag', () => {
    // Attributes attach via a preceding block-attribute line (strict djot).
    const html = carveToHtml('{.wide}\n::: details "More"\nBody.\n:::', {
      extensions: [details()],
      mode: 'static',
    })
    // Native disclosure with the open attribute and the author class.
    expect(html).toContain('<details open class="wide">')
    expect((html.match(/class="/g) ?? []).length).toBe(1) // details only; summary has none
  })

  it('honors a staticBlockRenderers.heading in static mode (API consistency)', () => {
    const headingExt = {
      name: 'static-heading',
      staticBlockRenderers: {
        heading: () => '<h1 class="static-heading">flat</h1>',
      },
    }
    const live = carveToHtml('# Title', { extensions: [headingExt], mode: 'interactive' })
    expect(live).toContain('<h1>Title</h1>') // static hook skipped when interactive
    const flat = carveToHtml('# Title', { extensions: [headingExt], mode: 'static' })
    expect(flat).toContain('<h1 class="static-heading">flat</h1>')
  })

  it('preserves registration order: an earlier extension wins in static mode', () => {
    // A custom extension registered BEFORE the bundled mermaid must keep its
    // claim on `mermaid` code blocks even in static mode (the static dispatch
    // walks extensions in registration order, not all-static-first).
    const customMermaid = {
      name: 'custom-mermaid',
      blockRenderers: {
        'code-block': (node: { type: string; lang?: string }) =>
          node.lang === 'mermaid' ? '<div class="custom-diagram">claimed</div>' : undefined,
      },
    }
    const html = carveToHtml('``` mermaid\nA --> B\n```', {
      extensions: [customMermaid, mermaid()],
      mode: 'static',
    })
    expect(html).toBe('<div class="custom-diagram">claimed</div>')
  })
})
