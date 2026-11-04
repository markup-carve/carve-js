/** Current spec corpus results for carve#5091 and carve#4980, ahead of the pinned submodule. */
export const RULED_HTML_AHEAD_OF_PIN_5091: ReadonlyMap<string, { reason: string; html: string }> = new Map([
  ['659-table-spans-keep-alignment-defaults-in-physical-columns-2', {
    reason: 'carve#5091 reads `= <` and `= ^` as header span placeholders; the corpus now escapes the glyph',
    html: '<table>\n  <tbody>\n    <tr><td colspan="2">a</td></tr>\n    <tr><td>b</td><th scope="row"></th></tr>\n  </tbody>\n</table>\n',
  }],
  ['659-table-spans-keep-alignment-defaults-in-physical-columns-20', {
    reason: 'carve#5091 reads `= <` as a header colspan placeholder; the corpus now escapes the glyph',
    html: '<table>\n  <thead>\n    <tr><th scope="col"></th></tr>\n  </thead>\n</table>\n',
  }],
])

/** Formatter sidecars rewritten by carve#5091 (braced alignment) and carve#4980 (no separator row). */
export const RULED_FMT_AHEAD_OF_PIN_5091: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ['319-cell-attributes-bind-after-the-kind-and-alignment-markers-2', {
    reason: 'carve#5091 writes alignment symbols at the start of the cell attribute block',
    fmt: '|={~ #score} Score |\n| 9 |\n',
  }],
  ['319-cell-attributes-bind-after-the-kind-and-alignment-markers-3', {
    reason: 'carve#5091 writes alignment symbols at the start of the cell attribute block',
    fmt: '|= Item |= Cost |\n| Pen |{> .num} 9 |\n',
  }],
  ['319-cell-attributes-bind-after-the-kind-and-alignment-markers-6', {
    reason: 'carve#5091 writes alignment symbols at the start of the cell attribute block',
    fmt: '|={< .h} Name |={> .c} Score |{.head}\n| Ann |{> .num} 9 |{.win}\n',
  }],
  // Spec main pins `|{<} < |` here; PART 11 §6h writes a header-flagged placeholder header-kind.
  ['659-table-spans-keep-alignment-defaults-in-physical-columns-4', {
    reason: 'carve#4980 writes the separator-promoted head row natively',
    fmt: '|={>} Wide |={<} < |={~} Last |\n| a | b | c |\n',
  }],
])

/** HTML import fixtures whose expected Carve uses the 0.1.13 alignment prefix. */
export const RULED_HTML_IMPORT_AHEAD_OF_PIN_5091: ReadonlyMap<string, { reason: string; carve: string }> = new Map([
  ['cell-text-align-columns', { reason: 'carve#5091 writes braced alignment', carve: '|={<} V |={>} D |\n| a | b |\n' }],
  ['cell-text-align-declarations', { reason: 'carve#5091 writes braced alignment', carve: '|{>} a |{<} b | c |{~} d |\n' }],
  ['cell-text-align-overrides', { reason: 'carve#5091 writes braced alignment', carve: '|={>} V |\n|{~} a |\n|{<} b |\n' }],
  ['cell-text-align-unmapped', { reason: 'carve#5091 writes braced alignment', carve: '|{~} a | b |\n' }],
])

/** The shared table alignment fixture carve#5091 rewrote to braced alignment. */
export const RULED_TABLE_ALIGNMENT_FIXTURES_5091: ReadonlyMap<string, { reason: string; canonical: string; aligned: string }> = new Map([
  ['attributes spans and empty cells', {
    reason: 'carve#5091 writes braced alignment',
    canonical: '|={.total} Total |={>} Qty |\n| 長い | 7 |\n| ^ | < |\n| | |\n',
    aligned: '|={.total} Total |={>} Qty |\n| 長い           | 7       |\n| ^              | <       |\n|                |         |\n',
  }],
])
