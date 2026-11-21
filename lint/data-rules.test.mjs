import { afterEach, expect, it } from 'vitest'
import { lint } from './lint.ts'
import { DATA_RULE_IDS } from './data-rules.ts'

function findings(source, mode) {
  if (mode === 'data') process.env.CARVE_LINT_RULES = 'data'
  else delete process.env.CARVE_LINT_RULES
  return lint(source).filter((entry) => DATA_RULE_IDS.has(entry.code))
    .map((entry) => `${entry.code}@${entry.range.startOffset}-${entry.range.endOffset}`)
}

afterEach(() => { delete process.env.CARVE_LINT_RULES })

const SAME = [
  'a\n\n---\n', '- - -\n', 'a. - - -\n', '>a\n', '---\n>a\n---\n', 'a\n# b\n', 'a\n> b\n', 'a\n:: t\n',
  'a\n{.c}\n', 'a\n[x]: /u\n', '{.c}\n\nb\n', '| a |\n\nTable: cap\n', '::: a\n:::: b\nx\n:::\n',
  '> # a\n', '- a\n\n    # b\n', '1. a\n\n  b\n', '  # a\n', '::: note\na\n::::\n',
]

it('the data rules report what the hand-written rules report on their triggers', () => {
  for (const source of SAME) expect(findings(source, 'data'), JSON.stringify(source)).toEqual(findings(source, 'code'))
})

it('C2-B-108 and the ruling of carve#6175: a directive is an open colon container', () => {
  expect(findings(':::: references\n:::\n', 'data')).toEqual(['colon-fence-length-mismatch@16-19'])
  expect(findings('::::\n::: glossary\n:::\n::::\n', 'data')).toEqual([])
})

it('C2-B-090: an attribute line with a space after its brace is an attribute line', () => {
  expect(findings('{ #id }\n', 'data')).toEqual(['unattached-block-attribute@0-7'])
  expect(findings('a\n{ #id }\n', 'data')).toEqual(['block-opener-without-blank-line@2-9'])
})

it('C2-B-031: a quote mark followed by a tab is text', () => {
  expect(findings('>\t\n', 'data')).toEqual(['blockquote-marker-without-space@0-1'])
})

it('C2-B-146: a lone pipe is no table row next to a caption-looking line', () => {
  expect(findings('Table: x\n|\n', 'data')).toEqual([])
})

it('the data rules of the second batch report what the hand-written rules report on their triggers', () => {
  for (const source of ['x [^ ] y\n', '[a][ ]\n', '[ ]: u\n', 'a <b> c\n', '> a\n>\n> [x]: y\n', ' [x]: y\n', 'a\n- b\n',
    '# H {.c}\n', '%%%\n%%% x\n%%%\n', '```\ncode\n ```\n']) {
    expect(findings(source, 'data'), JSON.stringify(source)).toEqual(findings(source, 'code'))
  }
})

it('C2-B-011: indented-code-block skips a paragraph whose previous block is a list', () => {
  expect(findings('\t1. w.\n\n    :\n', 'data')).toEqual([])
})

it('C2-B-109: fence-closer-indented reports no unclosed fence and reads the source column in a quote', () => {
  expect(findings('````\n  ```\n', 'data')).toEqual([])
  expect(findings('> ```\n>   ```\n', 'data')).toEqual(['fence-closer-indented@10-13'])
})

it('C2-B-110: comment-fence-closer-with-text reads a quoted line behind its quote mark only', () => {
  expect(findings('> %%%%\n> %%%% x\n', 'data')).toEqual(['comment-fence-closer-with-text@7-15'])
  expect(findings('>   %%%%\n> >   %%%% x\n', 'data')).toEqual([])
})

it('C2-B-069: description-term-multi-line starts behind the prefixes of the line', () => {
  expect(findings('> :: w\n> w\n', 'data')).toEqual(['description-term-multi-line@9-10'])
})

it('bare-html-tag reads paragraph, heading and table row lines, not term lines', () => {
  expect(findings(':: a <b>\n', 'data')).toEqual([])
  expect(findings('| <i> |\n', 'data')).toEqual(['bare-html-tag@2-5'])
})

