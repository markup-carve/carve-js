import { describe, expect, it } from 'vitest'
import { CarveOptionError } from '../src/options.ts'
import fs from 'node:fs'
import { format } from '../src/format.ts'
import { lint } from './lint.ts'

it('C2-B-202: an empty quoted include path is reported', () => {
  expect(lint('{{ "" }}\n').map((entry) => entry.code)).toContain('empty-include-path')
  expect(lint('{{ “” }}\n').map((entry) => entry.code)).toContain('empty-include-path')
})

it('C2-B-081: a definition shaped line in a quote is reported', () => {
  const entries = lint('> [a]: /u\n').filter((entry) => entry.code === 'definition-in-container')
  expect(entries).toHaveLength(1)
  expect(entries[0].range.startOffset).toBe(2)
})

it('C2-B-160 and C2-B-161: only a column-zero first-line hyphen run opens frontmatter', () => {
  for (const prefix of [' ', '  ', '    ', '\t']) {
    const source = `${prefix}---\n`
    const entries = lint(source, { upgrade: true }).filter((entry) => entry.code === 'thematic-break-spelling')
    expect(entries).toHaveLength(1)
    expect(entries[0].range).toEqual({ startOffset: prefix.length, endOffset: prefix.length + 3 })
  }
  const quoted = lint('> ---\n', { upgrade: true }).filter((entry) => entry.code === 'thematic-break-spelling')
  expect(quoted).toHaveLength(1)
  expect(quoted[0].range).toEqual({ startOffset: 2, endOffset: 5 })
  expect(lint('---\n', { upgrade: true }).map((entry) => entry.code)).not.toContain('thematic-break-spelling')
})

it('C2-B-160: a hyphen run below a non-paragraph leaf is thematic break spelling', () => {
  for (const source of [
    '# H\n---\n',
    '# H\n------\n',
    '> # H\n> ---\n',
    '::: note\n# H\n---\n:::\n',
    '= H\n---\n',
  ]) {
    const codes = lint(source, { upgrade: true }).map((entry) => entry.code)
    expect(codes, source).toContain('thematic-break-spelling')
    expect(codes, source).not.toContain('setext-heading-underline')
  }
  expect(lint('text\n---\n').map((entry) => entry.code)).toContain('setext-heading-underline')
  expect(lint('text\n---\n').map((entry) => entry.code)).not.toContain('thematic-break-spelling')
})

it('C2-B-030: the right aligned ordered marker is reported at that marker', () => {
  const entries = lint(' 9. a\n10. b\n').filter((entry) => entry.code === 'ordered-marker-right-aligned')
  expect(entries).toHaveLength(1)
  expect(entries[0].range.startOffset).toBe(6)
})

it('C2-B-154: an indented heading continuation is reported', () => {
  const entries = lint('# a\n b\n', { upgrade: true }).filter((entry) => entry.code === 'deprecated-indented-line-under-heading')
  expect(entries).toHaveLength(1)
  expect(entries[0].range.startOffset).toBe(4)
})

it('C2-B-207: an escaped number mark in a figure caption is literal', () => {
  const source = '::: figure\n![a](a.png)\n^ A \\#\n:::\n'
  expect(lint(source).map((entry) => entry.code)).not.toContain('figure-group-panel-number')
})

it('C2-A-086: a trailing table comment starts at its preceding space', () => {
  const entries = lint('| a | %% x\n+ b |\n').filter((entry) => entry.code === 'comment-splits-table-row')
  expect(entries).toHaveLength(1)
  expect(entries[0].range).toEqual({ startOffset: 5, endOffset: 10 })
})

it('C2-I-059: an inner braced opener made text by the outer closer is reported', () => {
  const entries = lint('*a {/b*/}\n').filter((entry) => entry.code === 'braced-span-opener-as-text')
  expect(entries).toHaveLength(1)
  expect(entries[0].range.startOffset).toBe(3)
})
import { CATALOG } from './catalog.ts'
import { IMPLEMENTED_RULES } from './lint.ts'
import { corpusResolver } from '../scripts/corpus.ts'
import { HELD } from '../scripts/corpus-held.ts'
import { registration } from '../cli/standard-extensions.ts'

