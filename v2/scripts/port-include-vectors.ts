// Ports the 212 include vectors of 0.1 (tests/include-conformance/vectors on main of the specification repository)
// to the 0.2 data format of v2/test/include-vectors: virtual files or a file tree, the entry, the options, and the
// expected HTML, fmt, warnings by code, dependencies and positions. A changed vector states the clause its new
// expectation comes from; a dropped one is listed with its reason.
//   node v2/scripts/port-include-vectors.ts <0.1 vector directory> <_VECTORS.md>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { format } from '../src/format.ts'
import { includeSource, readInclude } from '../src/include.ts'

interface OldVector {
  name: string
  description: string
  rules: string[]
  mode: string
  resolver: string
  entry?: string
  files?: Record<string, string>
  tree?: Record<string, unknown>
  entryPath?: string
  root?: string
  options?: Record<string, unknown>
  checkPositions?: boolean
  checkWarningLocations?: boolean
  checkFmtExpandEquivalence?: boolean
  forbiddenSubstrings?: string[]
  expected: {
    html: string
    fmt: string
    warnings: { rule: string, file?: string }[]
    dependencies: { id: string, resolved: boolean }[]
    positions?: { type: string, pos?: Record<string, unknown> }[]
    warningLocations?: { rule: string, file?: string, line: number, column: number }[]
  }
}

interface Warning {
  code: string
  file?: string
}

interface Expected {
  html: string
  fmt: string
  warnings: Warning[]
  dependencies: { id: string, read: boolean }[]
  positions?: { type: string, pos: Record<string, unknown> }[]
  locations?: { code: string, file?: string, line: number, column: number }[]
}

interface NewVector {
  name: string
  description: string
  verdict: 'unchanged' | 'changed'
  clauses: string[]
  note?: string
  resolver: 'virtual' | 'virtual-ids' | 'throws' | 'filesystem' | 'none'
  entry?: string
  files?: Record<string, string>
  tree?: Record<string, unknown>
  entryPath?: string
  root?: string
  options?: { depth?: number, bytes?: number, file?: string, throws?: string }
  checkFmtExpandEquivalence?: boolean
  forbiddenSubstrings?: string[]
  expected: Expected
}

// The 0.1 rules and the clauses that carry them over (spec/0.2/includes.md, "What 0.1 rules became").
const RULE_CLAUSES: Readonly<Record<string, string[]>> = {
  I1: ['C2-N-024', 'C2-N-026', 'C2-N-034', 'C2-N-035'], I1a: ['C2-N-027', 'C2-N-028', 'C2-N-029', 'C2-N-030'],
  I1b: ['C2-N-037', 'C2-N-038', 'C2-N-039', 'C2-N-040', 'C2-N-041'], I1c: ['C2-N-042', 'C2-N-043', 'C2-N-044', 'C2-N-045'],
  I1d: ['C2-N-046', 'C2-N-047'], I2: ['C2-N-002', 'C2-N-016'], I3: ['C2-N-003', 'C2-N-007'], I4: ['C2-N-015', 'C2-N-019'],
  I5: ['C2-N-053', 'C2-N-057'], I6: ['C2-N-064', 'C2-N-065', 'C2-N-066'], I7: ['C2-N-061', 'C2-N-068'],
  I8: ['C2-N-048', 'C2-N-049', 'C2-N-050'], I9: ['C2-N-002', 'C2-N-042'], I9a: ['C2-N-002'], I10: ['C2-N-012', 'C2-N-013'],
  I11: ['C2-N-083', 'C2-N-084'], I12: ['C2-N-080', 'C2-N-081'], I13: [], I14: ['C2-N-080'], I15: ['C2-N-005'], I16: ['C2-N-085'],
}

// The 0.1 codes of a failure that leaves the include unexpanded; each also gives the render loss include-unresolved (C2-N-070).
const CAUSE_CODES = new Set([
  'include-unresolved', 'include-region-invalid', 'include-section', 'include-cycle', 'include-lines-out-of-range',
  'include-non-text', 'include-budget', 'include-depth', 'include-selection-conflict', 'include-rows-out-of-range',
  'include-cols-invalid', 'include-cols-duplicate',
])

