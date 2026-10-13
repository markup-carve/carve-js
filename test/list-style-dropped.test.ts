import { describe, expect, it } from 'vitest'
import {
  carveToAnsiWithReport,
  carveToHtml,
  carveToHtmlWithReport,
  carveToMarkdownWithReport,
  migrateMarkdown,
  parse,
  carveToPlainTextWithReport,
} from '../src/index.js'
import { run, type CliIO } from '../src/cli.js'

// CARVE-P2-024: Markdown numbers in decimal only, so an alpha or roman list
// keeps its start and delimiter and reports its style as lost.
describe('list-style-dropped on the Markdown target', () => {
  const styled: Array<[string, string, string]> = [
    ['a. one\na. two\n', '1. one\n2. two\n', 'lower-alpha'],
    ['A. one\n', '1. one\n', 'upper-alpha'],
    ['i. one\n', '1. one\n', 'lower-roman'],
    ['I. one\n', '1. one\n', 'upper-roman'],
    ['iv) x\nv) y\n', '4) x\n5) y\n', 'lower-roman'],
  ]

  for (const roundtrip of [false, true]) {
    for (const [source, markdown, style] of styled) {
      it(`reports ${style} for ${JSON.stringify(source)} (roundtrip ${roundtrip})`, () => {
        const result = carveToMarkdownWithReport(source, { roundtrip })
        if (roundtrip) {
          expect(result.value).toBe(`<!-- carve: ${source.split(' ')[0]} -->\n${markdown}`)
          expect(result.losses).toEqual([])
          expect(parse(migrateMarkdown(result.value).value).children[0]).toMatchObject({ type: 'list', olType: source[0] === 'a' ? 'a' : source[0] === 'A' ? 'A' : source[0] === 'I' ? 'I' : 'i' })
          return
        }
        expect(result.value).toBe(markdown)
        expect(result.losses).toHaveLength(1)
        const [loss] = result.losses
        expect(loss).toMatchObject({ code: 'list-style-dropped', target: 'markdown', nodeType: 'block', style })
        expect(loss).not.toHaveProperty('format')
        expect(loss!.pos).toBeDefined()
      })
    }
  }

  it('rejects a list-style marker separated from its list', () => {
    const result = migrateMarkdown('<!-- carve: a. -->\n\n1. one\n2. two\n')
    expect(result.report.diagnostics.filter(row => row.code === 'carrier-markers-damaged')).toHaveLength(1)
    expect(parse(result.value).children.find(node => node.type === 'list')).not.toHaveProperty('olType')
  })

  it('takes the start and delimiter from Markdown, and the style from the marker', () => {
    const result = migrateMarkdown('<!-- carve: a. -->\n4) one\n5) two\n')
    expect(parse(result.value).children[0]).toMatchObject({ type: 'list', ordered: true, olType: 'a', start: 4, delim: ')' })
    expect(result.report.diagnostics.filter(row => row.code.startsWith('carrier-marker'))).toEqual([])
  })

  it.each([
    'i. one\nj. two\n',
    'v. one\nvi. two\n',
    'V. one\nVI. two\n',
    '> a. q\n> b. r\n',
    '{.x}\na. one\nb. two\n',
  ])('restores a styled list and its host %j', source => {
    const exported = carveToMarkdownWithReport(source, { roundtrip: true })
    expect(exported.losses).toEqual([])
    const restored = migrateMarkdown(exported.value)
    expect(restored.report.diagnostics.filter(row => row.code.startsWith('carrier-marker'))).toEqual([])
    expect(carveToHtml(restored.value)).toBe(carveToHtml(source))
  })

  it('restores a styled list in a footnote body', () => {
    const source = '[^n]: text\n\n    a. one\n    b. two\nafter [^n]\n'
    const exported = carveToMarkdownWithReport(source, { roundtrip: true })
    const restored = migrateMarkdown(exported.value)
    expect(exported.losses).toEqual([])
    expect(restored.report.diagnostics.filter(row => row.code.startsWith('carrier-marker'))).toEqual([])
    expect(carveToHtml(restored.value)).toBe(carveToHtml(source))
  })

  it.each([
    '[^n]: text\n\n    - x\n\n      a. one\n',
    '[^n]: text\n\n    > a. one\n',
    '[^n]: a. one\n',
  ])('reports style loss where a footnote cannot carry its list %j', source => {
    const exported = carveToMarkdownWithReport(source, { roundtrip: true })
    expect(exported.losses.map(loss => loss.code)).toContain('list-style-dropped')
    expect(exported.value).not.toContain('<!-- carve: a. -->')
  })

  it('keeps adjacent styled lists separate with their authored delimiters', () => {
    const source = 'a. one\n\nI. two\n'
    const exported = carveToMarkdownWithReport(source, { roundtrip: true })
    expect(exported.value).toContain('<!-- carve: I. -->\n1. two')
    expect(exported.losses).toEqual([])
    expect(carveToHtml(migrateMarkdown(exported.value).value)).toBe(carveToHtml(source))
  })

  it('preserves a styled list before a plain ordered list', () => {
    const source = 'a. one\n\n1. two\n'
    const exported = carveToMarkdownWithReport(source, { roundtrip: true })
    expect(exported.value).toContain('<!-- carve: a. -->')
    expect(parse(migrateMarkdown(exported.value).value).children.find(node => node.type === 'list')).toMatchObject({ olType: 'a' })
  })

  it('rejects a separated list-style marker in a footnote body', () => {
    const markdown = '[^n]: text\n\n    <!-- carve: a. -->\n\n    1. one\n'
    expect(migrateMarkdown(markdown).report.diagnostics.filter(row => row.code === 'carrier-markers-damaged')).toHaveLength(1)
  })

  it('keeps a list item when its opening line carries a style marker', () => {
    const markdown = '- <!-- carve: a. -->\n  1. one\n  2. two\n- next\n'
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.map(row => row.code)).toContain('carrier-marker-dropped')
    expect(result.value).toContain('- `<!-- carve: a. -->`{=html}')
    expect(result.value).toContain('- next')
  })

  it('keeps an empty footnote definition when its body has a style marker', () => {
    const markdown = '[^n]:\n    <!-- carve: a. -->\n    1. one\n\nref [^n]\n'
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.map(row => row.code)).toContain('carrier-markers-damaged')
    expect(result.value).toContain('[^n]:')
  })

  it('reports later carrier losses on their original lines after footnote style preparation', () => {
    const markdown = '[^n]: text\n\n    <!-- carve: a. -->\n    1. one\n\nref [^n]\n\n<!-- carve:2 {.x} -->\n# H\n'
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.find(row => row.code === 'carrier-marker-dropped')?.path).toBe('line:8')
  })

  it('keeps a marker-shaped line literal in a footnote code fence', () => {
    const markdown = '[^n]: text\n\n    ```\n    <!-- carve: a. -->\n    1. one\n    ```\n'
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.filter(row => row.code.startsWith('carrier-marker'))).toEqual([])
    expect(result.value).toContain('<!-- carve: a. -->')
  })

  it('ignores footnote-looking text in a top-level code fence', () => {
    const markdown = '```\n[^n]: text\n\n    <!-- carve: a. -->\n    1. one\n```\n\n<!-- carve: {.k} -->\n# H\n'
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.filter(row => row.code.startsWith('carrier-marker'))).toEqual([])
    expect(parse(result.value).children.find(node => node.type === 'heading')?.attrs?.classes).toEqual(['k'])
  })

  it('keeps later carriers when a fence interrupts a footnote', () => {
    const markdown = '[^n]: t\n```\n[^m]: x\n\n    <!-- carve: a. -->\n    1. one\n```\n\n<!-- carve: {.k} -->\n# H\n'
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.filter(row => row.code === 'carrier-markers-damaged')).toEqual([])
    expect(parse(result.value).children.find(node => node.type === 'heading')?.attrs?.classes).toEqual(['k'])
  })

  it('reports one loss per list, in document order', () => {
    const { losses } = carveToMarkdownWithReport('a. x\n\n> I. quoted\n\n- y\n\n  i. nested\n')
    expect(losses.map(loss => loss.code === 'list-style-dropped' && loss.style)).toEqual(['lower-alpha', 'upper-roman', 'lower-roman'])
  })

  it('reports nothing for a decimal list', () => {
    expect(carveToMarkdownWithReport('1. a\n2. b\n').losses).toEqual([])
    expect(carveToMarkdownWithReport('1) a\n', { roundtrip: true }).losses).toEqual([])
  })

  it('reports nothing on the HTML, plain and ANSI targets', () => {
    for (const render of [carveToHtmlWithReport, carveToPlainTextWithReport, carveToAnsiWithReport]) {
      expect(render('a. one\ni. two\n').losses).toEqual([])
    }
  })

  it('is accepted by --allow-loss', async () => {
    let out = ''
    let err = ''
    const io: CliIO = {
      readStdin: async () => 'a. one\n',
      write: (s) => { out += s },
      writeErr: (s) => { err += s },
      readFile: (p) => { throw new Error(`ENOENT: ${p}`) },
      writeFile: () => {},
    }
    expect(await run(['render', '--markdown', '--strict-losses', '--allow-loss', 'list-style-dropped'], io)).toBe(0)
    expect(out).toBe('1. one\n')
    expect(err).toBe('')
  })
})