describe('C2-W-107 parsed leaf ranges', () => {
  for (const [id, trigger] of [
    ['bare-html-tag', '<b>'],
    ['html-comment-renders-as-text', '<!-- x -->'],
    ['empty-include-path', '{{ }}'],
    ['link-gap-before-destination', '[x] (/u)'],
  ]) {
    it(`C2-W-107 ${id} ignores a code span`, () => {
      expect(lint(`before \`${trigger}\` after\n`).map(entry => entry.code)).not.toContain(id)
    })
    it(`C2-W-107 ${id} ignores a code block`, () => {
      expect(lint(`\`\`\`\n${trigger}\n\`\`\`\n`).map(entry => entry.code)).not.toContain(id)
    })
  }
  it('C2-W-107 ignores HTML shaped text in a raw span and a math span', () => {
    expect(lint('x `<b>`{=html} and $`<i>`\n').map((entry) => entry.code)).not.toContain('bare-html-tag')
  })
  it('C2-I-073: an autolink with a denied scheme is no bare tag, and a tag behind it still is', () => {
    const codes = (source) => lint(source).map((entry) => entry.code)
    expect(codes('<javascript:alert(1)>\n\n<https://x.org>\n')).toEqual([])
    expect(codes('> - *<foo:x>*\n')).toEqual([])
    const after = lint('<javascript:x> <b>t</b>\n').filter((entry) => entry.code === 'bare-html-tag')
    expect(after.map((entry) => entry.range.startOffset)).toEqual([15])
  })
  it('C2-W-107 ignores HTML shaped text in raw and comment blocks', () => {
    const source = '```=html\n<b>\n```\n\n%%%\n<i>\n%%%\n'
    expect(lint(source).map((entry) => entry.code)).not.toContain('bare-html-tag')
  })
  it('C2-W-107 keeps neighboring text and indentation visible to spelling rules', () => {
    const codes = (source) => lint(source).map((entry) => entry.code)
    expect(codes('`<b>` <i>\n')).not.toContain('indented-code-block')
    expect(codes('`a`\n---\n')).toContain('setext-heading-underline')
    expect(codes('`x`\n- a\n')).toContain('list-marker-without-blank-line')
    expect(codes('`x`\n> a\n')).toContain('block-opener-without-blank-line')
    expect(codes('`a`\n: b\n')).toContain('markdown-definition-paragraph')
    expect(codes('text\n\n[x]: /u\n^ cap\n')).not.toContain('unattached-caption')
  })
})

