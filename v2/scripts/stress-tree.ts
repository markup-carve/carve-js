// CPU time of `parse` (the public tree with positions) and of `render` (source to HTML) on shapes
// that make a naive pass quadratic, at three sizes ten times apart: the inline shapes of
// scripts/stress-inline.ts, each as one paragraph, and block shapes. A linear pass takes about ten
// times longer per step. It prints and fails only when a step takes more than `--limit` times
// the step before it (default 60). The limit is wider than that of the inline pass alone: a tree
// of 100,000 nodes leaves the caches that hold one of 10,000, so the last step costs two to three
// times what the pass itself adds. A quadratic pass takes 100 times longer per step.
//   node v2/scripts/stress-tree.ts [--sizes 1000,10000,100000] [--limit N] [--only TEXT]
import { loadavg } from 'node:os'
import { parse, render } from '../src/index.ts'
import { SHAPES } from './stress-inline.ts'

export type Shape = readonly [string, (size: number) => string]

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback
}

const sizes = option('sizes', '1000,10000,100000').split(',').map(Number)
const limit = Number(option('limit', '60'))
const only = option('only', '')
const FENCE = '`'.repeat(3)
// A stack of containers is capped at 200 (C2-B-190), so a nesting shape repeats a stack of this depth.
const STACK = 190

function each(size: number, line: (index: number) => string): string {
  let out = ''
  for (let index = 0; index < size; index++) out += line(index)
  return out
}

// [name, the document for a size]. A size is a count of blocks, of references or of nesting levels.
export const BLOCK_SHAPES: readonly Shape[] = [
  ['paragraphs', (size) => 'a b\n\n'.repeat(size)],
  ['items of one tight list', (size) => '- a\n'.repeat(size)],
  ['items of one loose list', (size) => '- a\n\n'.repeat(size)],
  ['task items', (size) => '- [x] a b\n'.repeat(size)],
  ['lists that end each other', (size) => '- a\n* b\n'.repeat(size)],
  ['nested quotes', (size) => `${'> '.repeat(size)}a`],
  ['nested lists', (size) => each(STACK, (index) => `${'  '.repeat(index)}- a\n`).repeat(Math.ceil(size / STACK))],
  ['quote lines', (size) => '> a\n'.repeat(size)],
  ['headings with one text', (size) => '# Same text\n\n'.repeat(size)],
  ['headings with their own text', (size) => each(size, (index) => `## Heading ${index}\n\n`)],
  ['headings below an authored id of their slug', (size) => `{#T}\nx\n\n${'# T\n\n'.repeat(size)}`],
  ['one id many times', (size) => '{#a}\nx\n\n'.repeat(size)],
  ['references to one definition', (size) => `${'[x][r] '.repeat(size)}\n\n[r]: /u`],
  ['references in their own paragraphs', (size) => `${'[x][r]\n\n'.repeat(size)}[r]: /u`],
  ['definitions with one label', (size) => `[x][r]\n\n${'[r]: /u\n'.repeat(size)}`],
  ['definitions and their references', (size) => each(size, (index) => `[x][r${index}]\n\n[r${index}]: /u${index}\n\n`)],
  ['unresolved references', (size) => '[x][nope]{.c} '.repeat(size)],
  ['references to one heading', (size) => `# T\n\n${'[T][] '.repeat(size)}`],
  ['cross-references to one heading', (size) => `# T\n\n${'</#T> '.repeat(size)}`],
  ['footnotes', (size) => each(size, (index) => `a[^n${index}]\n\n[^n${index}]: note ${index}\n\n`)],
  ['references to one footnote', (size) => `${'a[^n] '.repeat(size)}\n\n[^n]: note`],
  ['inline footnotes', (size) => 'a^[note] '.repeat(size)],
  ['footnotes that hold a footnote reference', (size) => `a[^n0]\n\n${each(size, (index) => `[^n${index}]: note[^n${index + 1}]\n`)}`],
  ['unused footnote definitions', (size) => each(size, (index) => `[^n${index}]: note\n`)],
  ['occurrences of one abbreviation', (size) => `*[HTML]: x\n\n${'HTML '.repeat(size)}`],
  ['abbreviation definitions', (size) => `${each(size, (index) => `*[A${index}]: x\n`)}\nA1 A2 B`],
  ['attribute lines above one block', (size) => `${'{.a k=v}\n'.repeat(size)}p`],
  ['blocks with an attribute line', (size) => '{#i .c k=v}\np\n\n'.repeat(size)],
  ['table rows', (size) => '| a | b |\n'.repeat(size)],
  ['cells of one row', (size) => `|${' a |'.repeat(size)}`],
  ['a row span over every row', (size) => `| a | b |\n${'| ^ | c |\n'.repeat(size)}`],
  ['a column span over every cell', (size) => `| a |${' < |'.repeat(size)}`],
  ['continuation rows', (size) => `| a | b |\n${'+ c | d |\n'.repeat(size)}`],
  ['head rows with alignment marks', (size) => '|={>} a |={~} b |\n'.repeat(size)],
  ['tables with a caption', (size) => '| a |\n^ Table #: x\n\n'.repeat(size)],
  ['captioned images and cross-references', (size) => each(size, (index) => `{#f${index}}\n![a](b)\n^ Figure #: x\n\n</#f${index}>\n\n`)],
  ['rows of a delimited table', (size) => `{table}\n${FENCE}csv\n${'a,"b,c",d\n'.repeat(size)}${FENCE}`],
  ['terms and descriptions', (size) => ':: t\n: d\n'.repeat(size)],
  ['code fences', (size) => `${FENCE}js\nx\n${FENCE}\n\n`.repeat(size)],
  ['lines of one code fence', (size) => `${FENCE}\n${'a < b\n'.repeat(size)}${FENCE}`],
  ['divs', (size) => ':::\na\n:::\n\n'.repeat(size)],
  ['nested divs', (size) => each(STACK, (index) => `${':'.repeat(3 + STACK - index)}\n`).repeat(Math.ceil(size / STACK))],
  ['admonitions with a title', (size) => '::: note "T"\na\n:::\n\n'.repeat(size)],
  ['lines of one line block', (size) => `::: |\n${'  a b\n'.repeat(size)}:::`],
  ['stanzas of one line block', (size) => `::: |\n${'a\n\n'.repeat(size)}:::`],
  ['comment-only lines in one paragraph', (size) => `a\n${'%% c\n'.repeat(size)}b`],
  ['comment-only lines between blocks', (size) => 'a\n\n%% c\n\n'.repeat(size)],
  ['braced comments in one paragraph', (size) => `a ${'{% c %}'.repeat(size)} HTML\n\n*[HTML]: x`],
  ['thematic breaks', (size) => '***\n\n'.repeat(size)],
  ['include directives', (size) => '{{ a.crv #s @lines:1-2 }}\n\n'.repeat(size)],
  ['sections that nest', (size) => each(size, (index) => `${'#'.repeat(1 + (index % 6))} H${index}\n\n`)],
  ['one long line of two-byte characters with marks', (size) => 'é *é* '.repeat(size)],
  ['lines of four-byte characters with marks', (size) => '😀 *😀*\n'.repeat(size)],
  ['mentions, tags and symbols', (size) => '@a #b :c: '.repeat(size)],
  ['spans with merged attribute blocks', (size) => '[a]{.b}{.c #d k=v} '.repeat(size)],
  ['smart punctuation', (size) => '"a" -- b... '.repeat(size)],
]

