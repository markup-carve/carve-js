import type { Attrs } from './ast.js'
import { setOwn } from './own-property.js'

/**
 * True when `inner` (the text between an attribute block's braces) is
 * ENTIRELY valid attribute syntax: a sequence of `#id`, `.class`, or
 * `key=value` tokens separated by whitespace/newlines, with nothing
 * left over. Used to decide whether a standalone `{...}` line is a
 * block-attribute line or literal text (PART 9 §15).
 */
export function isValidAttrPayload(inner: string): boolean {
  if (quotedRunSpansLines(inner)) return false
  return ATTR_PAYLOAD.test(inner)
}

/**
 * `^ ws* item (ws+ item)* ws*$`, spelled once. Anchored rather than stripped,
 * because stripping cannot express "these two may not touch".
 *
 * The BAREWORD alternative is the one name here that may not begin with `_`
 * (markup-carve/carve#1450). This is the SECOND spelling of that rule - the
 * first is `parseAttrs`'s `re` - and they have to move together, or the payload
 * validates as an attribute block that then parses to nothing.
 */
const ATTR_ITEM_SRC =
  '(?:#[a-zA-Z0-9_][\\w-]*)|(?:\\.[a-zA-Z0-9_][\\w-]*)|(?:[a-zA-Z_][\\w-]*=(?:"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|[^}|"\'\\\\ \\t\\n\\r]+))|(?::(?:[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})*)?)|(?:[a-zA-Z][\\w-]*)'
const ATTR_PAYLOAD = new RegExp(
  `^[ \\t\\n\\r]*(?:(?:${ATTR_ITEM_SRC})(?:[ \\t\\n\\r]+(?:${ATTR_ITEM_SRC}))*[ \\t\\n\\r]*)?$`,
)

/**
 * The same question for an INLINE attribute block, which additionally requires
 * every whitespace slot of its interior to be a SPACE (markup-carve/carve#906,
 * markup-carve/carve-js#836).
 */
export function isValidInlineAttrPayload(inner: string): boolean {
  return isValidAttrPayload(inner) && !inlineAttrPayloadHasTab(inner)
}

/** Tabs inside quoted values are content; other tabs invalidate inline attributes. */
function inlineAttrPayloadHasTab(inner: string): boolean {
  return inner.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '').includes('\t')
}

/** Whether any quoted run in an attribute payload carries a line break. */
function quotedRunSpansLines(inner: string): boolean {
  // `\\.` cannot consume a newline (no `s` flag), so a run that reaches the
  // next line does it through the unescaped-character class and is matched
  // here whole.
  for (const m of inner.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)) {
    if (m[0]!.includes('\n')) return true
  }

  return false
}

/** True when an attribute block parsed to no id, classes, or key=values. */
export function isEmptyAttrs(attrs: Attrs): boolean {
  return (
    attrs.id === undefined &&
    (attrs.classes === undefined || attrs.classes.length === 0) &&
    (attrs.keyValues === undefined || Object.keys(attrs.keyValues).length === 0)
  )
}

// Backslash before ASCII punctuation yields that character; any other
// backslash is kept literal. Mirrors the inline text-escape rule and the
// carve-php AttributeParser, applied to quoted attribute values.
const ATTR_VALUE_ESCAPABLE = /[\\`*_{}\[\]()#+\-.!~^/<>@%|=,"'$&:;?]/

/** True when a reader resolves a backslash plus `c` to a bare `c`. */
export function isAttrValueEscapable(c: string): boolean {
  return ATTR_VALUE_ESCAPABLE.test(c)
}

export function unescapeAttrValue(v: string): string {
  return v.replace(/\\(.)/g, (whole, c: string) => (isAttrValueEscapable(c) ? c : whole))
}

export function parseAttrs(src: string): Attrs {
  const attrs: Attrs = {}
  const order: string[] = []
  const seen = new Set<string>()
  const note = (slot: string) => {
    if (!seen.has(slot)) { seen.add(slot); order.push(slot) }
  }
  const re = /(?:#([a-zA-Z0-9_][\w-]*))|(?:\.([a-zA-Z0-9_][\w-]*))|(?:([a-zA-Z_][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^}|"'\\ \t\n\r]+)))|(?:(?<=^|[ \t\n\r]):((?:[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})*)?)(?=[ \t\n\r]|$))|(?:([a-zA-Z][\w-]*))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[1]) {
      attrs.id = m[1]
      note('#id')
    } else if (m[2]) {
      ;(attrs.classes ??= []).push(m[2])
      note('.class')
    } else if (m[3]) {
      const val =
        m[4] !== undefined ? unescapeAttrValue(m[4])
        : m[5] !== undefined ? unescapeAttrValue(m[5])
        : (m[6] ?? '')
      if (m[3] === 'id') {
        // `id=j` is the SAME attribute as `#j`: it sets the id slot, last-wins
        // (§15), instead of emitting a second `id="…"` (invalid HTML). Matches
        // carve-php; `{#i id=j}` -> `id="j"`.
        attrs.id = val
        note('#id')
      } else if (m[3] === 'class') {
        // `class=x` is the SAME attribute as `.x` (CARVE-P4-007): it APPENDS to
        // the class slot in source order instead of emitting a second
        // `class="…"` (invalid HTML), the id branch's reasoning one slot over.
        // The two spellings are not interchangeable in SOURCE - `.` reads an
        // `explicit_identifier`, so `-col` and `w-1/2` are classes only the
        // key-value form can spell (markup-carve/carve#2435).
        ;(attrs.classes ??= []).push(val)
        note('.class')
      } else {
        setOwn((attrs.keyValues ??= {}), m[3], val)
        note(m[3])
      }
    } else if (m[7] !== undefined) {
      // `{:TAG}` is exact sugar for `lang=TAG`, and `{:}` for `lang=""` - an
      // explicit "the language here is unknown", which stops inheritance from a
      // surrounding language in a way that omitting the attribute does not.
      // It desugars during attribute parsing, so there is no new AST node, no
      // new field, and a consumer that has never heard of the shorthand sees an
      // ordinary `lang` key/value.
      setOwn((attrs.keyValues ??= {}), 'lang', m[7])
      note('lang')
    } else if (m[8]) {
      if (m[8] === 'id') {
        // A bare boolean `id` also feeds the id slot (value ''), last-wins and
        // single -- `{id id=j}` -> `id="j"`, `{id}` -> `id=""` -- so `id` never
        // enters keyValues and no duplicate `id` attribute can be produced.
        attrs.id = ''
        note('#id')
      } else if (m[8] === 'class') {
        // A bare boolean `class` has the same empty-string value as `class=""`
        // (PART 4), so it feeds the class slot too - left in keyValues the two
        // spellings of one documented value would build different trees and the
        // duplicate `class` attribute would survive.
        ;(attrs.classes ??= []).push('')
        note('.class')
      } else {
        // Boolean attribute: a bare word with no value.
        setOwn((attrs.keyValues ??= {}), m[8], '')
        note(m[8])
      }
    }
  }
  if (order.length) attrs.order = order
  return attrs
}