it('carve#6192: block-opener-overindented reports the whole opening mark', () => {
  expect(findings('# H\n\n   ::::\n   x\n   ::::\n', 'data')).toEqual(['block-opener-overindented@8-12'])
  expect(findings('  ### H\n', 'data')).toEqual(['block-opener-overindented@2-5'])
})

it('carve#6194: a colon run inside a quote or item is not compared with a div outside it', () => {
  expect(findings('::::\n> :::\n', 'data')).toEqual([])
  expect(findings('::::\n- a\n\n  :::  \n', 'data')).toEqual([])
  expect(findings('> ::::\n> :::\n', 'data')).toEqual(['colon-fence-length-mismatch@9-12'])
})

it('C2-B-161: frontmatter-shaped-thematic-break reads an opener with trailing spaces', () => {
  expect(findings('---  \n\n', 'data')).toEqual(['frontmatter-shaped-thematic-break@0-6'])
})

it('carve#6194: a div inside a footnote is not compared with a run that the document owns', () => {
  expect(findings('[^n]: :::: warning\n      ---\n:::\n', 'data').filter((f) => f.startsWith('colon'))).toEqual([])
})

it('C2-B-090: a colon container with an attached attribute line is an open colon container', () => {
  expect(findings('{.c}\n::: note\n::::\n', 'data')).toEqual(findings('{.c}\n::: note\n::::\n', 'code'))
})

it('carve#6206: an overindented opener in a div inside a list item belongs to the item', () => {
  expect(findings('1. ::::\n    >\n', 'data')).toEqual(['list-item-block-overindented@12-13'])
  expect(findings('- ::: note\n  ::: tip\n     # H\n  :::\n  :::\n', 'data')).toEqual(findings('- ::: note\n  ::: tip\n     # H\n  :::\n  :::\n', 'code'))
})

it('the data rules follow the hand-written fixes of carve-js#5183, #5186 and #5187', () => {
  const only = (source, code) => findings(source, 'data').filter((found) => found.startsWith(`${code}@`))
  expect(only('c\n> %%%', 'block-opener-without-blank-line')).toEqual(['block-opener-without-blank-line@2-3'])
  expect(only('c\n>%% x', 'block-opener-without-blank-line')).toEqual([])
  expect(only('   :::\n     :::: warning\n   :::', 'colon-fence-length-mismatch')).toEqual(['colon-fence-length-mismatch@28-31'])
  expect(only('# H\n [a]: u', 'definition-in-container')).toEqual([])
  expect(only(':: t\n: ````\n      ````\n  > *[x1]:\n>   [^n]: : text', 'definition-in-container'))
    .toEqual(['definition-in-container@38-43'])
})

it('C2-B-031: a quote mark followed by a space and an inline comment is no marker without a space', () => {
  expect(findings('a\n> %% x\n', 'data').filter((found) => found.startsWith('blockquote'))).toEqual([])
  expect(findings('a\n>%% x\n', 'data').filter((found) => found.startsWith('blockquote'))).toEqual(['blockquote-marker-without-space@2-7'])
})

it('the third batch reports what the hand-written rules report on their triggers', () => {
  for (const source of ['a\n===\n', 'a\n---\n', '> a\n> ---\n', '+ b\n', '[a]:\n', '[^a]:\n', '[ ]:\n', '| a\n', '| a |\n', '+\n',
    '- +\n', '- a\n\n  +\n', '> [!NOTE]\n', '# H ##\n', '= ##\n', '# H\\##\n']) {
    expect(findings(source, 'data'), JSON.stringify(source)).toEqual(findings(source, 'code'))
  }
})

it('C2-B-109: a container closed with its parent stays open for the parent closer after a blank line', () => {
  expect(findings('  :::\n:::: note\n\n:::\n', 'data').filter((found) => found.startsWith('colon-fence')))
    .toEqual(['colon-fence-length-mismatch@17-20'])
})

it('C2-B-090: the opener of an attributed quote is its own mark, not the text behind it', () => {
  expect(findings('{#id}\n>\n', 'data').filter((found) => found.startsWith('block-opener-overindented'))).toEqual([])
  expect(findings('{#id}\n > a\n', 'data').filter((found) => found.startsWith('block-opener-overindented')))
    .toEqual(['block-opener-overindented@7-8'])
})

