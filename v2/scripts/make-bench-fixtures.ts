// Writes the documents of v2/scripts/bench-engines.ts to v2/test/fixtures/bench-engines/: `prose`, `lists-tables` and
// `reference-heavy`, each as `.crv`, `.md` and `.dj` with the same content and structure. A seeded generator builds one
// block list per document and three writers spell it, so the files differ only in syntax. The Markdown twin is GFM:
// pipe tables and footnotes. Run it again after changing a writer and commit the output.
//   node v2/scripts/make-bench-fixtures.ts [--out DIR]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Inline =
  | { kind: 'text', text: string }
  | { kind: 'em' | 'strong' | 'code', text: string }
  | { kind: 'link', text: string, url: string }
  | { kind: 'ref', text: string, label: string }
  | { kind: 'note', label: string }

interface Item {
  text: Inline[]
  sub: List | null
}

interface List {
  ordered: boolean
  items: Item[]
}

type Block =
  | { kind: 'heading', level: number, text: Inline[] }
  | { kind: 'para', text: Inline[] }
  | { kind: 'list', list: List }
  | { kind: 'quote', paras: Inline[][] }
  | { kind: 'code', lang: string, lines: string[] }
  | { kind: 'table', head: Inline[][], rows: Inline[][][] }
  | { kind: 'rule' }
  | { kind: 'definition', label: string, url: string }
  | { kind: 'footnote', label: string, text: Inline[] }

interface Syntax {
  em: string
  strong: string
  /** Header cells of a table, as one line or two. */
  tableHead: (cells: string[]) => string[]
}

const CARVE: Syntax = { em: '/', strong: '*', tableHead: (cells) => [`|= ${cells.join(' |= ')} |`] }
const MARKDOWN: Syntax = { em: '*', strong: '**', tableHead: (cells) => [row(cells), `|${cells.map(() => '---').join('|')}|`] }
const DJOT: Syntax = { em: '_', strong: '*', tableHead: MARKDOWN.tableHead }

const WORDS = (
  'parser renders source block inline token reader writer table column value input output stream buffer node tree ' +
  'document heading paragraph quote list item marker fence label anchor footnote reference engine syntax spelling ' +
  'record field option profile render change number letter section measure sample round median window budget ' +
  'careful simple steady quiet early later often rarely always never every other plain small large narrow wide'
).split(' ')

