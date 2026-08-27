/*
 * BBCode -> Carve migration.
 *
 * Port of carve-php `BbcodeToCarve`, for moving forum content into Carve.
 * BBCode is a tag language rather than a delimiter one, so this is a pipeline
 * of ordered rewrites rather than the delimiter-collision scan `djot-migrate`
 * runs: each pass turns one family of tags into its Carve spelling, and a
 * final cleanup drops whatever tags nobody claimed.
 *
 * Order matters throughout. Links and images run before the formatting pass so
 * a `[url=...]` destination is not caught by it; code runs after formatting so
 * the escaping has already protected verbatim spans; and cleanup runs last so
 * it only ever sees leftovers.
 *
 * Unlike Markdown, BBCode owns NO Carve delimiter: a `*` or `_` in a forum post
 * is literal text. So this passes no handled delimiters to the shared escaper,
 * which is what keeps `literal *stars*` from becoming Carve bold.
 */

import {
  escapeAttributeBlockOpener,
  escapeLiteralBackslashes,
  escapePlainCarveInlineSyntax,
  escapeVerbatimDelimiter,
  HANDLED_PLAIN,
} from './carve-escape.js'
import { occupiedPrivateUse, pickSentinelRun } from './sentinel-run.js'

/**
 * Maximum input length. The pipeline runs many full-string passes, so cost is
 * super-linear on a single huge input; BBCode is bounded forum content, so
 * anything implausibly large is rejected rather than converted slowly.
 */
export const BBCODE_MAX_INPUT_LENGTH = 262144

/** Thrown when the input exceeds {@link BBCODE_MAX_INPUT_LENGTH}. */
export class BbcodeInputTooLargeError extends Error {
  constructor(length: number) {
    super(
      `BBCode input exceeds maximum length of ${BBCODE_MAX_INPUT_LENGTH} bytes (got ${length})`,
    )
    this.name = 'BbcodeInputTooLargeError'
  }
}

/**
 * The stash key's preferred first code point, and how many it needs.
 *
 * Two: one to open the key and one to close it, the same pair carve-php's
 * `BbcodeToCarve::STASH_KEY_FIRST` prefers, so a post that occupies neither
 * converts to the same bytes in both engines.
 */
const STASH_KEY_BASE = 0xe001
const STASH_KEY_LENGTH = 2

/**
 * The key for the stash that survives the WHOLE pipeline.
 *
 * A separate run from {@link STASH_KEY_BASE}, and the same one carve-php
 * prefers (`BbcodeToCarve::STASH_KEY_CODE`), so a post that occupies neither
 * converts to the same bytes in both engines.
 */
const STASH_KEY_CODE = 0xe010

/**
 * Thrown when the post leaves no private-use run for the stash key.
 *
 * REFUSING, NOT CONVERTING ANYWAY. The importer stashes spans behind a key and
 * splices them back by index, so a key the post also carries does not lose a
 * character - it puts a span from ELSEWHERE in the post where the author's own
 * text was, and nothing about the result looks wrong. A post that occupies the
 * whole private-use area is not a post anyone wrote, and the honest failure is
 * the same answer {@link BbcodeInputTooLargeError} already gives for input this
 * converter will not touch. carve-php refuses here too, from the allocator
 * itself (`SentinelSpaceExhaustedException`, carve-php#1398).
 */
export class BbcodeSentinelSpaceExhaustedError extends Error {
  constructor() {
    super(
      `BBCode input occupies every private-use run of ${STASH_KEY_LENGTH} code points, so no stash key can be picked`,
    )
    this.name = 'BbcodeSentinelSpaceExhaustedError'
  }
}

/**
 * Protect the spans that must survive Carve escaping, then restore them.
 *
 * THE STASH KEY IS PICKED FROM WHAT THE POST DOES NOT CONTAIN. It used to be a
 * fixed U+E001/U+E002 pair under a docblock claiming the opposite, and the
 * restore is a regex over `open (\d+) close`: a post carrying those two
 * characters around a number was read as a stash slot and replaced by whatever
 * that slot held, while the tag that really owned the slot lost its own restore
 * (carve-js#1290, carve-php#1087). One span of a post rewrote a different part
 * of it, silently in both directions.
 *
 * THE OCCUPANCY SOURCE IS THE INPUT STRING, not a tree. This converter never
 * parses - it is ordered rewrites over one string - so there are no node values
 * to walk, and the string it is handed is the whole post. `occupiedPrivateUse`
 * takes `unknown` and already treats a bare string as one of the shapes it
 * walks, so it needed no second entry point: the set it returns is the same
 * bounded set of code points, read in one pass rather than by joining a copy of
 * the post.
 */
