import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml, fromAstJson, parse, renderCarve } from '../src/index.js'
import { canonicalCarveWrite } from '../src/ast/canonical-carve-write.js'
import { toAstJson } from '../src/ast-json.js'

const source = '- a\n%% c\nb\n'

describe('carve#5012 transparent single-line blocks', () => {
  it('keeps list and paragraph layout across a line comment', () => {
    expect(carveToHtml(source)).toBe('<ul>\n  <li>a\nb</li>\n</ul>')
    expect(carveToHtml('para\n%% c\nmore')).toBe('<p>para\nmore</p>')
  })

  it('keeps the comment node at its authored source extent', () => {
    const item = parse(source).children[0]
    expect(item?.type).toBe('list')
    if (item?.type !== 'list') return
    const comment = item.items[0]?.children.find((node) => node.type === 'comment')
    expect(comment).toMatchObject({
      type: 'comment', block: false, content: 'c',
      pos: { startLine: 2, endLine: 2, startColumn: 1, endColumn: 5, startOffset: 4, endOffset: 8 },
    })
  })

  it('writes a comment at its authored column and keeps the visible layout on readback', () => {
    const written = carveToCarve(source)
    expect(written).toBe(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    const quote = '> a\n%% c\nb\n'
    expect(carveToCarve(quote)).toBe(quote)
    expect(carveToHtml(carveToCarve(quote))).toBe(carveToHtml(quote))
  })

  it('registers erased definitions document-wide', () => {
    expect(carveToHtml('[go][r]\n[r]: /u\nmore')).toBe('<p><a href="/u">go</a>\nmore</p>')
    expect(carveToHtml('para\n*[AB]: Alpha Beta\nAB')).toBe('<p>para\n<abbr title="Alpha Beta">AB</abbr></p>')
  })

  it.each(['%% c', '[r]: /u', '*[A]: B'])('keeps a marker-line note quote split across %s', (invisible) => {
    const source = `[^n]: > a\n      > ${invisible}\n      > b\n\nsee[^n]\n`
    const html = carveToHtml(source)
    expect(html).toContain('<blockquote>\n        <p>a</p>\n        <p>b</p>\n      </blockquote>')
    expect(html).not.toContain('&gt;')
    const written = carveToCarve(source)
    expect(carveToHtml(written)).toBe(html)
    expect(carveToCarve(written)).toBe(written)
    if (invisible === '%% c') expect(written).toContain('      > %% c\n')
  })

  it('keeps spans, footnotes and attribute lines block-level', () => {
    expect(carveToHtml('para\n%%%\nhidden\n%%%\nmore')).toBe('<p>para</p>\n<p>more</p>')
    expect(carveToHtml('para\n{.x}\nmore')).toBe('<p>para</p>\n<p class="x">more</p>')
  })

  it('reports parser diagnostics once from the visible layout', () => {
    let reports = 0
    parse('%% c\n::: note\nbody', { onUnclosedContainer: () => { reports++ } })
    expect(reports).toBe(1)
  })

  it('keeps erased nodes in source order across a shared paragraph', () => {
    const nodes = parse('a\n%% one\n*[AB]: x\n%% two\nb').children
    expect(nodes.map((node) => node.type)).toEqual([
      'paragraph', 'comment', 'abbreviation_def', 'comment',
    ])
    expect(nodes.slice(1).map((node) => node.pos?.startLine)).toEqual([2, 3, 4])
  })

  it('keeps AST edits when an unrepresented line needs source recovery', () => {
    const source = '- a\n  [^f]: t\n[^f]: a\n     [r]: /url\n[r][]\n'
    const written = canonicalCarveWrite(source, {}, (document) => {
      const list = document.children[0]
      if (list?.type !== 'list') return false
      const paragraph = list.items[0]?.children[0]
      if (paragraph?.type !== 'paragraph' || paragraph.children[0]?.type !== 'text') return false
      paragraph.children[0].value = 'changed'
      return true
    })
    expect(written).toContain('- changed')
    expect(written).not.toBe(source)
  })

  it('keeps edits to text following a transparent comment', () => {
    const written = canonicalCarveWrite('a\n%% c\nb', {}, (document) => {
      const paragraph = document.children[0]
      if (paragraph?.type !== 'paragraph') return false
      const last = paragraph.children.at(-1)
      if (last?.type !== 'text') return false
      last.value = 'changed'
      return true
    })
    expect(written).toBe('a\n%% c\nchanged\n')
  })

  it('keeps comment placement when positions are disabled', () => {
    expect(carveToCarve('a\n%% c\nb', { positions: false })).toBe('a\n%% c\nb\n')
  })

  it('runs extension matchers only on the visible parse', () => {
    let calls = 0
    const extensions = [{ name: 'count', matchInline: () => { calls++; return null }, matchBlock: () => { calls++; return null } }]
    parse('a\nb', { extensions })
    const visibleCalls = calls
    calls = 0
    parse('a\n%% c\nb', { extensions })
    expect(calls).toBe(visibleCalls)
  })

  it('keeps a comment between adjacent list items', () => {
    const source = '- a\n%% c\n- b\n'
    expect(carveToCarve(source)).toBe(source)
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('keeps a comment inside a definition description', () => {
    const source = ':: t\n: a\n  %% c\n  b\n'
    const list = parse(source).children[0]
    expect(list?.type).toBe('definition_list')
    if (list?.type !== 'definition_list') return
    const description = list.items[0]?.definitions[0]
    expect(description?.map((node) => node.type)).toEqual(['paragraph', 'comment'])
    expect(description?.[1]?.pos?.startLine).toBe(3)
    expect(carveToCarve(source)).toBe(source)
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('keeps comments between definition descriptions at their authored line', () => {
    const source = ':: t\n: a\n  %% c\n: b\n'
    expect(carveToCarve(source)).toBe(source)
    expect(renderCarve(parse(source))).toBe(source)
  })

  it('keeps abbreviation definition order across description readback', () => {
    const source = ':: t\n: a\n  *[AB]: old\n: b\n*[AB]: new\nAB\n'
    const written = renderCarve(parse(source))
    expect(written).toBe(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(written).toContain('*[AB]: old\n: b\n*[AB]: new')
    expect(renderCarve(fromAstJson(carveToAstJson(source)))).toBe(source)
  })

  it('reconstructs paragraph placement from AST wire positions', () => {
    const source = ':: t\n: d\n  *[A]: a\ntail\n'
    expect(renderCarve(fromAstJson(carveToAstJson(source)))).toBe(renderCarve(parse(source)))
  })

  it('reconstructs list item placement from AST wire positions', () => {
    const source = '- AB\n*[AB]: first\n- AB\n*[AB]: second\nAB\n'
    const written = renderCarve(fromAstJson(carveToAstJson(source)))
    expect(written).toBe(renderCarve(parse(source)))
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  it('keeps a trailing erased quoted line in its authored quote', () => {
    const source = '> a\n> %% c\nb\n'
    const quote = parse(source).children[0]
    expect(quote?.type).toBe('block_quote')
    if (quote?.type !== 'block_quote') return
    expect(quote.children.map((node) => node.type)).toEqual(['paragraph', 'comment'])
    expect(quote.pos?.endLine).toBe(2)
    expect(carveToHtml(renderCarve(parse(source)))).toBe(carveToHtml(source))
    expect(carveToCarve(source)).toContain('> a\n> %% c\n')
    expect(renderCarve(fromAstJson(carveToAstJson(source)))).toContain('> a\n> %% c\n')
  })

  it('reconstructs a footnote comment from AST wire positions', () => {
    const source = '[^a]: intro\n  %% c\n  more\n\nuse[^a]\n'
    const direct = renderCarve(parse(source))
    const wire = renderCarve(fromAstJson(carveToAstJson(source)))
    expect(wire).toBe(direct)
    expect(wire).toContain('  %% c\n')
  })

  it('writes edits to restored transparent nodes', () => {
    expect(canonicalCarveWrite('a\n%% old\nb', {}, (document) => {
      const comment = document.children.find((node) => node.type === 'comment')
      if (!comment || comment.type !== 'comment') return false
      comment.content = 'new'
      return true
    })).toBe('a\n%% new\nb\n')
    expect(canonicalCarveWrite('a\n*[AB]: old\nb', {}, (document) => {
      const definition = document.children.find((node) => node.type === 'abbreviation_def')
      if (!definition || definition.type !== 'abbreviation_def') return false
      definition.expansion = 'new'
      return true
    })).toBe('a\n*[AB]: new\nb\n')
  })

  it('keeps a comment after a multiline inline node', () => {
    const source = 'a *b\nc*\n%% c\nd\n'
    expect(carveToCarve(source)).toBe(source)
    expect(carveToCarve(source, { positions: false })).toBe(source)
  })

  it('keeps writer placement records out of the public AST', () => {
    expect(JSON.stringify(toAstJson(parse('a\n%% c\nb')))).not.toContain('transparent')
  })
})