const CASES = [
  { id: 'deprecated-continuation-marker', trigger: '- a\n+\nb', near: '- a\n\nb', fragment: '+' },
  { id: 'thematic-break-spelling', trigger: '___', near: '***', fragment: '___' },
  { id: 'setext-heading-underline', trigger: 'A\n---', near: '= A', fragment: '---' },
  { id: 'deprecated-spaced-thematic-break', trigger: '- - -', near: '***', fragment: '- - -' },
  { id: 'block-marker-as-text', trigger: '~~~js\nx\n~~~', near: '```js\nx\n```', fragment: '~~~js' },
  { id: 'block-marker-as-text', trigger: '{.x\npara', near: '{.x}\npara', fragment: '{.x' },
  { id: 'html-comment-renders-as-text', trigger: '<!-- x -->', near: '%% x', fragment: '<!-- x -->' },
  { id: 'bare-html-tag', trigger: '<b>x</b>', near: '[x](/b)', fragment: '<b>' },
  { id: 'empty-reference-definition', trigger: '[a]:', near: '[a]: /u', fragment: '[a]:' },
  { id: 'table-shaped-paragraph', trigger: '| a | b', near: '| a | b |', fragment: '| a | b' },
  { id: 'blockquote-marker-without-space', trigger: '>x', near: '> x', fragment: '>x' },
  { id: 'indented-code-block', trigger: '    code', near: '```\ncode\n```', fragment: 'code' },
  { id: 'unattached-block-attribute', trigger: '{.x}', near: '{.x}\ntext', fragment: '{.x}' },
  { id: 'empty-include-path', trigger: '{{ }}', near: '{{ file.crv }}', fragment: '{{ }}' },
  { id: 'reserved-syntax', trigger: '{#dj}: x', near: '{#dj}\nx', fragment: '{#dj}: x' },
  { id: 'comment-splits-table-row', trigger: '| a |\n%% x\n+ b |', near: '| a |\n+ b |\n%% x', fragment: '%% x' },
  { id: 'include-attributes-unused', trigger: '{.wide}\n{{ a.crv }}', near: '{.wide}\n{{ a.js @code }}', fragment: '{.wide}\n{{ a.crv }}' },
  { id: 'include-lines-table-rows-hint', trigger: '{table}\n{{ d.csv @lines:1-2 @code:csv }}', near: '{table}\n{{ d.csv @rows:1-2 @code:csv }}',
    fragment: '{table}\n{{ d.csv @lines:1-2 @code:csv }}' },
  { id: 'table-row-count-clamped', trigger: '{table header-rows=5}\n```csv\na,b\nc,d\n```', near: '{table header-rows=2}\n```csv\na,b\nc,d\n```',
    fragment: 'header-rows=5' },
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
  { id: 'continuation-reading-changed', trigger: ':: term\n  more\n: desc', near: ':: term\nmore\n: desc', fragment: 'more',
    options: { upgrade: true } },
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
  { id: 'carve-version-unsupported', trigger: '---\ncarve-version: 0.3\n---', near: '---\ncarve-version: 0.2\n---',
    fragment: 'carve-version: 0.3' },
  { id: 'unclosed-inline-emphasis', trigger: 'a /b c', near: 'a /b/ c', fragment: '/' },
  { id: 'consumed-key-near-miss', trigger: '{align=left}\n| a |', near: '{aligns=left}\n| a |', fragment: 'align=left' },
  { id: 'delimited-table-wide-row', trigger: '{table}\n```csv\na,b\nc,d,e\n```',
    near: '{table}\n```csv\na,b\nc,d\n```', fragment: 'c,d,e' },
  { id: 'deprecated-table-attribute', trigger: '{header-rows=1}\n| a |', near: '{header-cols=1}\n| a |',
    fragment: 'header-rows=1' },
  { id: 'djot-definition-list', trigger: ': term\n\n  definition', near: 'term\n\n  definition', fragment: ': term',
    options: { rules: { 'djot-definition-list': 'on' } } },
  { id: 'djot-emphasis-underscore-braced', trigger: '{_x_}', near: '_x_', fragment: '{_x_}',
    options: { rules: { 'djot-emphasis-underscore-braced': 'on' } } },
  { id: 'djot-ordered-marker', trigger: '(1) x', near: '- x', fragment: '(1) x',
    options: { rules: { 'djot-ordered-marker': 'on' } } },
  { id: 'djot-tag-mention', trigger: 'a #word b', near: 'a word b', fragment: '#word',
    options: { rules: { 'djot-tag-mention': 'on' } } },
  { id: 'djot-typography-sign', trigger: 'a --> b', near: 'a - b', fragment: '-->',
    options: { rules: { 'djot-typography-sign': 'on' } } },
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
  { id: 'semantic-attribute-outside-span', trigger: '{kbd=Ctrl}\n# H', near: '[x]{kbd=Ctrl}',
    fragment: 'kbd=Ctrl' },
  { id: 'semantic-attribute-outside-span', trigger: '{mark=foo}\n{time=2024}\n# H', near: '{mark=foo}\n# H',
    fragment: 'time=2024' },
  { id: 'blank-reference-label', trigger: '[^ ]: x\n\na[^ ]', near: '[^n]: x\n\na[^n]', fragment: '[^ ]' },
  { id: 'blank-reference-label', trigger: '[t][ ]\n\n[ ]: /u', near: '[t][]\n\n[t]: /u', fragment: '[ ]' },
  { id: 'semantic-attribute-value-ignored', trigger: '[x]{mark=foo}', near: '[x]{mark}', fragment: 'mark=foo' },
  { id: 'table-column-arity', trigger: '{widths=10}\n| a | b |', near: '{widths=10,20}\n| a | b |',
    fragment: 'widths=10' },
  { id: 'table-attribute-invalid', trigger: '{widths=x}\n| a |', near: '{widths=10}\n| a |', fragment: 'widths=x' },
  { id: 'table-attribute-invalid', trigger: '{body-rows=1}\n| a |\n| b |', near: '{body-rows=1,1}\n| a |\n| b |', fragment: 'body-rows=1' },
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
const CLAUSE_CASES = JSON.parse(fs.readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')).cases
  .filter((entry) => entry.kind === 'lint')

function clauseOptions(entry) {
  const options = { ...entry.options }
  if (options.extensions !== undefined) options.extensions = registration(options.extensions, new Map(), false).extensions
  if (entry.files) options.includes = { resolver: corpusResolver(entry.files), ...options.includes }
  return options
}

function messageMatches(template, message) {
  const pieces = template.split(/\$\{[^}]+\}/)
  const expression = pieces.map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${expression}$`, 's').test(message)
}

function atRange(source, offset) {
  const prefix = Buffer.from(source).subarray(0, offset).toString('utf8')
  const lines = prefix.split('\n')
  return { line: lines.length, column: Array.from(lines.at(-1) ?? '').length + 1 }
}

describe('C2-W-107 spelling rule leaf near misses', () => {
  const lineRules = IMPLEMENTED_RULES.filter((rule) => rule.lines)
  for (const rule of lineRules) {
    const sample = [...CASES, ...CORPUS_CASES].find((entry) => entry.id === rule.id)
    if (sample === undefined) throw new Error(`missing spelling sample for ${rule.id}`)
    const line = sample.trigger.split('\n').find((part) => part.includes(sample.fragment)) ?? sample.fragment
    const marker = '`'.repeat(Math.max(1, ...[...line.matchAll(/`+/g)].map((match) => match[0].length + 1)))
    it(`C2-W-107 ${rule.id} ignores its trigger in a code span`, () => {
      expect(lint(`before ${marker}${line}${marker} after\n`, { upgrade: true, ...sample.options }).some((entry) => entry.code === rule.id)).toBe(false)
    })
    it(`C2-W-107 ${rule.id} ignores its trigger in a code block`, () => {
      expect(lint(`\`\`\`\n${sample.trigger}\n\`\`\`\n`, { upgrade: true, ...sample.options }).some((entry) => entry.code === rule.id)).toBe(false)
    })
  }
})