const INLINE_SHAPES: readonly Shape[] = SHAPES.map(([name, build]): Shape => [`inline: ${name}`, (size) => `x ${build(size)}`])

function cpuMicros(): number {
  const usage = process.cpuUsage()
  return usage.user + usage.system
}

/** CPU milliseconds of `action`: the lower of two runs. */
function time(action: () => void): number {
  let best = Infinity
  for (let run = 0; run < 2; run++) {
    const before = cpuMicros()
    action()
    best = Math.min(best, cpuMicros() - before)
  }
  return best / 1000
}

if (process.argv[1] === import.meta.filename) {
  console.log(`Node ${process.version}, load average ${loadavg().map((n) => n.toFixed(2)).join(' ')}`)
  console.log(`CPU milliseconds of parse (tree with positions) and of render (source to HTML) at the sizes ${sizes.join(', ')}; a step is the last size over the one before it`)
  console.log('')
  console.log(`| Shape | parse ${sizes.join(' | parse ')} | Step | render ${sizes.join(' | render ')} | Step |`)
  console.log(`|---|${sizes.map(() => '--:').join('|')}|--:|${sizes.map(() => '--:').join('|')}|--:|`)
  let worst = 0
  for (const [name, build] of [...BLOCK_SHAPES, ...INLINE_SHAPES]) {
    if (!name.includes(only)) continue
    const sources = sizes.map(build)
    const columns: string[] = []
    for (const action of [parse, render] as const) {
      const times = sources.map((src) => time(() => void action(src)))
      const step = times[times.length - 1]! / Math.max(times[times.length - 2]!, 0.5)
      worst = Math.max(worst, step)
      columns.push(`${times.map((ms) => ms.toFixed(1)).join(' | ')} | ${step.toFixed(1)}`)
    }
    console.log(`| ${name.replaceAll('|', '\\|')} | ${columns.join(' | ')} |`)
  }
  console.log('')
  console.log(`Largest last step: ${worst.toFixed(1)} (a linear pass takes about 10)`)
  process.exitCode = worst > limit ? 1 : 0
}
