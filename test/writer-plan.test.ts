// The planned writer (write-plan.ts): its tables come from the data files, it decides escapes with no
// parse, and where it decides a group it writes the bytes of the repair of C2-W-089.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARVE_SOURCES as EXAMPLES } from '../scripts/corpus.ts'
import { generateWriterTables } from '../scripts/generate-writer-tables.ts'
import { parseWithLayout } from '../src/api.ts'
import { format, formatWithDiagnostics } from '../src/index.ts'
import { writeTreeWithStats, type WriterPath } from '../src/write.ts'

const root = join(import.meta.dirname, '..')

function formatBy(source: string, path: WriterPath): ReturnType<typeof writeTreeWithStats> {
  const parsed = parseWithLayout(source, { extensions: [] })
  return writeTreeWithStats(parsed.document, { layout: parsed.layout }, path, false)
}

describe('the planned writer', () => {
  it('C2-W-088: src/write-tables.ts is what scripts/generate-writer-tables.ts writes', () => {
    const generated = generateWriterTables((file) => readFileSync(join(root, 'data', file), 'utf8'))
    expect(readFileSync(join(root, 'src/write-tables.ts'), 'utf8')).toBe(generated)
  })

  it('C2-W-010: where the plan decides a group, it writes the bytes of the repair, on every example input', () => {
    const differences: string[] = []
    let planned = 0
    for (const example of EXAMPLES) {
      const stats = formatBy(example.input, 'both').stats
      planned += stats.planned
      differences.push(...stats.differences)
    }
    expect(differences).toEqual([])
    expect(planned).toBeGreaterThan(300)
  })

  it('C2-W-089: a document whose every group the plan decides is written with no parse', () => {
    let documents = 0
    for (const example of EXAMPLES) {
      const stats = formatBy(example.input, 'plan').stats
      if (stats.repaired > 0) continue
      documents++
      expect(stats.parses, example.input).toBe(0)
    }
    expect(documents).toBeGreaterThan(200)
  })

  it('C2-W-089: a deep quote group enters repair without a failed check', () => {
    const source = readFileSync(join(import.meta.dirname, 'fixtures/plan-quote-depth.crv'), 'utf8')
    const parsed = parseWithLayout(source, { extensions: [] })
    const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', true)
    expect(result.stats.reasons.get('check') ?? 0).toBe(0)
    expect(result.stats.repaired).toBeGreaterThan(0)
    expect(result.output.diagnostics.some((diagnostic) => diagnostic.code === 'structure-unspellable')).toBe(false)
  })

  it('C2-I-023: a percent run directly after a bracket opener is planned as text', () => {
    const parsed = parseWithLayout('[%%\\ ]', { extensions: [] })
    const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', true)
    expect(result.stats.reasons.get('check') ?? 0).toBe(0)
    expect(result.stats.planned).toBeGreaterThan(0)
    expect(result.stats.repaired).toBe(0)
  })

  it('C2-I-023: a percent run after an escaped bang and a bracket is text', () => {
    const source = ']\\![%%]'
    const parsed = parseWithLayout(source, { extensions: [] })
    const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', false)
    expect(result.stats.planned).toBeGreaterThan(0)
    expect(result.stats.repaired).toBe(0)
    expect(formatWithDiagnostics(source).source).toBe(']![%%]\n')
  })

  it('C2-I-023: a percent run directly after a reference bracket stays in its folded key', () => {
    const source = '[[%%\n]][]'
    const result = formatWithDiagnostics(source, { normalize: true })
    expect(result.source).toBe(source + '\n')
    expect(result.diagnostics).toEqual([])
  })

  it('C2-W-011: a comment after an escaped bang and an unpaired bracket round-trips', () => {
    for (const source of ['x\\![ %%', 'x\\![\n%%']) {
      const result = formatWithDiagnostics(source)
      expect(result.diagnostics).toEqual([])
      expect(format(result.source)).toBe(result.source)
    }
  })

  it('C2-I-023: a percent run in an image label is text', () => {
    const source = '![[%%[\n]][]~'
    const result = formatWithDiagnostics(source, { normalize: true })
    expect(result.source).toBe(source + '\n')
    expect(result.diagnostics).toEqual([])
  })

  it('C2-I-023: nested brackets behind a percent run need no repair', () => {
    const source = '![[[%%[\n]][]]()~'
    for (const normalize of [false, true]) {
      const result = formatWithDiagnostics(source, { normalize })
      expect(result.source).toBe(source + '\n')
      expect(result.diagnostics).toEqual([])
    }
  })

  it('C2-I-023: a bracket later on an image percent line is text', () => {
    const result = formatWithDiagnostics('![[%%^[\n]][]~', { normalize: true })
    expect(result.source).toBe('![[%%^[\n]][]~\n')
    expect(result.diagnostics).toEqual([])
  })

  it('C2-W-089: prose, emphasis, links, lists, quotes, tables and code are planned with no parse', () => {
    const source = [
      '= Title', '', 'A paragraph with *strong*, /emphasis/, `code` and a [link](https://example.org "T").',
      'A second line, with {_underline_} and {^sup^}.', '', '- one', '- two', '', '> quoted', '',
      '| a | b |', '| c | d |', '', '```js', 'x = 1', '```', '',
    ].join('\n')
    const result = formatBy(source, 'plan')
    expect(result.output.source).toBe(source)
    expect(result.stats.repaired).toBe(0)
    expect(result.stats.parses).toBe(0)
  })

  // Each source is written by the plan alone, with the bytes the repair writes.
  const PLANNED: readonly [string, string][] = [
    ['C2-B-033: a marker before a tab is text', '-\ta\n'],
    ['C2-B-020: a list marker inside a quote of an item does not interrupt', '- > a\n  > - b\n'],
    ['C2-B-043: a bare dot before a dot and a space is no marker', '. . . and then silence\n'],
    ['C2-B-043: a bare dot before a dot that ends the line is a marker, so the text takes a backslash', '\\. .\n'],
    ['C2-B-092: an attribute-shaped later line is text', 'a\n{.x}\n'],
    ['C2-B-138: a line comment on a later line stays in the paragraph', 'a\n%% c\nb\n'],
    ['C2-B-166: a pipe line without a closing pipe is text', 'a\n| b\n'],
    ['C2-I-072: a bracket pair with nothing glued to it is text', 'x [a] y\n'],
    ['C2-I-073: an autolink of text takes its backslash, a broken one none', '\\<a:b> and <a b>\n'],
    ['C2-I-089: an inline footnote of text takes the backslash on its bracket', 'x ^\\[a] and ^[a\n'],
    ['C2-I-096: a cross-reference of text takes its backslash, an empty one none', '\\</#a> and </#>\n'],
    ['C2-I-104: straight quotes that read as smart quotes', 'a \'b\' c and it\'s, a "b" c\n'],
    ['C2-I-115: an arrow of one hyphen stays as typed', 'a <- b and \\<= c\n'],
    ['C2-I-074: an image sigil before a link of the tree, and before an open bracket', '\\![a](/u) and ![a\n'],
    ['C2-B-123: a line of a line block opens no block', '::: |\n- a\n# b\n  > c\n:::\n'],
    ['C2-B-135: in a line block `%%` is text', '::: |\n%% a\nb %% c\n:::\n'],
    ['C2-B-125: in a line block only a bare colon run closes', '::: |\n:: t\n::: x\n:::\n'],
    ['C2-B-069: a later line of a term continues like paragraph text', ':: t\n   - a\n   :: e\n   \\::: x\n: d\n'],
    ['C2-W-091: a text backtick before a code span takes its backslash behind other text openers', 'x< \\`{#`a` y\n'],
    ['C2-W-091: a text backtick before a code span behind an angle that opens nothing', 'x<a \\`b`a` c\n'],
    ['C2-B-167: a quote behind the last brace of a pipe line decides no row attribute', 'a\n| a |{*=}\'\n'],
    ['C2-B-167: a quote behind a row attribute after one space', 'a\n| a | {=\'\n'],
    ['C2-B-167: a quote glued behind a row attribute', '| a |{.c}\'\n'],
  ]
  for (const [clause, source] of PLANNED) {
    it(`${clause}, planned with no parse`, () => {
      const result = formatBy(source, 'plan')
      expect(result.output.source).toBe(source)
      expect(result.stats.repaired).toBe(0)
      expect(result.stats.parses).toBe(0)
      expect(formatBy(source, 'both').stats.differences).toEqual([])
    })
  }

  it('C2-W-016: a CR before a line end, in text or in the value of an atom, is planned as a reported loss', () => {
    for (const [source, path] of [['x %% c\r', '/children/0/children/1/value'], ['a\r \nb\n', '/children/0/children/0/value'],
      ['x %% c\r\t\n', '/children/0/children/1/value'], ['a\r\r\nb\n', '/children/0/children/0/value'],
      ["x'}/\\*\r", '/children/0/children/2/value']]) {
      const result = formatBy(source!, 'plan')
      expect(result.stats.planned, source).toBe(1)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.parses, source).toBe(0)
      expect(result.output.diagnostics.map((entry) => [entry.code, entry.path]), source).toEqual([['field-unspellable', path]])
    }
  })

  it('C2-B-010: a CR that other content follows on its line is no line end, and the plan writes it', () => {
    for (const source of ['a\rb\n', '`a\rb`\n', '```\na\rb\n```\n', 'x %% c\rd\n']) {
      const result = formatBy(source, 'both')
      expect(result.stats.planned, source).toBe(1)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-B-146, C2-B-149: a caption mark below a line of text or after a blank line is text, and the plan writes it bare', () => {
    for (const source of ['a\n\\^ b\n', '\\^ b\n', 'x\n\n\\^ b\n', '- a\n  \\^ b\n', 'a *b*\n\\^ c\n', '*x* ![i](u)\n\\^ b\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\^', '^'))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // C2-B-147, C2-B-157: below a paragraph that may still be a block image, the repair decides.
    for (const source of ['![i](u)\n\\^ b\n']) expect(formatBy(source, 'both').stats.planned, source).toBe(0)
  })

  it('C2-B-207: a text `#` of a caption before its number mark keeps its backslash in the formatted source', () => {
    for (const source of ['![b](b.png)\n^ Two \\# more\n', '![b](b.png)\n^ *Figure* 2. Two \\# more\n', '![b](b.png)\n^ a \\#\n']) {
      expect(format(source), source).toBe(source)
      expect(formatBy(source, 'plan').stats.planned, source).toBe(0)
    }
    // Behind the mark every `#` is text (C2-B-207), and a `#` inside markup is no mark.
    for (const source of ['![b](b.png)\n^ Fig # Two # more\n', '![b](b.png)\n^ *a #* b\n']) expect(format(source), source).toBe(source)
  })

  it('C2-B-166, C2-B-167: a pipe line where no pipe can close a row is text, and the plan writes it bare', () => {
    for (const source of ['\\| c | d\n', 'a\n\\| c | d\n', '\\| a |b\n', '\\| a |x %% c\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\|', '|'))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // A brace block or a line comment behind a pipe may make it the closing pipe, so the repair decides.
    for (const source of ['\\| a | {.x}\n', '\\| a |{.x}\n', '\\| a | %% c\n']) {
      expect(formatBy(source, 'both').stats.planned, source).toBe(0)
    }
  })

  it('C2-I-090, C2-I-063: a sigil before a closing brace behind text forms nothing, and the plan writes it bare', () => {
    for (const source of ['a @} b\n', 'a #} b\n', '#} x\n', '@}\n', '{#a#} #} x\n', 'x (#}) y\n', '*a*#} x\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-087: a bracket and a caret with no later `]` in the content open nothing, and the plan writes them bare', () => {
    for (const source of ['a \\[^b\n', '*a \\[^b*\n', 'a \\[^\n', 'a \\[^b\n\nc]\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\[', '['))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-078, C2-I-079: a label that starts with an at-sign or holds only blanks names no reference, and no bracket is escaped', () => {
    for (const source of ['[a][@]\n', '[[]][@]\n', '[a][@x]\n', '[a][ ]\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-028: a brace behind a host with no `}` on its line opens no attribute block, and the plan writes it bare', () => {
    for (const source of ['`a`\\{b\n', '`a`\\{b\nc}\n', '*a*\\{b c\n', '[a](/u)\\{\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\{', '{'))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    expect(formatBy('`a`\\{b}\n', 'both').stats.differences).toEqual([])
  })

  it('C2-B-119, C2-B-196: a colon run glued to a name is text, and the plan writes it bare', () => {
    // C2-B-033: a tab before further text leaves the line text too.
    for (const source of ['a\n\\:::x\n', '\\:::x\n', 'a\n\\::::x\n', '- a\n  \\:::x\n', 'a\n\\:::>\n', 'a\n\\:::\tx\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\:', ':'))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // A space or the line end behind the run makes a div line, so the colon keeps its backslash.
    for (const source of ['a\n\\::: x\n', 'a\n\\:::\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
    }
  })

  it('C2-B-137, C2-B-192, C2-W-088: refused attribute lines across comments need no escape', () => {
    for (const source of ['{.a}\n%% c\n{.b}\n', '{footer-rows=1}\n%% c\n%% d\n{.b}\n']) {
      expect(formatBy(source, 'both').output.source).toBe(source)
      expect(format(source)).toBe(source)
    }
  })

  it('C2-B-138: a comment-only line ends the content of an atom, and the openers before it are planned bare', () => {
    const sources = ['x `a\n%% b` y\n', 'x $`a\n%% b` y\n', '- x `a\n  %% b` y\n', '> x !`a\n> %% b` y\n']
    for (const source of [...sources, 'x {% a\n%% b %} y\n', 'x {#a\n%% b#} y\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      if (sources.includes(source)) expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-104, C2-I-106: behind a node, a quote sees what the reader sees there, and the plan writes it bare', () => {
    for (const source of ['x `c`\'s y\n', 'x *a*"b\n', 'x @a"b c\n', 'x <http://a.b>"b\n', 'x [^a]"b\n\n[^a]: n\n', 'x\\ "b c\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-017, C2-W-091: a text backtick before a code span that nothing before it can pair with is planned escaped', () => {
    for (const source of ['a \\` b `c`\n', 'a ``\n\n`c`\n', 'x \\` `c` `d`\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // Behind a mark of the tree, a delimiter or another backtick of text, the repair decides the order.
    for (const source of ['/a \\` b `c`/\n', '[a \\` `c`](/u)\n', '*a \\` `c`\n']) {
      expect(formatBy(source, 'both').stats.planned, source).toBe(0)
    }
  })

  it('C2-B-169, C2-I-017: a backtick of a cell is left to the repair, since a later cell of its row can close it', () => {
    const result = formatBy('| \\` | ` |\n', 'both')
    expect(result.output.source).toBe('| \\` | ` |\n')
    expect(result.stats.planned).toBe(0)
    expect(result.stats.reasons.get('check') ?? 0).toBe(0)
  })

  it('C2-B-024, C2-B-046, C2-B-081: a bracket at a line start is planned by the definition and task box shapes', () => {
    const sources = ['\\[a]: /u\n', 'x\n[a]: /u\n', '- \\[x] a\n', '- [x]\ta\n', '::: d\n[a]: /u\n:::\n', '> [a]: /u\n', '[a]: /u extra\n']
    for (const source of sources) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.reasons.has('line start ['), source).toBe(false)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-064, C2-I-040: a text bracket pair before a brace is planned by the attribute grammar of the reader', () => {
    for (const source of ['x \\[s]{.c} y\n', 'x [s]{ y\n', 'x [s]{???} y\n', 'x \\[[s]]{.c} y\n', 'x \\[s]{} y\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-B-119, C2-I-023: the quoted title of a div is planned as inline content, and `%%` in it is text', () => {
    const sources = ['::: note "a %% b"\nc\n:::\n', '::: tip "x [y] `c`"\nd\n:::\n', '::: d "T"\ne\n:::\n', '::: note "\\#a and \\@b"\nc\n:::\n']
    for (const source of sources) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-115, C2-I-117: a replaced run of signs takes the backslash on its first sign, and `=>` stays text', () => {
    for (const source of ['a \\==> b\n', 'a => b\n', 'a \\>= b\n', 'a == b\n', 'a \\<\\==> b\n', 'a \\!\\==> b\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-087, C2-I-079: a text `[^` before a label that is not blank opens a footnote reference and is planned escaped', () => {
    for (const source of ['a \\[^b] c\n', 'x \\[^a] y\n', 'x \\[^a b] y\n', 'x [^a\n', 'x [\\[^a] y\n', 'x \\[^a [b] c] y\n', 'x ^\\[^a] y\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // Before the `^[` of an inline footnote of the tree, and where the writer escaped the bracket, the repair decides.
    expect(formatBy('x\\[^[a] y\n', 'both').stats.planned).toBe(0)
    expect(formatBy('x[[^](/u)\n', 'both').output.source).toBe('x[[^](/u)\n')
    // C2-I-094, C2-I-074, C2-I-089: behind a text `:name`, `!` or `^` the bracket opens an extension, an image or an
    // inline footnote, not a reference.
    for (const source of ['x :B8[^ab] c\n', 'x![^a]\n', 'x![^[[]\n', 'x^[^[[]\n', 'x^[^![]\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-B-090, C2-B-091, C2-B-092: a first line that is an attribute line is escaped before a next line and bare alone', () => {
    for (const source of ['\\{.x}\nb\n', '{.x}\n', '\\{.x}{#y}\nb\n', '- \\{.x}\n  b\n', '> \\{.x}\n> b\n', '\\{.x}\n`c`\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // Stacked attribute lines are left to the repair.
    expect(formatBy('{.x}\n{.y}\n', 'both').stats.repaired).toBe(1)
  })

  it('C2-B-081, C2-B-082: a line that starts with a footnote reference of the tree opens no definition where its shape fails', () => {
    for (const source of ['[^1]:A bare\n', '[^a][^b]: x\n', '[^a]:x\n\n[^a]: y\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-115: a run of `=` holds no replaced run unless `==>` or `<==` reaches into it', () => {
    for (const source of ['a ====== b\n', 'a =\\==> b\n', 'x ===\\==> y\n', 'a \\<\\==> b\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    expect(formatBy('a \\<=== b\n', 'both').stats.repaired).toBe(1)
  })

  it('C2-I-063: a sigil of text before a closing brace is planned bare behind a node', () => {
    for (const source of ['x `a`#} y\n', 'x `a`@} y\n', 'x /a/#} y\n', 'x `a`\\#a y\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-B-081, C2-B-084, C2-B-024: a bracket pair before a colon opens a definition only where a first line starts one', () => {
    const sources = ['x [a]: y\n', 'x\n[a]: y\n', '> [a]: /u\n', '- [a]: /u\n', '= [a]: b\n', 'x [a]:\n', '\\*[A]: b\n', '*[a-b]: x\n']
    for (const source of sources) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-118: a text bracket pair past the depth cap is left to the repair, which keeps it bare', () => {
    const source = `${'['.repeat(210)}x${']'.repeat(210)}{.a}\n`
    const result = formatBy(source, 'both')
    expect(result.output.source).toBe(source)
    expect(result.stats.reasons.has('depth cap')).toBe(true)
    expect(result.stats.differences).toEqual([])
  })

  it('C2-B-190, C2-I-118: no block counts toward the inline cap, so brackets inside 100 quotes are planned', () => {
    for (const source of [`${'> '.repeat(100)}x ${'['.repeat(101)}a\n`, `${'> '.repeat(100)}x ${'['.repeat(101)}a${']'.repeat(101)} y\n`]) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    expect(formatBy(`${'> '.repeat(100)}x ${'['.repeat(201)}a\n`, 'both').stats.reasons.has('depth cap')).toBe(true)
  })

  it('C2-W-091: a backtick behind a delimiter of text is left to the repair, which escapes the delimiter first', () => {
    const result = formatBy('*\\`*𫐍`*\n', 'both')
    expect(result.output.source).toBe('\\*\\`*𫐍`*\n')
    expect(result.stats.differences).toEqual([])
  })

  it('C2-I-033, C2-I-005: a text brace block whose quoted value holds a closing brace is opaque as a whole', () => {
    for (const source of ["{k='}'}\n", '{k="}"}\n', "x {k='}'} y\n"]) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-B-033: a bare list marker at a line start is text, so it is planned bare', () => {
    for (const source of ['-\n', 'a\n-\n', '1.\n', '> -\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-B-190: past the block cap the opener of a container is text, and the plan writes it bare', () => {
    for (const tail of ['> a', '- a', '1. a', ': d']) {
      const source = `${'> '.repeat(200)}${tail}\n`
      const result = formatBy(source, 'both')
      expect(result.output.source, tail).toBe(source)
      expect(result.stats.repaired, tail).toBe(0)
      expect(result.stats.differences, tail).toEqual([])
    }
    const result = formatBy(`${'> '.repeat(200)}>\n`, 'both')
    expect(result.stats.repaired).toBe(0)
    expect(result.stats.differences).toEqual([])
    expect(result.output.source).toBe(`${'> '.repeat(200)}>\n`)
  })

  it('C2-B-190, C2-B-125: past the block cap a run of three colons may still close an outer div, so the plan does not take it', () => {
    const source = `:: \\\none\ntwo\n${'::::: \\\none\ntwo\n'.repeat(200)}:::`
    const parsed = parseWithLayout(source, { extensions: [] })
    const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', true)
    expect(result.stats.reasons.get('check') ?? 0).toBe(0)
  })

  it('C2-I-118: the open delimiters and brackets of a content count together, so a link behind 199 of them is planned', () => {
    const source = `${'*a '.repeat(199)}[x](u)\n`
    const result = formatBy(source, 'both')
    expect(result.output.source).toBe(source)
    expect(result.stats.repaired).toBe(0)
    expect(formatBy(`${'*a '.repeat(200)}[x](u)\n`, 'both').stats.planned).toBe(0)
  })

  it('C2-W-016: only a CR before a line feed or the end of the content joins a line end, so a CR before a CR is planned', () => {
    for (const source of ['a\r\rb\n', 'a\rb\r\rc\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-109: an inline footnote has its own run of single quotes, and the quotes around it are planned', () => {
    for (const source of ["a ^[it's x] b\n", "'a ^['b'] c' d\n", "a 'b ^[c' d] e' f\n", "x ^[a ^['b] c'] d\n"]) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-W-088, C2-W-090: a pair of two marks of text takes the backslash on its opener, as the procedure gives it', () => {
    // C2-I-050: a mark before a combining mark is text, and so is the brace before it, so no pair forms there.
    for (const source of ['a \\*b* c\n', 'a /b \\*c* d/ e\n', 'a \\*b* \\*c* d\n', '{,\u{fe0e}x,}\n', '{~\u{301}a~>b~} {~c~>d~}\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-055: behind a bare `{` of text the caret makes a braced opener, no footnote sigil, and the plan decides it', () => {
    for (const source of ['a {^b c\n', 'a \\{^b^} c\n', 'a {^[x] c\n', 'a {^\\[^a] c\n', 'a {^`c` d\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-069: a text bracket pair before a parenthesis with no closing one on its line forms no link and is planned bare', () => {
    for (const source of ['[a](b c\n', '![a](b c\n', 'x [a](b\nc\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-075, C2-I-079: a collapsed reference takes its label from its pair, so a blank one forms nothing', () => {
    for (const source of ['x[ ][]a\n', 'x\\[b][]a\n', 'x\\[@][]\n', 'x[\\ ][]a\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-028, C2-W-090: a brace of text behind a host takes the backslash where it would open an attribute block', () => {
    for (const source of ['*a*\\{.c} x\n', '`a`\\{k=v}\n', '*a*\\{.c}{.d}\n', '*a*{} b\n', '*a*{.c U-210#i} and\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // C2-I-036: a node that is no host, such as a non-breaking space, takes no block, and the brace stays bare.
    expect(formatBy('x\\ {a}\n', 'both').stats.differences).toEqual([])
    // C2-I-021: behind a code span `{=` may be a raw marker, which the attribute grammar does not read.
    expect(formatBy('x`a`{=\\_}\n', 'both').stats.differences).toEqual([])
  })

  it('C2-I-060, C2-I-111: a brace before a dash run with no closer of its mark in the leaf is text, and the plan writes it bare', () => {
    for (const source of ['a {-- b\n', 'a {--- b\n', 'a {... b\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    expect(formatBy('x {--}\n', 'both').stats.repaired).toBe(1)
  })

  it('C2-I-021: behind a host other than a plain code span, `{=` is a braced opener and no attribute block', () => {
    for (const source of ['*a*{=b=} c\n', '*a*{=b c\n', '*a*{=b}\n', '$`a`{=b}\n', '`a`{=html}\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-057, C2-W-099: a hyphen run of text before `}` with no `{-` before it closes nothing, and the plan escapes the run', () => {
    for (const source of ['a -\\-} b\n', 'a -\\--} b\n', '*a* -\\-}x\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    expect(formatBy('{-a -\\-} b\n', 'both').stats.repaired).toBe(1)
  })

  it('C2-B-024: a term mark on a later line of a paragraph inside an item is a lazy line, and the plan writes it bare', () => {
    for (const source of [':: a\n: b\n  :: c\n  # H\n', ':: a\n: b\n  :: c\n', ':: term\n: - a\n    :: sub\n: def\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-025: an unclosed brace of text behind a braced comment is text, and the plan writes it bare', () => {
    const result = formatBy('x/{%*%}\\{%<a:b>\n', 'both')
    expect(result.output.source).toBe('x/{% * %}{%<a:b>\n')
    expect(result.stats.planned).toBe(1)
    expect(result.stats.differences).toEqual([])
  })

  it('C2-B-101: a bullet before a brace leaves the group to the repair', () => {
    const result = formatBy('\\-{[^*} {x=1}[^^]\n', 'both')
    // C2-I-034: the block after the dash is no valid attribute block, so the line opens no item and the dash stays bare.
    expect(result.output.source).toBe('-{[^*} {x=1}[^^]\n')
    expect(result.stats.planned).toBe(0)
  })

  it('C2-W-097: a backslash of text left single before punctuation leaves the group to the repair', () => {
    const result = formatBy('x{%\\\'-\\\\*^[\n', 'both')
    expect(result.output.source).toBe('x{%\\\'-\\\\*^[\n')
    expect(result.stats.planned).toBe(0)
  })

  // `format` writes a planned group with no parse, so a block the plan cannot check goes to the repair.
  it('C2-W-002, C2-W-033: a container on the first line of a footnote is left to the repair, which writes it', () => {
    const parsed = parseWithLayout('[^f]: - :::', { extensions: [] })
    const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', false)
    expect(result.stats.planned).toBe(0)
    expect(result.output).toEqual({ source: '[^f]: - :::\n\n        :::\n', diagnostics: [] })
  })

  it('C2-W-099: a run of hyphens of text is planned with every second hyphen escaped', () => {
    const result = formatBy('a -\\-- b\n', 'both')
    expect(result.output.source).toBe('a -\\-- b\n')
    expect(result.stats.differences).toEqual([])
    expect(result.stats.repaired).toBe(0)
  })
})

// Shapes that the writer wrote in time above linear: each doubling of the input may at most
// multiply the time of the writer by 2.8 on average. The fastest of three runs is taken against the noise of the machine.
const STRESS_SHAPES: readonly [string, (n: number) => string][] = [
  ['unclosed braced emphasis openers', (n) => ` ${'{/a {/b /} { '.repeat(n)}\n`],
  ['braced strong around code spans', (n) => `${'{*a {*b `c` *} {*a {*b `c`'.repeat(n)}\n`],
  ['prose with marks', (n) => `${'word /em/ *strong* `code` [link](/u) -\\-- '.repeat(n)}end\n`],
  ['paragraphs', (n) => 'A paragraph with a line,\nand a second line.\n\n'.repeat(n)],
  ['table rows', (n) => '| a | b *c* |\n'.repeat(n)],
  ['text bracket pairs before an unclosed parenthesis', (n) => `${'[a]( '.repeat(n)}\n`],
]

/** The fastest of `runs` writes of the parse of `source`; the parse itself is not timed. */
function fastest(source: string, runs = 5): number {
  const parsed = parseWithLayout(source, { extensions: [] })
  let best = Infinity
  for (let run = 0; run < runs; run++) {
    const started = performance.now()
    writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', false)
    best = Math.min(best, performance.now() - started)
  }
  return best
}

describe('time linear in the output', () => {
  for (const [name, shape] of STRESS_SHAPES) {
    it(`C2-W-089: ${name} take time linear in their size`, () => {
      const small = formatBy(shape(50), 'both').stats
      expect(small.repaired).toBe(0)
      expect(small.differences).toEqual([])
      // One run at the largest size first, so the heap has grown before anything is timed.
      formatBy(shape(8000), 'plan')
      const times = [1000, 2000, 4000, 8000].map((n) => fastest(shape(n), 3))
      // The mean growth per doubling over three doublings, so one noisy step does not decide. Below 1,000 the time of
      // the compiler tiers decides the first step on a loaded machine; a quadratic writer grows 4 times per doubling.
      const perDoubling = Math.cbrt(times[3]! / Math.max(times[0]!, 0.5))
      expect(perDoubling, `${times.map((time) => time.toFixed(1)).join(', ')} ms`).toBeLessThan(2.8)
    })
  }
})

describe('time linear in the number of groups', () => {
  it('C2-W-089: planned and repaired groups that alternate take time linear in their count', () => {
    const shape = (n: number): string => '\\# a\n\n\\- b\n\n'.repeat(n)
    const small = formatBy(shape(10), 'plan').stats
    expect(small.planned).toBeGreaterThan(0)
    expect(small.repaired).toBeGreaterThan(0)
    fastest(shape(4000))
    const times = [500, 1000, 2000, 4000].map((n) => fastest(shape(n)))
    const perDoubling = Math.cbrt(times[3]! / Math.max(times[0]!, 0.5))
    expect(perDoubling, `${times.map((time) => time.toFixed(1)).join(', ')} ms`).toBeLessThan(2.8)
  })
})

// The two inputs of the property harness that the repair took 2.7 and 23 seconds to format.
describe('the slow inputs of the repair', () => {
  for (const name of ['a4da2114c87f7869', 'b01dcd98fddcd1f4']) {
    it(`C2-W-089: ${name} is planned with no parse and keeps the bytes of the repair`, () => {
      const source = readFileSync(join(root, 'test/fixtures/writer-slow', `${name}.crv`), 'utf8')
      const result = formatBy(source, 'plan')
      expect(result.output.source).toBe(readFileSync(join(root, 'test/fixtures/writer-slow', `${name}.out`), 'utf8'))
      expect(result.stats.repaired).toBe(0)
      expect(result.stats.parses).toBe(0)
      expect(fastest(source)).toBeLessThan(500)
    })
  }
})
