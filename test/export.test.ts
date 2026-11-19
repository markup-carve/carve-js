// The Markdown, plain-text and ANSI exports (`@markup-carve/carve/export`): one call per format, the writers of the
// reserved targets, an output for every node type, the 0.1 writers on equivalent trees, and CommonMark block structure.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parse } from '../src/api.ts'
import { type DocumentNode, type Node } from '../src/ast.ts'
import { CarveOptionError } from '../src/options.ts'
import {
  CarveExportError, EXPORT_TARGETS, exportDocument, exportTargets, exportWriters, registerExports, toAnsi, toMarkdown, toPlainText,
} from '../public/export.ts'
import { createWriterRegistry, RESERVED_WRITER_TARGETS, type Writer } from '../public/writers.ts'

const root = join(import.meta.dirname, '..')
const ESC = '\x1b'

function md(source: string): string {
  return toMarkdown(parse(source)).output
}

function plain(source: string): string {
  return toPlainText(parse(source)).output
}

function ansi(source: string): string {
  return toAnsi(parse(source)).output
}

/** The ANSI output with its SGR sequences taken out, which is the text a terminal shows. */
function shown(source: string): string {
  return ansi(source).replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'gu'), '')
}

describe('the export calls', () => {
  it('return the text and the losses of the run in one result', () => {
    const result = toMarkdown(parse('::: x\nz\n:::\n'))
    expect(result.output).toBe('z\n')
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['markdown-container-flattened'])
    expect(result.diagnostics[0]).toMatchObject({ channel: 'render-loss', severity: 'warning', path: '/children/0' })
  })

  it('throw under strictLosses where the run lost something', () => {
    expect(() => toMarkdown(parse('```=latex\n\\x\n```\n'), { strictLosses: true })).toThrow(CarveExportError)
    expect(toMarkdown(parse('a\n'), { strictLosses: true }).output).toBe('a\n')
  })

  it('refuse an unknown option and a value of the wrong kind', () => {
    expect(() => toPlainText(parse('a'), { width: 80 } as never)).toThrow(CarveOptionError)
    expect(() => toAnsi(parse('a'), { smartTypography: 'yes' } as never)).toThrow(CarveOptionError)
    expect(() => toMarkdown(parse('a'), { urlPolicy: { deny: 'javascript' } } as never)).toThrow(CarveOptionError)
  })

  it('leave the tree they are given as it was', () => {
    const tree = parse('# H\n\nSee </#H>.\n')
    const before = JSON.stringify(tree)
    toMarkdown(tree)
    toAnsi(tree)
    expect(JSON.stringify(tree)).toBe(before)
  })

  it('refuse a value that is not a tree', () => {
    expect(() => toMarkdown({ type: 'paragraph' } as never)).toThrow()
  })

  it('write smart punctuation as the glyph, or as typed when smartTypography is false', () => {
    const tree = parse('a -- b...\n')
    expect(toPlainText(tree).output).toBe('a – b…\n')
    expect(toPlainText(tree, { smartTypography: false }).output).toBe('a -- b...\n')
  })

  it('blank a destination the URL policy denies and report it', () => {
    const byDefault = toMarkdown(parse('[a](javascript:x) [b](ftp://h/f)\n'))
    expect(byDefault.output).toBe('[a]() [b](ftp://h/f)\n')
    expect(byDefault.diagnostics.map((entry) => entry.code)).toEqual(['destination-denied'])
    expect(toMarkdown(parse('[b](ftp://h/f)\n'), { urlPolicy: { deny: ['ftp'] } }).output).toBe('[b]()\n')
  })
})