it('C2-B-025: an attribute line past the item content column is reported when a paragraph takes it', () => {
  expect(findings('- a\n\n    {.c}\n  b\n', 'data')).toEqual(['list-item-block-overindented@9-13'])
})

it('the fourth batch reports what the hand-written rules report on their triggers', () => {
  for (const source of ['*.c,*.h*\n', 'a /* b */ c\n', '*/x/*\n', '{% if x %}\n', 'a {%endif%} b\n', '{% if %}\n',
    '::: |\nab\n%% x\n:::\n', ':: - x\n: d\n', ':: > q\n: d\n', ':: -x\n: d\n', 'a {{ }} b\n', '{{ "" }}\n', '{{a}}\n',
    '![](a.png)\n', '![x](a.png)\n', '[a]()\n', '[a](){.c}\n', '[a](<>)\n', '> ::: footnotes\n> :::\n', '::: footnotes\n:::\n',
    '::: figure "T"\n:::\n', '::: figure\n:::\n', '{loose=1}\n- a\n', '{k="a loose=b"}\n- a\n', '{.loose}\n- a\n']) {
    expect(findings(source, 'data'), JSON.stringify(source)).toEqual(findings(source, 'code'))
  }
  const on = { rules: { 'djot-subscript-tilde-braced': 'on', 'djot-highlight-braces': 'on' } }
  for (const source of ['a {~b~} c\n', '{=x=}\n', '\\{~x~}\n']) {
    process.env.CARVE_LINT_RULES = 'data'
    const data = lint(source, on).map((entry) => entry.code)
    delete process.env.CARVE_LINT_RULES
    expect(data, JSON.stringify(source)).toEqual(lint(source, on).map((entry) => entry.code))
  }
})

it('C2-B-109: a quoted backtick run inside a fence outside the quote is content, not an indented closer', () => {
  expect(findings('```\n> ```\n', 'data').filter((found) => found.startsWith('fence-closer'))).toEqual([])
  expect(findings('> ```\n>   ```\n', 'data').filter((found) => found.startsWith('fence-closer'))).toEqual(['fence-closer-indented@10-13'])
})

it('the fifth batch reports what the hand-written rules report on their triggers', () => {
  for (const source of ['[a] (u)\n', 'x [a]\t(b) [c] ( ) [d] (e)\n', '> q\n::: >\nz\n:::\n', '> q\n::: > n\n:::\n',
    '^ cap\n', 'para\n^ cap\n', '[x]: /u\n^ cap\n', '*[A]: b\n^ cap\n', '> [x]: u\n^ c\n', '![a](b.png)\n^ cap\n',
    '| a | b |\n|---|:-:|\n', '| a | b\n|---|---|\n', '| x |--y\n|--|\n', '|---|\n|---|\n', '| a |\n| -:- |\n',
    '| {.c}< a | {#i}~ b |\n', '| {}> a |\n', '|={.c}< a |\n', '|  {a}~  |\n']) {
    expect(findings(source, 'data'), JSON.stringify(source)).toEqual(findings(source, 'code'))
  }
  const on = { rules: { 'djot-heading-continuation': 'on' } }
  for (const source of ['# Head\nnext\n', '# Head\n  next\n', '> # H\n> x\n', '## H\nx\n']) {
    process.env.CARVE_LINT_RULES = 'data'
    const data = lint(source, on).map((entry) => `${entry.code}@${entry.range.startOffset}`)
    delete process.env.CARVE_LINT_RULES
    expect(data, JSON.stringify(source)).toEqual(lint(source, on).map((entry) => `${entry.code}@${entry.range.startOffset}`))
  }
})