const NOTE_REF = (n: number): string => `<a id="fnref${n}" href="#fn${n}" role="doc-noteref"><sup>${n}</sup></a>`
const NOTE = (n: number, text: string): string => [
  `    <li id="fn${n}">`,
  `      <p>${text}<a href="#fnref${n}" role="doc-backlink" aria-label="Back to reference">↩</a></p>`,
  '    </li>',
].join('\n')
const NOTES = (...notes: string[]): string => [
  '<section role="doc-endnotes" aria-label="Footnotes">', '  <hr>', '  <ol>', ...notes, '  </ol>', '</section>',
].join('\n')
const UNREAD = (id: string): { id: string, read: boolean } => ({ id, read: false })
const READ = (id: string): { id: string, read: boolean } => ({ id, read: true })
const W = (code: string, file?: string): Warning => (file === undefined ? { code } : { code, file })
const UNEXPANDED = (code: string, file?: string): Warning[] => [W(code, file), W('include-unresolved', file)]

/** A changed vector: the clauses its expectation comes from and the fields that differ from the 0.1 golden. */
interface Change {
  clauses: string[]
  expected: Partial<Expected>
  resolver?: NewVector['resolver']
  entry?: string
  files?: Record<string, string>
}

const sections = (...parts: [string, string, number?][]): string => parts.map(([id, text, level]) =>
  `<section id="${id}">\n  <h${level ?? 1}>${text}</h${level ?? 1}>\n</section>`).join('\n')

