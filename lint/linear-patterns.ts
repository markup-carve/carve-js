// Linear-time matchers for the lint-model patterns that a backtracking regular expression engine runs in quadratic
// time on some lines (carve#6297). Each answers what its pattern answers, with the same match spans and groups;
// test/lint-linear-patterns.test.ts compares every one with its RegExp and checks all lint-model patterns for growth.

/** The part of the RegExp interface the generated lint rules call. */
export interface Pattern {
  readonly source: string
  test(text: string): boolean
  exec(text: string): RegExpExecArray | null
  matchAll(text: string): Iterable<RegExpExecArray>
  /** The group spans of the first match, where a matcher has them without building the match. */
  spans?(text: string): Groups | null
}

type Groups = Record<string, [number, number]>

function found(text: string, start: number, end: number, groups: Groups): RegExpExecArray {
  const match = [text.slice(start, end)] as unknown as RegExpExecArray
  match.index = start
  match.input = text
  const named: Record<string, string> = {}
  for (const name in groups) named[name] = text.slice(groups[name]![0], groups[name]![1])
  match.groups = named
  ;(match as { indices?: unknown }).indices = Object.assign([[start, end]], { groups })
  return match
}

/** The fallback alternatives match a bracket run but define neither report group. */
function failedLinkGap(text: string, start: number, end: number): RegExpExecArray {
  const match = found(text, start, end, {})
  match.groups = { link: undefined, dest: undefined } as unknown as Record<string, string>
  ;(match.indices as unknown as { groups: Record<string, undefined> }).groups = { link: undefined, dest: undefined }
  return match
}

/** A cursor over one text: the first match at or after `from`, asked with `from` never moving back. */
type Cursor = (from: number) => RegExpExecArray | null

class Matcher implements Pattern {
  readonly source: string
  private readonly cursor: (text: string) => Cursor

  constructor(source: string, cursor: (text: string) => Cursor) {
    this.source = source
    this.cursor = cursor
  }

  test(text: string): boolean {
    return this.cursor(text)(0) !== null
  }

  exec(text: string): RegExpExecArray | null {
    return this.cursor(text)(0)
  }

  * matchAll(text: string): Iterable<RegExpExecArray> {
    const next = this.cursor(text)
    for (let match = next(0); match !== null; match = next(match.index + match[0].length)) yield match
  }
}

/** One match of the row's three alternatives, starting at its first bracket. */
function linkGapAt(text: string, open: number): RegExpExecArray {
  let close = open + 1
  while (close < text.length && text[close] !== ']' && text[close] !== '\n') close++
  if (close <= open + 1 || text[close] !== ']') return failedLinkGap(text, open, close)
  let paren = close + 1
  while (text[paren] === ' ' || text[paren] === '\t') paren++
  if (paren <= close + 1 || text[paren] !== '(') return failedLinkGap(text, open, close)
  let end = paren + 1
  while (end < text.length && text[end] !== ')' && text[end] !== '\n') end++
  if (text[end] === ')') return found(text, open, end + 1,
    { link: [open, end + 1], dest: [paren + 1, end] })
  return failedLinkGap(text, open, end)
}

function linkGap(source: string): Matcher {
  // The row consumes a failed bracket run as well as a link. Each cursor starts after the last consumed run.
  return new Matcher(source, (text) => (from) => {
    const open = text.indexOf('[', from)
    return open < 0 ? null : linkGapAt(text, open)
  })
}

const LINE_END = /[\n\r\u2028\u2029]/
// `.*?` before `[ \t]*$` rescans a run of spaces from each of its positions. With no line break to stop `.`, the greedy
// prefix and the trimmed rest always match, so no other split is ever taken.
function contentSpan(text: string): [number, number] | null {
  if (LINE_END.test(text)) return null
  let at = 0
  while (text[at] === ' ' || text[at] === '\t') at++
  while (text[at] === '>' && text[at + 1] === ' ') {
    at += 2
    while (text[at] === ' ' || text[at] === '\t') at++
  }
  let end = text.length
  while (end > at && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--
  return [at, end]
}

class QuotedContent extends Matcher {
  constructor(source: string) {
    super(source, (text) => {
      let done = false
      return (from) => {
        const span = done || from > 0 ? null : contentSpan(text)
        done = true
        return span === null ? null : found(text, 0, text.length, { c: span })
      }
    })
  }

  spans(text: string): Groups | null {
    const span = contentSpan(text)
    return span === null ? null : { c: span }
  }
}

const MATCHERS: Record<string, (source: string) => Matcher> = {
  '^[ \\t]*(?:> [ \\t]*)*(?<c>.*?)[ \\t]*$': (source) => new QuotedContent(source),
  '(?<link>\\[[^\\]\\n]+\\][ \\t]+\\((?<dest>[^)\\n]*)\\))|\\[[^\\]\\n]+\\][ \\t]+\\([^)\\n]*|\\[[^\\]\\n]*': linkGap,
}

/** Whether `source` has a linear matcher here. */
export function hasLinearMatcher(source: string): boolean {
  return Object.hasOwn(MATCHERS, source)
}

/** The linear matcher for `source`; the flags only matter to the RegExp it stands for. */
export function linearPattern(source: string): Pattern {
  const make = MATCHERS[source]
  if (make === undefined) throw new Error(`lint-model: no linear matcher for ${source}`)
  return make(source)
}
