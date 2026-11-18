// What the corpus runner holds: the example and clause case fields whose stated result departs from its clause, and the
// field each refused tree is refused at.

/**
 * The fields of the examples and clause cases whose stated result departs from its own clause. Each is written up, with the
 * clause-correct result, in _EXAMPLE_FIXES.md for the specification; the field must keep failing until the
 * corpus is corrected, and every other field of the example is still checked.
 */
export const HELD: ReadonlyMap<string, { fields: readonly string[], fix: string }> = new Map([
  ['includes-38', { fields: ['tree'], fix: '_EXAMPLE_FIXES.md F1: the copy in the child carries its note number (C2-N-074, C2-A-100)' }],
  ['CC-1048', { fields: ['html'], fix: '_EXAMPLE_FIXES.md F2: sections are on by default (C2-H-026, C2-H-127)' }],
  ['CC-1142', { fields: ['diagnostics:unresolved-reference-link'],
    fix: '_EXAMPLE_FIXES.md F3: a render reports its parse and render losses, while unresolved-reference-link belongs to lint' }],
  ['CC-601', { fields: ['diagnostics:duplicate-id'], fix: 'C2-W-138 ranges the id rather than the later span' }],
  ['CC-813', { fields: ['diagnostics:semantic-attribute-value-ignored'],
    fix: 'C2-W-138 ranges the key and value rather than the whole span' }],
  ['CC-891', { fields: ['diagnostics:delimited-table-wide-row'],
    fix: 'C2-W-138 ranges the whole table rather than only its fence opener' }],
  ['CC-996', { fields: ['diagnostics:duplicate-id'], fix: 'C2-W-138 ranges the id rather than the later span' }],
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
])
