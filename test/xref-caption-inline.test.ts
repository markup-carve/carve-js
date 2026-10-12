import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  carveToHtml,
  carveToMarkdown,
  htmlToAst,
  htmlToCarve,
  markdownToCarve,
  migrateMarkdown,
  parse,
} from '../src/index.js'

const fixtures = JSON.parse(
  readFileSync(
    new URL('./fixtures/xref-caption-inline.json', import.meta.url),
    'utf8',
  ),
) as {
  exportImport: Array<{
    source: string
    expectedNodes: Record<string, unknown>[]
  }>
  markdownExportImport: Array<{
    id: string
    source: string
    expectedNodes: Record<string, unknown>[]
    carrierFragments: string[]
  }>
}
const source = fixtures.exportImport[0].source as string
function nodes(value: unknown): Record<string, any>[] {
  if (!value || typeof value !== 'object') return []
  return [
    ...('type' in value ? [value as Record<string, any>] : []),
    ...Object.values(value).flatMap(nodes),
  ]
}
function projection(tree: unknown, expected: Record<string, unknown>[]) {
  for (const row of expected) {
    expect(
      nodes(tree).some((node) =>
        Object.entries(row).every(([path, value]) => {
          const field = path
            .split('.')
            .reduce((current, key) => current?.[key], node as any)
          return JSON.stringify(field) === JSON.stringify(value)
        }),
      ),
    ).toBe(true)
  }
}

describe('cross-reference and caption carriers', () => {
  it('keeps default HTML unchanged and wraps only the caption number', () => {
    expect(carveToHtml(source)).toBe(
      '<figure id="fig-sun">\n  <img src="sun.png" alt="Sun">\n  <figcaption>Figure 1: The sun</figcaption>\n</figure>\n<p>See <a href="#fig-sun">Figure 1</a>.</p>',
    )
    expect(carveToHtml(source, { roundtrip: false })).toBe(carveToHtml(source))
    expect(carveToHtml(source, { roundtrip: true })).toContain(
      'Figure <span data-carve-caption-number>1</span>: The sun',
    )
  })
  it.each(['safe', 'semantic', 'roundtrip'] as const)(
    'restores the shared fixture in %s mode under either prefix',
    (mode) => {
      for (const prefix of ['carve', 'djot']) {
        const html = carveToHtml(source, { roundtrip: true }).replaceAll(
          'data-carve-',
          `data-${prefix}-`,
        )
        projection(
          htmlToAst(html, { mode }).value,
          fixtures.exportImport[0].expectedNodes,
        )
        const imported = htmlToCarve(html, { mode }).value
        expect(carveToHtml(imported)).toBe(carveToHtml(source))
        expect(imported).not.toMatch(
          /data-(?:carve|djot)-(?:xref|caption-number|inline)/,
        )
      }
    },
  )
  it('discards generated cross-reference and caption text', () => {
    const html = carveToHtml(source, { roundtrip: true })
      .replace('>Figure 1</a>', '>stale</a>')
      .replace('>1</span>', '>999</span>')
    expect(carveToHtml(htmlToCarve(html).value)).toBe(carveToHtml(source))
  })
  it.each(['#', '#bad id', '#bad>id', '/u', 'javascript:alert(1)'])(
    'rejects an invalid cross-reference fragment %s',
    (href) => {
      const imported = htmlToAst(
        `<p><a href="${href}" data-carve-xref>label</a></p>`,
      )
      expect(
        nodes(imported.value).some((node) => node.type === 'heading_ref'),
      ).toBe(false)
      expect(imported.report.diagnostics.length).toBeGreaterThan(0)
    },
  )
  it.each(['class="x"', 'onclick="alert(1)"'])(
    'rejects caption-number spans with %s',
    (attrs) => {
      const imported = htmlToAst(
        `<p><span data-carve-caption-number ${attrs}>1</span></p>`,
      )
      expect(
        nodes(imported.value).some((node) => node.type === 'caption_number'),
      ).toBe(false)
      expect(imported.report.diagnostics.length).toBeGreaterThan(0)
    },
  )
  it('rejects a caption-number span holding elements', () => {
    expect(
      nodes(
        htmlToAst('<p><span data-carve-caption-number><b>1</b></span></p>')
          .value,
      ).some((node) => node.type === 'caption_number'),
    ).toBe(false)
  })
})

