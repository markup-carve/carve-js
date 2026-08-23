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
 * The runs whose content is LITERAL for the whole pipeline, hidden behind a
 * key and put back at the very end.
 *
 * {@link escapePlainBbcodeText} protects spans while it escapes and restores
 * them before it returns, so every pass below used to see the enclosed markup
 * and rewrite it. Two families need more than that:
 *
 * `[code]`, `[c]` and `[icode]` hold text the author wants SHOWN, which is most
 * of what a forum uses them for. Only the CONTENT is hidden here; the tags stay
 * visible so `convertCode` still recognizes the run and builds its fence.
 *
 * `[noparse]` has no Carve construct to become at all. Its whole effect is
 * "the enclosed text is literal", so the TAGS are consumed and the content is
 * left as the escaper already wrote it - escaping it a second time would double
 * the backslash and render a literal one beside the bold it was meant to
 * prevent. Keeping the tags emitted them verbatim, and `cleanup` then ate the
 * closer, leaving an unbalanced `[noparse]` in a document that has no such
 * construct (carve-js#1368, carve-php#1209).
 *
 * RESTORED AFTER `cleanup`, because cleanup strips leftover BBCode tags and
 * this content legitimately contains some - a `[code]` block showing `[b]` is
 * the whole point of it.
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
  out = out.replace(/\[noparse\]([\s\S]*?)\[\/noparse\]/gi, (_whole, body: string) => key(body))

  const slot = new RegExp(`${open}(\\d+)${close}`, 'gu')

  return {
    text: out,
    // ONE PASS IS NOT ENOUGH WHEN THE RUNS NEST. `[noparse]` is stashed after
    // the code runs, so its body can hold a key of its own, and a single
    // replace walks PAST the key it just spliced in - carve-php restores in one
    // pass and emits the raw private-use characters for exactly that input.
    // The loop is bounded by the number of spans, since every pass that changes
    // the text consumes at least one.
    restore: (result: string): string => {
      let restored = result
      for (let i = 0; i <= spans.length; i++) {
        const next = restored.replace(slot, (_whole, index: string) => spans[Number(index)] ?? '')
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

function convertLists(text: string): string {
  let out = text.replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, (_whole, body: string) => {
    let counter = 1
    const items = body.replace(
      /\[\*\]([\s\S]*?)(?=\[\*\]|$)/gi,
      (_item, content: string) => `${counter++}. ${content.trim()}\n`,
    )
    return `\n\n${items}\n`
  })

  // The bullet marker alternates per list so two adjacent lists stay distinct:
  // same-marker lists separated only by a blank line merge into one in Carve.
  let bulletIndex = 0
  out = out.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_whole, body: string) => {
    const marker = bulletIndex % 2 === 0 ? '-' : '*'
    bulletIndex++
    const items = body.replace(
      /\[\*\]([\s\S]*?)(?=\[\*\]|$)/gi,
      (_item, content: string) => `${marker} ${content.trim()}\n`,
    )
    return `\n\n${items}\n`
  })

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
 *
 * A U+0000 IN THE INPUT IS REPLACED BY U+FFFD, before anything reads the text.
 * An importer is the same boundary as an ingest, and PART 12 section 21 says so
 * as a SHOULD rather than a MUST because the format being read may have a rule
 * of its own - BBCode has none, so Carve's applies. The Markdown importer
 * already does this, following CommonMark 2.3 (carve-js#1291); this one passed
 * the raw byte straight through into its Carve output, which is a writer
 * emitting a character the Carve parser replaces on read.
 *
 * Not the same act as picking the stash key (carve-js#1290): a picked run is
 * drawn from characters the input MAY legitimately carry, so it needs a scan
 * and a refusal when the private-use area is full. NUL is not a character this
 * converter may emit at all.
 *
 * @throws {BbcodeInputTooLargeError} when the input exceeds the length cap.
 * @throws {BbcodeSentinelSpaceExhaustedError} when the input leaves no
 *   private-use run free for the stash key.
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