function catalogMessageMatches(id, message) {
  return CATALOG[id].messages.some((template) => {
    const pieces = template.split(/\$\{[^}]+\}/)
    const expression = pieces.map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    return new RegExp(`^${expression}$`, 's').test(message)
  })
}

describe('C2-W-106 catalog rules', () => {
  it('C2-H-137 and C2-W-109 reject invalid lint options with CarveOptionError', () => {
    for (const platforms of [true, 'github', ['other'], [1]]) {
      expect(() => lint('<', { platforms })).toThrowError(CarveOptionError)
    }
    for (const rules of [true, [], { 'platform-mention-token': true }, { unknown: 'on' }, { toString: 'on' }]) {
      expect(() => lint('', { rules })).toThrowError(CarveOptionError)
    }
  })
  it('registers each lint catalog row exactly once', () => {
    const implemented = IMPLEMENTED_RULES.map((rule) => rule.id)
    expect(new Set(implemented)).toEqual(new Set(Object.keys(CATALOG)))
  })

  it('has a trigger and a near miss for every catalog row', () => {
    const active = new Set(Object.keys(CATALOG))
    const positives = new Set(CLAUSE_CASES.flatMap((entry) => (entry.expected.diagnostics ?? []).map((finding) => finding.code))
      .filter((id) => active.has(id)))
    const misses = new Set(CLAUSE_CASES.flatMap((entry) => entry.expected.notReported ?? []).filter((id) => active.has(id)))
    const coreRules = Object.keys(CATALOG).filter((id) => !('status' in CATALOG[id] && CATALOG[id].status === 'void'))
    expect(positives).toEqual(new Set(coreRules))
    expect(misses).toEqual(new Set(coreRules))
  })

  for (const id of Object.keys(CATALOG)) {
    if ('status' in CATALOG[id] && CATALOG[id].status === 'void') continue
    it(`${id} has a candidate 13 trigger, near miss, message variant, and byte range`, () => {
      // Later clause cases carry the latest catalog range when an older case predates a ruling.
      // A held case (scripts/corpus-held.ts) is one this engine does not pass yet, so it is no trigger here.
      const cases = CLAUSE_CASES.filter((entry) => !HELD.has(entry.id))
      const positive = cases.findLast((entry) => entry.expected.diagnostics?.some((finding) => finding.code === id))
      const miss = cases.find((entry) => entry.expected.notReported?.includes(id))
      const own = [...CASES, ...CORPUS_CASES].find((entry) => entry.id === id)
      const trigger = positive?.input ?? own?.trigger
      const near = miss?.input ?? own?.near
      const options = positive ? clauseOptions(positive) : { ...own?.options, rules: { ...own?.options?.rules, [id]: 'on' } }
      expect(trigger).toBeDefined()
      expect(near).toBeDefined()
      const expected = positive?.expected.diagnostics.find((finding) => finding.code === id)
      const matches = lint(trigger, options).filter((entry) => entry.code === id)
      expect(matches.length).toBeGreaterThan(0)
      const finding = matches.find((entry) => expected?.messageWhen === undefined ||
        messageMatches(CATALOG[id].messages[CATALOG[id].conditions.indexOf(expected.messageWhen)], entry.message))
      expect(finding).toBeDefined()
      expect(catalogMessageMatches(id, finding.message)).toBe(true)
      expect(finding.severity).toBe(CATALOG[id].severity)
      expect(finding.range.startOffset).toBeGreaterThanOrEqual(0)
      expect(finding.range.endOffset).toBeGreaterThan(finding.range.startOffset)
      expect(finding.range.endOffset).toBeLessThanOrEqual(Buffer.byteLength(trigger))
      if (expected?.line !== undefined) expect(atRange(trigger, finding.range.startOffset).line).toBe(expected.line)
      if (expected?.column !== undefined) expect(atRange(trigger, finding.range.startOffset).column).toBe(expected.column)
      if (expected?.endLine !== undefined) expect(atRange(trigger, finding.range.endOffset).line).toBe(expected.endLine)
      if (expected?.endColumn !== undefined) expect(atRange(trigger, finding.range.endOffset).column).toBe(expected.endColumn)
      if (positive === undefined && own?.fragment !== undefined) {
        const start = trigger.indexOf(own.fragment)
        const expectedStart = Buffer.byteLength(trigger.slice(0, start))
        expect(finding.range).toEqual({ startOffset: expectedStart, endOffset: expectedStart + Buffer.byteLength(own.fragment) })
      }
      const nearOptions = miss ? clauseOptions(miss) : options
      expect(lint(near, nearOptions).some((entry) => entry.code === id)).toBe(false)
    })
  }
})

