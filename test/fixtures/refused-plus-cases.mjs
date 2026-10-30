// Input generator for the refused-plus property (markup-carve/carve#4396).
// Deterministic: the same seed yields the same documents.

const WRAPPERS = [
  { kind: 'item', first: ['- '], rest: '  ' },
  { kind: 'ordered', first: ['1. '], rest: '   ' },
  { kind: 'task', first: ['- [ ] '], rest: '  ' },
  { kind: 'description', first: [':: t', ': '], rest: '  ' },
  { kind: 'note', first: ['[^a]: '], rest: '  ' },
  { kind: 'quote', first: ['> '], rest: '> ' },
]

// The content a host holds before the `+` line.
const LEAVES = [
  ['a'],
  ['a', 'b'],
  ['a', ''],
  ['```', 'code'],
  ['```', 'code', '```'],
  ['~~~', 'code'],
  ['> q'],
  ['> q', ''],
  [':::', 'd'],
  ['- s'],
  ['# H'],
]

const FOLLOWERS = [
  [],
  [''],
  ['para'],
  [' para'],
  ['  para'],
  ['   para'],
  ['    para'],
  ['      para'],
  ['', 'para'],
  ['', '  para'],
  ['- sib'],
  ['  - sib'],
  ['    - sib'],
  ['1. sib'],
  ['```', 'f', '```'],
  ['  ```', '  f', '  ```'],
  ['> r'],
  ['  > r'],
  ['# H2'],
  ['  # H2'],
  ['[^c]: n'],
  [':: u', ': v'],
  [':::', 'z', ':::'],
  ['| c |'],
]

const wrap = (wrappers, lines) => {
  let out = lines
  for (const w of [...wrappers].reverse()) {
    const pad = w.rest
    const head = w.first.slice(0, -1)
    const lead = w.first.at(-1)
    out = [...head, ...out.map((line, i) => (i === 0 ? lead + line : line === '' && w.kind !== 'quote' ? '' : pad + line))]
  }
  return out
}

const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

// Every document holds exactly one `+`, at `plusLine`.
export function generate(count = 3000, seed = 4396) {
  const random = rng(seed)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const seen = new Set()
  const cases = []
  for (let tries = 0; cases.length < count && tries < count * 40; tries++) {
    const depth = 1 + Math.floor(random() * 3)
    // A second note under one label would be dropped as a duplicate, with its `+`.
    const wrappers = Array.from({ length: depth }, () => pick(WRAPPERS))
      .map((w, i) => (w.kind === 'note' ? { ...w, first: [`[^n${i}]: `] } : w))
    const quotes = wrappers.filter((w) => w.kind === 'quote').length
    const follower = pick(FOLLOWERS)
    let body
    let plusLine
    const form = random()
    if (form < 0.3) {
      // The `+` is the whole content of a marker line.
      const lines = wrap(wrappers, ['+'])
      plusLine = lines.length - 1
      body = lines
    } else {
      const lines = wrap(wrappers, pick(LEAVES))
      // A lone `+` at a column, behind none, some or all of the quote prefixes.
      const prefix = '> '.repeat(Math.floor(random() * (quotes + 1)))
      const column = Math.floor(random() * 7)
      plusLine = lines.length
      body = [...lines, prefix + ' '.repeat(column) + '+']
    }
    const prefixed = random() < 0.5 && quotes > 0 ? '> '.repeat(Math.ceil(random() * quotes)) : ''
    const tail = follower.map((line) => (line === '' ? prefixed.trimEnd() : prefixed + line))
    const notes = wrappers.flatMap((w, i) => (w.kind === 'note' ? ['', `[^n${i}]`] : []))
    const source = [...body, ...tail, ...notes].join('\n') + '\n'
    if (seen.has(source)) continue
    seen.add(source)
    cases.push({ source, plusLine })
  }
  return cases
}

export const withLetter = (source, plusLine) => {
  const lines = source.split('\n')
  lines[plusLine] = lines[plusLine].replace('+', 'x')
  return lines.join('\n')
}

// A `+` the output no longer holds was spent only if a block took it: it needs a
// follower, and it may not leave a host emptier than the letter does.
const EMPTY_BODY = /<li>(?:<input[^>]*>)?\s*<\/li>|<dd>\s*<\/dd>/g
const empties = (html) => html.match(EMPTY_BODY)?.length ?? 0
export function violation({ source, plusLine }, html, letter) {
  const kept = html.includes('+')
  if (kept) return html.replaceAll('+', 'x') === letter ? null : 'structure'
  const follower = source.split('\n').slice(plusLine + 1).find((line) => line.replace(/^[> ]*/, '') !== '')
  if (!follower) return 'dropped'
  // A note definition renders elsewhere, so its host looks empty.
  if (/^[> ]*\[\^/.test(follower)) return null
  return empties(html) > empties(letter) ? 'emptied' : null
}