function escapePlainBbcodeText(bbcode: string): string {
  const occupied = occupiedPrivateUse(bbcode)
  const [open, close] = pickSentinelRun(occupied, STASH_KEY_BASE, STASH_KEY_LENGTH) as [
    string,
    string,
  ]
  // The allocator's documented last resort is the preferred run rather than a
  // throw - right for a writer, which would otherwise refuse to render a
  // document it can still write. An importer has the opposite trade: the run it
  // falls back to is one the post contains, which is the substitution above. So
  // the post-condition is checked here rather than in the shared allocator,
  // whose contract the two writers depend on and this does not change.
  if (occupied.has(open.charCodeAt(0)) || occupied.has(close.charCodeAt(0))) {
    throw new BbcodeSentinelSpaceExhaustedError()
  }

  const spans: string[] = []
  const protect = (match: string): string => {
    spans.push(match)
    return `${open}${spans.length - 1}${close}`
  }

  let text = bbcode.replace(/\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\]/gi, protect)
  text = text.replace(/\[(?:c|icode)\][\s\S]*?\[\/(?:c|icode)\]/gi, protect)
  text = text.replace(/\[url\][\s\S]*?\[\/url\]/gi, protect)
  text = text.replace(/\[img(?:=[^\]]*)?\][\s\S]*?\[\/img\]/gi, protect)
  text = text.replace(/\[\/?[a-z][a-z0-9]*(?:=[^\]]*)?\]/gi, protect)
  // `[*]` is the list-item tag and the pattern above cannot see it - that one
  // needs a letter after the bracket. Left unprotected, two on a line read as a
  // `*…*` pair to the escaper, which then backslashes the very marker
  // convertLists is about to read (carve-php#1141).
  text = text.replace(/\[\*\]/g, protect)

  // BBCode owns no backslash escape, no attribute block and no code span of the
  // shape Carve spells with a backtick, so each of those characters in a post
  // is one the author typed. Run after the tags and code spans are stashed, so
  // only real text is touched, and in this order: doubling the backslashes
  // first is what leaves every run from source text EVEN, which is how the two
  // stages after it tell a delimiter the author escaped from one they did not.
  text = escapePlainCarveInlineSyntax(
    escapeAttributeBlockOpener(escapeVerbatimDelimiter(escapeLiteralBackslashes(text))),
    HANDLED_PLAIN,
  )

  return text.replace(
    new RegExp(`${open}(\\d+)${close}`, 'gu'),
    (_whole, index: string) => spans[Number(index)] ?? '',
  )
}

/**
 * Escape the first `count` characters of `line`, which is how the Carve writer
 * neutralizes a block opener: the marker itself stops being a marker.
 */
function escapeOpenerRun(line: string, count: number): string {
  return `${line.slice(0, count).replace(/(.)/gu, '\\$1')}${line.slice(count)}`
}

/** How long the run of `marker` at the start of `line` is. */
function openerRunLength(line: string, marker: string): number {
  let length = 0
  while (line[length] === marker) length++

  return length
}

/**
 * The line rewritten so it opens no block, or `null` when it opens none.
 *
 * EVERY SPELLING HERE IS THE ONE `renderCarve` WRITES for a paragraph whose
 * text is this line, and the two are checked against each other form by form in
 * test/a-noparse-run-opens-no-block.test.ts rather than being asserted from a
 * table written by hand. The writer is the authority for this engine's own
 * output, so a rule that moves there moves this check with it.
 *
 * THE BOUND IS THAT A LOOKALIKE IS NOT A MARKER. `-a`, `1.a`, `>a`, `+ a` and
 * `[b]x[/b]` open nothing, so none of them is touched - a literal run that
 * backslashed every leading punctuation character would put escapes in front of
 * ordinary forum text.
 */