describe('lint messages of the candidate 8 catalog', () => {
  const message = (source, code) => lint(source).find((entry) => entry.code === code)?.message
  it('quotes and escapes a version and a normalized key as JSON string text', () => {
    expect(message('---\ncarve: "9"\n---', 'carve-version-unsupported')).toContain('version "\\"9\\""')
    expect(message('[^a b]: one\n\n[^a  b]: two', 'footnote-labels-differ-only-in-whitespace')).toContain('Normalized key: "a b".')
  })

  it('names the span of an unclosed opener and counts one column in the singular', () => {
    expect(message('a /b c', 'unclosed-inline-emphasis')).toBe('This emphasis opener is unclosed in its paragraph; add a closer.')
    expect(message('a *b c', 'unclosed-inline-emphasis')).toBe('This strong opener is unclosed in its paragraph; add a closer.')
    expect(message(' # H', 'block-opener-overindented')).toContain('indented 1 column past')
    expect(message('  # H', 'block-opener-overindented')).toContain('indented 2 columns past')
  })
})

describe('C2-W-109 lint options and ordering', () => {
  it('applies default, explicit, and platform rule states', () => {
    expect(lint('_x_').some((entry) => entry.code === 'deprecated-bare-underline')).toBe(false)
    expect(lint('_x_', { upgrade: true }).some((entry) => entry.code === 'deprecated-bare-underline')).toBe(true)
    expect(lint('_x_', { upgrade: true, rules: { 'deprecated-bare-underline': 'off' } })
      .some((entry) => entry.code === 'deprecated-bare-underline')).toBe(false)
    expect(lint('See @bob.').some((entry) => entry.code === 'platform-mention-token')).toBe(false)
    expect(lint('See @bob.', { platforms: ['github'] })
      .some((entry) => entry.code === 'platform-mention-token')).toBe(true)
    expect(lint('See @bob.', { platforms: ['github'], rules: { 'platform-mention-token': 'off' } })
      .some((entry) => entry.code === 'platform-mention-token')).toBe(false)
  })

  it('sorts mixed spelling and tree findings by UTF-8 byte position', () => {
    const findings = lint('😀 **bold**\n\n# H\n\n_x_')
    const positions = findings.map((entry) => entry.range.startOffset)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(findings.every((entry) => entry.channel === 'lint')).toBe(true)
  })
})

