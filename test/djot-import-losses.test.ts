import { expect, it } from 'vitest'
import { djotToCarve, migrateDjot } from '../src/index.js'
import { djotToCarveWithLosses } from '../src/djot-import.js'

it.each([
  '<https://example.com/[x][missing]>\n',
  '[x](a(b[x][missing]c))\n',
  '![x](a(b[x][missing]c))\n',
  '`[x][missing]`\n',
  '`[x][missing]`{=html}\n',
  '$`[x][missing]`\n',
  '[t]{k="[x][missing]"}\n',
  '{% [x][missing] %}\n',
])('does not scan references inside an opaque payload: %s', (source) => {
  expect(djotToCarveWithLosses(source).losses).toEqual([])
  expect(migrateDjot(source).report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['fidelity-unverified'])
})

it.each([
  ['_({_foo_})_\n', 'Nested same-kind emphasis', 1],
  ['*****a*****\n', 'Nested same-kind emphasis', 1],
  ['__emphasis inside_ emphasis_\n', 'Nested same-kind emphasis', 1],
  ['##\n', 'An empty heading', 1],
  ['[link][]\n\n[link]:\n[link2]: url\n', 'A link with an empty destination', 1],
  ['[link][a and\nb]\n', 'An unresolved Djot reference', 1],
  ['[link][a and\nb]\n\n[a and\nb]: url\n', 'An unresolved Djot reference', 1],
  ['[Link][]\n\n[link]: /url\n', 'An unresolved Djot reference', 1],
  ['[[foo](bar)](baz)\n', 'A link inside another link', 1],
  [': term\n', 'An empty definition description', 1],
  ['> : term\n', 'An empty definition description', 1],
  ['- : term\n', 'An empty definition description', 1],
  ['intro\n\n> : term\n', 'An empty definition description', 3],
  ['- first\n- : term\n', 'An empty definition description', 2],
  ['> > : term\n', 'An empty definition description', 1],
  ['> - : term\n', 'An empty definition description', 1],
  ['- > : term\n', 'An empty definition description', 1],
  ['1. : term\n', 'An empty definition description', 1],
  ['> : term\n>\n> outside\n', 'An empty definition description', 1],
  ['- : term\n\n- outside\n', 'An empty definition description', 1],
  ['> : term\n\n  outside\n', 'An empty definition description', 1],
  ['- : term\n- sibling\n\n    body\n', 'An empty definition description', 1],
  ['- : term\n  - sibling\n\n    body\n', 'An empty definition description', 1],
  ['> : term\n> - sibling\n>\n>   body\n', 'An empty definition description', 1],
  [
    ': apple\n fruit\n\n  Paragraph one\n\n  Paragraph two\n\n  - sub\n  - list\n\n: orange\n',
    'An empty definition description',
    11,
  ],
  ['|a|b|\n|:-|---:|\n|c|d|\n|cc|dd|\n|-:|:-:|\n|e|f|\n|g|h|\n', 'A separator inside a table', 5],
  ['|--|--|\n', 'A table containing only separator rows', 1],
  ['| |\n', 'A table row whose cells are all blank', 1],
] as const)('names the loss in %s at its source line', (source, message, line) => {
  const result = migrateDjot(source)
  expect(result.value).toBe(djotToCarve(source))
  expect(result.report.diagnostics).toContainEqual(expect.objectContaining({ code: 'fidelity-unverified' }))
  expect(result.report.diagnostics).toContainEqual({
    code: 'structure-unspellable',
    message: expect.stringContaining(message),
    path: `line:${line}`,
    fidelity: 'dropped',
    severity: 'warning',
    confidence: 'exact',
  })
  expect(djotToCarveWithLosses(source).losses).toContainEqual({
    code: 'structure-unspellable',
    message: expect.stringContaining(message),
    line,
  })
})

it('keeps source positions across frontmatter, folded headings, removed attributes and synthesized footnotes', () => {
  const source = '---\nkey: value\n---\n\n# Heading\ncontinued\n\n{title=x}\n\n[^missing]\n\n[link][absent]\n'
  expect(migrateDjot(source).report.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'structure-unspellable',
      path: 'line:12',
    }),
  )
  expect(migrateDjot(source.replace(/\n/g, '\r\n')).report.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'structure-unspellable',
      path: 'line:12',
    }),
  )
})

it('dedents a lazy definition term continuation', () => {
  expect(djotToCarve(': apple\n fruit\n\n  Body\n\n: orange\n')).toContain(':: apple\nfruit\n')
})

it.each(['***', '*-*-*', '# h', '> q', '- li', '1. li', '```\nc\n```', '| t |', '::: d\nin\n:::'])(
  'collects a reference definition after a %s block',
  (block) => {
    for (const source of [`[r][]\n\n${block}\n[r]: /u\n`, `${block}\n[r]: /u\n\n[r][]\n`]) {
      expect(djotToCarveWithLosses(source).losses).toEqual([])
    }
  },
)

it('keeps a reference-looking line in an open paragraph unresolved', () => {
  expect(djotToCarveWithLosses('[r][]\n\npara\n[r]: /u\n').losses).toContainEqual(
    expect.objectContaining({
      line: 1,
      message: expect.stringContaining('An unresolved Djot reference'),
    }),
  )
})

