// What the corpus runner holds: the example and clause case fields whose stated result departs from its clause, and the
// field each refused tree is refused at. Every other gate a pin move can turn red has its own hold list here, judged by
// scripts/holds.ts.
import type { Holds } from './holds.ts'

// Rulings of the spec pin that carve-js does not implement yet; each hold goes with its port.
const KEY_ATTRIBUTES = 'carve#6605 an authored abbr, kbd or time attribute beside the key (C2-M-047; spec carve#6814)'
const NOTE_COMMENTS = 'carve#6235 the comments of a wrapper the note pass drops (C2-M-109; spec carve#6814)'
const LOOSE_CARRIER = 'carve#6844 data-carve-loose carries the spacing of a loose list (C2-H-138, C2-H-186; spec carve#6862)'
const IMAGE_PARAGRAPH = 'carve#6832 an image-only paragraph that would not import back keeps its p (C2-H-018; spec carve#6836)'
const NOTE_CONDITIONALS = 'carve#6850 the Word conditional comments of a dropped note wrapper (C2-M-109; spec carve#6851)'
const AUTHORED_FALLBACK = 'carve#6848 the authored-block fallback runs under normalize too (C2-W-088, C2-W-127; spec carve#6849)'

/**
 * The fields of the examples and clause cases that this engine does not pass yet: a stated result that departs from its own
 * clause, or a ruling of the pin not yet implemented here, each with its ticket. The field must keep failing until it is
 * fixed, and every other field of the example is still checked.
 */
export const HELD: ReadonlyMap<string, { fields: readonly string[], fix: string }> = new Map([
  ['CC-2230', { fields: ['children', 'carve', 'notReported:import-attribute-dropped'], fix: KEY_ATTRIBUTES }],
  ['CC-2231', { fields: ['children', 'carve', 'notReported:import-attribute-dropped'], fix: KEY_ATTRIBUTES }],
  ['CC-2232', { fields: ['children', 'carve', 'notReported:import-attribute-dropped'], fix: KEY_ATTRIBUTES }],
  ['CC-2233', { fields: ['children', 'carve', 'diagnosticsComplete'], fix: KEY_ATTRIBUTES }],
  ['CC-2234', { fields: ['children', 'carve'], fix: NOTE_COMMENTS }],
  ['CC-2235', { fields: ['diagnostics:import-element-dropped', 'diagnosticsComplete'], fix: NOTE_COMMENTS }],
  ['CC-2236', { fields: ['children', 'carve'], fix: NOTE_COMMENTS }],
  ['CC-2398', { fields: ['html'], fix: IMAGE_PARAGRAPH }],
  ['CC-2399', { fields: ['html'], fix: IMAGE_PARAGRAPH }],
  ['CC-2402', { fields: ['html'], fix: IMAGE_PARAGRAPH }],
  ['CC-2403', { fields: ['html'], fix: IMAGE_PARAGRAPH }],
  ['CC-2406', { fields: ['html'], fix: IMAGE_PARAGRAPH }],
  ['CC-2407', { fields: ['html'], fix: IMAGE_PARAGRAPH }],
  ['CC-2409', { fields: ['html'], fix: IMAGE_PARAGRAPH }],
  ['CC-2410', { fields: ['html'], fix: IMAGE_PARAGRAPH }],
  ['CC-2412', { fields: ['children'], fix: IMAGE_PARAGRAPH }],
  ['CC-1425', { fields: ['diagnostics:import-element-dropped'], fix: NOTE_CONDITIONALS }],
  ['CC-2428', { fields: ['carve', 'diagnosticsComplete'], fix: AUTHORED_FALLBACK }],
  ['CC-2414', { fields: ['html'], fix: LOOSE_CARRIER }],
  ['CC-2440', { fields: ['html'], fix: LOOSE_CARRIER }],
  ['CC-2441', { fields: ['children', 'carve'], fix: LOOSE_CARRIER }],
  ['CC-2442', { fields: ['html'], fix: LOOSE_CARRIER }],
  ['CC-2443', { fields: ['children', 'carve'], fix: LOOSE_CARRIER }],
  ['CC-2444', { fields: ['html'], fix: LOOSE_CARRIER }],
  ['CC-2445', { fields: ['html'], fix: LOOSE_CARRIER }],
  ['CC-2446', { fields: ['children', 'carve'], fix: LOOSE_CARRIER }],
  ['CC-2447', { fields: ['html'], fix: LOOSE_CARRIER }],
  ['CC-2450', { fields: ['children', 'carve', 'diagnostics:import-carrier-ignored'], fix: LOOSE_CARRIER }],
  ['CC-2451', { fields: ['children', 'carve', 'diagnostics:import-carrier-ignored'], fix: LOOSE_CARRIER }],
  ['CC-2452', { fields: ['children', 'carve', 'diagnostics:import-carrier-ignored'], fix: LOOSE_CARRIER }],
  ['CC-2453', { fields: ['children', 'carve'], fix: LOOSE_CARRIER }],
  ['CC-2454', { fields: ['html', 'diagnostics:carrier-attribute-dropped'], fix: LOOSE_CARRIER }],
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
  ['snippet-definition-id', '/children/0'], ['snippet-definition-empty', '/children/0'],
  ['snippet-use-mode-mismatch', '/children/0/children/0'],
])

/**
 * The rows of the pinned lint catalog this engine does not register or does not pass the catalog check of yet, each with
 * its ticket; one that passes is a stale hold.
 */
export const HELD_RULES: Holds = new Map()

/** The supplied trees of trees/nodes.json the reader still refuses, each with its ticket; one that is accepted is a stale hold. */
export const HELD_SUPPLIED: Holds = new Map()

/** The refused trees the reader does not refuse at their `REFUSED_AT` field yet, each with its ticket. */
export const HELD_REFUSED: Holds = new Map()

/** The example inputs the planned writer (C2-W-010, C2-W-089 in test/writer-plan.test.ts) does not pass yet, each with its ticket. */
export const WRITER_PLAN_HELD: Holds = new Map()