describe('the writer registry', () => {
  it('reserves markdown, plain and ansi for the exports', () => {
    expect(RESERVED_WRITER_TARGETS).toEqual(['markdown', 'plain', 'ansi'])
    expect(EXPORT_TARGETS).toEqual(['markdown', 'plain', 'ansi'])
    const writers = createWriterRegistry()
    for (const target of RESERVED_WRITER_TARGETS) expect(writers.has(target)).toBe(false)
    const impostor = { target: 'markdown', write: () => ({ output: '', diagnostics: [] }) } as Writer
    expect(() => writers.register(impostor)).toThrow(CarveOptionError)
  })

  it('takes the export writers, which write what the calls write', () => {
    const writers = registerExports(createWriterRegistry())
    expect(writers.targets()).toEqual(['html', 'carve', 'markdown', 'plain', 'ansi'])
    const tree = parse('# T\n\n*b* text\n')
    expect(writers.write('markdown', tree)).toEqual(toMarkdown(tree))
    expect(writers.write('plain', tree)).toEqual(toPlainText(tree))
    expect(writers.write('ansi', tree)).toEqual(toAnsi(tree))
    expect(exportWriters.map((writer) => writer.target)).toEqual(['markdown', 'plain', 'ansi'])
    expect(() => registerExports(writers)).toThrow(CarveOptionError)
  })

  it('writes by target name, and refuses an unknown target with the list of known ones', () => {
    expect(exportTargets()).toEqual(['html', 'carve', 'markdown', 'plain', 'ansi'])
    expect(exportDocument('plain', parse('*a*')).output).toBe('a\n')
    expect(exportDocument('html', parse('a')).output).toBe('<p>a</p>')
    expect(() => exportDocument('pdf', parse('a'))).toThrow(/known targets: html, carve, markdown, plain, ansi/u)
  })
})

describe('the Markdown export', () => {
  it.each([
    ['# Head', '# Head\n'],
    ['a *b* /c/ `d`', 'a **b** *c* `d`\n'],
    ['- [x] done\n- [ ] todo', '- [x] done\n- [ ] todo\n'],
    ['1. one\n2. two', '1. one\n2. two\n'],
    ['> q', '> q\n'],
    ['``` js\nx\n```', '```js\nx\n```\n'],
    ['a\n\n***\n\nb', 'a\n\n---\n\nb\n'],
    ['|= A |= B |\n| 1 | 2 |', '| A | B |\n| --- | --- |\n| 1 | 2 |\n'],
    ['{=mark=} {+ins+} {-del-}', '<mark>mark</mark> <ins>ins</ins> <del class="critic-delete">del</del>\n'],
    ['[t](https://e.x "T")', '[t](https://e.x "T")\n'],
    ['![a](i.png)', '![a](i.png)\n'],
    ['<https://a.b>', '<https://a.b>\n'],
    ['x[^n]\n\n[^n]: note', 'x[^n]\n\n[^n]: note\n'],
    ['::: note\nbody\n:::', 'body\n'],
    ['::: |\nl1\nl2\n:::', 'l1\\\nl2\n'],
    ['$`x`', '$x$\n'],
    ['[x]{abbr="Y"}', '<abbr title="Y">x</abbr>\n'],
    [':: t\n: d', '**t**\n\nd\n'],
    ['```=html\n<b>\n```', '&lt;b&gt;\n'],
    ['a\\\nb', 'a\\\nb\n'],
    ['snake_case and _x', 'snake_case and \\_x\n'],
    ['# H\n\nSee </#H>.', '# H\n\nSee [H](#h).\n'],
    ['- a\n%% #region x\n- b', '- a\n\n* b\n'],
    ['- a\n  - b', '- a\n  - b\n'],
    ['x {_y_}', 'x <u>y</u>\n'],
    ['`` a`b ``', '``a`b``\n'],
  ])('writes %j', (source, expected) => {
    expect(md(source)).toBe(expected)
  })

  it('keeps text from reading as a block of its own', () => {
    expect(md('a\n\\- b\n\\# c\n1\\. d')).toBe('a\n\\- b\n\\# c\n1\\. d\n')
  })

  it('writes an emphasis whose delimiters could not flank as its HTML element', () => {
    expect(md('x{*"y"*}')).toBe('x<strong>“y”</strong>\n')
  })

  it('writes a caption after its host and reports it', () => {
    const result = toMarkdown(parse('![p](p.png)\n^ Figure #: q\n'))
    expect(result.output).toBe('![p](p.png)\nFigure 1: q\n')
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['markdown-caption-flattened'])
  })
})

describe('the plain-text export', () => {
  it.each([
    ['# Head', 'Head\n'],
    ['a *b* /c/ `d`', 'a b c d\n'],
    ['- [x] done\n- [ ] todo', '- done\n- todo\n'],
    ['> q', '"q"\n'],
    ['|= A |= B |\n| 1 | 2 |', 'A | B\n1 | 2\n'],
    ['{-del-} {+ins+}', '~del~ ins\n'],
    ['x[^n]\n\n[^n]: note', 'x[n]\n\n[^n]: note\n'],
    ['*[HTML]: Hyper Text\n\nHTML here', 'HTML (Hyper Text) here\n'],
    ['@user #tag :smile:', '@user #tag :smile:\n'],
    ['::: |\na \\\nb\n:::', 'a \nb\n'],
    ['a\n%% c\nb', 'a b\n'],
  ])('writes %j', (source, expected) => {
    expect(plain(source)).toBe(expected)
  })

  it('reports raw content it drops', () => {
    const result = toPlainText(parse('```=html\n<b>\n```\n'))
    expect(result.output).toBe('\n')
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['raw-format-dropped'])
  })
})

