// What the corpus runner holds: the example and clause case fields whose stated result departs from its clause, and the
// field each refused tree is refused at.

// Rulings of the spec pin that carve-js does not implement yet; each hold goes with its port.
const TABLE_HEAD = 'carve#6663 a head of data cells (C2-M-037, C2-B-186; spec carve#6816)'
const TABLE_FOOT = 'carve#6664 a table of only a foot (C2-B-187, C2-W-136; spec carve#6816)'
const UNSCOPED_TH = 'carve#6623 an unscoped th of a leading th row (C2-M-037; spec carve#6816)'
const COL_WIDTH = 'carve-js#5574 the width a col style gives (C2-M-041; spec carve#6816)'
const KEY_ATTRIBUTES = 'carve#6605 an authored abbr, kbd or time attribute beside the key (C2-M-047; spec carve#6814)'
const NOTE_COMMENTS = 'carve#6235 the comments of a wrapper the note pass drops (C2-M-109; spec carve#6814)'
const LINE_OPTIONS = 'carve#6791 the line options of a captioned code block stay on its pre (C2-H-211; spec carve#6803)'
const METADATA_FIELDS = 'carve#3598 root metadata fields beside a frontmatter node (C2-A-193, C2-W-011; spec carve#6815)'
const REGION_MARKER = 'carve#6727 a region marker keeps the closer of the last fence (C2-W-123; spec carve#6815)'
const DJOT_GATE = 'carve#6499 the djot- rules default to off (C2-T-031, C2-T-049; spec carve#6824)'
const QUOTE_LOCALE = 'carve-rs#4838 a smart quotes locale outside its row falls back (C2-X-075; spec carve#6824)'
const BINARY64 = 'carve#6099 a tree number is a binary64 value (C2-A-219; spec carve#6819)'
const ESCAPE_ROUND_KEYS = 'carve#6813 a key the escape rounds cannot spell is no loss where the output reads back'
  + ' (C2-W-075; spec carve#6825)'

/**
 * The fields of the examples and clause cases that this engine does not pass yet: a stated result that departs from its own
 * clause, or a ruling of the pin not yet implemented here, each with its ticket. The field must keep failing until it is
 * fixed, and every other field of the example is still checked.
 */