it('C2-W-147: the pair rules read each text run with the pair scan, as the hand-written rules do', () => {
  const pairs = ['deprecated-bare-underline', 'deprecated-bare-strike', 'deprecated-bare-highlight', 'markdown-strong-double-star',
    'markdown-strikethrough-double-tilde', 'djot-emphasis-underscore', 'djot-subscript-tilde', 'djot-superscript-caret']
  const on = { rules: Object.fromEntries(pairs.map((id) => [id, 'on'])) }
  const both = (source) => ['data', 'code'].map((mode) => {
    if (mode === 'data') process.env.CARVE_LINT_RULES = 'data'
    else delete process.env.CARVE_LINT_RULES
    return lint(source, on).map((entry) => `${entry.code}@${entry.range.startOffset}-${entry.range.endOffset} ${entry.path}`)
  })
  for (const source of ['a _b_ c\n', 'x_y_z\n', '\\_b_\n', '_b _\n', 'a ~b~ c ~~d~~ e\n', '**b** and **c d**\n', '**a*b**\n',
    '=x= y\n', 'a ^b^ c\n', '{^x^}\n', 'a _b\nc_ d\n', '*x _y_ z*\n', '[l _a_](u) _b_\n', '`c` _d_ `e`\n', '| _a_ | ~b~ |\n',
    '_b_\u0301\n', '_\u200db_\n', '\u00e9_b_ c\n']) {
    const [data, code] = both(source)
    expect(data, JSON.stringify(source)).toEqual(code)
  }
  // C2-I-047 tests the character before the opener, and U+1D400 is a letter: no pair opens behind it.
  expect(both('\u{1D400}_a_ b\n')[0]).toEqual([])
})

it('C2-W-140, C2-W-141: rules that read the node of a record and count its children report what the hand-written rules report', () => {
  const on = { rules: { 'emphasis-as-heading': 'on' } }
  for (const source of ['a[^x] b\n', 'a[^x] b\n\n[^x]: note\n', '*[^[g]*] b*\n', '::: figure\n![one](a.png)\n^ (a) One\n:::\n',
    '::: figure\n![a](a.png)\n^ A\n\n![b](b.png)\n^ B\n:::\n', '::: figure\ntext\n:::\n', '::: figure\n| a |\n:::\n', '*bold*\n',
    '*a* %% c\n', '*a* b\n', '*a*\n/b/\n', '{.wide}\n{{ a.crv }}\n', '{.wide}\n{{ a.js @code }}\n',
    '{table}\n{{ d.csv @lines:1-2 @code:csv }}\n', '{table}\n{{ d.csv @rows:1-2 @code:csv }}\n']) {
    const runs = ['data', 'code'].map((mode) => {
      if (mode === 'data') process.env.CARVE_LINT_RULES = 'data'
      else delete process.env.CARVE_LINT_RULES
      return lint(source, on).map((entry) => `${entry.code}@${entry.range.startOffset}-${entry.range.endOffset} ${entry.path}`)
    })
    expect(runs[0], JSON.stringify(source)).toEqual(runs[1])
  }
})

it('C2-W-141: rules that look up other records of the document report what the hand-written rules report', () => {
  const on = { rules: { 'duplicate-reference-url': 'on' } }
  for (const source of ['[a]: /u\n[b]: /u\n', '[a]: /u\n[a]: /v\n\n[a]\n', '[a]: /u\n\n[x][a]\n', '[a]: /u\n\n![x][a]\n', '[^n]: x\n',
    'a[^n]\n\n[^n]: x\n', '[^n]: x [^m]\n\n[^m]: y\n', '# A\n\n### B\n', '## A\n\n# B\n\n### C\n', '= A\n\n# B\n', '# A\n\n# B\n',
    '{.c}\n# A\n\n= B\n', '> # A\n\n=== C\n', '- ## A\n\n#### B\n']) {
    const runs = ['data', 'code'].map((mode) => {
      if (mode === 'data') process.env.CARVE_LINT_RULES = 'data'
      else delete process.env.CARVE_LINT_RULES
      return lint(source, on).map((entry) => `${entry.code}@${entry.range.startOffset}-${entry.range.endOffset} ${entry.path} ${entry.message}`)
    })
    expect(runs[0], JSON.stringify(source)).toEqual(runs[1])
  }
})

