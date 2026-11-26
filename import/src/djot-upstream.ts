// Parser fixes of djot.js main that 0.3.2, the last release, lacks. Each patch mirrors one upstream commit on the
// pinned 0.3.2 internals (the library exports neither its block specs nor its inline matchers), and installs once.
import { parseEvents as parseDjotEvents } from '@djot/djot'

interface Match { startpos: number, endpos: number, annot: string }
interface Opener { startpos: number, endpos: number, annot: string, matchIndex?: number }
type Matcher = (self: Inline, pos: number, endpos: number) => number | null
interface Inline {
  subject: string
  matches: Match[]
  openers: Record<string, Opener[] | undefined>
  matchers: Record<number, Matcher>
  destination: boolean
  allowAttributes: boolean
  attributeStart: number | null
  attributeSlices: unknown[] | null
  verbatimType: string
  addMatch: (startpos: number, endpos: number, annot: string, matchIndex?: number) => void
  reparseAttributes: () => void
  carvePendingSpan?: PendingSpan | undefined
}
interface PendingSpan { open: number, close: number, brace: number }
interface ListContainer { extra: { indent: number, styles?: string[], carveBullet?: string } }
interface BlockSpec { name: string, open: (spec: BlockSpec) => boolean, continue: (container: ListContainer) => boolean }
interface Block {
  subject: string
  pos: number
  indent: number
  starteol: number
  specs: BlockSpec[]
  tip: () => ListContainer | undefined
  carveBullets?: true
}
type Events = Iterator<Match, undefined>

const TASK_MARKER = /[*+-] \[[Xx ]\][ \t\r\n]/y

/** Installs every patch; the prototypes are taken from a parser the library opens. */
export function installDjotUpstreamFixes(): void {
  const events = parseDjotEvents('x\ny\n')
  const block = Object.getPrototypeOf(events) as { [Symbol.iterator]: (this: Block) => Events, carveUpstream?: true }
  if (block.carveUpstream === true) return
  block.carveUpstream = true
  const iterate = block[Symbol.iterator]
  block[Symbol.iterator] = function (this: Block) {
    separateTaskBullets(this)
    return detachAttributesAtBlankLines(iterate.call(this))
  }
  iterate.call(events as unknown as Block).next()
  const containers: unknown = Reflect.get(events, 'containers')
  const inline: unknown = Array.isArray(containers) ? Reflect.get(containers.at(-1) as object, 'inlineParser') : undefined
  if (inline !== null && typeof inline === 'object') patchInline(inline as Inline)
}

/**
 * jgm/djot.js df32bf3: block attributes apply only to a block right after them; a blank line drops them. Attribute
 * groups wait for the next event that consumes them (a container opener or a thematic break); a blank line first
 * strips their attribute events, so nothing is merged and the event order, which decides tight lists, is kept.
 */
function detachAttributesAtBlankLines(inner: Events): Events {
  const held: Match[] = []
  let inGroup = false
  let ready: Match[] = []
  let next = 0
  let finished = false
  const settle = (event: Match): Match[] => {
    const annot = event.annot
    if (held.length === 0 && annot !== '+block_attributes') return [event]
    if (annot === '+block_attributes') inGroup = true
    else if (annot === '-block_attributes') inGroup = false
    else if (!inGroup && decides(annot)) {
      const out = annot === 'blankline' ? held.filter(isGroupBoundary) : held.slice()
      held.length = 0
      out.push(event)
      return out
    }
    held.push(event)
    return []
  }
  return {
    next(): IteratorResult<Match> {
      for (;;) {
        if (next < ready.length) return { value: ready[next++]!, done: false }
        if (finished) return { value: undefined, done: true }
        const step = inner.next()
        finished = step.done === true
        ready = step.done === true ? held.splice(0) : settle(step.value)
        next = 0
      }
    },
  }
}

/** A blank line drops held attributes; a container opener or a thematic break takes them. */
function decides(annot: string): boolean {
  return annot === 'blankline' || annot === 'thematic_break' || annot.startsWith('+')
}

function isGroupBoundary(event: Match): boolean {
  return event.annot === '+block_attributes' || event.annot === '-block_attributes'
}

/** jgm/djot.js 7892004: a task list's style includes its bullet, so `- [ ]` and `+ [ ]` items are two lists. */
function separateTaskBullets(parser: Block): void {
  if (parser.carveBullets === true) return
  parser.carveBullets = true
  const list = parser.specs.find(spec => spec.name === 'list')
  if (list === undefined) return
  const open = list.open
  const proceed = list.continue
  list.open = spec => {
    const bullet = parser.subject.charAt(parser.pos)
    if (!open(spec)) return false
    const tip = parser.tip()
    if (tip?.extra.styles?.includes('X') === true) tip.extra.carveBullet = bullet
    return true
  }
  list.continue = container => {
    const bullet = container.extra.carveBullet
    if (bullet !== undefined && parser.indent <= container.extra.indent && parser.pos !== parser.starteol) {
      TASK_MARKER.lastIndex = parser.pos
      if (TASK_MARKER.test(parser.subject) && parser.subject.charAt(parser.pos) !== bullet) return false
    }
    return proceed(container)
  }
}

function patchInline(parser: Inline): void {
  const prototype = Object.getPrototypeOf(parser) as Inline
  const matchers = parser.matchers
  escapedDollarIsText(matchers)
  escapedBackslashKeepsDisplayMath(matchers)
  spanNeedsAttributes(matchers, prototype)
  for (const [c, fallback] of DELIMITERS) {
    const code = c.codePointAt(0)!
    const matcher = matchers[code]
    if (matcher === undefined) continue
    matchers[code] = (self, pos, endpos) => {
      // C_HYPHEN builds its delete matcher only for a brace-adjacent `-`; any other `-` is a dash.
      if (c === '-' && self.subject[pos - 1] !== '{' && self.subject[pos + 1] !== '}') return matcher(self, pos, endpos)
      return closesAcrossLink(self, pos, endpos, c, fallback) ?? matcher(self, pos, endpos)
    }
  }
}

