import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve, migrateMarkdown, parse } from '../src/index.js'
import { run, type CliIO } from '../src/cli.js'

const imported = (markdown: string) => markdownToCarve(markdown).replace(/\n+$/, '')

describe('a GitHub alert blockquote', () => {
  it.each([
    ['NOTE', 'note', 'Note'],
    ['TIP', 'tip', 'Tip'],
    ['IMPORTANT', 'info', 'Info'],
    ['WARNING', 'warning', 'Warning'],
    ['CAUTION', 'danger', 'Danger'],
  ])('imports [!%s] as a %s admonition', (label, kind, name) => {
    const carve = imported(`> [!${label}]\n> Back up first.`)
    expect(carve).toBe(`::: ${kind}\nBack up first.\n:::`)
    expect(carveToHtml(carve).trim()).toBe(`<aside class="admonition ${kind}" aria-label="${name}">\n  <p>Back up first.</p>\n</aside>`)
  })

  it('keeps block content of the body', () => {
    const markdown = [
      '> [!WARNING]',
      '>',
      '> First paragraph.',
      '>',
      '> - one',
      '> - two',
      '>',
      '> ```js',
      '> const x = 1',
      '> ```',
    ].join('\n')
    const carve = imported(markdown)
    expect(carve).toBe('::: warning\nFirst paragraph.\n\n- one\n- two\n\n```js\nconst x = 1\n```\n:::')
    const html = carveToHtml(carve)
    expect(html).toContain('<aside class="admonition warning" aria-label="Warning">')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<code class="language-js">const x = 1\n</code>')
  })

  it('keeps a quote inside the body, alert-shaped or not', () => {
    expect(imported('> [!NOTE]\n> outer\n>\n> > [!TIP]\n> > inner')).toBe('::: note\nouter\n\n> [!TIP]\n> inner\n:::')
  })

  it('takes a lazy continuation line into the body', () => {
    expect(imported('> [!NOTE]\nlazy')).toBe('::: note\nlazy\n:::')
  })

  it('keeps a literal colon fence in the body escaped', () => {
    const carve = imported('> [!NOTE]\n> ::: tip\n> t\n> :::')
    expect(carve).toBe('::: note\n\\::: tip\nt\n\\:::\n:::')
    expect(parse(carve).children.map(node => node.type)).toEqual(['admonition'])
  })

  it('is a writer fixed point', () => {
    const carve = markdownToCarve('# T\n\n> [!CAUTION]\n> - a\n> - b\n\ntext\n')
    expect(carveToCarve(carve)).toBe(carve)
  })

  it.each([
    ['a lowercase label', '> [!note]\n> x'],
    ['a mixed-case label', '> [!Note]\n> x'],
    ['an unknown label', '> [!FOO]\n> x'],
    ['text after the label', '> [!TIP] hi\n> x'],
    ['the label not on the first line', '> x\n> [!NOTE]'],
    ['an escaped label', '> \\[!NOTE]\n> x'],
    ['an empty body', '> [!CAUTION]'],
    ['an empty body with blank quote lines', '> [!CAUTION]\n>\n>'],
    ['a hard break after the label', '> [!TIP]  \n> x'],
  ])('stays a quote for %s', (_, markdown) => {
    const carve = imported(markdown)
    expect(carve.startsWith('>')).toBe(true)
    expect(parse(carve).children.map(node => node.type)).toEqual(['block_quote'])
  })

  it.each([
    ['in a list item', '- > [!NOTE]\n  > x', 'list'],
    ['in another quote', '> > [!NOTE]\n> > x', 'block_quote'],
  ])('stays a quote nested %s', (_, markdown, outer) => {
    const document = parse(imported(markdown))
    expect(document.children.map(node => node.type)).toEqual([outer])
    expect(JSON.stringify(document)).not.toContain('"admonition"')
  })
})

describe('the migration report for a GitHub alert', () => {
  it('records the conversion as normalized at the quote line', () => {
    const { value, report } = migrateMarkdown('# T\n\n> [!IMPORTANT]\n> Read this.\n')
    expect(value).toBe('# T\n\n::: info\nRead this.\n:::\n')
    expect(report.diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(false)
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'markdown-github-alert', severity: 'info', fidelity: 'normalized', confidence: 'exact', path: 'line:3',
    }))
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'markdown-paragraph', path: 'line:4' }))
    expect(report.diagnostics.some(row => row.code === 'markdown-block-quote')).toBe(false)
  })

  it.each([
    ['only a lazy continuation line', '> [!NOTE]\nlazy\n', '::: note\nlazy\n:::\n'],
    ['two spaces after the marker', '>  [!NOTE]\n> x\n', '::: note\nx\n:::\n'],
  ])('records the conversion for a body of %s', (_, markdown, carve) => {
    const { value, report } = migrateMarkdown(markdown)
    expect(value).toBe(carve)
    expect(report.diagnostics.map(row => [row.code, row.fidelity, row.path])).toEqual([
      ['markdown-github-alert', 'normalized', 'line:1'],
      ['markdown-paragraph', 'preserved', 'line:2'],
    ])
  })

  it.each([
    ['opening the document', '>\n> [!NOTE]\n> x\n', '> [!NOTE]\n> x\n', 1],
    ['after a heading', '# T\n\n>\n> [!NOTE]\n> x\n', '# T\n\n> [!NOTE]\n> x\n', 3],
  ])('keeps a quote with an empty line above the label %s', (_, markdown, carve, line) => {
    const { value, report } = migrateMarkdown(markdown)
    expect(value).toBe(carve)
    expect(report.diagnostics.filter(row => row.code !== 'markdown-atx-heading').map(row => [row.code, row.fidelity, row.path])).toEqual([
      ['markdown-block-quote', 'preserved', `line:${line}`],
      ['markdown-paragraph', 'preserved', `line:${line + 1}`],
      ['markdown-soft-break', 'preserved', `line:${line + 1}`],
    ])
  })

  it('reports a quote that stays a quote as a block quote', () => {
    const { report } = migrateMarkdown('> [!note]\n> x\n')
    expect(report.diagnostics.some(row => row.code === 'markdown-github-alert')).toBe(false)
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'markdown-block-quote', path: 'line:1' }))
  })
})

describe('carve migrate --from markdown with a GitHub alert', () => {
  it('writes the admonition and a passing report', async () => {
    let out = ''
    const files: Record<string, string> = {}
    const io: CliIO = {
      readStdin: async () => '> [!WARNING]\n> Back up first.\n',
      write: (s) => { out += s },
      writeErr: () => {},
      readFile: (p) => { throw new Error(`ENOENT: ${p}`) },
      writeFile: (p, c) => { files[p] = c },
    }
    expect(await run(['migrate', '--from', 'markdown', '--report', 'report.json', '--check-loss'], io)).toBe(0)
    expect(out).toBe('::: warning\nBack up first.\n:::\n')
    expect(JSON.parse(files['report.json']!).diagnostics[0]).toMatchObject({ code: 'markdown-github-alert', fidelity: 'normalized' })
  })
})
