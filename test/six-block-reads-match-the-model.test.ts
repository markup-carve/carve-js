import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

const html = (source: string): string => carveToHtml(source).trim()
const flat = (source: string): string => html(source).replace(/>\s+</g, '><')

describe('frontmatter format (carve#4387)', () => {
  it.each(['---_', '--- _', '---a_b'])('%s opens no frontmatter', (opener) => {
    expect(html(`${opener}\nk: v\n---\np\n`)).toContain('<hr>')
  })

  it('still opens on letters and digits', () => {
    expect(html('---yaml1\nk: v\n---\np\n')).toBe('<p>p</p>')
  })
})

describe('a losing duplicate footnote (carve#4087)', () => {
  it('still registers a definition nested in its body', () => {
    const out = html('[^g]: a\n\n[^g]: b\n  [^h]: inner\n\nx[^g] [^h]\n')
    expect(out).not.toContain('[^h]')
    expect(out).toContain('<li id="fn2">')
    expect(out).toContain('inner')
    expect(out).not.toContain('<p>b')
  })
})

describe('a comment-only continuation cell (carve#4088)', () => {
  it.each(['%% y', '%%%y%%%'])('%s adds no joining space', (cell) => {
    const source = `| a | b |\n+ x | ${cell} |\n`
    expect(html(source)).toContain('<td>b</td>')
    const row = (parse(source).children[0] as { rows: Array<{ cells: Array<{ children: Array<{ type: string }> }> }> }).rows[0]!
    expect(row.cells[1]!.children.map(child => child.type)).toEqual(['text', 'cell_wrap', 'comment'])
  })
})

describe('a marker-shaped caption continuation line (carve#4299)', () => {
  it.each(['- b', '* b', '1. b', 'a) b', '- [ ] b'])('keeps the indentation of %s', (line) => {
    expect(html(`|x|\n^ a\n  ${line}\n`)).toContain(`<caption>a\n  ${line}</caption>`)
  })

  it('reads the same under a code block', () => {
    expect(html('```\nx\n```\n^ a\n  - b\n')).toContain('<figcaption>a\n  - b</figcaption>')
  })
})

describe('a display-math span over several lines (carve#4115)', () => {
  it.each([
    ['$$`x\ny`\n^ p\n', '\\[x\ny\\]'],
    ['$$`x\ny\nz\n^ p\n', '\\[x\ny\nz\\]'],
    ['$$`x\ny`\n\n^ p\n', '\\[x\ny\\]'],
    ['$$`x\n- l\n^ p\n', '\\[x\n- l\\]'],
  ])('takes a caption: %j', (source, math) => {
    const out = flat(source)
    expect(out).toContain(math)
    expect(out).toContain('<figcaption>p</figcaption>')
  })

  it('keeps a caret line as text when other content shares the paragraph', () => {
    expect(flat('$$`x\ny` z\n^ p\n')).not.toContain('<figure>')
  })

  it('keeps its figure through the writer', () => {
    const source = '$$`x\ny`\n^ p\n'
    expect(html(renderCarve(parse(source)))).toBe(html(source))
  })
})

describe('an indented heading of only a form feed (carve#4405)', () => {
  it.each([' # \f\n', '  ## \f\n', '    # \f\n', '>  # \f\n', '- x\n\n   # \f\n'])('is a heading: %j', (source) => {
    expect(html(source)).toMatch(/<h[12][^>]*>\f<\/h[12]>/)
  })
})

describe('an invalid header-rows count (carve#4137)', () => {
  it('renders one body group with a row-scope header', () => {
    const out = flat('{header-rows=7}\n|= a |\n| b |\n')
    expect(out).not.toContain('<thead>')
    expect(out).toContain('<th scope="row">a</th>')
  })
})
