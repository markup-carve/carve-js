import { type Attrs, type Position } from '../../ast.js'
import { isEmptyAttrs, isValidInlineAttrPayload, parseAttrs } from '../../extension/attribute-parser.js'
import { openVerbatimRun } from '../block/parse-block-boundaries.js'
import { type AnchorRange } from '../inline/parse-inline-core.js'
import { RE_INLINE_ATTR } from '../inline/parse-inline-opaque.js'

export const trimCellPadding = (text: string): string => {
  let start = 0
  let end = text.length
  while (start < end && text.charCodeAt(start) === 0x20) start++
  while (end > start && text.charCodeAt(end - 1) === 0x20) end--
  if (start === 0 && end === text.length) return text

  return text.slice(start, end)
}

/**
 * Parse a table cell's leading markers from its raw between-pipe text.
 *
 * Kind, alignment and attribute runs start against the opening pipe.
 * A leading padding space keeps content out of those runs. A lone `<` or
 * `^` is a span before those runs are considered.
 *
 * A cell whose trimmed content is exactly `^` or `<`, with any space padding,
 * is a rowspan/colspan marker. The other tight prefixes may contain an
 * optional `=` (header) followed by an optional alignment
 * marker (`>` right, `<` left, `~` center).
 */
/**
 * The characters a table cell reads as an ALIGNMENT MARKER, glued to `|` or `|=`.
 *
 * Exported so the Carve writer can read the set off the parser instead of
 * carrying a second copy of it. The writer must not emit a header marker
 * immediately followed by one of these, because the next parse eats it as
 * alignment and keeps the rest of the cell as text (markup-carve/carve-js#903).
 * A guard built from a hand-listed set would be a second spelling of this rule,
 * and this repository has repeatedly found one rule spelled N times where N was
 * larger than anyone claimed.
 */
export const TABLE_ALIGNMENT_MARKERS: ReadonlyMap<string, 'left' | 'right' | 'center'> = new Map([
  ['>', 'right'],
  ['<', 'left'],
  ['~', 'center'],
])

/**
 * Read a table cell's attribute block at `from`, if there is one there.
 *
 * Uses the quote-aware inline-attribute matcher so a quoted `}` inside a value
 * (`{key="{y}"}`) is handled rather than truncated at the first brace. The WHOLE
 * payload must then be valid attribute syntax (same as inline and block
 * attribute blocks); a partially-invalid payload like `{.x 1bad}` is not an
 * attribute block, so the `{` stays ordinary content.
 *
 * Exported so the linter asks this question the same way the parser answers it.
 * A rule spelled twice drifts, and the rule this one serves - the block binds
 * after the markers - already had four spellings across the engines to unify.
 */
export function readCellAttributeBlock(
  src: string,
  from = 0,
): { attrs: Attrs; length: number } | undefined {
  if (src[from] !== '{') return undefined
  const m = RE_INLINE_ATTR.exec(src.slice(from))
  if (!m || !isValidInlineAttrPayload(m[1]!)) return undefined
  const attrs = parseAttrs(m[1]!)
  if (isEmptyAttrs(attrs)) return undefined

  return { attrs, length: m[0].length }
}

/**
 * A cell's marker run as the parser reads it - kind marker, alignment run,
 * attribute block - WITHOUT the §5 T11 terminator check.
 *
 * `end` is where T11 wants the terminating space (0 when there is no run);
 * `alignStart`..`alignEnd` is the accepted alignment run, empty when there is
 * none or it was rejected. Exported so the linter reports a missing terminator
 * against the parser's own run instead of a second spelling of it.
 */