describe('the ANSI export', () => {
  it('styles inline markup and resets after each run', () => {
    expect(ansi('a *b* /c/ `d`')).toBe(`a ${ESC}[1mb${ESC}[0m ${ESC}[3mc${ESC}[0m ${ESC}[93md${ESC}[0m\n`)
  })

  it('underlines the first two heading levels across their display width', () => {
    expect(shown('# 日本')).toBe('日本\n════\n')
    expect(shown('### x')).toBe('x\n')
  })

  it('draws a table in a box, its header row bold', () => {
    expect(shown('|= A |= B |\n| 1 | 22 |')).toBe('┌───┬────┐\n│ A │ B  │\n├───┼────┤\n│ 1 │ 22 │\n└───┴────┘\n')
  })

  it('marks every line of a quote with a bar and every task with its state', () => {
    expect(shown('> a\n>\n> b')).toBe('│ a\n\n│ b\n')
    expect(shown('- [x] a\n- [ ] b')).toBe('☑ a\n☐ b\n')
  })

  it('drops control characters of the author, which a terminal would act on', () => {
    const tree: DocumentNode = { type: 'document', astVersion: '2.0', children: [
      { type: 'paragraph', children: [{ type: 'text', value: `a${ESC}]0;x\u0007b` }] },
    ] }
    expect(toAnsi(tree).output).toBe('a]0;xb\n')
  })
})

/** Every node type in the trees of the specification examples. */
function nodeTypes(document: Node, into: Set<string>): void {
  into.add(document.type)
  for (const value of Object.values(document)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'object' && item !== null && 'type' in item) nodeTypes(item as Node, into)
    }
  }
}

describe('every node type', () => {
  const examples = (JSON.parse(readFileSync(join(root, 'spec/spec/0.2/conformance/examples.json'), 'utf8')) as {
    examples: { id: string, input?: string, options?: Record<string, unknown>, expected?: { tree?: DocumentNode } }[]
  }).examples

  it('has an output in all three exports for each specification example', () => {
    const seen = new Set<string>()
    let written = 0
    for (const example of examples) {
      const tree = example.expected?.tree
      if (tree === undefined) continue
      nodeTypes(tree, seen)
      for (const call of [toMarkdown, toPlainText, toAnsi]) {
        const result = call(tree)
        expect(typeof result.output, example.id).toBe('string')
        expect(call(tree), example.id).toEqual(result)
      }
      written++
    }
    expect(written).toBeGreaterThan(500)
    // The node types no example tree holds are the ones only a supplied tree carries.
    expect(seen.size).toBeGreaterThan(60)
  })
})

interface CommonmarkNode { type: string, level: number, listType: string, isContainer: boolean }
interface CommonmarkParser { parse(text: string): { walker(): { next(): { entering: boolean, node: CommonmarkNode } | null } } }
const { Parser } = createRequire(import.meta.url)('commonmark') as { Parser: new () => CommonmarkParser }

/** The block structure CommonMark reads from Markdown: each block's type, heading level and list kind, in order. */
function commonmarkBlocks(markdown: string): string[] {
  const walker = new Parser().parse(markdown).walker()
  const found: string[] = []
  for (let event = walker.next(); event !== null; event = walker.next()) {
    const node = event.node
    if (!event.entering || node.isContainer === false && node.type !== 'thematic_break' && node.type !== 'code_block') continue
    if (node.type === 'document' || node.type === 'text') continue
    if (node.type === 'heading') found.push(`heading${node.level}`)
    else if (node.type === 'list') found.push(`list-${node.listType}`)
    else if (['paragraph', 'block_quote', 'code_block', 'thematic_break', 'item'].includes(node.type)) found.push(node.type)
  }
  return found
}

/** The same structure read from the Carve tree. */
function carveBlocks(nodes: readonly Node[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'heading') into.push(`heading${node.level}`)
    else if (node.type === 'paragraph') into.push('paragraph')
    else if (node.type === 'block_quote') into.push('block_quote')
    else if (node.type === 'code_block') into.push('code_block')
    else if (node.type === 'thematic_break') into.push('thematic_break')
    else if (node.type === 'list') into.push(`list-${node.marker.kind === 'ordered' ? 'ordered' : 'bullet'}`)
    else if (node.type === 'list_item') into.push('item')
    if (node.type === 'block_quote' || node.type === 'list' || node.type === 'list_item' || node.type === 'section') carveBlocks(node.children, into)
  }
  return into
}

