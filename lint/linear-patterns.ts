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

function oddBackslashesAtEnd(source: string): Matcher {
  return new Matcher(source, (text) => (from) => {
    let run = 0
    while (text.charCodeAt(text.length - 1 - run) === 92) run++
    if (run % 2 === 0) return null
    const start = Math.max(0, text.length - run - 1)
    return start < from ? null : found(text, start, text.length, {})
  })
}

function definitionWithLabel(source: string): Matcher {
  return new Matcher(source, (text) => (from) => {
    if (from > 0 || !text.startsWith('[') || !text.endsWith(']:') || text.length < 3) return null
    const close = text.length - 2
    let spoken = false
    for (let at = 1; at < close; at++) {
      if (text[at] === ']') return null
      if (text[at] !== ' ' && text[at] !== '\t') spoken = true
    }
    return spoken ? found(text, 0, text.length, { def: [0, text.length], label: [1, close] }) : null
  })
}

const SPACE = /\s/
const LINE_END = /[\n\r\u2028\u2029]/
const NAME = /[A-Za-z0-9_:-]/
const LETTER = /[A-Za-z]/

/** Where the tag starting with the `<` at `at` ends, or -1. */
function tagEnd(text: string, at: number): number {
  let next = at + 1
  if (text[next] === '/') next++
  if (text[next] === undefined || !LETTER.test(text[next]!)) return -1
  while (text[next] !== undefined && NAME.test(text[next]!)) next++
  if (text[next] !== undefined && SPACE.test(text[next]!)) {
    let attributes = next + 1
    while (attributes < text.length && text[attributes] !== '<' && text[attributes] !== '>') attributes++
    return text[attributes] === '>' ? attributes + 1 : -1
  }
  if (text[next] === '/') next++
  return text[next] === '>' ? next + 1 : -1
}

/** The length of the step the pattern takes over the `<` at `at` outside a comment, or 0 when it has none. */
function bracketStep(text: string, at: number): number {
  if (at + 1 === text.length) return 1
  if (text[at + 1] !== '!') return 2
  if (at + 2 === text.length) return 2
  if (text[at + 2] !== '-') return 3
  if (at + 3 === text.length) return 3
  return text[at + 3] === '-' ? 0 : 4
}

// The pattern steps through the line lazily and tries the tag after a run of `<` at every step, so a run of n
// brackets costs n². The result of a step only depends on where it stands: this reads the steps right to left once,
// in the order of the pattern's alternatives, and keeps for each position the tag that the pattern finds from there.
class TagSteps {
  private readonly text: string
  private readonly starts: Int32Array
  private readonly ends: Int32Array
  // The first `-->` at or after a position, before any line break, whose step finds a tag.
  private readonly comments: Int32Array
  // The last `<` of the run that the position starts, and the end of the tag there.
  private last = -1
  private end = -1

  constructor(text: string) {
    this.text = text
    this.starts = new Int32Array(text.length + 2).fill(-1)
    this.ends = new Int32Array(text.length + 2).fill(-1)
    this.comments = new Int32Array(text.length + 2).fill(-1)
  }

  first(): RegExpExecArray | null {
    for (let at = this.text.length; at >= 0; at--) {
      const next = this.next(at)
      if (next > at) {
        this.starts[at] = this.starts[next]!
        this.ends[at] = this.ends[next]!
      }
      this.comments[at] = this.comment(at)
    }
    const end = this.ends[0]!
    return end < 0 ? null : found(this.text, 0, end, { tag: [this.starts[0]!, end] })
  }

  /** The position whose result the step at `at` takes, or `at` when it finds the tag itself or nothing. */
  private next(at: number): number {
    const text = this.text
    if (text[at] !== '<') return at < text.length ? at + 1 : at
    if (text[at + 1] !== '<') this.end = tagEnd(text, this.last = at)
    if (this.end >= 0) {
      this.starts[at] = this.last
      this.ends[at] = this.end
      return at
    }
    const comment = text.startsWith('<!--', at) ? this.comments[at + 4]! : -1
    return comment >= 0 ? comment + 3 : at + bracketStep(text, at)
  }

  private comment(at: number): number {
    if (at < this.text.length && LINE_END.test(this.text[at]!)) return -1
    return this.text.startsWith('-->', at) && this.ends[at + 3]! >= 0 ? at : this.comments[at + 1]!
  }
}

function firstBareTag(source: string): Matcher {
  return new Matcher(source, (text) => (from) => (from > 0 ? null : new TagSteps(text).first()))
}

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
  '^(?:[^<]|<!--.*?-->|<[^!<A-Za-z/]|<[A-Za-z/]|<<|<!(?:[^-]|$)|<!-(?:[^-]|$)|<$)*?<*(?<tag></?[A-Za-z][A-Za-z0-9_:-]*(?:\\s[^<>]*)?/?>)': firstBareTag,
  '(?<link>\\[[^\\]\\n]+\\][ \\t]+\\((?<dest>[^)\\n]*)\\))|\\[[^\\]\\n]+\\][ \\t]+\\([^)\\n]*|\\[[^\\]\\n]*': linkGap,
  '(?:^|[^\\\\])(?:\\\\\\\\)*\\\\$': oddBackslashesAtEnd,
  '^(?<def>\\[(?<label>[^\\]]*[^\\] \\t][^\\]]*)\\]:)$': definitionWithLabel,
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