export const HELD: ReadonlyMap<string, { fields: readonly string[], fix: string }> = new Map([
  ['CC-2100', { fields: ['carve', 'diagnosticsComplete'], fix: TABLE_HEAD }],
  ['CC-2101', { fields: ['carve', 'diagnosticsComplete'], fix: TABLE_HEAD }],
  ['CC-2102', { fields: ['carve', 'diagnosticsComplete'], fix: TABLE_HEAD }],
  ['CC-2103', { fields: ['carve', 'diagnosticsComplete'], fix: TABLE_HEAD }],
  ['CC-2237', { fields: ['html'], fix: TABLE_HEAD }],
  ['CC-2238', { fields: ['html'], fix: TABLE_HEAD }],
  ['CC-2239', { fields: ['html'], fix: TABLE_HEAD }],
  ['CC-2240', { fields: ['html'], fix: TABLE_HEAD }],
  ['CC-2241', { fields: ['diagnostics:table-row-count-clamped'], fix: TABLE_HEAD }],
  ['CC-2242', { fields: ['carve'], fix: TABLE_HEAD }],
  ['syntax-blocks-219', { fields: ['html', 'tree'], fix: TABLE_HEAD }],
  ['CC-2068', { fields: ['html', 'children'], fix: TABLE_FOOT }],
  ['CC-2244', { fields: ['carve', 'diagnosticsComplete'], fix: TABLE_FOOT }],
  ['CC-2245', { fields: ['carve', 'diagnosticsComplete'], fix: TABLE_FOOT }],
  ['CC-2246', { fields: ['html'], fix: TABLE_FOOT }],
  ['CC-2247', { fields: ['notReported:table-row-count-clamped'], fix: TABLE_FOOT }],
  ['CC-2248', { fields: ['html'], fix: TABLE_FOOT }],
  ['CC-2249', { fields: ['carve'], fix: TABLE_FOOT }],
  ['CC-2063', { fields: ['diagnostics:field-unspellable', 'diagnosticsComplete'], fix: UNSCOPED_TH }],
  ['CC-2250', { fields: ['diagnostics:field-unspellable', 'diagnosticsComplete'], fix: UNSCOPED_TH }],
  ['CC-2251', { fields: ['status', 'stderrCategory'], fix: UNSCOPED_TH }],
  ['CC-2252', { fields: ['carve'], fix: COL_WIDTH }],
  ['CC-2253', { fields: ['carve'], fix: COL_WIDTH }],
  ['CC-2254', { fields: ['carve'], fix: COL_WIDTH }],
  ['CC-2255', { fields: ['carve'], fix: COL_WIDTH }],
  ['CC-2256', { fields: ['carve'], fix: COL_WIDTH }],
  ['CC-2230', { fields: ['children', 'carve', 'notReported:import-attribute-dropped'], fix: KEY_ATTRIBUTES }],
  ['CC-2231', { fields: ['children', 'carve', 'notReported:import-attribute-dropped'], fix: KEY_ATTRIBUTES }],
  ['CC-2232', { fields: ['children', 'carve', 'notReported:import-attribute-dropped'], fix: KEY_ATTRIBUTES }],
  ['CC-2233', { fields: ['children', 'carve', 'diagnosticsComplete'], fix: KEY_ATTRIBUTES }],
  ['CC-2234', { fields: ['children', 'carve'], fix: NOTE_COMMENTS }],
  ['CC-2235', { fields: ['diagnostics:import-element-dropped', 'diagnosticsComplete'], fix: NOTE_COMMENTS }],
  ['CC-2236', { fields: ['children', 'carve'], fix: NOTE_COMMENTS }],
  ['CC-2218', { fields: ['html'], fix: LINE_OPTIONS }],
  ['CC-2227', { fields: ['html'], fix: LINE_OPTIONS }],
  ['CC-2228', { fields: ['html'], fix: LINE_OPTIONS }],
  ['CC-501', { fields: ['diagnostics:field-unspellable', 'diagnosticsComplete'], fix: METADATA_FIELDS }],
  ['CC-2265', { fields: ['carve'], fix: REGION_MARKER }],
  ['CC-2266', { fields: ['carve'], fix: REGION_MARKER }],
  ['CC-2267', { fields: ['carve'], fix: REGION_MARKER }],
  ['CC-1354', { fields: ['status'], fix: DJOT_GATE }],
  ['CC-2148', { fields: ['status', 'stdout', 'stderrCategory'], fix: QUOTE_LOCALE }],
  ['CC-2298', { fields: ['status', 'stdout', 'stderrCategory'], fix: QUOTE_LOCALE }],
  ['CC-2299', { fields: ['status', 'stdout', 'stderrCategory'], fix: QUOTE_LOCALE }],
  ['CC-2313', { fields: ['refusal'], fix: BINARY64 }],
  ['CC-2314', { fields: ['refusal'], fix: BINARY64 }],
  ['CC-2315', { fields: ['refusal'], fix: BINARY64 }],
  ['CC-2316', { fields: ['refusal'], fix: BINARY64 }],
  ['CC-2318', { fields: ['refusal'], fix: BINARY64 }],
  ['CC-2319', { fields: ['refusal'], fix: BINARY64 }],
  ['CC-2320', { fields: ['threw:TypeError'], fix: BINARY64 }],
  ['CC-2321', { fields: ['threw:TypeError'], fix: BINARY64 }],
  ['CC-2322', { fields: ['threw:TypeError'], fix: BINARY64 }],
  ['CC-2323', { fields: ['diagnosticsComplete'], fix: ESCAPE_ROUND_KEYS }],
  ['CC-2324', { fields: ['carve', 'diagnosticsComplete'], fix: ESCAPE_ROUND_KEYS }],
])

