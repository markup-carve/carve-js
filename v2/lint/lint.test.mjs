import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { format } from '../src/format.ts'
import { lint } from './lint.ts'
import { CATALOG } from './catalog.ts'
import { IMPLEMENTED_RULES } from './lint.ts'

const CASES = [
  { id: 'deprecated-continuation-marker', trigger: '- a\n+\nb', near: '- a\n\nb', fragment: '+' },
  { id: 'thematic-break-spelling', trigger: '___', near: '***', fragment: '___' },
  { id: 'setext-heading-underline', trigger: 'A\n---', near: '= A', fragment: '---' },
  { id: 'deprecated-spaced-thematic-break', trigger: '- - -', near: '***', fragment: '- - -' },
  { id: 'block-marker-as-text', trigger: '~~~js\nx\n~~~', near: '```js\nx\n```', fragment: '~~~js' },
  { id: 'html-comment-renders-as-text', trigger: '<!-- x -->', near: '%% x', fragment: '<!-- x -->' },
  { id: 'bare-html-tag', trigger: '<b>x</b>', near: '[x](/b)', fragment: '<b>' },
  { id: 'empty-reference-definition', trigger: '[a]:', near: '[a]: /u', fragment: '[a]:' },
  { id: 'table-shaped-paragraph', trigger: '| a | b', near: '| a | b |', fragment: '| a | b' },
  { id: 'blockquote-marker-without-space', trigger: '>x', near: '> x', fragment: '>x' },
  { id: 'indented-code-block', trigger: '    code', near: '```\ncode\n```', fragment: 'code' },
  { id: 'unattached-block-attribute', trigger: '{.x}', near: '{.x}\ntext', fragment: '{.x}' },
  { id: 'empty-include-path', trigger: '{{ }}', near: '{{ file.crv }}', fragment: '{{ }}' },
  { id: 'link-gap-before-destination', trigger: '[x] (/u)', near: '[x](/u)', fragment: '] (' },
  { id: 'deprecated-bare-underline', trigger: 'a _x_ b', near: 'a {_x_} b', fragment: '_x_' },
  { id: 'deprecated-bare-strike', trigger: 'a ~x~ b', near: 'a {~x~} b', fragment: '~x~' },
  { id: 'deprecated-bare-highlight', trigger: 'a =x= b', near: 'a {=x=} b', fragment: '=x=' },
  { id: 'markdown-strong-double-star', trigger: '**bold**', near: '*bold*', fragment: '**bold**' },
  { id: 'markdown-strikethrough-double-tilde', trigger: '~~x~~', near: '{~x~}', fragment: '~~x~~' },
  { id: 'a11y/image-alt', trigger: '![](/x)', near: '![x](/x)', fragment: '![](/x)' },
  { id: 'empty-link-destination', trigger: '[x]()', near: '[x](/u)', fragment: '[x]()' },
  { id: 'deprecated-loose-attribute', trigger: '{loose}\n- a\n- b', near: '- a\n- b', fragment: '{loose}' },
  { id: 'heading-level-skip', trigger: '# One\n\n### Two', near: '# One\n\n## Two', fragment: '### Two' },
  { id: 'duplicate-reference-url', trigger: '[a]: /u\n\n[b]: /u', near: '[a]: /u\n\n[b]: /v', fragment: '[b]: /u' },
  { id: 'deprecated-separator-row', trigger: '| a |\n|---|', near: '|= a |', fragment: '|---|' },
  { id: 'frontmatter-shaped-thematic-break', trigger: '---', near: '---\ntitle: x\n---', fragment: '---' },
  { id: 'unused-link-reference-definition', trigger: '[a]: /u', near: '[a]: /u\n\n[a][]', fragment: '[a]: /u' },
  { id: 'unresolved-reference-link', trigger: '[a][b]', near: '[b]: /u\n\n[a][b]', fragment: '[a][b]' },
  { id: 'unresolved-footnote', trigger: 'See [^a].', near: '[^a]: Note.\n\nSee [^a].', fragment: '[^a]' },
  { id: 'unused-footnote-definition', trigger: '[^a]: Note.', near: '[^a]: Note.\n\nSee [^a].', fragment: '[^a]: Note.' },
  { id: 'broken-fragment-link', trigger: '[x](#no)', near: '# yes\n\n[x](#yes)', fragment: '[x](#no)' },
  { id: 'broken-crossref', trigger: '</#no>', near: '# yes\n\n</#yes>', fragment: '</#no>' },
  { id: 'deprecated-cell-alignment', trigger: '|< a |', near: '|={<} a |', fragment: '< a' },
  { id: 'deprecated-indented-line-under-heading', trigger: '# Heading\n  continuation', near: '# Heading\ncontinuation',
    fragment: 'continuation' },
  { id: 'description-term-multi-line', trigger: ':: term\nmore\n: desc', near: ':: term\n: desc', fragment: 'more' },
  { id: 'figure-group-empty', trigger: '::: figure\ntext\n:::', near: '::: figure\n| a |\n^ cap\n:::', fragment: '::: figure' },
  { id: 'figure-group-nested', trigger: '::: figure\n::: figure\n:::\n:::', near: '::: figure\n| a |\n^ cap\n:::',
    fragment: '::: figure' },
  { id: 'figure-group-single-panel', trigger: '::: figure\n| a |\n^ cap\n:::',
    near: '::: figure\n| a |\n^ cap\n| b |\n^ cap\n:::', fragment: '::: figure' },
  { id: 'figure-group-opener-metadata', trigger: '::: figure "T"\ntext\n:::', near: '::: figure\ntext\n:::',
    fragment: '::: figure "T"' },
  { id: 'platform-issue-reference', trigger: 'See #123.', near: 'See item 123.', fragment: '#123',
    options: { platforms: ['github'] } },
  { id: 'platform-mention-token', trigger: 'See @bob.', near: 'See Bob.', fragment: '@bob',
    options: { platforms: ['github'] } },
  { id: 'braced-comment-in-a-template-source', trigger: '{% if x %}', near: '{% note %}', fragment: '{% if x %}' },
  { id: 'caption-looking-paragraph', trigger: '| a |\nTable: cap', near: '| a |\n^ cap', fragment: 'Table: cap' },
  { id: 'carve-version-unsupported', trigger: '---\ncarve: 0.3\n---', near: '---\ncarve: 0.2\n---', fragment: 'carve: 0.3' },
  { id: 'consumed-key-near-miss', trigger: '{align=left}\n| a |', near: '{aligns=left}\n| a |', fragment: 'align=left' },
  { id: 'delimited-table-wide-row', trigger: '{table}\n```csv\na,b\nc,d,e\n```',
    near: '{table}\n```csv\na,b\nc,d\n```', fragment: 'c,d,e' },
  { id: 'deprecated-table-attribute', trigger: '{header-rows=1}\n| a |', near: '{header-cols=1}\n| a |',
    fragment: 'header-rows=1' },
  { id: 'djot-emphasis-underscore', trigger: 'a _x_ b', near: 'a /x/ b', fragment: '_x_',
    options: { rules: { 'djot-emphasis-underscore': 'on' } } },
  { id: 'djot-heading-continuation', trigger: '# h\ntext', near: '# h\n\ntext', fragment: 'text',
    options: { rules: { 'djot-heading-continuation': 'on' } } },
  { id: 'djot-highlight-braces', trigger: '{=x=}', near: '=x=', fragment: '{=x=}',
    options: { rules: { 'djot-highlight-braces': 'on' } } },
  { id: 'djot-intraword-underscore', trigger: 'a_x_b', near: 'a _x_ b', fragment: '_x_',
    options: { rules: { 'djot-intraword-underscore': 'on' } } },
  { id: 'djot-plus-bullet', trigger: '+ a', near: '- a', fragment: '+ a',
    options: { rules: { 'djot-plus-bullet': 'on' } } },
  { id: 'djot-subscript-tilde', trigger: 'a ~x~ b', near: 'a {,x,} b', fragment: '~x~',
    options: { rules: { 'djot-subscript-tilde': 'on' } } },
  { id: 'djot-subscript-tilde-braced', trigger: '{~x~}', near: '{,x,}', fragment: '{~x~}',
    options: { rules: { 'djot-subscript-tilde-braced': 'on' } } },
  { id: 'djot-superscript-caret', trigger: 'a ^x^ b', near: 'a {^x^} b', fragment: '^x^',
    options: { rules: { 'djot-superscript-caret': 'on' } } },
  { id: 'figure-group-panel-number', trigger: '::: figure\n| a |\n^ # cap\n:::',
    near: '::: figure\n| a |\n^ cap\n:::', fragment: '^ # cap' },
  { id: 'footnote-labels-differ-only-in-whitespace', trigger: '[^a b]: one\n\n[^a  b]: two',
    near: '[^a b]: one\n\n[^c d]: two', fragment: '[^a  b]: two' },
  { id: 'heading-marker-mixed', trigger: '= One\n\n# Two', near: '= One\n\n= Two', fragment: '# Two' },
  { id: 'quote-fence-ends-the-quote-above', trigger: '> a\n::: >\nb\n:::',
    near: '> a\n> ::: >\nb\n:::', fragment: '::: >' },
  { id: 'region-marker-renders-as-text', trigger: '#region x', near: '%% #region x', fragment: '#region x' },
  { id: 'semantic-attribute-outside-span', trigger: '{mark=foo}\n# H', near: '[x]{mark=foo}',
    fragment: 'mark=foo' },
  { id: 'semantic-attribute-value-ignored', trigger: '[x]{mark=foo}', near: '[x]{mark}', fragment: 'mark=foo' },
  { id: 'table-column-arity', trigger: '{widths=10}\n| a | b |', near: '{widths=10,20}\n| a | b |',
    fragment: 'widths=10' },
  { id: 'table-column-overlap', trigger: '{aligns=left}\n|={>} a |= b |',
    near: '{aligns=left}\n|= a |= b |', fragment: 'aligns=left' },
  { id: 'table-marker-run-padding', trigger: '|{.x}> a |', near: '|>{.x} a |', fragment: '{.x}>' },
  { id: 'table-row-without-closing-pipe', trigger: '| a | b', near: '| a | b |', fragment: '| a | b',
    options: { rules: { 'table-row-without-closing-pipe': 'on' } } },
  { id: 'table-width-total', trigger: '{widths=60,60}\n| a | b |', near: '{widths=50,50}\n| a | b |',
    fragment: 'widths=60,60' },
  { id: 'tight-list-item-with-blank-line', trigger: '- a\n\n  b\n- c', near: '- a\n\n- c', fragment: 'a',
    options: { rules: { 'tight-list-item-with-blank-line': 'on' } } },
  { id: 'uneven-list-indent', trigger: '  - a\n- b', near: '- a\n- b', fragment: '- b' },
]