const IDENTIFIERS = ['parseBlock()', 'renderHtml', 'eventLength', 'scanInline()', 'tree.children', 'state.depth', 'MAX_DEPTH']
const LANGUAGES = ['js', 'python', 'rust', 'php']

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Generator {
  private readonly next: () => number
  private definitions = 0
  private notes = 0
  readonly pendingDefinitions: Block[] = []
  readonly pendingNotes: Block[] = []

  constructor(seed: number) {
    this.next = random(seed)
  }

  int(below: number): number {
    return Math.floor(this.next() * below)
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(values.length)]!
  }

  words(count: number): string {
    return Array.from({ length: count }, () => this.pick(WORDS)).join(' ')
  }

  /** A sentence; `refs` adds reference links and footnote calls, whose definitions wait in the pending lists. */
  sentence(refs: boolean): Inline[] {
    const out: Inline[] = [{ kind: 'text', text: capitalized(this.words(2 + this.int(4))) }]
    const parts = 2 + this.int(4)
    for (let at = 0; at < parts; at++) {
      out.push({ kind: 'text', text: ` ${this.words(1 + this.int(4))} ` })
      out.push(this.span(refs))
    }
    out.push({ kind: 'text', text: ` ${this.words(1 + this.int(3))}.` })
    return out
  }

  span(refs: boolean): Inline {
    const roll = this.int(refs ? 8 : 6)
    if (roll === 0) return { kind: 'em', text: this.words(1 + this.int(2)) }
    if (roll === 1) return { kind: 'strong', text: this.words(1 + this.int(2)) }
    if (roll === 2) return { kind: 'code', text: this.pick(IDENTIFIERS) }
    if (roll === 3) return { kind: 'link', text: this.words(1 + this.int(3)), url: `https://example.com/${this.pick(WORDS)}/${this.int(100)}` }
    if (roll === 6) return this.reference()
    if (roll === 7) return this.footnote()
    return { kind: 'text', text: this.words(2) }
  }

  reference(): Inline {
    const label = `ref-${++this.definitions}`
    this.pendingDefinitions.push({ kind: 'definition', label, url: `https://example.org/${this.pick(WORDS)}/${this.definitions}` })
    return { kind: 'ref', text: this.words(1 + this.int(3)), label }
  }

  footnote(): Inline {
    const label = `note-${++this.notes}`
    this.pendingNotes.push({ kind: 'footnote', label, text: this.sentence(false) })
    return { kind: 'note', label }
  }

  paragraph(refs: boolean): Block {
    const text: Inline[] = []
    const count = 2 + this.int(4)
    for (let at = 0; at < count; at++) {
      if (at > 0) text.push({ kind: 'text', text: ' ' })
      text.push(...this.sentence(refs))
    }
    return { kind: 'para', text }
  }

  heading(level: number): Block {
    return { kind: 'heading', level, text: [{ kind: 'text', text: capitalized(this.words(2 + this.int(4))) }] }
  }

  list(depth: number): List {
    const items: Item[] = []
    const count = 2 + this.int(4)
    for (let at = 0; at < count; at++) {
      const text: Inline[] = [{ kind: 'text', text: `${capitalized(this.words(2 + this.int(3)))} ` }, this.span(false)]
      items.push({ text, sub: depth < 2 && this.int(3) === 0 ? this.list(depth + 1) : null })
    }
    return { ordered: this.int(2) === 0, items }
  }

  table(): Block {
    const columns = 2 + this.int(3)
    const head = Array.from({ length: columns }, () => [{ kind: 'text', text: capitalized(this.pick(WORDS)) } as Inline])
    const cell = (): Inline[] => (this.int(4) === 0 ? [this.span(false)] : [{ kind: 'text', text: this.words(1 + this.int(2)) }])
    const rows = Array.from({ length: 3 + this.int(5) }, () => Array.from({ length: columns }, cell))
    return { kind: 'table', head, rows }
  }

  code(): Block {
    const name = this.pick(IDENTIFIERS).replace(/\W/g, '')
    const lines = [`function ${name}(value) {`]
    for (let at = this.int(5); at >= 0; at--) lines.push(`  value = value + ${this.int(100)}`)
    lines.push('  return value', '}')
    return { kind: 'code', lang: this.pick(LANGUAGES), lines }
  }

  quote(): Block {
    return { kind: 'quote', paras: Array.from({ length: 1 + this.int(2) }, () => this.sentence(false)) }
  }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

function inline(nodes: Inline[], syntax: Syntax): string {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'text': return node.text
      case 'em': return `${syntax.em}${node.text}${syntax.em}`
      case 'strong': return `${syntax.strong}${node.text}${syntax.strong}`
      case 'code': return `\`${node.text}\``
      case 'link': return `[${node.text}](${node.url})`
      case 'ref': return `[${node.text}][${node.label}]`
      case 'note': return `[^${node.label}]`
    }
  }).join('')
}

/** `text` broken at spaces into lines of at most 80 columns. A link or code span may hold a space, so it never breaks inside one. */
function wrap(nodes: Inline[], syntax: Syntax, prefix: string): string[] {
  const lines: string[] = []
  let line = ''
  for (const piece of nodes.flatMap((node) => (node.kind === 'text' ? node.text.split(/(?= )/) : [inline([node], syntax)]))) {
    const word = line === '' ? piece.trimStart() : piece
    if (line !== '' && word.startsWith(' ') && prefix.length + line.length + word.length > 80) {
      lines.push(prefix + line)
      line = word.trimStart()
    } else {
      line += word
    }
  }
  if (line !== '') lines.push(prefix + line)
  return lines
}