function escapedBlockOpener(rest: string): string | null {
  // A thematic break is three or more of one marker with nothing else on the
  // line, so it is decided before the bullet arm, which shares two of them.
  if (/^([-*_])\1{2,}[ \t]*$/.test(rest)) {
    return escapeOpenerRun(rest, rest.trimEnd().length)
  }
  if (/^([`~])\1{2,}/.test(rest)) {
    return escapeOpenerRun(rest, openerRunLength(rest, rest[0]!))
  }
  if (rest.startsWith('%%')) return escapeOpenerRun(rest, 2)
  if (/^[-*][ \t]/.test(rest)) return escapeOpenerRun(rest, 1)

  // An ordered marker is reached by its DELIMITER, with or without the digits
  // in front of it, so the escape goes on the delimiter rather than the line.
  const ordered = /^(\d{1,9}[.)]|\.)[ \t]/.exec(rest)
  if (ordered) {
    const digits = ordered[1]!.length - 1

    return `${rest.slice(0, digits)}${escapeOpenerRun(rest.slice(digits), 1)}`
  }

  if (/^>([ \t]|$)/.test(rest)) return escapeOpenerRun(rest, 1)
  if (/^#{1,6}[ \t]+\S/.test(rest)) {
    return escapeOpenerRun(rest, openerRunLength(rest, '#'))
  }
  if (/^:{3,}/.test(rest)) return escapeOpenerRun(rest, 1)
  if (/^\|.*\|/.test(rest)) return escapeOpenerRun(rest, 1)
  // A link reference, footnote or abbreviation definition. `[b]x[/b]` is not
  // one of these, and the pinned `[noparse]` output keeps it unescaped.
  if (/^\*?\[[^\]]*\]:/.test(rest)) return escapeOpenerRun(rest, 1)

  return null
}

/**
 * Escape every line-initial block opener in a run whose content is LITERAL.
 *
 * `escapePlainCarveInlineSyntax` covers INLINE syntax only, so a line-initial
 * `- `, `1. ` or `> ` inside a `[noparse]` body was never protected and reached
 * the document as document structure - and a literal blank run in the same body
 * then decided how MANY lists it built, since PART 9 section 11 N1a reads three
 * or more blank lines before a marker as a hard list boundary (carve-js#1386).
 * `[noparse]` means the enclosed text is literal, so no line of it may open a
 * block at all.
 *
 * NOT APPLIED TO THE `[code]` FAMILY, whose body is written inside a fence and
 * is literal by construction; escaping there would put backslashes into the
 * code the author asked to be shown.
 */
function escapeLineInitialBlockOpeners(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)![0]
      const escaped = escapedBlockOpener(line.slice(indent.length))

      return escaped === null ? line : `${indent}${escaped}`
    })
    .join('\n')
}

/**
 * The runs whose content is LITERAL for the whole pipeline, hidden behind a
 * key and put back at the very end.
 */
function stashLiteralRuns(text: string): { text: string; restore: (out: string) => string } {
  const occupied = occupiedPrivateUse(text)
  const [open, close] = pickSentinelRun(occupied, STASH_KEY_CODE, STASH_KEY_LENGTH) as [
    string,
    string,
  ]
  if (occupied.has(open.charCodeAt(0)) || occupied.has(close.charCodeAt(0))) {
    throw new BbcodeSentinelSpaceExhaustedError()
  }

  const spans: string[] = []
  const key = (body: string): string => {
    spans.push(body)

    return `${open}${spans.length - 1}${close}`
  }

  let out = text
  // THE FENCE TRIM HAPPENS HERE NOW. `convertCode` writes a block fence around
  // `body.trim()`, and once the body is a key there is no whitespace left for
  // that trim to find - the newlines it used to remove sit inside the stash
  // instead, and the fence comes back holding a blank line above and below the
  // code. carve-php trims in the same place for the same reason and does NOT do
  // this, so its `[code=php]` output carries both blank lines; this engine has
  // pinned the trimmed form since before the stash existed. The inline family
  // is written verbatim between backticks, so it is stashed as it stands.
  for (const [pattern, trim] of [
    [/(\[code(?:=[^\]]*)?\])([\s\S]*?)(\[\/code\])/gi, true],
    [/(\[(?:c|icode)\])([\s\S]*?)(\[\/(?:c|icode)\])/gi, false],
  ] as Array<[RegExp, boolean]>) {
    out = out.replace(pattern, (_whole, openTag: string, body: string, closeTag: string) =>
      `${openTag}${key(trim ? body.trim() : body)}${closeTag}`)
  }
  // The body is escaped as the LITERAL text the tag declares it to be. It has
  // already been through the plain escaper for inline syntax; this is the block
  // half of the same job, and it runs here because after this line the body is
  // a key nothing else can read.
  out = out.replace(/\[noparse\]([\s\S]*?)\[\/noparse\]/gi, (_whole, body: string) =>
    key(escapeLineInitialBlockOpeners(body)),
  )

  const slot = new RegExp(`${open}(\\d+)${close}`, 'gu')

  return {
    text: out,
    restore: (result: string): string => {
      let restored = result
      for (let i = 0; i <= spans.length; i++) {
        const next = restored.replace(slot, (_whole: string, index: string, offset: number) => {
          const body = spans[Number(index)] ?? ''
          if (!body.includes('\n')) return body
          const prefix = containerPrefixAt(restored, offset)

          return prefix === null ? body : prefixLines(prefix, body, 1)
        })
        if (next === restored) break
        restored = next
      }

      return restored
    },
  }
}

function convertLinks(text: string): string {
  return text
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '[$2]($1)')
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<$1>')
    .replace(/\[email\]([\s\S]*?)\[\/email\]/gi, '<mailto:$1>')
}

function convertImages(text: string): string {
  return text
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '![]($1)')
    .replace(/\[img=[^\]]*\]([\s\S]*?)\[\/img\]/gi, '![]($1)')
}

function convertBasicFormatting(text: string): string {
  return (
    text
      .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '*$1*')
      .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '/$1/')
      .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '_$1_')
      .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '~$1~')
      // Size, colour and font have no Carve equivalent: the tags go, the text
      // stays. Dropping the content would lose the post.
      .replace(/\[size=[^\]]*\]([\s\S]*?)\[\/size\]/gi, '$1')
      .replace(/\[color=[^\]]*\]([\s\S]*?)\[\/color\]/gi, '$1')
      .replace(/\[font=[^\]]*\]([\s\S]*?)\[\/font\]/gi, '$1')
  )
}

function convertCode(text: string): string {
  return (
    text
      .replace(
        /\[code=([^\]]+)\]([\s\S]*?)\[\/code\]/gi,
        // A leading `=` in the language is stripped so untrusted BBCode cannot
        // mint a Carve `=html` raw-HTML block, which would be live HTML under
        // the default renderer.
        (_whole, lang: string, body: string) =>
          `\n\n\`\`\`${lang.trim().toLowerCase().replace(/^=+/, '').trimStart()}\n${body.trim()}\n\`\`\`\n\n`,
      )
      .replace(
        /\[code\]([\s\S]*?)\[\/code\]/gi,
        (_whole, body: string) => `\n\n\`\`\`\n${body.trim()}\n\`\`\`\n\n`,
      )
      .replace(/\[c\]([\s\S]*?)\[\/c\]/gi, '`$1`')
      .replace(/\[icode\]([\s\S]*?)\[\/icode\]/gi, '`$1`')
  )
}

/**
 * Parse quote attribution into `name (datetime) #id`.
 *
 * Forums spell it every way there is: a bare username, `name="user"`,
 * `id="9" name="user" date="..."`, or a leading bare `"9"` post id.
 */
function formatAttribution(attribution: string): string {
  let remaining = attribution.trim()
  let id: string | null = null
  let name: string | null = null
  let datetime: string | null = null

  const leadingId = /^["'](\d+)["']/.exec(remaining)
  if (leadingId) {
    id = leadingId[1]!
    remaining = remaining.slice(leadingId[0].length).trim()
  } else {
    const namedId = /\bid=["']?(\d+)["']?/i.exec(remaining)
    if (namedId) {
      id = namedId[1]!
      remaining = remaining.replace(namedId[0], '')
    }
  }

  const namedName = /\bname=["']([^"']+)["']/i.exec(remaining)
  if (namedName) {
    name = namedName[1]!
    remaining = remaining.replace(namedName[0], '')
  }

  const namedDate = /\bdate=["']([^"']+)["']/i.exec(remaining)
  if (namedDate) {
    datetime = namedDate[1]!
    remaining = remaining.replace(namedDate[0], '')
  }

  const namedTime = /\btime=["']([^"']+)["']/i.exec(remaining)
  if (namedTime) {
    datetime = datetime !== null ? `${datetime} ${namedTime[1]!}` : namedTime[1]!
    remaining = remaining.replace(namedTime[0], '')
  }

  remaining = remaining.trim()
  if (name === null && remaining !== '') name = remaining

  let out = name ?? ''
  if (datetime !== null) out += ` (${datetime})`
  if (id !== null) out += ` #${id}`

  return out.trim()
}

function formatAsBlockquote(content: string, author: string | null): string {
  const quoted = content
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

  let out = `\n\n${quoted}\n`
  if (author !== null && author !== '') out += `^ ${formatAttribution(author)}\n`

  return `${out}\n`
}

/**
 * Convert `[quote]` with a stack rather than by recursing on each closed
 * quote's inner content, which re-scanned it and was quadratic on deeply
 * nested input - a converter DoS.
 */
function convertQuotes(text: string): string {
  const contents: string[] = ['']
  const authors: (string | null)[] = [null]
  let top = 0
  let i = 0

  const openTag = /\[quote(?:[= ]([^\]]*))?\]/iy
  const closeTag = /\[\/quote\]/iy

  while (i < text.length) {
    openTag.lastIndex = i
    const open = openTag.exec(text)
    if (open) {
      contents.push('')
      authors.push(open[1] ?? null)
      top++
      i += open[0].length
      continue
    }

    closeTag.lastIndex = i
    const close = closeTag.exec(text)
    if (close) {
      i += close[0].length
      if (top > 0) {
        const blockquote = formatAsBlockquote(contents[top]!, authors[top]!)
        contents.pop()
        authors.pop()
        top--
        contents[top] += blockquote
      }
      // A stray `[/quote]` with no open quote is dropped.
      continue
    }

    contents[top] += text[i]
    i++
  }

  // Unclosed quotes run to end of input, innermost first.
  while (top > 0) {
    const blockquote = formatAsBlockquote(contents[top]!, authors[top]!)
    contents.pop()
    authors.pop()
    top--
    contents[top] += blockquote
  }

  return contents[0]!
}

/**
 * The container prefix already written on the line that reaches `index`, or
 * `null` when what stands before it there is not container structure.
 *
 * THE COLUMN A PASS WRITES INTO IS NOT ALWAYS COLUMN 0. `convertQuotes` runs
 * before `convertLists`, so by the time the list pass writes a line it may be
 * writing INSIDE a quote whose `> ` is already on the page. A blank line at
 * column 0 there ENDS the quote and one source quote comes out as two
 * (carve-js#1383); a marker at column 0 leaves it the same way.
 *
 * THE BOUND IS THAT THE PREFIX IS STRUCTURE AND NOTHING ELSE. Only blockquote
 * markers and indentation are replicated. A `[list]` that follows prose on its
 * line is not opening a container - re-indenting under it would rewrite an
 * ordinary post - and `null` is the answer that keeps today's output for every
 * such line.
 */
function containerPrefixAt(text: string, index: number): string | null {
  const prefix = text.slice(text.lastIndexOf('\n', index - 1) + 1, index)

  return prefix !== '' && /^[ \t>]*$/.test(prefix) ? prefix : null
}

/**
 * Write `body` at the column `prefix` opens, from line `from` onward.
 *
 * A line that would be empty takes the prefix with its trailing spaces removed,
 * which is how a quote's own blank line is spelled: `> ` with the space left on
 * is trailing whitespace the Carve writer never emits.
 */
function prefixLines(prefix: string, body: string, from: number): string {
  const blank = prefix.replace(/[ \t]+$/, '')

  return body
    .split('\n')
    .map((line, index) => (index < from ? line : line === '' ? blank : `${prefix}${line}`))
    .join('\n')
}

/**
 * Trim an item body to the text it holds, keeping the interior layout.
 *
 * The same trim the regex version spelled `content.trim()`, plus a per-line
 * right trim so a continuation line indented below cannot carry the source's
 * trailing spaces into the middle of a list.
 */
function trimItemBody(body: string): string {
  return body
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
    .trimStart()
}

/** One open `[list]`, with the items it has collected so far. */
interface ListFrame {
  /** `[list=1]` rather than `[list]`. */
  ordered: boolean
  /** The bullet this list writes, alternating with its siblings. */
  marker: string
  /** The ordered delimiter this list writes, alternating with its siblings. */
  delimiter: string
  /** Text between `[list]` and its first `[*]`. */
  lead: string
  /** Item bodies, at the column their content will occupy. */
  items: string[]
  /** The body of the item being collected, or `null` before the first `[*]`. */
  current: string | null
  /** The separation axis for lists opening inside the CURRENT item. */
  siblingIndex: number
}

/**
 * `[list=a]` and friends are not a spelling this converter claims.
 *
 * Only the two forms it has ever converted open a frame; anything else falls
 * through to `cleanup`, which strips an opener carrying a value exactly as it
 * did before. Widening the set here would be a second change wearing this
 * one's clothes.
 */
function isListSpelling(value: string | undefined): boolean {
  return value === undefined || value.trim() === '1'
}

/** How much of the container prefix stands at `at`, so the scan can step over it. */
function consumedPrefix(text: string, at: number, prefix: string): number {
  if (text.startsWith(prefix, at)) return prefix.length
  const blank = prefix.replace(/[ \t]+$/, '')

  return blank !== '' && text.startsWith(blank, at) ? blank.length : 0
}

/** Write one closed list as Carve, every line at the column it occupies. */
function renderList(frame: ListFrame): string {
  let counter = 1
  const items = frame.items.map((content) => {
    const marker = frame.ordered ? `${counter++}${frame.delimiter} ` : `${frame.marker} `
    const indent = ' '.repeat(marker.length)

    // THE ITEM'S CONTENT COLUMN, NOT COLUMN 0. A continuation paragraph written
    // flat is a TOP-LEVEL paragraph, and the next marker line then folds into it
    // as lazy continuation - a two-item source list came back as one item plus a
    // paragraph that had swallowed the second marker (carve-js#1387).
    return trimItemBody(content)
      .split('\n')
      .map((line, index) => (index === 0 ? `${marker}${line}` : line === '' ? '' : `${indent}${line}`))
      .join('\n')
  })

  return items.length === 0 ? '' : `${items.join('\n')}\n`
}

/**
 * Convert the `[list]` family with a stack rather than a pair of non-greedy
 * regexes.
 */
function convertLists(text: string): string {
  const openTag = /\[list(?:=([^\]]*))?\]/iy
  const itemTag = /\[\*\]/iy
  const closeTag = /\[\/list\]/iy

  const frames: ListFrame[] = []
  let out = ''
  let rootSibling = 0
  // The prefix the OUTERMOST open list stands in. Every line inside that list
  // carries it too, so the scan steps over it on the way in and `prefixLines`
  // writes it back on the way out.
  let prefix: string | null = null
  let i = 0

  const attach = (frame: ListFrame, addition: string): void => {
    if (frame.current === null) frame.lead += addition
    else frame.current += addition
  }

  const append = (addition: string): void => {
    if (frames.length === 0) out += addition
    else attach(frames[frames.length - 1]!, addition)
  }

  const closeFrame = (): void => {
    const frame = frames.pop()!
    if (frame.current !== null) frame.items.push(frame.current)

    const lead = trimItemBody(frame.lead)
    const list = renderList(frame)
    const block = `${lead === '' ? '' : `${lead}\n`}${list}`.replace(/\n+$/, '')

    if (frames.length > 0) {
      // A nested list joins its item's content directly, with no blank line, so
      // the item stays tight rather than growing a paragraph around its text.
      const parent = frames[frames.length - 1]!
      const existing = parent.current === null ? parent.lead : parent.current
      attach(parent, `${existing === '' || existing.endsWith('\n') ? '' : '\n'}${block}\n`)

      return
    }

    if (prefix === null) {
      out += `\n\n${block}\n\n`
    } else {
      out = out.replace(/\n+$/, '\n')
      out += prefixLines(prefix, `\n${block}`, 0)
    }
    prefix = null
  }

  while (i < text.length) {
    openTag.lastIndex = i
    const open = openTag.exec(text)
    if (open && isListSpelling(open[1])) {
      const axis =
        frames.length === 0 ? rootSibling++ : frames[frames.length - 1]!.siblingIndex++
      if (frames.length === 0) {
        prefix = containerPrefixAt(out, out.length)
        if (prefix !== null) out = out.slice(0, out.length - prefix.length)
      }
      frames.push({
        ordered: open[1] !== undefined,
        marker: axis % 2 === 0 ? '-' : '*',
        delimiter: axis % 2 === 0 ? '.' : ')',
        lead: '',
        items: [],
        current: null,
        siblingIndex: 0,
      })
      i += open[0].length
      continue
    }

    if (frames.length > 0) {
      itemTag.lastIndex = i
      const item = itemTag.exec(text)
      if (item) {
        const frame = frames[frames.length - 1]!
        if (frame.current !== null) frame.items.push(frame.current)
        frame.current = ''
        frame.siblingIndex = 0
        i += item[0].length
        continue
      }

      closeTag.lastIndex = i
      if (closeTag.exec(text) !== null) {
        i += '[/list]'.length
        closeFrame()
        continue
      }
    }

    // A `[/list]` with no open list, and every other character, is text - the
    // stray closer reaches `cleanup` and is stripped there, as before.
    const character = text[i]!
    append(character)
    i++
    if (character === '\n' && frames.length > 0 && prefix !== null) {
      i += consumedPrefix(text, i, prefix)
    }
  }

  // An unclosed `[list]` runs to end of input, innermost first.
  while (frames.length > 0) closeFrame()

  return out
}

function convertTables(text: string): string {
  return text.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, (_whole, body: string) => {
    const rows: string[] = []

    for (const [, row] of body.matchAll(/\[tr\]([\s\S]*?)\[\/tr\]/gi)) {
      // A row with any `[th]` is a header row, and takes Carve's native `|=`
      // header markers rather than a separator line.
      if (/\[th\]/i.test(row!)) {
        const cells = [...row!.matchAll(/\[th\]([\s\S]*?)\[\/th\]/gi)].map(
          (m) => `|= ${m[1]!.trim()}`,
        )
        if (cells.length) rows.push(`${cells.join(' ')} |`)
        continue
      }

      const cells = [...row!.matchAll(/\[td\]([\s\S]*?)\[\/td\]/gi)].map((m) => m[1]!.trim())
      if (cells.length) rows.push(`| ${cells.join(' | ')} |`)
    }

    return `\n\n${rows.join('\n')}\n\n`
  })
}

