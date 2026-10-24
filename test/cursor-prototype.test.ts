import { describe, expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

describe('experimental block cursor', () => {
  it('matches the public AST and HTML across its migrated block families', () => {
    const source = [
      '# Unicode 😀',
      '',
      'A [link][site] with *strong* text.',
      '',
      '- first item',
      '- second item',
      '  - nested item',
      '  - another item',
      '',
      '> A quoted /word/.',
      '',
      '```js',
      'const n = 1',
      '```',
      '',
      '| Name | Value |',
      '|:---|---:|',
      '| left | 1 |',
      '',
      '[site]: https://example.com',
      '',
    ].join('\n')
    const reference = parse(source)
    const cursor = parseCursorPrototype(source)
    expect(cursor).toStrictEqual(reference)
    expect(renderHtml(resolve(cursor))).toBe(renderHtml(resolve(reference)))
  })

  it('keeps fenced definitions inert and accepts longer valid closers', () => {
    const source = [
      '#   Heading',
      '',
      '```',
      '[ref]: https://wrong.example',
      '````',
      '',
      '[label][ref]',
      '',
    ].join('\n')
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['a\n \nb\n', 'a\n\t\nb\n'])
  ('treats a whitespace-only line as a paragraph boundary: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['|= Name |= Value |\n| a | 1 |\n', '|= Name |= Value |\n'])
  ('parses a canonical table row without a GFM separator: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('parses data-only tables at the root after a document or block boundary', () => {
    for (const source of ['| a | b |\n', '| a | b |\n| c | d |\n',
      '| a |\n', '| --- | --- |\n| 1 | 2 |\n', '| a | b |\n\n',
      '# Before\n\n| a | b |\n', '\n| a | b |\n',
      '| a | b |\n\n| c | d |\n', 'para\n| a |\n', '# Heading\n| a |\n',
      '{aligns="right,,center" valigns="top,middle,bottom" widths="25,50,25"}\n| A | B | C |\n| D | E | F |\n']) {
      expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    }
    for (const source of ['- +\n| a | b |\n', '> - > +\n| c |\n', '| a |\npara\n',
      '| a |\n\n>\n\n^ cap\n', '| a |\n\n- +\n']) {
      expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
    }
  })

  it.each([
    '|= A |\n| b\t|\n',
    '|= A |\n+ b |\n',
    '|= A ||\n',
    '|=x |\n',
    '# Before\n\n|= A |\n| b |\n',
    '|= A |\n\nText\n\n|= B |\n',
    '|= A |\n^ Table #\n',
    '{aligns="right"}\n|= A |\n', '{#id .table}\n|= A |\n',
    '|= A |\n^ First #\nsecond\n',
    '| a |\n^ caption\ncontinued\n',
    '# Before\n\n|= A |\n| b |\n^ Caption\n',
    '|= A |\n^ Caption   \n',
  ])('uses the existing table rules for canonical rows: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> | a |\n> | b |\n', '> > | a |\n> > | b |\n',
    '>   | a |\n>   | b |\n', '> |= A |\n', '> > |= A |\n',
    '::: note\n| a |\n| b |\n:::\n'])
  ('maps a quoted table back to document source positions: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a caption line after an empty quote as paragraph text', () => {
    const source = '>\n^ cap\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('maps a direct list table and guards unresolved caption and quote ownership', () => {
    const source = '- | a |\n  | b |\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(() => parseCursorPrototype('- | a |\n\n\n  ^ cap\n- c\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('- > | a |\n  + b |\ntail\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '3.{#x k=v} A numbered item with id and key-value.\n',
    'a.{.c} An alpha item.\n',
    '1.{#k} a\n   # h\n',
    '1.{.note}  first\n\n    second\n',
  ])('parses attributes abutting an ordered item marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '---\ntitle: Example\n---\n\nBody\n',
    '--- yaml\ntitle: Example\n---\n\nBody\n',
    '---\t\ntitle: Example\n---\n\nBody\n',
    '---\n---\n\nBody\n',
    '---\nfoo\n',
    '----\nfoo\n',
    '---x\nfoo\n',
  ])('uses the production root frontmatter reader: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '$$`E = mc^2`\n^ Equation: mass-energy\n',
    '$$`E = mc^2`\n\n^ Equation: mass-energy\n',
    '{#eq-emc}\n$$`E = mc^2`\n^ Equation #: mass-energy\n',
    '$$`a + b = c`\n\n^ Equation: the sum\n',
    '$$`E = mc^2`\n\n\n^ detached\n',
  ])('attaches a caption only to a standalone display equation: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '```=html\n<custom-el>Verbatim HTML</custom-el>\n```\n',
    '```=html\nb\n\n```\n\nafter\n',
    '```=html\n\n```\n\nafter\n',
    '```=html\nunterminated',
  ])('uses the production raw-fence reader at the root: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '> ```=html\n> x\n> ```\n',
    '::: note\na\n\n```=html\n\n```\n:::\n',
    '> a\n>\n> ```=html\n\nb\n',
  ])('uses the raw reader inside mapped quote and named containers: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines an unclosed quote raw block with a quoted blank payload', () => {
    expect(() => parseCursorPrototype('> a\n>\n> ```=html\n>\n\nb\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '::: |\nRoses are red,\nViolets are blue.\n:::\n',
    '::: |\nRoses are red,\n  Violets are blue.\n:::\n',
    '::: |\nTwo roads    diverged in a yellow wood,\nAnd looked   down one as far as I could\n:::\n',
    '::: |\ntab\tgap\nwide\t\tgap\n\tlead\n:::\n',
    '::: |\na  \\\n:::\n',
  ])('uses the production line-block reader and inline mode: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('maps a line block inside a quote to original source positions', () => {
    const source = '> ::: |\n> line\n> :::\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a line-block closer inside its named container', () => {
    const source = '::: note\n::: |\nline\n:::\n:::\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('maps a line block after an item paragraph through the list owner', () => {
    const source = '- x\n\n  ::: |\n  ab\\\t\n  cd\n  :::\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a line block on an item marker until its payload column is mapped', () => {
    expect(() => parseCursorPrototype('- ::: |\n    ```\n  :::\n  para\ntail\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '- a\n\n  ```=latex\n  \\x\n  ```\n',
    '- a\n\n  ```=latex\n  \\x\n  ```\n\n  c\n',
    '- a\n\n  ```=html\n  <x>\n  ```\n',
  ])('keeps raw-fence boundaries and list spacing separate: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a raw fence on an item marker until its payload column is mapped', () => {
    expect(() => parseCursorPrototype('- ```=html\n  <x>\n  ```\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it('assigns a lazy quote line to a quote inside a named container', () => {
    const source = '::: note\n> a\nb\n:::\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> > a\nb\n', '> a\n> > b\nc\n'])
  ('keeps a lazy line in its nested quote paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '> %%%\n> hidden\n> %%%\n',
    '::: note\n%%%\nhidden\n%%%\n:::\n',
  ])('uses the production comment reader in mapped containers: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a list-owned block comment until its boundary is mapped', () => {
    expect(() => parseCursorPrototype('- %%%\n  hidden\n  %%%\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it('declines a degraded quote comment until its line ownership is mapped', () => {
    expect(() => parseCursorPrototype('> %%%\n> text\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '- - a\n\n  %% just a note\n- b\n',
    '- a\n\n  %% note\n- b\n',
  ])('keeps a list loose when a blank precedes an invisible tail: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '{table}\n```csv\na,b\n1,2\n```\n',
    '{table header-rows=0}\n```tsv\nA\tB\n^\t<x>\n```\n',
    '{table aligns=left,right,right}\n```csv\nItem,Qty,Price\nApple,12,0.40\n"Pear, green",3,0.55\n```\n^ Stock on hand\n',
  ])('maps delimited table cells to their fence payload: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '> +\n|= 2-col header | < |= header |\n',
  ])('declines table forms whose container ownership is not migrated: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it('resolves root abbreviations and retains line comments', () => {
    const source = 'HTML is short.\n\n*[HTML]: Hyper Text\n\n%% editorial note\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a root block comment and ignores definitions inside it', () => {
    const source = '%%% note\n[ref]: /wrong\n%%%\n\n[ref][ref]\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('treats an unterminated triple-percent opener as a line comment', () => {
    const source = 'before\n\n%%%\nsecret\n\nafter\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(() => parseCursorPrototype('- x\n%%%%\ny\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['[^f]: note\n\nSee [^f].\n', '[^f]:   note\n', '[^f]: {empty}\n',
    '[^__proto__]: note\n', '[^f]: a\n\n[^f]: b\n'])
  ('keeps a one-line footnote definition in the document sidecar: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a multiline footnote until its body collector is migrated', () => {
    expect(() => parseCursorPrototype('[^f]: note\n  # heading\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('[^f]: note\n\n\n  more\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('[^f]: \n')).toThrow(UnsupportedCursorSyntax)
  })

  it('keeps a plain footnote continuation and its source positions', () => {
    for (const source of ['[^f]: note\n  more\n\nbody[^f]\n',
      '[^f]: note\n  more text.\n', '[^f]: note\n  Äpfel und Öl.\n',
      '[^f]: note\n\n  more text.\n\nbody[^f]\n']) {
      expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    }
  })

  it.each([':: t\n', ':: t\n: d\n', ':: t\n:  d\n',
    ':: t\n: d\n:: u\n: e\n', ':: a\n:: b\n: c\n'])
  ('parses a standalone simple definition list: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: t\n: > quote\n', ':: t\n: # Heading\n',
    ':: t\n: - item\n'])
  ('parses a one-line block in a definition body: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: term\n: A definition wrapped\nonto the next line.\n',
    ':: term\n: a\n  continuation\n'])
  ('keeps one plain wrapped definition paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a definition continuation marker before a plain follower', () => {
    expect(() => parseCursorPrototype(':: term\n: +\nflush\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype(':: term\n: a\nnext\nthird\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype(':: term\n: a\n    indented\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype(':: term\n: a\nnext\n:: later\n: b\n')).toThrow(UnsupportedCursorSyntax)
  })

  it('declines a definition body with trailing whitespace until its span rule is migrated', () => {
    expect(() => parseCursorPrototype(':: term\n: body  \n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype(':: term\n\n: body\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['# Before\n\n:: term\n: body\n',
    ':: term\n: body\n\n# After\n', '- list\n\n:: term\n: body\n'])
  ('keeps a simple definition list among other root blocks: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('ends a definition before a closed root comment block', () => {
    const source = ':: term\n:  body\n%%%\nhidden\n%%%\ntail\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(() => parseCursorPrototype(':: term\n:  body\n%%%\nhidden\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- [x] done\n', '- [ ] todo\n', '- [-] dropped\n', '- [+] plain\n'])
  ('preserves authored task list state: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['---\n', '***\n', '___\n'])('preserves thematic break spelling: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('carries block attributes over an invisible comment and blank line', () => {
    const source = '{.chapter}{#first}\n\n%% note\n# Title\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('consumes a loose-list attribute before publishing the AST', () => {
    const source = '{loose}\n1. Note text.\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['  text\n', '   # H\n', 'a\n  b\n', '  a\n  b\n'])
  ('trims paragraph indentation without changing source positions: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a heading marker without text as a paragraph', () => {
    const source = '#  \n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['# \u00a0 Title\n', '# \u00a0 ab\n\n[ab][]\n',
    '#   Heading\n', '# Title {#id}\n'])
  ('uses the canonical heading opener and content boundary: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    'a. apple\nb. banana\n',
    'iii. three\niv. four\n',
    '. first\n. second\n',
    '1) first\n2) second\n',
    '* first\n* second\n',
  ])('retains authored list marker dialect: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['-{.c} A classed item.\n', '-{#k} [x] bare\n',
    '.{#x} attributed\n', '-{title="a}b"} text\n',
    '-{.c} a\n  b\n', '.{#x} a\n  b\n'])
  ('preserves an attribute on a list item marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps task state before item attributes in the serialized AST', () => {
    const source = '-{#k} [x] bare\n  # inside\n'
    expect(JSON.stringify(parseCursorPrototype(source))).toBe(JSON.stringify(parse(source)))
  })

  it('promotes a paragraph containing one image to the public block node', () => {
    const source = '# Gallery\n\n![alt](photo.png)\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('retains reference-image promotion inside a quote', () => {
    const source = '> ![a][p]\n> ^ Cap\n\n[p]: /a\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '![alt](photo.png)\n^ Caption\n',
    '![alt](photo.png)\n\n^ Caption\n',
    '![alt](photo.png)\n\n\n^ Caption\n',
  ])('preserves image caption reach: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a caption-looking line in a paragraph led by an image and other text', () => {
    const source = '![a](p.png) text\n^ Caption\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('continues the outer list item after a blank below a nested list', () => {
    const source = '- a\n  - b\n\n  c\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps markers on a marker line in one nested list', () => {
    const source = '- - A\n\n    second\n  - B\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n+\nc\n- b\n', '1. a\n+\nc\n2. b\n'])
  ('attaches a single paragraph after a root list continuation marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a plus that precedes an indented line', () => {
    expect(() => parseCursorPrototype('- a\n+\n  c\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '- ```\n  a\n\n  b\n  ```\n',
    '- ```\n  - x\n  ```\n',
    '- ```\n    # H\n  ```\n',
    '- a\n    ```\n    x\n    ```\n',
    '- a\n    ```\n    x\n\n    y\n    ```\n',
    '- a\n    ```\n    x\n',
    '- a\n\n  b\n',
  ])('keeps a list item body intact across its lines: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n\n  > q\n', '- a\n\n  # H\n',
    '- a\n\n  b\n', '- > a\n\n  > b\n',
    '- a\n\n  {.x}\n  b\n', '- a\n\n  {.x}\n  # H\n',
    '- a\n    > q\n', '1. one\n\n    > q\n', '- a\n    # H\n'])
  ('classifies a blank before a new item block: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '> [a]: /x\n\nSee [t][a].\n',
    '- [a]: /x\n\nSee [t][a].\n',
  ])('declines a nested reference definition until its prepass is migrated: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it('parses nested blocks through the same cursor inside a quote', () => {
    const source = '> # Heading\n>\n> - one\n> - two\n>\n> > nested quote\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines an unmarked quote follower while its paragraph may still be open', () => {
    expect(() => parseCursorPrototype('> :: term\nlazy\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('> +\nlazy\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('> quote\n\tlazy\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['> quote\nlazy\n', '> quote\nlazy\n> more\n',
    '> a\n\\# escaped heading\n', '> first\n> second\nlazy\n',
    '> quote\nlazy\n\n', '> quote\nlazy\n^ Attribution\n'])
  ('keeps a plain quote paragraph open for its unmarked next line: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> Stay hungry.\n^ Attribution\n', '> quote\n\nnext\n', '> # Heading\ntail\n',
    '> > # H\ntail\n', '> > ```\n> > c\n> > ```\ntail\n',
    '> - item\n>   # Heading\ntail\n'])
  ('keeps a completed quote before the next root block: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['::: note\nBody\n:::\n', '::: toc\nBody\n:::\n',
    ':::\nA plain box.\n:::\n',
    ':::\n:::\n',
    ':::\nOuter\n::::\nInner\n::::\n:::\n',
    '::: note "Careful"\nVisible body.\n:::\n',
    '::: note [plain]\nBody\n:::\n',
    '::: [g]\na\n:::\n',
    '::: details "Baseline Wide"\nb\n:::\n',
    '::: note "Careful" [x]\nBody\n:::\n',
    '::: 2col\ny\n:::\n',
    ':::[/i/]\ny\n:::\n',
    '::: note\nbody\n',
    ':::\nbody\n',
    '::: note\n',
    '::: note\n# Heading\n\n- item\n:::\n',
    '::: note\nouter\n::: tip\ninner\n:::\n:::\n',
    '::: note\n::: tip\nBody\n:::\n:::',
    '> ::: note\n> Body\n> :::\n',
    '> quote\n> ::: note\n> body\n> :::\ntail\n',
    '> ::: footnotes\n> :::\n'])
  ('parses a simple named container through the shared block cursor: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['::: figure\nBody\n:::\n', '::: list-table\n- item\n:::\n',
    '> ::: references\n> :::\n', '- ::: note\n  body\n  :::\n',
    ':::\n*[HTML]: Hyper Text\n\nThe HTML spec.\n:::\n',
    '::: "Careful"\nBody\n:::\n',
    '::: note\n```text\n::: tip\n```\nbody\n:::\nafter\n',
    '::: note\n```\n:::\n```\n:::\n'])
  ('declines specialized or nested containers until their ownership is migrated: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '- > quote\n',
    '- ```\n  code\n  ```\n',
    '- # Heading\n',
    '- | a |\n  |---|\n  | b |\n',
    '- first\n  > quote\n',
  ])('parses a block inside a list item: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '> quote\n^ Caption\n',
    '> quote\n\n^ Caption\n',
    '```\ncode\n```\n^ Caption\n',
    '| Head |\n|---|\n| body |\n^ Caption\n',
    '| Head |\n|---|\n| body |\n^ Table #\n',
    '![p](p.png)\n^ Figure #, q\n',
  ])('keeps a caption on its block target: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '- ![a](b.png)\n\n  ^ cap\n- c\n',
    '- ![a](b.png)\n\n  ^ cap\n',
    '- ```\n  code\n  ```\n\n  ^ cap\n- c\n',
    '- $$`x`\n\n  ^ cap\n- c\n',
    '- text\n\n  ^ cap\n- c\n',
  ])('preserves list tightness around a caption: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n\n  *[A]: a\n', '- a\n\n  *[A]: a\n  - b\n',
    '- a\n\n  *[A]: a\n  - b\n- c\n'])
  ('treats an abbreviation-shaped list line as paragraph text: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a nested first-block continuation marker until column ownership is migrated', () => {
    expect(() => parseCursorPrototype('- foo\n  1. +\n    > b\n'))
      .toThrow(UnsupportedCursorSyntax)
    expect(parseCursorPrototype('- a\n  - +\f\n\nb\n')).toStrictEqual(parse('- a\n  - +\f\n\nb\n'))
  })

  it('declines a raised colon container whose list ownership is unresolved', () => {
    expect(() => parseCursorPrototype('- head\n\n      ::: note\n      a\n- second\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- item\n  %%%\n  [r]: /url\n  %%%\n\n[r][]\n',
    '- a\n  %%%\n  x\n  %%%\n # h\n'])
  ('maps a closed list comment at the item content column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n  %%%\n  x\n  %%%\n - s\n',
    '- x\n  %%%\n  a\n\n  b\n  %%%\n',
    '- intro\n\n   %%%\n   hidden\n   %%%\n'])
  ('declines list comments with unresolved line ownership: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['![a][nope]\n^ cap\n', '![a][nope]\n\n^ cap\n',
    '![a][ref]\n^ cap\n\n[ref]: /u\n'])
  ('attaches an image caption only when its reference resolves: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['``` graphviz\ndigraph { A -> B }\n```\n',
    '``` php\ncode\n```\n', '~~~ php\ncode\n~~~\n',
    '```php "src/Auth.php" [Composer]\ncomposer require x\n```\n',
    '``` "Heading"\ncode\n```\n', '``` [Label]\ncode\n```\n',
    '~~~php "Title" [Label]\ncode\n~~~\n',
    '- ```php "Title"\n  code\n  ```\n'])
  ('parses fence language and metadata: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['```  php\ncode\n```\n', '```\tphp\ncode\n```\n',
    '~~~  php\ncode\n~~~\n'])
  ('declines a fence language with an invalid separator: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['```\ncode\n', '~~~\ncode\n',
    'Intro\n\n```\ncode\n', 'Intro\n\n~~~\ncode\n',
    'Intro\n  \n```\ncode\n', 'Intro\n\t\n~~~\ncode\n'])
  ('parses a bare root fence opened at a block boundary through EOF: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines an unclosed fence after open paragraph text', () => {
    expect(() => parseCursorPrototype('Text\n```\ncode\n')).toThrow(UnsupportedCursorSyntax)
  })

  it('declines source forms that have not been migrated', () => {
    expect(() => parseCursorPrototype('A\r\nB')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('| a\\|b | c |\n|---|---|\n| x | y |')).toThrow(UnsupportedCursorSyntax)
  })
})