const CHANGES: Readonly<Record<string, Change>> = {
  // Ruling 6: no rename; per-file lookup, then outward.
  'i05-a-heading-and-a-paragraph-sharing-an-id': { clauses: ['C2-N-057', 'C2-N-058'], expected: {
    html: '<section id="tip">\n  <h1>Tip</h1>\n  <p id="tip">Child tip.</p>\n</section>', warnings: [W('duplicate-id', 'a.crv')] } },
  'i05-a-reference-follows-its-own-renamed-target': { clauses: ['C2-N-058'], expected: {
    html: '<p id="tip">Parent <a href="#only">p</a> tip.</p>\n<p id="only">only</p>\n<p id="tip">Child tip.</p>\n' +
      '<p>See <a href="#tip">mine</a> and <a href="#only">parent</a>.</p>', warnings: [W('duplicate-id', 'a.crv')] } },
  'i05-a-reference-follows-the-first-renamed-copy': { clauses: ['C2-N-058'], expected: {
    html: '<section id="dup">\n  <h1>Parent</h1>\n</section>\n<section id="dup">\n  <h1>One</h1>\n</section>\n' +
      '<section id="dup">\n  <h1>Two</h1>\n  <p>See <a href="#dup">Parent</a>.</p>\n</section>',
    warnings: [W('duplicate-id', 'a.crv'), W('duplicate-id', 'a.crv')] } },
  'i05-an-inline-span-colliding-with-a-block': { clauses: ['C2-N-058'], expected: {
    html: '<p id="tip">Parent.</p>\n<p>A <span id="tip">span</span> here.</p>', warnings: [W('duplicate-id', 'a.crv')] } },
  'i05-each-renamed-copy-takes-its-own-suffix': { clauses: ['C2-N-058'], expected: {
    html: sections(['dup', 'Parent'], ['dup', 'One'], ['dup', 'Two']), warnings: [W('duplicate-id', 'a.crv'), W('duplicate-id',
      'a.crv')] } },
  'i05-explicit-heading-id-collision-warns': { clauses: ['C2-N-058'], expected: {
    html: '<section id="intro">\n  <h1>A</h1>\n  <p>First.</p>\n</section>\n' +
      '<section id="intro">\n  <h1>B</h1>\n  <p>Second.</p>\n</section>',
    warnings: [W('duplicate-id', 'b.crv')] } },
  'i05-footnote-reference-crosses-the-boundary': { clauses: ['C2-N-054', 'C2-N-055'], expected: {
    html: `<p>See [^c].</p>\n<p>Child sees ${NOTE_REF(1)}.</p>\n${NOTES(NOTE(1, 'Parent note.'))}`, warnings: [] } },
  'i05-footnote-rename': { clauses: ['C2-N-055'], expected: { warnings: [] } },
  'i05-heading-id-rename': { clauses: ['C2-N-057', 'C2-N-058'], expected: { html: sections(['dup', 'A'], ['dup', 'B']),
    warnings: [W('duplicate-id', 'b')] } },
  'i05-parent-id-wins-child-crossref-follows': { clauses: ['C2-N-058'], expected: {
    html: '<section id="dup">\n  <h1>Child</h1>\n  <p>See <a href="#dup">Child</a>.</p>\n</section>\n' +
      '<section id="dup">\n  <h1>Parent</h1>\n</section>',
    warnings: [W('duplicate-id')] } },
  'i05-rename-suffix-skips-an-id-written-later': { clauses: ['C2-N-057'], expected: {
    html: sections(['dup', 'Parent'], ['dup', 'Child'], ['dup-2', 'Later']), warnings: [W('duplicate-id', 'a.crv')] } },
  'i05-two-paragraphs-sharing-an-id': { clauses: ['C2-N-058'], expected: {
    html: '<p id="tip">Parent tip.</p>\n<p id="tip">Child tip.</p>', warnings: [W('duplicate-id', 'a.crv')] } },
  // Rulings 2 to 4: tree-only expansion and local positions.
  'i01c-code-payload-is-not-parsed': { clauses: ['C2-N-016', 'C2-N-042', 'C2-N-080'], expected: {} },
  'i01c-code-region': { clauses: ['C2-N-016', 'C2-N-042', 'C2-N-080'], expected: {} },
  'i01c-code-span-bom': { clauses: ['C2-N-019', 'C2-N-044', 'C2-A-141'], expected: { positions: [
    { type: 'code_block', pos: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 3, startOffset: 3, endOffset: 8, file: 'b.txt' } },
    { type: 'code_block', pos: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 3, startOffset: 3, endOffset: 5, file: 'b.txt' } },
  ] } },
  'i04-child-frontmatter-is-the-child-s-own': { clauses: ['C2-N-021'], expected: {} },
  'i04-fragment-containment-unclosed-fence': { clauses: ['C2-N-015', 'C2-A-045'], expected: {
    html: '<p>Before.</p>\n<pre><code class="language-js">let x = 1;\n</code></pre>\n<p>After.</p>',
      warnings: [W('unclosed-code-fence', 'child')] } },
  'i05-merged-footnote-definitions-collect-at-the-end': { clauses: ['C2-N-016', 'C2-N-056'], expected: {} },
  // One code per cause, dependencies as include nodes, and 0.2 clauses outside the Includes document.
  'i01-bare-option-other-than-code-is-malformed': { clauses: ['C2-N-025', 'C2-H-133', 'C2-N-083'], expected: {
    html: '<p>{{ child @shift }}</p>', warnings: UNEXPANDED('include-option-invalid'), dependencies: [UNREAD('child')] } },
  'i01-inverted-line-range': { clauses: ['C2-N-025', 'C2-N-062', 'C2-N-083'], expected: {
    html: '<p>{{ child @lines:3-1 }}</p>', warnings: UNEXPANDED('include-option-invalid'), dependencies: [UNREAD('child')] } },
  'i01-repeated-option-bare-code-and-language': { clauses: ['C2-N-025', 'C2-H-133', 'C2-N-083'], expected: {
    html: '<p>{{ a.js @code @code:js }}</p>', warnings: UNEXPANDED('include-option-invalid'), dependencies: [UNREAD('a.js')] } },
  'i01-repeated-option-code-language': { clauses: ['C2-N-025', 'C2-H-133', 'C2-N-083'], expected: {
    html: '<p>{{ a.js @code:js @code:py }}</p>', warnings: UNEXPANDED('include-option-invalid'), dependencies: [UNREAD('a.js')] } },
  // C2-H-133: the valid options in the order of C2-W-058, then the entries of `invalid`.
  'i01-repeated-option-lines': { clauses: ['C2-N-025', 'C2-H-133', 'C2-W-058', 'C2-N-083'], expected: {
    html: '<p>{{ a.js @lines:1-1 @code @lines:3-3 }}</p>', warnings: UNEXPANDED('include-option-invalid'),
    dependencies: [UNREAD('a.js')] } },
  'i01-repeated-option-shift': { clauses: ['C2-N-025', 'C2-H-133', 'C2-W-058', 'C2-N-083'], expected: {
    html: '<p>{{ a.js @shift:1 @code @shift:2 }}</p>', warnings: UNEXPANDED('include-option-invalid'),
    dependencies: [UNREAD('a.js')] } },
  // C2-B-202: a tab does not end a bare path; C2-H-133 and C2-W-058 write one space before the section.
  'i01-section-after-a-tab': { clauses: ['C2-B-202', 'C2-N-061', 'C2-H-133', 'C2-W-058'], expected: {
    html: '<p>{{ child\t #pick }}</p>', fmt: '{{ child\t #pick }}\n', warnings: UNEXPANDED('include-not-found') } },
  'i01-shift-malformed-value': { clauses: ['C2-N-025', 'C2-H-133', 'C2-N-083'], expected: {
    html: '<p>{{ child @shift:x }}</p>', warnings: UNEXPANDED('include-option-invalid'), dependencies: [UNREAD('child')] } },
  'i01-two-section-names-conflict': { clauses: ['C2-B-203', 'C2-N-002'], expected: {
    html: '<p>{{ child #Alpha #Beta }}</p>', warnings: [] } },
  'i01-unknown-option-literal': { clauses: ['C2-N-025', 'C2-H-133', 'C2-N-083'], expected: {
    html: '<p>{{ child @nope:1 }}</p>', warnings: UNEXPANDED('include-option-invalid'), dependencies: [UNREAD('child')] } },
  'i01b-region-selector-conflict': { clauses: ['C2-N-024', 'C2-H-133', 'C2-W-058', 'C2-N-083'], expected: {
    html: '<p>{{ child @lines:1-2 @region:demo }}</p>', warnings: UNEXPANDED('include-selection-conflict'),
    dependencies: [UNREAD('child')] } },
  'i01c-code-language-must-be-a-language-token': { clauses: ['C2-N-025', 'C2-N-083'], expected: {
    warnings: UNEXPANDED('include-option-invalid'), dependencies: [UNREAD('a.js')] } },
  'i01c-code-section-conflict': { clauses: ['C2-N-024', 'C2-N-083'], expected: {
    warnings: UNEXPANDED('include-selection-conflict'), dependencies: [UNREAD('child')] } },
  // C2-N-045: the child is the table an authored fence gives, with the cell of the unclosed quote holding the rest.
  'i01c-code-table-malformed-quoting': { clauses: ['C2-B-181', 'C2-N-045'], expected: {
    html: '<table>\n  <thead>\n    <tr><th scope="col">a</th><th scope="col">b</th></tr>\n  </thead>\n  <tbody>\n' +
      '    <tr><td>bad</td></tr>\n  </tbody>\n</table>', warnings: [W('delimited-table-malformed', 'data.csv')] } },
  'i03-no-deps-without-resolver': { clauses: ['C2-N-003', 'C2-N-083'], expected: {
    warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('child')] } },
  'i04-attribution-grandchild': { clauses: ['C2-N-061', 'C2-N-063'], expected: { warnings: UNEXPANDED('include-not-found',
    'section.crv') } },
  'i04-attribution-omitted-without-sourcepath': { clauses: ['C2-N-061', 'C2-N-063'],
    expected: { warnings: UNEXPANDED('include-not-found') } },
  // C2-A-142: a finding in the top-level document names no file.
  'i04-attribution-toplevel': { clauses: ['C2-N-061', 'C2-A-142'], expected: { warnings: UNEXPANDED('include-not-found') } },
  'i04-included-warning-source-line': { clauses: ['C2-N-061', 'C2-N-063'], expected: {
    warnings: UNEXPANDED('include-not-found', 'child.crv'),
    locations: [{ code: 'include-not-found', file: 'child.crv', line: 3, column: 1 }] } },
  'i07-binary-content-non-text': { clauses: ['C2-N-011', 'C2-N-070'], expected: { warnings: UNEXPANDED('include-non-text') } },
  'i07-resolver-throws-no-leak': { clauses: ['C2-N-013', 'C2-N-068'], expected: { warnings: UNEXPANDED('include-unreadable') } },
  'i07-selection-conflict': { clauses: ['C2-N-024', 'C2-H-133', 'C2-N-083'], expected: {
    html: '<p>{{ child #x @lines:1-1 }}</p>', warnings: UNEXPANDED('include-selection-conflict'), dependencies: [UNREAD('child')] } },
  // C2-H-127: with rawHtml off a raw block is written as code.
  'i09-verbatim-raw-block': { clauses: ['C2-H-127', 'C2-N-002'],
    expected: { html: '<pre><code class="language-html">{{ child }}\n</code></pre>' } },
  'i10-fs-absolute-path-denied': { clauses: ['C2-N-012', 'C2-H-133', 'C2-N-084'], expected: {
    html: '<p>{{ <TMP>/secret.crv }}</p>', warnings: UNEXPANDED('include-outside-root'), dependencies: [UNREAD('<TMP>/secret.crv')] } },
  'i10-fs-dotdot-escape-denied': { clauses: ['C2-N-012', 'C2-N-084'], expected: {
    warnings: UNEXPANDED('include-outside-root'), dependencies: [READ('ok.crv'), UNREAD('../secret.crv')] } },
  'i10-fs-symlink-dir-escape-denied': { clauses: ['C2-N-012'], expected: { warnings: UNEXPANDED('include-outside-root') } },
  'i10-fs-symlink-file-and-dotdot-denied': { clauses: ['C2-N-012'], expected: {
    warnings: [...UNEXPANDED('include-outside-root'), ...UNEXPANDED('include-outside-root')] } },
  'i11-fs-escaping-target-below-the-root-keeps-its-spelling': { clauses: ['C2-N-012', 'C2-N-083', 'C2-N-084'], expected: {
    warnings: UNEXPANDED('include-outside-root', 'sub/frag.crv'), dependencies: [READ('sub/frag.crv'), UNREAD('../../secret.crv')] } },
  'i11-fs-missing-target-below-the-root-names-where-it-would-appear': { clauses: ['C2-N-013', 'C2-N-084'], expected: {
    warnings: UNEXPANDED('include-not-found', 'sub/frag.crv'), dependencies: [READ('sub/frag.crv'), UNREAD('sub/missing.crv')] } },
  'i11-missing-target-unresolved-dep': { clauses: ['C2-N-013', 'C2-N-083'], expected: { warnings: UNEXPANDED('include-not-found') } },
  'i12-fmt-across-blocks': { clauses: ['C2-N-002', 'C2-N-003', 'C2-N-083'], expected: {
    warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('a.crv')] } },
  'i12-fmt-auto-preserved': { clauses: ['C2-N-003', 'C2-H-133', 'C2-N-080'], expected: {
    html: '<p>{{ chapter.crv @shift:auto }}</p>', warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('chapter.crv')] } },
  // Restated without the inline directive, which 0.2 does not have (C2-N-002).
  'i12-fmt-expand-equivalence': {
    clauses: ['C2-N-002', 'C2-N-049', 'C2-N-081'], entry: '{{ a.crv }}\n\nSee and here:\n\n{{ "c d.crv" @shift:auto }}',
    files: { 'a.crv': '# Chapter\n\nBody.', 'c d.crv': '## Quoted path' },
    expected: {
      html: '<section id="Chapter">\n  <h1>Chapter</h1>\n  <p>Body.</p>\n  <p>See and here:</p>\n  <section id="Quoted-path">\n' +
        '    <h2>Quoted path</h2>\n  </section>\n</section>',
      fmt: '{{ a.crv }}\n\nSee and here:\n\n{{ "c d.crv" @shift:auto }}\n', dependencies: [READ('a.crv'), READ('c d.crv')],
    },
  },
  // C2-N-061: without a resolver no_resolver, rank 1, is the cause that is reported.
  'i12-fmt-invalid-option-preserved': { clauses: ['C2-N-003', 'C2-N-061', 'C2-H-133'], expected: {
    html: '<p>{{ chapter.crv @bogus:1 }}</p>', warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('chapter.crv')] } },
  'i12-fmt-lines-preserved': { clauses: ['C2-N-003', 'C2-H-133'], expected: {
    html: '<p>{{ chapter.crv @lines:2-40 }}</p>', warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('chapter.crv')] } },
  'i12-fmt-malformed-section-preserved': { clauses: ['C2-B-203', 'C2-N-003', 'C2-H-133'], expected: {
    html: '<p>{{ chapter.crv #1bad }}</p>', warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('chapter.crv')] } },
  // C2-W-058: a path whose bare form cannot hold it is quoted (open point 5 of the Includes document).
  'i12-fmt-quoted-plain-quotes': { clauses: ['C2-N-003', 'C2-H-133', 'C2-W-058'], expected: {
    html: '<p>{{ "my chapter.crv" }}</p>', warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('my chapter.crv')] } },
  'i12-fmt-section-preserved': { clauses: ['C2-N-003', 'C2-H-133'], expected: {
    html: '<p>{{ chapter.crv #intro }}</p>', warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('chapter.crv')] } },
  // C2-H-133 writes the decoded integer; C2-L-055 keeps the spelling `+1` in fmt, since it decodes to the same value.
  'i12-fmt-shift-preserved': { clauses: ['C2-N-003', 'C2-H-133', 'C2-W-058', 'C2-L-055'], expected: {
    html: '<p>{{ chapter.crv @shift:1 }}</p>', warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('chapter.crv')] } },
  'i12-fmt-verbatim-wellformed': { clauses: ['C2-N-003'], expected: {
    warnings: UNEXPANDED('include-no-resolver'), dependencies: [UNREAD('chapter.crv')] } },
  'i14-fmt-empty-braces-escaped': { clauses: ['C2-B-202', 'C2-W-058'], expected: {} },
  'i14-fmt-not-shape-wellformed-escaped': { clauses: ['C2-B-201', 'C2-W-058'], expected: {} },
}

