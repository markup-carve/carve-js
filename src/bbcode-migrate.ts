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
 * Protect the spans that must survive Carve escaping, then restore them.
 *
 * The stash key is private-use code points the input cannot carry, rather than
 * a fixed sentinel: carve-php#1087 found that a post containing the sentinel
 * had that text replaced by an unrelated span of the same post.
 */
function escapePlainBbcodeText(bbcode: string): string {
  const spans: string[] = []
  const open = '\u{E001}'
  const close = '\u{E002}'
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
 * @throws {BbcodeInputTooLargeError} when the input exceeds the length cap.
 */
export function bbcodeToCarve(bbcode: string): string {
  if (bbcode.length > BBCODE_MAX_INPUT_LENGTH) {
    throw new BbcodeInputTooLargeError(bbcode.length)
  }

  let text = bbcode.replace(/\r\n?/g, '\n')
  text = escapePlainBbcodeText(text)
  text = convertLinks(text)
  text = convertImages(text)
  text = convertBasicFormatting(text)
  text = convertCode(text)
  text = convertQuotes(text)
  text = convertLists(text)
  text = convertOther(text)

  return cleanup(text)
}