export function scanCellMarkerRun(src: string): {
  header: boolean
  align?: 'left' | 'right' | 'center'
  valign?: 'top' | 'middle' | 'bottom'
  attrs?: Attrs
  alignStart: number
  alignEnd: number
  end: number
} {
  // Tight prefix only: the marker must sit at index 0 of the raw text.
  let i = 0
  let header = false
  if (src[i] === '=') {
    header = true
    i++
  }
  // A one- or two-axis run is consumed as a unit. A duplicate axis other than
  // `~~` invalidates the whole run, so `|=<< Note|` keeps both `<` bytes as
  // visible content instead of silently consuming a valid-looking prefix.
  const markerStart = i
  let align: 'left' | 'right' | 'center' | undefined
  let valign: 'top' | 'middle' | 'bottom' | undefined
  let inheritedHorizontal = false
  let invalidAxis = src[i] === '^' || src[i] === 'v' ||
    (src[i] === '~' && (src[i + 1] === '<' || src[i + 1] === '>'))
  if (src[i] === '?' && src[i + 1] !== undefined && '^~v'.includes(src[i + 1]!)) {
    inheritedHorizontal = true
    valign = src[i + 1] === '^' ? 'top' : src[i + 1] === '~' ? 'middle' : 'bottom'
    i += 2
  }
  while (!inheritedHorizontal && src[i] !== undefined && '<>~^v?'.includes(src[i]!)) {
    const marker = src[i]!
    if (marker === '?') {
      invalidAxis = true
      break
    } else if (marker === '<' || marker === '>' || marker === '~') {
      if (align === undefined) {
        align = marker === '<' ? 'left' : marker === '>' ? 'right' : 'center'
      } else if (marker === '~' && valign === undefined) {
        valign = 'middle'
      } else {
        invalidAxis = true
        break
      }
    } else {
      if (valign !== undefined) { invalidAxis = true; break }
      valign = marker === '^' ? 'top' : 'bottom'
    }
    i++
  }
  // What follows the run is not checked here: the T11 terminator check in
  // `parseCellMarkers` rejects the whole run when it is not a space.
  const validRun = i > markerStart &&
    !invalidAxis &&
    (align !== undefined || inheritedHorizontal)
  if (!validRun) {
    i = markerStart
    align = undefined
    valign = undefined
    inheritedHorizontal = false
  }

  // A `{...}` attribute block supplies the cell's attributes. It binds LAST -
  // after the kind marker and after the alignment marker, in every cell - and
  // is GLUED to whatever precedes it: to the marker run where the cell has one
  // (`|=<{.x} …`), to the opening `|` where it has none (`|{.x} …`). The rest,
  // after optional whitespace, is the cell content. A SPACE before the brace
  // (`| {.x}`) is ordinary content, not attributes. A cell that carries an
  // attribute block is never a bare span marker, so its content is literal
  // even if it is just `<`/`^`. An invalid payload leaves the `{` as content.
  //
  // The order is what makes an attributed HEADER cell expressible at all. With
  // the block bound ahead of the `=`, the only available shape is `|{#x}=R|`,
  // and that is ambiguous by construction: an attributed header cell, or a data
  // cell whose content starts with `=`. This grammar reads it the second way,
  // so the shape the writer produced for an attributed header cell came back as
  // `<td id="x">=R</td>` and the round-trip invariant failed on it. Once `=`
  // has committed the cell to header, everything after it is unambiguous
  // (spec §5 T10, corpus 319).
  const alignEnd = i
  const block = readCellAttributeBlock(src, i)
  if (block) i += block.length

  return {
    header,
    ...(align ? { align } : {}),
    ...(valign ? { valign } : {}),
    ...(block ? { attrs: block.attrs } : {}),
    alignStart: markerStart,
    alignEnd,
    end: i,
  }
}

export function parseCellMarkers(src: string): {
  header: boolean
  span?: 'rowspan' | 'colspan'
  align?: 'left' | 'right' | 'center'
  valign?: 'top' | 'middle' | 'bottom'
  attrs?: Attrs
  content: string
} {
  // A lone span glyph takes precedence over an empty alignment run.
  const trimmedSource = trimCellPadding(src)
  if (trimmedSource === '<' || trimmedSource === '^') return { header: false, span: trimmedSource === '<' ? 'colspan' : 'rowspan', content: '' }

  // Spec §5 T11: THE MARKER RUN ENDS AT A SPACE. The kind marker, the alignment
  // run and the attribute block are ONE run, and a cell carrying any of them
  // must follow it with one literal space. Without that space there is no run
  // and every character of it is content, so `|=hot= |` is the highlight its
  // author wrote rather than a header cell holding `hot=`. The closing pipe is
  // not a terminator (`|= |` is the empty header cell) and neither is a tab,
  // which PART 7 gives no padding role inline. The run is ATOMIC: a rejected
  // alignment run takes the `=` with it, so without the space the cell is not
  // a header either.
  const run = scanCellMarkerRun(src)
  if (run.end > 0 && src[run.end] === ' ') {
    const { header, align, valign, attrs } = run
    // A tight prefix was consumed; the rest is content.
    const content = trimCellPadding(src.slice(run.end))
    if ((align !== undefined || valign !== undefined) && attrs !== undefined) return { header, ...(align ? { align } : {}), ...(valign ? { valign } : {}), attrs, content }
    if (align !== undefined || valign !== undefined) return { header, ...(align ? { align } : {}), ...(valign ? { valign } : {}), content }
    if (attrs !== undefined) return { header, attrs, content }
    return { header, content }
  }

  // No tight prefix: the whole trimmed text is content.
  const trimmed = trimCellPadding(src)
  return { header: false, content: trimmed }
}

/**
 * Would a cell holding exactly this payload be read as a SPAN MARKER?
 *
 * Exported so the Carve writer can read the rule off the parser instead of
 * carrying a second copy of it, the same way `TABLE_ALIGNMENT_MARKERS` is.
 * Naming `^` and `<` in the writer would be an enumeration that goes stale the
 * next time a cell-level marker is added, and the alignment sigil's history is
 * what that costs: each writer answered that class with its own slightly
 * different set of characters.
 *
 * PADDING IS NOT AN ESCAPE WHERE THE PRODUCTION ADMITS PADDING (PART 11
 * section 6f). Section 6e's one space in front of a cell's content puts it out
 * of reach of the three slots that are read GLUED to the opening pipe, and that
 * argument holds only where the construct forbids the padding. The span cell is
 * written WITH the padding inside it -
 *
 *     rowspan_marker = {space}, '^', {space} ;
 *     colspan_marker = {space}, '<', {space} ;
 *
 * so a cell whose whole payload is `^` or `<` needs an escape when written
 * with span padding. A lone `<` takes priority over an empty alignment run.
 *
 * The predicate is over the payload, so the writer can ask before it chooses
 * the cell prefix. The parser checks the same glyphs before marker runs.
 */