/** A list, nested lists indented under the text of their item. Djot needs a blank line before a nested list. */
function list(value: List, syntax: Syntax, indent: string): string[] {
  const lines: string[] = []
  value.items.forEach((item, at) => {
    const marker = value.ordered ? `${at + 1}. ` : '- '
    lines.push(`${indent}${marker}${inline(item.text, syntax)}`)
    if (item.sub === null) return
    if (syntax === DJOT) lines.push('')
    lines.push(...list(item.sub, syntax, indent + ' '.repeat(marker.length)))
  })
  return lines
}

function block(value: Block, syntax: Syntax): string[] {
  switch (value.kind) {
    case 'heading': return [`${'#'.repeat(value.level)} ${inline(value.text, syntax)}`]
    case 'para': return wrap(value.text, syntax, '')
    case 'list': return list(value.list, syntax, '')
    case 'quote': return value.paras.flatMap((para, at) => [...(at > 0 ? ['>'] : []), ...wrap(para, syntax, '> ')])
    case 'code': return ['```' + value.lang, ...value.lines, '```']
    case 'table': return [
      ...syntax.tableHead(value.head.map((cell) => inline(cell, syntax))),
      ...value.rows.map((cells) => row(cells.map((cell) => inline(cell, syntax)))),
    ]
    case 'rule': return ['***']
    case 'definition': return [`[${value.label}]: ${value.url}`]
    case 'footnote': return [`[^${value.label}]: ${inline(value.text, syntax)}`]
  }
}

function spell(blocks: Block[], syntax: Syntax): string {
  return blocks.map((value) => block(value, syntax).join('\n')).join('\n\n') + '\n'
}

/** Blocks from `section` until the Carve spelling reaches `bytes`. */
function grow(bytes: number, section: (index: number) => Block[]): Block[] {
  const blocks: Block[] = []
  for (let index = 0; Buffer.byteLength(spell(blocks, CARVE)) < bytes; index++) blocks.push(...section(index))
  return blocks
}

function prose(): Block[] {
  const g = new Generator(1)
  return [g.heading(1), ...grow(30_000, (index) => [
    ...(index % 4 === 0 ? [g.heading(2)] : [g.heading(3)]),
    ...Array.from({ length: 2 + g.int(3) }, () => g.paragraph(false)),
  ])]
}

function listsTables(): Block[] {
  const g = new Generator(2)
  const kinds = [
    (): Block => ({ kind: 'list', list: g.list(0) }),
    (): Block => g.table(),
    (): Block => g.quote(),
    (): Block => g.code(),
  ]
  return [g.heading(1), ...grow(20_000, (index) => [
    g.heading(2),
    g.paragraph(false),
    kinds[index % kinds.length]!(),
    kinds[(index + 1 + g.int(3)) % kinds.length]!(),
    ...(index % 5 === 4 ? [{ kind: 'rule' } as Block] : []),
  ])]
}

function referenceHeavy(): Block[] {
  const g = new Generator(3)
  const blocks = [g.heading(1), ...grow(13_000, (index) => [
    g.heading(2 + (index % 3)),
    g.paragraph(true),
    ...(index % 2 === 0 ? [g.paragraph(true)] : []),
  ])]
  return [...blocks, ...g.pendingDefinitions, ...g.pendingNotes]
}

const at = process.argv.indexOf('--out')
const out = at >= 0 ? process.argv[at + 1]! : join(import.meta.dirname, '../test/fixtures/bench-engines')
mkdirSync(out, { recursive: true })
const documents: [string, Block[]][] = [['prose', prose()], ['lists-tables', listsTables()], ['reference-heavy', referenceHeavy()]]
for (const [name, blocks] of documents) {
  for (const [extension, syntax] of [['crv', CARVE], ['md', MARKDOWN], ['dj', DJOT]] as const) {
    writeFileSync(join(out, `${name}.${extension}`), spell(blocks, syntax))
  }
  console.log(`${name}: ${Buffer.byteLength(spell(blocks, CARVE))} bytes of Carve`)
}