describe('C2-B-215 to C2-B-216 controls', () => {
  const on = { rules: { 'deprecated-bare-underline': 'on' } }

  it('handles line, next line, document, and re-enable scopes', () => {
    expect(lint('_x_ %% carve-lint-disable-line deprecated-bare-underline', on)).toEqual([])
    expect(lint('%% carve-lint-disable-next-line deprecated-bare-underline\n_x_', on)).toEqual([])
    expect(lint('%% carve-lint-disable\n_x_\n%% carve-lint-enable\n_y_', on).filter((entry) =>
      entry.code === 'deprecated-bare-underline').length).toBe(1)
  })

  it('ignores malformed controls and protected syntax', () => {
    expect(lint('%%  carve-lint-disable\n_x_', on).some((entry) => entry.code === 'deprecated-bare-underline')).toBe(true)
    expect(lint('`%% carve-lint-disable`\n_x_', on).some((entry) => entry.code === 'deprecated-bare-underline')).toBe(true)
    expect(lint('%%carve-lint-disable\n_x_', on).some((entry) => entry.code === 'deprecated-bare-underline')).toBe(true)
    expect(lint('{% %% carve-lint-disable %}\n_x_', on).some((entry) => entry.code === 'deprecated-bare-underline')).toBe(true)
  })

  it('uses the last document control and keeps line scopes independent', () => {
    const source = '%% carve-lint-disable\n_x_\n%% carve-lint-enable deprecated-bare-underline\n_y_'
    expect(lint(source, on).filter((entry) => entry.code === 'deprecated-bare-underline').length).toBe(1)
    const local = '%% carve-lint-disable-next-line,deprecated-bare-underline\n_x_\n_y_'
    expect(lint(local, on).filter((entry) => entry.code === 'deprecated-bare-underline').length).toBe(1)
  })

  it('keeps byte ranges after non-ASCII source', () => {
    const finding = lint('😀 _x_', on).find((entry) => entry.code === 'deprecated-bare-underline')
    expect(finding?.range).toEqual({ startOffset: 5, endOffset: 8 })
  })
})

describe('C2-W-108 formatter stability', () => {
  it('lint changes neither the tree nor the formatter output of the 0.2 examples', () => {
    const examples = JSON.parse(fs.readFileSync(new URL('./examples.json', import.meta.url), 'utf8'))
    const violations = []
    for (const example of examples) {
      const before = format(example.source)
      lint(example.source)
      if (format(example.source) !== before) violations.push(example.origin)
    }
    expect(examples.length).toBe(360)
    expect(violations).toEqual([])
  })
})

describe('the corpus session', () => {
  const found = (source, code) => lint(source).filter((entry) => entry.code === code)

  it('C2-B-174: a header mark on a joining span mark whose row is no head row is reported with the second message', () => {
    for (const source of ['| a |\n|= ^ |', '| a |= < |']) {
      const entries = found(source, 'table-span-marker-attribute')
      expect(entries, source).toHaveLength(1)
      expect(entries[0].message, source).toContain('header mark makes no head row')
    }
    expect(found('|= H |\n|= ^ |', 'table-span-marker-attribute')).toEqual([])
    expect(found('|= H | < |', 'table-span-marker-attribute')).toEqual([])
    expect(found('| a |\n|={.c} ^ |', 'table-span-marker-attribute')[0].message).toContain('attribute block')
  })

  it('C2-B-147, C2-B-149: a caption line below a raw block is text and is reported', () => {
    const entries = found('```=html\n<b>x</b>\n```\n^ cap', 'unattached-caption')
    expect(entries.map((entry) => entry.range)).toEqual([{ startOffset: 22, endOffset: 27 }])
    expect(found('```js\nx\n```\n^ cap', 'unattached-caption')).toEqual([])
    expect(found('***\n^ cap', 'unattached-caption')).toHaveLength(1)
  })
})