describe('marked Markdown inline elements', () => {
  it.each(fixtures.markdownExportImport)(
    'mirrors the shared $id fixture',
    (fixture) => {
      const markdown = carveToMarkdown(fixture.source, { roundtrip: true })
      for (const fragment of fixture.carrierFragments)
        expect(markdown).toContain(fragment)
      for (const prefix of ['carve', 'djot']) {
        const imported = markdownToCarve(
          markdown.replaceAll('data-carve-', `data-${prefix}-`),
        )
        projection(parse(imported), fixture.expectedNodes)
        expect(carveToHtml(imported)).toBe(carveToHtml(fixture.source))
      }
    },
  )
  it.each([
    ['[x]{.c} text\n', 'x text\n'],
    ['![a](i.png){width=300}\n', '![a](i.png)\n'],
    ['[l](u){.k}\n', '[l](u)\n'],
  ])('keeps default Markdown unchanged: %s', (carve, markdown) => {
    expect(carveToMarkdown(carve)).toBe(markdown)
    expect(carveToMarkdown(carve, { roundtrip: false })).toBe(markdown)
  })
  it.each(['[x](u)\n', '![a](i.png)\n', '[x]{}\n'])(
    'keeps constructs without attributes unchanged: %s',
    (carve) => {
      expect(carveToMarkdown(carve, { roundtrip: true })).toBe(
        carveToMarkdown(carve),
      )
    },
  )
  it('writes Markdown children and a plain image alt', () => {
    const carve =
      '[*bold* and /italic/]{.c} [*link*](u){.k} ![*alt*](i){width=3}\n'
    const markdown = carveToMarkdown(carve, { roundtrip: true })
    expect(markdown).toContain('data-carve-inline>**bold** and *italic*</span>')
    expect(markdown).toContain('data-carve-inline>**link**</a>')
    expect(markdown).toContain('alt="*alt*"')
    expect(carveToHtml(markdownToCarve(markdown))).toBe(carveToHtml(carve))
  })
  it('leaves unmarked inline HTML on its existing raw import path', () => {
    expect(markdownToCarve('<span class="c">x</span>')).toContain('{=html}')
    expect(markdownToCarve('<a href="u" class="k">l</a>')).toContain('{=html}')
  })
  it.each([
    '<span class="c" onclick="alert(1)" data-carve-inline>x</span>',
    '<a href="javascript:alert(1)" data-carve-inline>x</a>',
    '<img src="javascript:alert(1)" data-carve-inline>',
    '<span bad:name="x" data-carve-inline>x</span>',
  ])('drops and reports refused marked content: %s', (markdown) => {
    const imported = migrateMarkdown(markdown)
    const html = carveToHtml(imported.value)
    expect(html).not.toMatch(/onclick|javascript:|bad:name/)
    expect(imported.report.diagnostics.length).toBeGreaterThan(0)
  })
  it.each([
    '<span data-carve-inline>x',
    '<a href="u" data-carve-inline>x</span>',
  ])('reports damaged marked tags: %s', (markdown) => {
    const imported = migrateMarkdown(markdown)
    expect(
      imported.report.diagnostics.some(
        (row) => row.code === 'carrier-markers-damaged',
      ),
    ).toBe(true)
    expect(carveToHtml(imported.value)).not.toMatch(/<(?:span|a)\b/)
  })
})

it('restores nested marked spans and links', () => {
  const carve = '[a [*b*]{.inner} [c](u){.link}]{.outer}\n'
  const markdown = carveToMarkdown(carve, { roundtrip: true })
  expect(carveToHtml(markdownToCarve(markdown))).toBe(carveToHtml(carve))
})

it('does not mistake authored values for an internal body placeholder', () => {
  const carve = '[x]{title=CARVEINLINEBODY} ![CARVEMARKEDBODY](i){width=3}\n'
  expect(
    carveToHtml(markdownToCarve(carveToMarkdown(carve, { roundtrip: true }))),
  ).toBe(carveToHtml(carve))
})

it('falls back for the entire damaged carrier set', () => {
  const markdown =
    '<!-- carve: {#h} -->\n# Heading\n\n<a href="#h" data-carve-xref>Heading</a>\n\n<span data-carve-inline>broken\n'
  const imported = migrateMarkdown(markdown)
  expect(
    imported.report.diagnostics.filter(
      (row) => row.code === 'carrier-markers-damaged',
    ),
  ).toHaveLength(1)
  expect(imported.value).toContain('<!-- carve: {#h} -->')
  expect(
    nodes(parse(imported.value)).some((node) => node.type === 'heading_ref'),
  ).toBe(false)
})

it.each([
  '<span data-carve-inline onclick="unterminated>x',
  '<span onclick="alert(1)" data-carve-inline><script>alert(1)</script>',
])('keeps unreadable marked content inert: %s', (markdown) => {
  const imported = migrateMarkdown(markdown)
  expect(
    imported.report.diagnostics.some(
      (row) => row.code === 'carrier-markers-damaged',
    ),
  ).toBe(true)
  expect(carveToHtml(imported.value)).not.toMatch(/<(?:script|span)\b/)
})

