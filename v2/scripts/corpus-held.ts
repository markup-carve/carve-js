// What the corpus runner holds: the example fields whose stated result departs from its clause, and the
// field each refused tree is refused at.

/**
 * The fields of the examples whose stated result departs from its own clause. Each is written up, with the
 * clause-correct result, in _EXAMPLE_FIXES.md for the specification; the field must keep failing until the
 * corpus is corrected, and every other field of the example is still checked.
 */
export const HELD: ReadonlyMap<string, { fields: readonly string[], fix: string }> = new Map([
  ['includes-38', { fields: ['tree'], fix: '_EXAMPLE_FIXES.md F8: the copy in the child carries its note number (C2-N-074, C2-A-100)' }],
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
  ['default-empty-props', '/children/0/props'],
])