describe('Markdown read back by a CommonMark parser', () => {
  const PARTS = [
    '# Title', '## Sub *em*', 'Plain text with *strong* and `code`.', '- one\n- two', '1. first\n2. second', '> quoted',
    '``` js\nlet x = 1\n```', '***', '- item\n\n  > inside', '> - a\n> - b', '- [x] task', '3. three', 'Text with # hash, - dash and 1. one',
    'line one\nline two', '- outer\n  - inner', 'a_b_c and *x*', '> # quoted heading',
  ]

  it('keeps the block structure of the core constructs', () => {
    let documents = 0
    for (let a = 0; a < PARTS.length; a++) {
      for (let b = 0; b < PARTS.length; b++) {
        for (const c of [0, 2, 7]) {
          const source = `${PARTS[a]}\n\n${PARTS[b]}\n\n${PARTS[c]}\n`
          const tree = parse(source)
          expect(commonmarkBlocks(toMarkdown(tree).output), source).toEqual(carveBlocks(tree.children))
          documents++
        }
      }
    }
    expect(documents).toBe(PARTS.length * PARTS.length * 3)
  })
})

describe('the export guide', () => {
  it('runs every example', async () => {
    const guide = readFileSync(join(root, 'docs/export.md'), 'utf8')
    const dir = mkdtempSync(join(tmpdir(), 'carve-export-guide-'))
    const examples = [...guide.matchAll(/^```ts\n([\s\S]*?)^```$/gmu)].map((match) => match[1]!)
    expect(examples.length).toBeGreaterThanOrEqual(2)
    for (const [index, example] of examples.entries()) {
      const file = join(dir, `example-${index}.ts`)
      const code = example
        .replaceAll("'@markup-carve/carve/export'", JSON.stringify(pathToFileURL(join(root, 'public/export.ts')).href))
        .replaceAll("'@markup-carve/carve'", JSON.stringify(pathToFileURL(join(root, 'public/index.ts')).href))
      writeFileSync(file, code)
      await import(pathToFileURL(file).href)
    }
  })
})

// The 0.1 writers on the 0.1 corpus, against the exports of the 0.2 source the upgrade tool writes for each row whose
// HTML it proves unchanged. The differences that remain are the ones docs/export.md lists.
const engine01 = join(root, 'build/engine-0.1/index.js')
const corpus = join(root, 'spec/tests/corpus')

describe.skipIf(!existsSync(engine01) || !existsSync(corpus))('the 0.1 writers on equivalent trees', () => {
  it('agree on most of the corpus', { timeout: 240_000 }, async () => {
    type Render = (tree: unknown) => string
    const old = await import(pathToFileURL(engine01).href) as { parse: (source: string) => unknown, renderMarkdown: Render,
      renderPlainText: Render, renderAnsi: Render }
    const { upgrade } = await import(pathToFileURL(join(root, 'upgrade/src/upgrade.ts')).href) as {
      upgrade: (source: string) => { output: string, check: string } }
    const pairs: [string, Render, typeof toMarkdown][] = [
      ['markdown', old.renderMarkdown, toMarkdown], ['plain', old.renderPlainText, toPlainText], ['ansi', old.renderAnsi, toAnsi],
    ]
    const same: Record<string, number> = { markdown: 0, plain: 0, ansi: 0 }
    let rows = 0
    const files = readdirSync(corpus).filter((name) => name.endsWith('.crv')).sort().filter((_, at) => at % 3 === 0)
    for (const name of files) {
      const source = readFileSync(join(corpus, name), 'utf8')
      const upgraded = upgrade(source)
      if (upgraded.check !== 'pass') continue
      const before = old.parse(source)
      const tree = parse(upgraded.output)
      rows++
      for (const [target, write01, write02] of pairs) {
        if (write01(structuredClone(before)) === write02(tree).output) same[target]!++
      }
    }
    expect(rows).toBeGreaterThan(1000)
    expect(same['markdown']! / rows).toBeGreaterThan(0.9)
    expect(same['plain']! / rows).toBeGreaterThan(0.95)
    expect(same['ansi']! / rows).toBeGreaterThan(0.95)
  })
})