it.each([
  '[x]{abbr="Expansion" .c}\n',
  '[x]{time="2026" .c}\n',
  '[x]{kbd .c}\n',
  '[x]{abbr="Expansion" time="2026" .c}\n',
])('restores the HTML element rendered for a semantic span: %s', (carve) => {
  expect(
    carveToHtml(markdownToCarve(carveToMarkdown(carve, { roundtrip: true }))),
  ).toBe(carveToHtml(carve))
})

it('keeps default Markdown cross-reference output unchanged', () => {
  expect(carveToMarkdown(source)).toBe(
    '![Sun](sun.png)\nFigure 1: The sun\n\nSee Figure 1.\n',
  )
})

it('keeps cross-reference targets distinct from internal placeholders', () => {
  const carve = '{#CARVEINLINEBODY}\n# Target\n\nSee </#CARVEINLINEBODY>.\n'
  const markdown = carveToMarkdown(carve, { roundtrip: true })
  expect(markdown).toContain('href="#CARVEINLINEBODY"')
  expect(carveToHtml(markdownToCarve(markdown))).toBe(carveToHtml(carve))
  expect(
    markdownToCarve('<a href="#&#67;ARVEMARKEDBODY" data-carve-xref>label</a>'),
  ).toBe('</#CARVEMARKEDBODY>')
})

it.each(['safe', 'semantic', 'roundtrip'] as const)(
  'preserves a cross-reference title attribute in %s mode',
  (mode) => {
    const imported = htmlToAst(
      '<p><a href="#h" title="tooltip" data-carve-xref>stale</a></p>',
      { mode },
    )
    projection(imported.value, [
      { type: 'heading_ref', target: 'h', 'attrs.keyValues.title': 'tooltip' },
    ])
  },
)

it.each(['safe', 'semantic', 'roundtrip'] as const)(
  'consumes new reserved names on unrelated hosts in %s mode',
  (mode) => {
    for (const prefix of ['carve', 'djot']) {
      const imported = htmlToCarve(
        `<p data-${prefix}-xref data-${prefix}-caption-number data-${prefix}-inline>x</p>`,
        { mode },
      )
      expect(imported.value).toBe('x\n')
    }
  },
)

it('keeps an authored abbreviation ahead of automatic expansion', () => {
  const carve = '*[HTML]: Automatic\n\n[HTML]{abbr=Custom .c}\n'
  const markdown = carveToMarkdown(carve, { roundtrip: true })
  expect(markdown).toContain(
    '<abbr title="Custom" class="c" data-carve-inline>HTML</abbr>',
  )
  const inline = markdown.trim().split('\n').at(-1)!
  expect(carveToHtml(markdownToCarve(inline))).toBe(
    carveToHtml('[HTML]{abbr=Custom .c}\n'),
  )
})

it('does not balance tags inside an HTML comment', () => {
  const imported = migrateMarkdown(
    '<span class="c" data-carve-inline>x<!-- </span> -->y</span>',
  )
  expect(
    imported.report.diagnostics.some(
      (row) => row.code === 'carrier-markers-damaged',
    ),
  ).toBe(false)
})

describe('a cross-reference carrier accepts every crossref_id', () => {
  const strip = (value: unknown) => JSON.stringify(value, (key, x) => (key === 'pos' || key === 'srcByteLength' ? undefined : x))

  for (const source of ['# Café\n\nSee </#Café>.\n', '# 日本語\n\nSee </#日本語>.\n', '{id="a.b"}\n# Head\n\nSee </#a.b>.\n', '{id="a:b"}\n# Head\n\nSee </#a:b>.\n', '{id="bad!"}\n# Head\n\nSee </#bad!>.\n']) {
    it(`round-trips ${JSON.stringify(source)} through HTML and Markdown`, () => {
      const viaHtml = htmlToCarve(carveToHtml(source, { roundtrip: true }), { mode: 'safe' }).value
      const viaMarkdown = migrateMarkdown(carveToMarkdown(source, { roundtrip: true })).value
      expect(strip(parse(viaHtml).children)).toBe(strip(parse(source).children))
      expect(strip(parse(viaMarkdown).children)).toBe(strip(parse(source).children))
    })
  }

  for (const href of ['#a b', '#', '#a>b', 'https://e.com/#x', '#a\tb']) {
    it(`refuses ${JSON.stringify(href)} as a cross-reference fragment`, () => {
      const imported = htmlToCarve(`<p><a href="${href}" data-carve-xref>t</a></p>`, { mode: 'safe' }).value
      expect(imported).not.toContain('</#')
    })
  }
})