/** Each `betweenMatched` delimiter of djot.js 0.3.2 with the match it falls back to. */
const DELIMITERS: readonly (readonly [string, string])[] = [
  ['~', 'str'], ['^', 'str'], ['_', 'str'], ['*', 'str'], ['+', 'str'], ['=', 'str'], ['-', 'str'],
  ['\'', 'right_single_quote'], ['"', 'left_double_quote'],
]

/**
 * jgm/djot.js 713a417: inside a link destination a delimiter does not close an opener from before the link's `[`; it
 * stays text. The closer test repeats `betweenMatched`, which decides the same way once this returns null.
 */
function closesAcrossLink(self: Inline, pos: number, endpos: number, c: string, fallback: string): number | null {
  if (!self.destination) return null
  const link = self.openers['[']?.at(-1)
  if (link?.annot !== 'explicit_link') return null
  const closer = closerShape(self, pos, endpos, fallback)
  const opener = self.openers[closer.closeMarker ? `{${c}` : c]?.at(-1)
  if (!closer.canClose || opener === undefined || opener.endpos === pos - 1 || opener.startpos >= link.startpos) return null
  self.addMatch(pos, closer.endcloser, closer.defaultMatch)
  return closer.endcloser + 1
}

function closerShape(self: Inline, pos: number, endpos: number, fallback: string) {
  const openMarker = self.matches.at(-1)?.annot === 'open_marker'
  const closeMarker = !openMarker && pos + 1 <= endpos && self.subject[pos + 1] === '}'
  const canClose = closeMarker || (!openMarker && pos > 0 && !/[ \t\r\n]/u.test(self.subject[pos - 1] ?? ' '))
  let defaultMatch = fallback
  if (openMarker) defaultMatch = defaultMatch.replace(/^right/u, 'left')
  else if (closeMarker) defaultMatch = defaultMatch.replace(/^left/u, 'right')
  return { closeMarker, canClose, endcloser: closeMarker ? pos + 1 : pos, defaultMatch }
}

/** jgm/djot.js 1d4843b: a backslash-escaped `$` before a code span is text, not an inline math prefix. */
function escapedDollarIsText(matchers: Record<number, Matcher>): void {
  const backtick = matchers[0x60]
  if (backtick === undefined) return
  matchers[0x60] = (self, pos, endpos) => {
    const previous = self.matches.at(-2)
    const escaped = self.subject[pos - 1] === '$' && previous?.annot === 'escape' && previous.endpos === pos - 2
    const result = backtick(self, pos, endpos)
    const last = self.matches.at(-1)
    if (escaped && last?.annot === '+inline_math' && last.startpos === pos - 1) {
      self.matches.splice(-1, 1, { startpos: pos - 1, endpos: pos - 1, annot: 'str' }, { ...last, startpos: pos, annot: '+verbatim' })
      self.verbatimType = 'verbatim'
    }
    return result
  }
}

/**
 * carve-js#5590, not upstream: djot.js (0.3.2 and main) refuses `$$` display math whenever the byte before it is a
 * backslash, so an escaped one (`\\$$`) refused it too. Only an `escape` match right before the `$$` refuses it.
 */
function escapedBackslashKeepsDisplayMath(matchers: Record<number, Matcher>): void {
  const backtick = matchers[0x60]
  if (backtick === undefined) return
  matchers[0x60] = (self, pos, endpos) => {
    const before = self.matches.at(-3)
    const refused = self.subject.startsWith('$$', pos - 2) && self.subject[pos - 3] === '\\'
      && !(before?.annot === 'escape' && before.endpos === pos - 3)
    const result = backtick(self, pos, endpos)
    const dollar = self.matches.at(-2)
    const last = self.matches.at(-1)
    if (refused && last?.annot === '+inline_math' && last.startpos === pos - 1
      && dollar?.annot === 'str' && dollar.startpos === pos - 2 && dollar.endpos === pos - 2) {
      self.matches.splice(-2, 2, { ...last, startpos: pos - 2, annot: '+display_math' })
      self.verbatimType = 'display_math'
    }
    return result
  }
}

/** jgm/djot.js 00eb258: `[text]{` is a span only when a valid attribute block follows; otherwise both brackets are text. */
function spanNeedsAttributes(matchers: Record<number, Matcher>, prototype: Inline): void {
  const bracket = matchers[0x5d]
  if (bracket === undefined) return
  matchers[0x5d] = (self, pos, endpos) => {
    const opener = self.openers['[']?.at(-1)
    const result = bracket(self, pos, endpos)
    const last = self.matches.at(-1)
    if (self.allowAttributes && opener?.matchIndex !== undefined && last?.annot === '-span' && last.startpos === pos) {
      self.carvePendingSpan = { open: opener.matchIndex, close: self.matches.length - 1, brace: pos + 1 }
    }
    return result
  }
  const reparse = prototype.reparseAttributes
  prototype.reparseAttributes = function (this: Inline) {
    const pending = this.carvePendingSpan
    if (this.attributeSlices !== null && pending !== undefined && pending.brace === this.attributeStart) {
      this.matches[pending.open]!.annot = 'str'
      this.matches[pending.close]!.annot = 'str'
      this.carvePendingSpan = undefined
    }
    reparse.call(this)
  }
}
