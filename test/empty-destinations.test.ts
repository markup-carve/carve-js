import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml, carveToMarkdown, fromAstJson, htmlToCarve, lintCarve, renderAnsi, renderCarveWithConversionReport, renderHtml, renderPlainText } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'
import { djotToCarveWithLosses } from '../src/djot-import.js'

const canonical = (source: string) => carveToCarve(source).trim()

describe('explicit empty destinations', () => {
  it.each([
    ['[t]()', '<p><a href="">t</a></p>', '[t]()'],
    ['[]()', '<p><a href=""></a></p>', '[]()'],
    ['[t]( )', '<p><a href="">t</a></p>', '[t]()'],
    ['[t]( "T")', '<p><a href="" title="T">t</a></p>', '[t]( "T")'],
    ['![alt]()', '<img src="" alt="alt">', '![alt]()'],
    ['![alt]( "T")', '<img src="" alt="alt" title="T">', '![alt]( "T")'],
  ])('keeps %s', (source, html, written) => {
    expect(carveToHtml(source)).toBe(html)
    expect(canonical(source)).toBe(written)
    expect(canonical(canonical(source))).toBe(written)
  })

  it('distinguishes an empty definition from an unresolved reference on the wire', () => {
    const defined = carveToAstJson('[t][r]\n\n[r]:')
    const undefinedRef = carveToAstJson('[t][r]')
    const definedLink = (defined.children[0] as { children: { href: string; ref: string; rawRef: string }[] }).children[0]!
    const missingLink = (undefinedRef.children[0] as { children: { href: string; ref: string; rawRef: string }[] }).children[0]!
    expect(definedLink).toMatchObject({ href: '', ref: 'r', rawRef: '[t][r]' })
    expect(missingLink).toMatchObject({ href: '', ref: 'r', rawRef: '[t][r]' })
    expect(defined.children.some((node) => node.type === 'link_reference_definition' && node.href === '')).toBe(true)
    expect(undefinedRef.children.some((node) => node.type === 'link_reference_definition')).toBe(false)
    expect(renderHtml(fromAstJson(JSON.parse(JSON.stringify(defined))))).toBe('<p><a href="">t</a></p>')
    expect(renderHtml(fromAstJson(JSON.parse(JSON.stringify(undefinedRef))))).toBe('<p>[t][r]</p>')
    expect(canonical('[t][r]\n\n[r]:')).toBe('[t][r]\n\n[r]:')
  })

  it('renders resolved empty references without their definition line', () => {
    const source = 'x [t][r] y\n\n[r]:'
    const ast = fromAstJson(carveToAstJson(source))
    expect(renderPlainText(ast)).toContain('x t y')
    expect(renderPlainText(ast)).not.toContain('[r]:')
    expect(renderAnsi(ast)).not.toContain('[r]:')
    expect(carveToMarkdown(source)).not.toContain('[r]:')

    const image = fromAstJson(carveToAstJson('![t][r]\n\n[r]:'))
    expect(renderPlainText(image)).toContain('t')
    expect(renderPlainText(image)).not.toContain('![t][r]')
    expect(renderAnsi(image)).not.toContain('![t][r]')
  })

  it('derives a cross-reference label from a resolved empty reference', () => {
    const source = '{#h}\n# A [t][r]\n\nsee </#h>\n\n[r]:'
    const see = '<p>see <a href="#h">A t</a></p>'
    expect(carveToHtml(source)).toContain(see)
    expect(renderHtml(fromAstJson(JSON.parse(JSON.stringify(carveToAstJson(source)))))).toContain(see)
    expect(carveToHtml('{#h}\n# A [t][r]\n\nsee </#h>')).toContain('<p>see <a href="#h">A [t][r]</a></p>')
  })

  it('collapses a resolved empty reference image after AST JSON decoding', () => {
    const document = carveToAstJson('[a]:\n\n![al][a]')
    expect(renderHtml(fromAstJson(JSON.parse(JSON.stringify(document))))).toBe('<img src="" alt="al">')
  })

  it.each(['[t](/u )', '[t](/u\t)', '[t](/u "T"\t)', '[t](  "T")', '[t](\t"T")'])(
    'keeps invalid destination padding literal: %s', source => {
      expect(carveToHtml(source)).not.toContain('<a href=')
    },
  )

  it('keeps a quoted destination nonempty', () => {
    expect(carveToHtml('[t]("T")')).toContain('href="&quot;T&quot;"')
  })

  it('writes empty Markdown destinations with an unambiguous angle spelling', () => {
    expect(carveToMarkdown('[t]()').trim()).toBe('[t](<>)')
    expect(carveToMarkdown('[t]( "T")').trim()).toBe('[t](<> "T")')
    expect(carveToMarkdown('![a]( "T")').trim()).toBe('![a](<> "T")')
  })

  it('warns on a bare empty definition', () => {
    expect(lintCarve('[r]:').map((warning) => warning.rule)).toContain('empty-reference-definition')
  })

  it('reports metadata an empty definition cannot spell', () => {
    const document = { type: 'document' as const, children: [
      { type: 'link_reference_definition' as const, label: 'r', href: '', title: 'T', attrs: { id: 'x' } },
    ] }
    const result = renderCarveWithConversionReport(document)
    expect(result.value?.trim()).toBe('[r]:')
    expect(result.report.diagnostics.map((row) => [row.code, row.field])).toEqual([
      ['field-unspellable', 'title'], ['field-unspellable', 'attrs'],
    ])
  })

  it('imports explicit empty HTML destinations as native nodes', () => {
    expect(htmlToCarve('<p><a href="">t</a></p>').value).toBe('[t]()\n')
    expect(htmlToCarve('<img src="" alt="a">').value).toBe('![a]()\n')
    expect(htmlToCarve('<p><a>t</a></p>').value).toBe('t\n')
  })

  it('imports empty Markdown destinations without dropping the link', () => {
    const inline = markdownToCarveWithLosses('[t](<>) and ![alt]()')
    expect(inline.value.trim()).toBe('[t]() and ![alt]()')
    expect(inline.losses).toEqual([])
    const reference = markdownToCarveWithLosses('[t][r]\n\n[r]: <>')
    expect(reference.value.trim()).toBe('[t][r]\n\n[r]:')
    expect(reference.losses).toEqual([])
    expect(markdownToCarveWithLosses('[x][a&amp;b]\n\n[a&amp;b]: <>').value.trim())
      .toBe('[x][a&b]\n\n[a&b]:')
    expect(markdownToCarveWithLosses('[r]\n\n[r]: <>\n[r]: /later').value.trim())
      .toBe('[r][]\n\n[r]:')
  })

  it('reports a titled empty Markdown definition that becomes inline links', () => {
    const result = markdownToCarveWithLosses('[t][r]\n\n[r]: <> "T"')
    expect(result.value.trim()).toBe('[t]( "T")')
    expect(result.losses).toContainEqual(expect.objectContaining({ code: 'structure-unspellable', line: 3 }))
  })

  it.each([
    ['[t][r]\n\n[r]: <> "a\nb"', 3],
    ['[t][r]\n\n[r]: <> (a\nb)', 3],
    ["[t][r]\n\n[r]: <>\n  'a\nb'", 3],
  ])('inlines a titled empty Markdown definition whose title wraps: %j', (source, line) => {
    const result = markdownToCarveWithLosses(source)
    expect(result.value.trim()).toBe('[t]( "a\nb")')
    expect(carveToHtml(result.value)).toBe('<p><a href="" title="a\nb">t</a></p>')
    expect(result.losses).toContainEqual(expect.objectContaining({ code: 'structure-unspellable', line }))
  })

  it.each([
    ['> [t][r]\n>\n> [r]: <> "a\n> b"', '> [t]( "a\n> b")', '<blockquote><p><a href="" title="a\nb">t</a></p></blockquote>'],
    ['> [t][r]\n>\n> [r]: <> "a\nb"', '> [t]( "a\n> b")', '<blockquote><p><a href="" title="a\nb">t</a></p></blockquote>'],
    ['> [t][r]\n>\n> [r]: <>\n> "a\n> b"', '> [t]( "a\n> b")', '<blockquote><p><a href="" title="a\nb">t</a></p></blockquote>'],
    ['> [t][r]\n>\n> [r]: <>\n"a\nb"', '> [t]( "a\n> b")', '<blockquote><p><a href="" title="a\nb">t</a></p></blockquote>'],
    ['>> [t][r]\n>>\n>> [r]: <> "a\n> b"', '> > [t]( "a\n> > b")', '<blockquote>\n  <blockquote><p><a href="" title="a\nb">t</a></p></blockquote>\n</blockquote>'],
    ['[r]: <> "a\nb"\n\n> x [t][r] y', '> x [t]( "a\n> b") y', '<blockquote><p>x <a href="" title="a\nb">t</a> y</p></blockquote>'],
    ['> ![t][r]\n>\n> [r]: <> "a\n> b"', '> ![t]( "a\n> b")', '<blockquote>\n  <img src="" alt="t" title="a\nb">\n</blockquote>'],
    ['[r]: <> "a\nb"\n\n> - [t][r]', '> - [t]( "a\n>   b")', '<blockquote>\n  <ul>\n    <li><a href="" title="a\nb">t</a></li>\n  </ul>\n</blockquote>'],
    ['[r]: <> "a\nb"\n\n- > [t][r]', '- > [t]( "a\n  > b")', '<ul>\n  <li>\n    <blockquote><p><a href="" title="a\nb">t</a></p></blockquote>\n  </li>\n</ul>'],
    ['> x ![t][r] y\n>\n> [r]: <> "a\n> b"', '> x ![t]( "a\n> b") y', '<blockquote><p>x <img src="" alt="t" title="a\nb"> y</p></blockquote>'],
  ])('inlines a quoted titled empty Markdown definition whose title wraps: %j', (source, carve, html) => {
    const result = markdownToCarveWithLosses(source)
    expect(result.value.trim()).toBe(carve)
    expect(carveToHtml(result.value)).toBe(html)
    expect(result.losses).toContainEqual(expect.objectContaining({ code: 'structure-unspellable' }))
  })

  it('leaves a quoted definition whose title a blank quote line ends as text', () => {
    const result = markdownToCarveWithLosses('> [t][r]\n>\n> [r]: <> "a\n>\n> b"')
    expect(result.value).toContain('> [t][r]')
    expect(result.losses).not.toContainEqual(expect.objectContaining({ code: 'structure-unspellable' }))
  })

  it('imports empty Djot destinations without a false loss', () => {
    const inline = djotToCarveWithLosses('[t]()')
    expect(inline.value).toBe('[t]()')
    expect(inline.losses).toEqual([])
    const reference = djotToCarveWithLosses('[t][r]\n\n[r]:')
    expect(reference.value).toBe('[t][r]\n\n[r]:')
    expect(reference.losses).toEqual([])
  })
})