/** The field each refused tree is refused at: the field its clauses decide. */
export const REFUSED_AT: ReadonlyMap<string, string> = new Map([
  ['major-version', '/astVersion'], ['version-leading-zero', '/astVersion'], ['unknown-required-extension', '/extensions/0'],
  ['unknown-core-field', '/children/0/color'], ['unknown-core-field-nested', '/children/0/children/0/style'],
  ['unknown-core-type', '/children/0'], ['retired-type-figure', '/children/0'],
  ['extension-without-fallback', '/children/0/children/0/fallback'], ['extension-without-version', '/children/0/version'],
  ['declaration-without-version', '/extensions/0/version'], ['task-unknown-field', '/children/0/children/0/task/due'],
  ['marker-unknown-field', '/children/0/marker/color'], ['payload-unknown-field', '/children/0/children/0/payload/0/encoding'],
  ['manifest-unknown-field', '/resources/0/owner'], ['root-without-type', '/type'], ['root-without-children', '/children'],
  ['root-without-version', '/astVersion'], ['root-not-document', '/type'], ['schema-failure', '/children/0/level'],
  ['position-below-one', '/children/0/pos/startColumn'], ['envelope-version-differs', '/document/astVersion'],
  ['block-depth', '/children/0/children/0'], ['inline-depth', '/children/0/children/0'],
  ['data-undeclared', '/children/0/data/org.example.flag'], ['data-holds-node', '/children/0/data/org.example.flag'],
  ['caption-on-plain-paragraph', '/children/0/caption'], ['marker-start-one', '/children/0/marker/start'],
  ['include-range-order', '/children/0/options/lines'], ['include-region-shape', '/children/0/options/region'],
  ['role-image-text', '/children/0/children'], ['role-math-inline', '/children/0/children'],
  ['include-children-without-file', '/children/0/file'], ['duplicate-attribute-key', '/children/0/attrs/keyValues'],
  ['duplicate-extension-declaration', '/extensions/1/name'], ['head-rows-field', '/children/0/children/0/headRows'],
  ['attribute-key-not-a-key', '/children/0/attrs/keyValues/0/0'],
  ['math-number-without-prefix', '/children/0/children/0/number'], ['math-prefix-inline', '/children/0/children/0/numberPrefix'],
  ['table-group-order', '/children/0/children/1'], ['default-citation-mode', '/children/0/children/0/children/0/mode'],
  ['default-autolink-text', '/children/0/children/0/text'], ['default-empty-attrs', '/children/0/attrs'],
  ['ordered-marker-without-style', '/children/0/marker/style'],
  ['smart-punctuation-without-glyph', '/children/0/children/0/glyph'],
  ['smart-punctuation-other-glyph', '/children/0/children/0/glyph'], ['include-caption-without-code', '/children/0/caption'],
  ['table-cell-empty', '/children/0/children/0/children/0/children/0/children'],
  ['cell-paragraph-beside-block', '/children/0/children/0/children/0/children/0/children/0'],
  ['extension-source-name-raw-fence', '/children/0/source/name'],
  ['unqualified-inline-extension-fallback', '/children/0/children/0/fallback'],
  ['smart-punctuation-other-source', '/children/0/children/0/source'], ['marker-start-out-of-range', '/children/0/marker/start'],
  ['extension-undeclared', '/children/0/name'], ['extension-version-differs', '/children/0/version'],
  ['default-empty-props', '/children/0/props'], ['default-empty-resource-ids', '/children/0/resourceIds'],
  ['marker-of-both-kinds', '/children/0/marker/style'], ['metadata-unknown-field', '/metadata/unknown'],
  ['node-without-type', '/type'], ['unknown-root-field', '/extra'], ['member-as-root-block', '/children/0'],
  ['definition-in-quote', '/children/0/children/0'], ['table-source-widths-in-semantic-tree', '/children/0/separatorWidths'],
  ['cell-count-zero', '/children/0/children/0/children/0/children/0/colspan'],
  ['rowspan-past-group', '/children/0/children/0/children/0/children/0/rowspan'],
  ['annotation-id-repeated-across-nodes', '/children/0/data/carve.annotation/ids/0'], ['envelope-extra-field', '/extra'],
  ['decorative-image-with-alt', '/children/0/children/0'], ['bibliography-unknown-key', '/children/1/metadata/bibliography/unknown'],
  ['typed-metadata-wrong-value', '/metadata/fields/n/value'], ['namespace-not-declared', '/children/0/data/carve.source'],
  ['empty-importer-version', '/children/0/data/carve.source/importer/version'],
  ['named-styles-on-paragraph', '/children/0/data/carve.style'], ['qualified-extension-without-declaration', '/children/0/name'],
  ['extension-payload-empty-format', '/children/0/payload/0/format'], ['qualified-extension-missing-fallback', '/children/0/fallback'],
  ['extension-source-missing-body', '/children/0/source/body'], ['extension-slot-not-declared', '/children/0/slots/legend'],
  ['unqualified-extension-depth-33', `/children/0${'/children/0'.repeat(33)}`],
  ['image-decorative-false-without-alt', '/children/0/children/0'],
])

/** The supplied trees of trees/nodes.json the reader still refuses, each with its ticket; one that is accepted is a stale hold. */
export const HELD_SUPPLIED: ReadonlyMap<string, string> = new Map([])