it.each(['# a\ncontinued', '## a\n## continued', '#\na\ncontinued', '# a\n  continued'])(
  'registers the whole implicit heading label in %s',
  (heading) => {
    expect(djotToCarveWithLosses(`[a continued][]\n\n${heading}\n`).losses).toEqual([])
    expect(djotToCarveWithLosses(`[a][]\n\n${heading}\n`).losses).toContainEqual(
      expect.objectContaining({
        line: 1,
        message: expect.stringContaining('An unresolved Djot reference'),
      }),
    )
  },
)

it('does not register a heading continuation as a separate implicit label', () => {
  expect(djotToCarveWithLosses('[continued][]\n\n# a\n# continued\n').losses).toContainEqual(
    expect.objectContaining({
      line: 1,
      message: expect.stringContaining('An unresolved Djot reference'),
    }),
  )
})

it('ends an implicit heading label before a list opener', () => {
  expect(djotToCarveWithLosses('[a][]\n\n# a\n- continued\n').losses).toEqual([])
  expect(djotToCarveWithLosses('[a continued][]\n\n# a\n- continued\n').losses).toContainEqual(
    expect.objectContaining({
      line: 1,
      message: expect.stringContaining('An unresolved Djot reference'),
    }),
  )
})

it.each([
  '`_({_foo_})_ [x][missing] ## | |`\n',
  '```\n##\n[x][missing]\n| |\n: orange\n```\n',
  '[x]{title="[a][missing]"}\n',
  '[x][ref]\n\n[ref]:\n  /url\n',
  '[link _and_ link][]\n\n[link and link]: url\n',
  '*_different kinds_*\n',
  '> [x][ref]\n>\n> [ref]: /u\n',
  '- [x][ref]\n\n  [ref]: /u\n',
  'See [Introduction][].\n\n# Introduction\n',
  'See [Introduction][].\n\n{#foo}\n# Introduction\n',
  '[link][]\n[link][link2]\n\n[link2]:\n  url2\n[link]:\n url\n',
])('does not name losses inside opaque or representable source: %s', (source) => {
  expect(djotToCarveWithLosses(source).losses).toEqual([])
})

it.each([
  '> : term\n>\n>   body\n',
  '> > : term\n> >\n> >   body\n',
  '> - : term\n>\n>     body\n',
  '- > : term\n  >\n  >   body\n',
  '- : term\n\n    body\n',
  '1. : term\n\n     body\n',
  '- : term\n\n    - nested\n',
  ': term\n - continuation\n\n  body\n',
  '> paragraph\n> : term\n',
  '- paragraph\n  : term\n',
  '> ```\n> : term\n> ```\n',
  '- ```\n  : term\n  ```\n',
  '[^note]: body\n',
  '> [^note]: body\n',
  '- [^note]: body\n',
])('does not report an empty description for container content in %s', (source) => {
  expect(djotToCarveWithLosses(source).losses).toEqual([])
})

it.each(['- a\n\n  - b\n  - c\n\n- d\n', '- a\n  - b\n\n  - c\n\n- d\n'])(
  'keeps a tight list ending in a nested list tight: %s',
  (source) => {
    const result = migrateDjot(source)
    expect(result.value).not.toContain('\n\n- d')
    expect(result.report.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'structure-unspellable' }))
  },
)

it('reports nested links after an escaped bang', () => {
  expect(djotToCarveWithLosses('\\![[foo](bar)](baz)').losses)
    .toContainEqual(expect.objectContaining({ line: 1, message: expect.stringContaining('A link inside another link') }))
})

it('keeps unfinished destinations literal in a long report scan', () => {
  expect(djotToCarveWithLosses('x^[[a](b '.repeat(8192)).losses).toEqual([])
})

it('reports each empty heading at its original line', () => {
  const result = djotToCarveWithLosses('#\n\n'.repeat(512))
  expect(result.losses).toHaveLength(512)
  expect(result.losses[0]!.line).toBe(1)
  expect(result.losses.at(-1)!.line).toBe(1023)
})

it('keeps links inside image alt text from becoming nested anchors', () => {
  expect(djotToCarveWithLosses('[![a [b](u)](image)](outer)').losses).toEqual([])
})

it.each([
  '[a [b [c](u)] d](v)',
  '[text [span [x](u)]{.c}](v)',
  '[![a [b](u)] text](v)',
])('reports a nested link through a plain bracket: %s', (source) => {
  expect(djotToCarveWithLosses(source).losses)
    .toContainEqual(expect.objectContaining({ message: expect.stringContaining('A link inside another link') }))
})

it.each([
  '[a [b](u)\\\n\nc](v)',
  '> [x [a](u)\n>\n> b](v)',
  '| [a [b](u) | c](v) |',
])('keeps nested link reports inside their paragraph or cell: %s', (source) => {
  expect(djotToCarveWithLosses(source).losses).toEqual([])
})


it.each(['![a]()', '![a][missing]', '![a][]\n\n[a]:'])('reports images with missing destinations: %s', (source) => {
  expect(djotToCarveWithLosses(source).losses).toContainEqual(expect.objectContaining({ message: expect.stringContaining('image') }))
})

it('preserves a space-only destination without an empty-target loss', () => {
  expect(djotToCarveWithLosses('[a]( )').losses).toEqual([])
})