it('C2-W-141: lookups after a record and ancestor fields give what the hand-written rules report', () => {
  const sources = ['[^a]: x\n\n[^ a]: y\n\nUse [^a].\n', '{.c}\n[^a]: x\n\n[^ a]: y\n', '[^a  b]: x\n\n[^a b]: y\n',
    '| a | b |\n| c |\n|---|\n| d | e | f |\n', '> | a |\n> | b | c |\n', 'i. one\n\na. two\n', 'i. one\n\n\n\n\na. two\n',
    'I. one\n- x\n\nA. two\n', '> i) one\n>\n> a) two\n', '::: figure\npara\n:::\n', '::: figure\n> ::: figure\n> x\n> :::\n:::\n']
  // The rows of DATA_ONLY run from data in both modes, so findings at one start may come in another order.
  for (const source of sources) expect(findings(source, 'data').sort(), JSON.stringify(source)).toEqual(findings(source, 'code').sort())
  expect(findings('[^a]: x\n\n[^ a]: y\n\nUse [^a].\n', 'data')).toEqual(['footnote-labels-differ-only-in-whitespace@9-17'])
  expect(findings('i. one\n\na. two\n', 'data')).toEqual(['ordered-list-kind-split@0-6'])
})

it('C2-B-127: figure-group-nested reads the opener of a div behind its attribute line', () => {
  const source = '::: figure\n{.x}\n::: figure\nin\n:::\n![i](j)\n^ c\n:::\n'
  for (const mode of ['code', 'data']) expect(findings(source, mode)).toContain('figure-group-nested@11-33')
})

it('C2-W-149: the table fields give what the hand-written table rules report', () => {
  const sources = ['| a | b |\n%% c\n+ d |\n', '| a | %% t\n+ d |\n', '{table}\n```csv\na,b\nc,d,e\n```\n', '| < a | b |\n',
    '|= ~^{ .x } a |= b |\n', '| a | {.x} |\n', '| a |{.x} |\n', '| a |{<} |\n', '| a | b |\n| < | ^ |\n',
    '|= a |= b |\n|={.x} ^ | c |\n', '| a | b |\n| c | d |\n| = ^ | e |\n', '| a | b |\n| c | \\< |\n', '| a | {} |\n', '| a | {% c %} |\n', '{table}\n```csv\na,<\n^,> abc\n```\n']
  for (const source of sources) expect(findings(source, 'data'), JSON.stringify(source)).toEqual(findings(source, 'code'))
  expect(findings('| a | b |\n%% c\n+ d |\n', 'data')).toEqual(['comment-splits-table-row@10-14'])
  expect(findings('| a |{<} |\n', 'data')).toEqual(['table-row-attribute-as-cell@0-10'])
  expect(findings('| a | {} |\n', 'data')).toEqual([])
})

it('C2-W-138, C2-B-210: the hand-written table attribute rules read behind container prefixes', () => {
  const codes = (source) => lint(source).map((entry) => `${entry.code}@${entry.range.startOffset}-${entry.range.endOffset}`)
  expect(codes('> {footer-rows=5}\n> | a |\n')).toContain('table-row-count-clamped@3-16')
  expect(codes('{footer-rows="5"}\n| a |\n')).toContain('table-row-count-clamped@1-16')
  expect(codes('{footer-rows}\n|= a |\n')).toContain('table-row-count-clamped@1-12')
  expect(codes('> {header-rows=1}\n> | a |\n')).toContain('deprecated-table-attribute@2-25')
  for (const mode of ['code', 'data']) expect(findings('| a |\n%% c  \n+ b |\n', mode)).toEqual(['comment-splits-table-row@6-10'])
})

it('C2-W-138: a data finding on a comment line of a table names the table', () => {
  const paths = (mode) => {
    if (mode === 'data') process.env.CARVE_LINT_RULES = 'data'
    else delete process.env.CARVE_LINT_RULES
    return lint('> | a |\n> %% c\n> + d |\n').filter((entry) => entry.code === 'comment-splits-table-row').map((entry) => entry.path)
  }
  expect(paths('data')).toEqual(paths('code'))
  expect(paths('data')).toEqual(['/children/0/children/0'])
})

it('C2-W-149: row_index counts rows, not the comments among them', () => {
  for (const mode of ['code', 'data']) {
    expect(findings('| a | b |\n| c | d |\n%% x\n| ^ | e |\n', mode)).toEqual([])
    expect(findings('|= a |\n%% x\n| ^ |\n', mode)).toEqual(['table-span-marker-blocked@13-16'])
  }
})