function convertOther(text: string): string {
  let out = text
    .replace(/\[hr\]/gi, '\n---\n')
    // Alignment has no Carve equivalent: tags go, text stays.
    .replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '$1')
    .replace(/\[left\]([\s\S]*?)\[\/left\]/gi, '$1')
    .replace(/\[right\]([\s\S]*?)\[\/right\]/gi, '$1')
    .replace(
      /\[spoiler(?:=([^\]]+))?\]([\s\S]*?)\[\/spoiler\]/gi,
      (_whole, title: string | undefined, body: string) => {
        const titleAttr = title ? `{title="${title.trim()}"}\n` : ''
        return `${titleAttr}::: spoiler\n${body.trim()}\n:::\n`
      },
    )

  out = convertTables(out)

  return (
    out
      .replace(
        /\[youtube\]([a-zA-Z0-9_-]+)\[\/youtube\]/gi,
        '![YouTube Video](https://www.youtube.com/watch?v=$1)',
      )
      // Forced brace form: a BBCode sup/sub is often intraword
      // (E=mc[sup]2[/sup]), where a bare `^2^` would be literal in Carve.
      .replace(/\[sup\]([\s\S]*?)\[\/sup\]/gi, '{^$1^}')
      .replace(/\[sub\]([\s\S]*?)\[\/sub\]/gi, '{,$1,}')
  )
}

function cleanup(text: string): string {
  return `${text
    .replace(/\[\/[a-z][a-z0-9]*\]/gi, '')
    .replace(/\[[a-z][a-z0-9]*=[^\]]*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

/**
 * Convert BBCode markup to Carve markup.
 */
export function bbcodeToCarve(bbcode: string): string {
  if (bbcode.length > BBCODE_MAX_INPUT_LENGTH) {
    throw new BbcodeInputTooLargeError(bbcode.length)
  }

  let text = bbcode.replace(/\0/g, '\ufffd').replace(/\r\n?/g, '\n')
  text = escapePlainBbcodeText(text)
  const literal = stashLiteralRuns(text)
  text = literal.text
  text = convertLinks(text)
  text = convertImages(text)
  text = convertBasicFormatting(text)
  text = convertCode(text)
  text = convertQuotes(text)
  text = convertLists(text)
  text = convertOther(text)

  return literal.restore(cleanup(text))
}