export function cellPayloadIsSpanMarker(payload: string): boolean {
  const trimmed = trimCellPadding(payload)
  return trimmed === '^' || trimmed === '<'
}

export interface RawCell {
  header: boolean
  span?: 'rowspan' | 'colspan'
  align?: 'left' | 'right' | 'center'
  valign?: 'top' | 'middle' | 'bottom'
  attrs?: Attrs
  raw: string
  /**
   * The backtick run this cell's collected source ends INSIDE, 0 when it ends
   * outside one. Carried forward per continuation row rather than recomputed
   * from `raw`, which would be quadratic in the number of rows.
   */
  openRun: number
  /**
   * Where this cell sits in the document, when that is answerable.
   *
   * Cleared once a `+` continuation row merges into the cell: its content then
   * comes from two non-adjacent regions, so no single span covers it and PART 12
   * section 4 forbids inventing one.
   */
  pos?: Position
  /**
   * Where each FRAGMENT of `raw` came from, one range per source region, set
   * only for a fragment VERIFIED to appear verbatim at that point in its line -
   * a fragment whose source cannot be confirmed contributes no range, so the
   * nodes over it go unplaced rather than landing on a wrong offset.
   *
   * A cell with no `+` continuation has exactly one range covering all of `raw`,
   * which maps the same way a single base offset did. A CONTINUED cell has one
   * per row, with the joining space between them mapping to nothing: the
   * fragments each sit verbatim in the document even though their concatenation
   * does not, so the inlines inside one fragment are placeable and only the ones
   * reaching across a row boundary are not (markup-carve/carve-js#1153).
   */
  anchors?: AnchorRange[]
  /** Continuation text on a span marker, joined to its origin after the span walk. */
  joins?: Array<{ frag: string; at: FragmentPlace | null; marker: FragmentPlace | null; sep: FragmentPlace | null; line: number; rowIndex: number }>
  /** The `+` of the continuation line the last fragment came from. */
  lastMarker?: number
  wraps?: Array<{ offset: number; line: number; row?: number; col?: number; pos?: Position }>
}

export interface FragmentPlace {
  offset: number
  line: number
  column: number
}

/** Appends one `+` continuation fragment to a cell's collected source. */
export function joinFragment(target: RawCell, frag: string, at: FragmentPlace | null, line?: number, row?: number, marker?: FragmentPlace | null, sep?: FragmentPlace | null, col?: number): void {
  const fragStart = target.raw ? target.raw.length + 1 : 0
  // A second fragment from the same `+` line joins across that line's own pipe,
  // so its marker is the pipe and not the `+` the first join already covers.
  const sameLine = marker && target.lastMarker === marker.offset
  if (marker) target.lastMarker = marker.offset
  else delete target.lastMarker
  if (sameLine) marker = sep ?? null
  if (target.raw && line !== undefined) (target.wraps ??= []).push({
    offset: fragStart - 1, line, ...(row ? { row } : {}), ...(col !== undefined ? { col } : {}),
    ...(marker ? { pos: {
      startLine: marker.line, endLine: marker.line,
      startColumn: marker.column, endColumn: marker.column + 1,
      startOffset: marker.offset, endOffset: marker.offset + 1,
    } } : {}),
  })
  target.raw = target.raw ? `${target.raw} ${frag}` : frag
  // Only the NEW fragment is read; the joining space is not a run
  // character, so resuming from the cell's own state is exact.
  target.openRun = openVerbatimRun(frag, target.openRun)
  // The CELL keeps no span. Its content sits in two column ranges on
  // non-adjacent lines, and one range covering both would swallow the
  // neighbouring column's content on the lines between - so cell 1 would
  // CONTAIN cell 0, and an offset would map to two sibling cells at once.
  // A construct that is not one contiguous range cannot honestly be one.
  delete target.pos
  if (at) {
    const range: AnchorRange = { from: fragStart, to: fragStart + frag.length, ...at }
    if (target.anchors) target.anchors.push(range)
    else target.anchors = [range]
  }
  // NO CLAMP ON THE RANGE BEFORE when this fragment is unplaceable. A
  // range's `to` is the length `raw` had when it was appended, and the
  // next fragment starts one past that, so the joining space is already
  // the only offset between them and an unplaced fragment simply leaves a
  // wider gap. `to` is inclusive so an exclusive span end may land on it;
  // the space itself belongs to no range, which is what makes a node
  // reaching across the boundary unplaceable.
}

export const isGfmDelimiterCell = (c: RawCell): boolean =>
  !c.header && !c.span && !c.align && !c.valign && !c.attrs &&
  /^:?-+:?$/.test(trimCellPadding(c.raw))

export const isGfmDelimiterRow = (row: RawCell[]): boolean =>
  row.length > 0 && row.every(isGfmDelimiterCell)