/** Vectors _VECTORS.md keeps unchanged where a clause decides otherwise (_SPEC_GAPS.md). */
const RULED: Readonly<Record<string, Change & { note: string }>> = {
  // C2-B-010: a lone CR is no line end, so the file is one line and its marker is malformed (C2-N-040).
  'i01c-code-span-cr-region': { clauses: ['C2-B-010', 'C2-N-034', 'C2-N-040', 'C2-N-041'],
    note: 'C2-B-010 ends a line only at LF, so the file is one line and its region marker is malformed',
    expected: { html: '<p>{{ q.js @region:a @code }}</p>', warnings: UNEXPANDED('include-region-invalid'), positions: [] } },
  // C2-N-002: `{{` with no path is text, each brace read on its own; the inline chapter forms no tag behind `{{ `.
  'i01-section-only-no-path-literal': { clauses: ['C2-N-002', 'C2-B-202'],
    note: 'a directive with no path is text, which the 0.2 inline chapter reads with no tag in it',
    expected: { html: '<p>{{ #intro }}</p>' } },
}

/** The verdict of each vector in _VECTORS.md, and its note. */
function verdicts(text: string): Map<string, { section: string, note: string }> {
  const out = new Map<string, { section: string, note: string }>()
  let section = ''
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) section = line.slice(3).replace(/ \(\d+\)$/, '')
    const match = /^\| `([^`]+)` \|(.*)\|\s*$/.exec(line)
    if (match !== null && section !== '') out.set(match[1]!, { section, note: match[2]!.trim() })
  }
  return out
}

function resolverOf(old: OldVector): NewVector['resolver'] {
  if (old.mode === 'filesystem') return 'filesystem'
  if (old.resolver === 'none') return 'none'
  if (old.options?.['resolverThrows'] !== undefined) return 'throws'
  return old.options?.['resolverIds'] === true ? 'virtual-ids' : 'virtual'
}

/** The fs ids of 0.1 are `<TMP>/<root>/...`; a 0.2 id is the path from the root (v2/cli/include-fs.ts). */
function fsId(id: string, root: string): string {
  const prefix = root === '.' ? '<TMP>/' : `<TMP>/${root}/`
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

function oldWarnings(old: OldVector, root: string): Warning[] {
  const out: Warning[] = []
  for (const warning of old.expected.warnings) {
    const file = warning.file === undefined ? undefined : fsId(warning.file, root)
    // C2-A-142: a finding in the top-level document names no file.
    const entry = old.entryPath === undefined ? undefined : fsId(`<TMP>/${old.entryPath}`, root)
    const own = file === undefined || file === old.options?.['sourcePath'] || file === entry ? undefined : file
    out.push(W(warning.rule, own))
    if (CAUSE_CODES.has(warning.rule)) out.push(W('include-unresolved', own))
  }
  return out
}

function oldPositions(old: OldVector): Expected['positions'] {
  const positions = old.expected.positions
  if (positions === undefined) return undefined
  return positions.flatMap((entry) => (entry.pos === undefined ? [] : [{ type: entry.type, pos: entry.pos }]))
}

const SPAN = /<span class="(?:tag|mention)"><strong>([^<]*)<\/strong><\/span>/g

function unescaped(html: string): string {
  return html.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&')
}

function escaped(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * C2-H-133: an unexpanded include is a paragraph that holds its directive as text, the options in the order of
 * C2-W-058 and the invalid entries after them. 0.1 read tags and mentions in it and kept the author's order.
 */
function directiveText(html: string): string {
  return html.split('\n').map((line) => {
    if (!line.startsWith('<p>{{ ') || !line.endsWith(' }}</p>')) return line
    const text = unescaped(line.slice(3, -4).replaceAll(SPAN, '$1'))
    const parts = readInclude(text, 0, text.length)
    if (parts === null) return line
    const node = { type: 'include' as const, path: parts.path, ...(parts.section === null ? {} : { section: parts.section }),
      ...(Object.keys(parts.options).length === 0 ? {} : { options: parts.options }),
      ...(parts.invalid.length === 0 ? {} : { invalid: parts.invalid }) }
    return `<p>${escaped(includeSource(node))}</p>`
  }).join('\n')
}

/** C2-W-002, C2-W-035, C2-W-058: the fmt golden is 0.2 canonical source, which the writer spells. */
function canonical(old: OldVector, entry: string | undefined): string {
  const source = entry ?? String(old.tree?.[old.entryPath ?? ''] ?? '').replaceAll(/<ABS:([^>]+)>/g, '<TMP>/$1')
  return format(source)
}

/** The change of a vector: its row in CHANGES, or a clause that rules a vector _VECTORS.md keeps unchanged. */
function changeOf(old: OldVector, verdict: { section: string, note: string }, html: string): { change?: Change, note?: string } {
  if (verdict.section.startsWith('Changed')) {
    const change = CHANGES[old.name]
    if (change === undefined) throw new Error(`no change for ${old.name}`)
    return { change, note: verdict.note }
  }
  const ruled = RULED[old.name]
  if (ruled !== undefined) return { change: ruled, note: `_VECTORS.md lists it unchanged; ${ruled.note}` }
  if (html === old.expected.html) return {}
  const note = '_VECTORS.md lists it unchanged; C2-H-133 writes the directive as text, the options in the order of C2-W-058'
  return { change: { clauses: ['C2-H-133', 'C2-W-058'], expected: {} }, note }
}

function expectedOf(old: OldVector, html: string, entry: string | undefined): Expected {
  const root = old.root ?? '.'
  const expected: Expected = {
    html,
    fmt: canonical(old, entry),
    warnings: oldWarnings(old, root),
    dependencies: old.expected.dependencies.map((dep) => ({ id: fsId(dep.id, root), read: dep.resolved })),
  }
  const positions = oldPositions(old)
  if (positions !== undefined) expected.positions = positions
  const locations = old.expected.warningLocations
  if (locations !== undefined) {
    expected.locations = locations.map((entry) => ({
      code: entry.rule, ...(entry.file === undefined ? {} : { file: entry.file }), line: entry.line, column: entry.column,
    }))
  }
  return expected
}

const OPTION_NAMES: readonly [string, 'depth' | 'bytes' | 'file' | 'throws'][] = [
  ['maxDepth', 'depth'], ['maxBytes', 'bytes'], ['sourcePath', 'file'], ['resolverThrows', 'throws'],
]

function optionsOf(old: OldVector): NewVector['options'] | undefined {
  const options: Record<string, unknown> = {}
  for (const [from, to] of OPTION_NAMES) if (old.options?.[from] !== undefined && from !== 'resolverIds') options[to] = old.options[from]
  return Object.keys(options).length > 0 ? options as NewVector['options'] : undefined
}

function clausesOf(old: OldVector, change: Change | undefined): string[] {
  return change?.clauses ?? [...new Set(old.rules.flatMap((rule) => RULE_CLAUSES[rule] ?? []))]
}

function port(old: OldVector, verdict: { section: string, note: string }): NewVector {
  const html = directiveText(old.expected.html)
  const { change, note } = changeOf(old, verdict, html)
  const entry = change?.entry ?? old.entry
  const out: NewVector = {
    name: old.name, description: old.description, verdict: change === undefined ? 'unchanged' : 'changed',
    clauses: clausesOf(old, change), resolver: change?.resolver ?? resolverOf(old),
    expected: { ...expectedOf(old, html, entry), ...change?.expected },
  }
  if (note !== undefined) out.note = note
  if (old.mode === 'filesystem') Object.assign(out, { tree: old.tree, entryPath: old.entryPath, root: old.root ?? '.' })
  else Object.assign(out, { entry, files: change?.files ?? old.files ?? {} })
  return withChecks(old, out)
}

function withChecks(old: OldVector, out: NewVector): NewVector {
  const options = optionsOf(old)
  if (options !== undefined) out.options = options
  if (old.checkFmtExpandEquivalence === true) out.checkFmtExpandEquivalence = true
  if (old.forbiddenSubstrings !== undefined) out.forbiddenSubstrings = old.forbiddenSubstrings
  return out
}

if (process.argv[1] === import.meta.filename) {
  const [from, table] = process.argv.slice(2)
  if (from === undefined || table === undefined) throw new Error('usage: port-include-vectors.ts <0.1 vectors> <_VECTORS.md>')
  const rows = verdicts(readFileSync(table, 'utf8'))
  const target = join(import.meta.dirname, '../test/include-vectors')
  mkdirSync(join(target, 'vectors'), { recursive: true })
  const dropped: { name: string, reason: string }[] = []
  const kept: { name: string, verdict: string }[] = []
  const reclassified: string[] = []
  for (const file of readdirSync(from).filter((name) => name.startsWith('i') && name.endsWith('.json')).sort()) {
    const old = JSON.parse(readFileSync(join(from, file), 'utf8')) as OldVector
    const verdict = rows.get(old.name)
    if (verdict === undefined) throw new Error(`${old.name} is not classified`)
    if (verdict.section.startsWith('Drop')) {
      dropped.push({ name: old.name, reason: verdict.note })
      continue
    }
    const vector = port(old, verdict)
    kept.push({ name: vector.name, verdict: vector.verdict })
    if (vector.verdict === 'changed' && verdict.section === 'Unchanged') reclassified.push(vector.name)
    writeFileSync(join(target, 'vectors', file), `${JSON.stringify(vector, null, 2)}\n`)
  }
  const manifest = {
    source: 'tests/include-conformance/vectors on main of markup-carve/carve (0.1)',
    total: kept.length + dropped.length,
    unchanged: kept.filter((entry) => entry.verdict === 'unchanged').length,
    changed: kept.filter((entry) => entry.verdict === 'changed').length,
    reclassified,
    dropped,
  }
  writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`${manifest.unchanged} unchanged, ${manifest.changed} changed, ${dropped.length} dropped`)
}