const CORPUS_CASES = JSON.parse(fs.readFileSync(new URL('./corpus-cases.json', import.meta.url), 'utf8'))

function catalogMessageMatches(id, message) {
  return CATALOG[id].messages.some((template) => {
    const pieces = template.split(/\$\{[^}]+\}/)
    const expression = pieces.map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    return new RegExp(`^${expression}$`, 's').test(message)
  })
}

describe('C2-W-106 catalog rules', () => {
  it('registers each lint catalog row exactly once', () => {
    const implemented = IMPLEMENTED_RULES.map((rule) => rule.id)
    expect(new Set(implemented).size).toBe(implemented.length)
    expect(new Set(implemented)).toEqual(new Set(Object.keys(CATALOG)))
  })

  it('has a trigger and a near miss for every catalog row', () => {
    const covered = new Set([...CASES, ...CORPUS_CASES].map((entry) => entry.id))
    expect(covered).toEqual(new Set(Object.keys(CATALOG)))
  })

  for (const testCase of CASES) {
    it(`${testCase.id} has a trigger, a near miss, catalog text, and a source range`, () => {
      const matches = lint(testCase.trigger, testCase.options).filter((entry) => entry.code === testCase.id)
      expect(matches.length).toBeGreaterThan(0)
      expect(lint(testCase.near, testCase.options).some((entry) => entry.code === testCase.id)).toBe(false)
      const finding = matches[0]
      expect(finding.channel).toBe('lint')
      expect(finding.severity).toBe(CATALOG[testCase.id].severity)
      expect(catalogMessageMatches(testCase.id, finding.message)).toBe(true)
      expect(finding.path).toBeDefined()
      const range = finding.range
      expect(testCase.trigger.slice(range.startOffset, range.endOffset)).toContain(testCase.fragment)
    })
  }

  for (const testCase of CORPUS_CASES) {
    it(`${testCase.id} keeps its real-text trigger and deletion near miss`, () => {
      const matches = lint(testCase.trigger).filter((entry) => entry.code === testCase.id)
      expect(matches.length).toBeGreaterThan(0)
      expect(lint(testCase.near).some((entry) => entry.code === testCase.id)).toBe(false)
      const finding = matches.find((entry) => entry.message === testCase.message)
      expect(finding).toBeDefined()
      expect(catalogMessageMatches(testCase.id, finding.message)).toBe(true)
      const bytes = Buffer.from(testCase.trigger)
      expect(bytes.subarray(finding.range.startOffset, finding.range.endOffset).toString('utf8')).toContain(testCase.fragment)
    })
  }
})

describe('C2-B-215 to C2-B-216 controls', () => {
  it('handles line, next line, document, and re-enable scopes', () => {
    expect(lint('_x_ %% carve-lint-disable-line deprecated-bare-underline')).toEqual([])
    expect(lint('%% carve-lint-disable-next-line deprecated-bare-underline\n_x_')).toEqual([])
    expect(lint('%% carve-lint-disable\n_x_\n%% carve-lint-enable\n_y_').filter((entry) =>
      entry.code === 'deprecated-bare-underline').length).toBe(1)
  })

  it('ignores malformed controls and protected syntax', () => {
    expect(lint('%%  carve-lint-disable\n_x_').some((entry) => entry.code === 'deprecated-bare-underline')).toBe(true)
    expect(lint('`%% carve-lint-disable`\n_x_').some((entry) => entry.code === 'deprecated-bare-underline')).toBe(true)
    expect(lint('%%carve-lint-disable\n_x_').some((entry) => entry.code === 'deprecated-bare-underline')).toBe(true)
    expect(lint('{% %% carve-lint-disable %}\n_x_').some((entry) => entry.code === 'deprecated-bare-underline')).toBe(true)
  })

  it('uses the last document control and keeps line scopes independent', () => {
    const source = '%% carve-lint-disable\n_x_\n%% carve-lint-enable deprecated-bare-underline\n_y_'
    expect(lint(source).filter((entry) => entry.code === 'deprecated-bare-underline').length).toBe(1)
    const local = '%% carve-lint-disable-next-line,deprecated-bare-underline\n_x_\n_y_'
    expect(lint(local).filter((entry) => entry.code === 'deprecated-bare-underline').length).toBe(1)
  })

  it('keeps byte ranges after non-ASCII source', () => {
    const finding = lint('😀 _x_').find((entry) => entry.code === 'deprecated-bare-underline')
    expect(finding?.range).toEqual({ startOffset: 5, endOffset: 8 })
  })
})

describe('C2-W-108 formatter stability', () => {
  it('does not create findings for the clean 0.2 specification examples', () => {
    const examples = JSON.parse(fs.readFileSync(new URL('./examples.json', import.meta.url), 'utf8'))
    const violations = []
    for (const example of examples) {
      if (lint(example.source).length !== 0) continue
      const findings = lint(format(example.source))
      if (findings.length > 0) violations.push({ origin: example.origin, codes: findings.map((entry) => entry.code) })
    }
    expect(examples.length).toBe(360)
    expect(violations).toEqual([])
  })
})
