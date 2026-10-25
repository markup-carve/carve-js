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

  it.each([
    'text\n- a\n- b\n',
    'text\n1. x\n2. y\n',
    '- a\n\n+\n- s\n',
    '> quoted\n- item\n',
  ])('keeps a list marker in the open paragraph when its owner does not claim it: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '- item **bold** text\n',
    '1. item [link](/u)\n',
    '- item with trailing spaces  \n',
  ])('builds a one-line list paragraph with its public inline and source positions: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '[x][r]\n\n[r]: /url "Title"\n',
    '[x][r]\n\n[r]: /url {.external}\n',
    '[x][r]\n\n[r]: /first\n\n[r]: /last\n',
    '[x][r]\n\n[r]: \ufeffhttps://example.com/\n',
    '[^]: /u\n\nsee [text][^].\n',
  ])('matches root reference definition metadata and winner selection: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('uses the canonical table reader for span-marked simple rows', () => {
    const source = '| < | b |\n|---|---|\n| c | d |\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    ':::\tnote\nx\n:::\n',
    '::: \tnote\nx\n:::\n',
  ])('keeps a tab in a colon separator distinct from later metadata: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '::: note\t"Title"\nx\n:::\n',
    '::: note "Title"\t[First]\nx\n:::\n',
    '::: note [a\t%% hidden]\nbody\n:::\n',
  ])('keeps a recognized colon kind when later metadata has a tab: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '::: >\nhello\n:::\n',
    '::: >\nhello\n:::\n^ Caption\n',
  ])('builds a fenced quote and optional caption through the shared body reader: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('promotes direct paragraph breaks inside a hard-break fence', () => {
    const source = '::: \\\none\ntwo\n:::\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('accepts an underscore at the start of a named container kind', () => {
    const source = '::: _box\ncontent\n:::\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps inline attributes after a bare colon run as paragraph text', () => {
    const source = '::: {.sidebar}\nnot a div\n:::\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    'text\n>>= operator\n>=3 items\n>_< face\n',
    'text\n>\tprose\n',
  ])('does not open a quote from an invalid quote marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['| a | b\n', '|\n'])
  ('keeps an invalid pipe row as paragraph text: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '| a | b |\n|\t--- |\t--- |\n| 1 | 2 |\n',
    '| a | b |\n| ---\t| ---\t|\n| 1 | 2 |\n',
  ])('treats tabs in a table separator as cell content: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('starts an indented line comment position at its marker', () => {
    const source = 'x\n  %% indented comment\ny\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '|{.highlight} Total | 99 |\n|---|---|\n| a | b |\n',
    '| Name | Score |{.head}\n|------|-------|\n| Ann | 9 |{.win}\n',
  ])('uses the canonical table reader for authored cell or row attributes: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('ends heading, list and quote spans before trailing spaces', () => {
    const source = '# Title \n\n- item \n\n> quoted \n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('places footnote text after a tab in its marker separator', () => {
    const source = 'x[^f]\n\n[^f]: \tnote\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '- a\n{.c\n}\n~~~\ny\n~~~\n',
    '- a\n{.c\n.d}\npara\n',
  ])('collects wrapped root block attributes before the following block: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('lets wrapped root attributes interrupt an open paragraph', () => {
    const source = 'text\n{.c\n.d}\npara\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    'See the note.[^n]\n\n[^n]: First paragraph of the note.\n+\nA second paragraph, joined with +.\n',
    '[^a]: intro\n+\nmore\n\nsee[^a]\n',
  ])('attaches one plain footnote paragraph after a root continuation marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines an empty-sentinel footnote with a continuation marker', () => {
    expect(() => parseCursorPrototype('[^a]: {empty}\n+\nmore\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    ':: term\n: A first paragraph,\n+\nthen a flush-left block joined with +.\n',
    ':: term\n:  intro\n+\nmore\n',
  ])('attaches one plain paragraph after a root definition continuation marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    'text\n```js\ncode\n',
    'text\n~~~\ncode\n# Heading\n',
    'text\n```js\ncode\n```\n',
  ])('checks for a fence closer before interrupting a root paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps an unclosed raw fence in the open root paragraph', () => {
    const source = 'text\n```=html\nfoo\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['a\n \nb\n', 'a\n\t\nb\n'])
  ('treats a whitespace-only line as a paragraph boundary: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('preserves raw source positions across CRLF and CR lines', () => {
    for (const source of ['a\r\nb\r\n', '- a\r\n- b\r\n', '> quote\r\nlazy\r\n',
      'a\rb\r', '- a\r- b\r', '> quote\rlazy\r']) {
      expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    }
  })

  it('replaces NUL text while retaining the raw byte length', () => {
    for (const source of ['a\0b\n', '# H\0\n', '- a\0\n- b\n']) {
      expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    }
  })

  it('maps the stripped leading BOM back to authored positions', () => {
    for (const source of ['\ufeff# Heading\n', '\ufeffa\nb\n',
      '\ufeff- a\n- b\n', '\ufeff|= A |\n| b |\n']) {
      expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    }
  })

  it('matches position-free and frontmatter-format parse options', () => {
    for (const source of ['# Heading\n', '- a\n- b\n', '\ufeff# Heading\r\n']) {
      expect(parseCursorPrototype(source, { positions: false })).toStrictEqual(
        parse(source, { positions: false }))
    }
    const frontmatter = '---\ntitle: X\n---\nText\n'
    expect(parseCursorPrototype(frontmatter, { defaultFrontmatterFormat: 'toml' })).toStrictEqual(
      parse(frontmatter, { defaultFrontmatterFormat: 'toml' }))
    const rendererOnly = { extensions: [{ name: 'renderer-only', renderers: {} }] }
    expect(parseCursorPrototype('Text\n', rendererOnly)).toStrictEqual(parse('Text\n', rendererOnly))
    expect(() => parseCursorPrototype('Text\n', { onUnclosedContainer: () => {} }))
      .toThrow(UnsupportedCursorSyntax)
  })

  it('replaces lone surrogates before scanning without changing raw byte length', () => {
    for (const source of ['a\ud800b\n', '# H\udfff\n', '- a\ud800\n- b\n']) {
      expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    }
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

  it.each(['- x\n  %%%\ny\n', '1. x\n   %%%\ny\n',
    '- x\n  %%%\n y\n'])
  ('keeps an indented degraded comment in a simple item: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- - x\n  %%%\n  y\n', '- x\n  %%%\n  body\ny\n'])
  ('declines degraded comments with unresolved nested ownership: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '- - a\n\n  %% just a note\n- b\n',
    '- a\n\n  %% note\n- b\n',
    '- a\n\n  %% note\n  text\n',
    '10. t\n\n    %% c\n    z\n',
  ])('keeps a list loose when a blank precedes an invisible tail: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a closed block comment separate from a line-comment tail', () => {
    const source = '- t\n\n  %%%\n  c\n  %%%\n z\n'
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

  it('hoists a footnote definition from a named container', () => {
    const source = 'See [^a].\n\n::: note\n[^a]: note body\n:::\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a multiline footnote until its body collector is migrated', () => {
    expect(parseCursorPrototype('[^f]: note\n  # heading\n'))
      .toStrictEqual(parse('[^f]: note\n  # heading\n'))
    expect(parseCursorPrototype('[^f]: note\n\n\n  more\n'))
      .toStrictEqual(parse('[^f]: note\n\n\n  more\n'))
    expect(() => parseCursorPrototype('[^f]: \n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype('[^f]: %% comment\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['[^a]: note\n  > quoted\n\nsee[^a]\n',
    '[^n]: intro\n  > quote\n    ordinary line\n\nsee[^n]\n'])
  ('keeps a single structural footnote continuation: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['[^a]: note\n\n  ```=html\n  <b>x</b>\n  ```\n\nsee[^a]\n',
    '[^a]: note\n\n  | a |\n  | - |\n  | b |\n\nsee[^a]\n',
    '[^a]: note\n  ```\n  code\n  ```\n'])
  ('keeps one fenced or table block in a footnote: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['[^n]: intro\n  > quote\n  # heading\n\nsee[^n]\n',
    'See[^1].\n\n[^1]: a\n\n\n    - b\n',
    '[^a]: note\n\n  {.cls}\n  styled\n\nsee[^a]\n'])
  ('keeps a bounded structural footnote follower: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a plain footnote paragraph after a bounded table', () => {
    const source = '[^a]: intro\n\n  | a |\n  | - |\n  | b |\n\n  closing line.\n\nsee[^a]\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['[^a]: intro\n  %% c\n  more\n\nsee[^a]\n',
    '[^a]: intro\n  %%%\n  c\n  %%%\n  more\n\nsee[^a]\n'])
  ('keeps a comment before a plain footnote paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a nested quote in one footnote list item', () => {
    const source = '[^n]: intro\n\n  - item\n\n    > quote\n\nsee[^n]\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- one\n  ::: note\n  b\n  :::\n',
    '- item\n  ::: note\n  body\n  :::\ntail\n'])
  ('keeps a closed one-paragraph colon container in a list item: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- ::: note\n  :::\n', '- ::: d\n  :::\n',
    '> - ::: box\n>   :::\n- tail\n', '> - ::: box\n>   :::\n  - tail\n'])
  ('keeps an empty closed colon container in its list owner: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- ::: note\n  - para text\n  :::\n',
    '- ::: note\n  1. para text\n  :::\n',
    '- ::: note\n  - one\n  - two\n  :::\n',
    '- ::: note\n\n  - para text\n  :::\n'])
  ('keeps a nested list inside a closed marker-line colon container: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- ::: d\n  b\n\n- s\n',
    '- ::: d\n  b\n\ntail\n'])
  ('ends an unclosed marker-line colon container at its physical blank: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n\n  [r]: /target\n',
    '- a\n\n  [r]: /target\n\n- b\n',
    '- a\n\n  [r]: /target\n\n  tail\n',
    '- [x][r]\n\n  [r]: /target\n'])
  ('hoists a reference definition owned by a simple root list: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['1. a\n\n   [r]: /target\n',
    '10. a\n\n    [r]: /target\n',
    '* a\n\n  [r]: /target\n'])
  ('hoists a reference definition at a root list content column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n  [r]: /u\ntail\n\n[r][]\n',
    '- a\n  [r]: /u\n more\ntail\n',
    '- a\n  [r]: /u\n\n  more\n'])
  ('hoists an adjacent simple list definition with a bounded follower: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['1. x\n   [r]: /u\n   [t][r]\n',
    '- a\n  [r]: /u\n    "T"\ntail\n\n[r][]\n',
    '- a\n  [r]: /u\n\n    more\ntail\n\n[r][]\n'])
  ('declines an adjacent list definition with unresolved following content: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['> - a\n> \n>   [r]: /target\n',
    '> - a\n> \n>   [r]: /target\n> \n> - b\n',
    '> - a\n> \n>   [r]: /target\n> \n>   tail\n',
    '> - [x][r]\n> \n>   [r]: /target\n'])
  ('hoists a reference definition owned by a simple quoted list: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> 1. a\n> \n>    [r]: /target\n',
    '> 10. a\n> \n>     [r]: /target\n',
    '> * a\n> \n>   [r]: /target\n'])
  ('hoists a quoted list definition at its authored content column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['[x][r]\n\n  [r]: /target\n',
    '> [x][r]\n> \n>   [r]: /target\n',
    '- a\n```\n- b\n```\n\n  [r]: /target\n'])
  ('does not index an indented root line as a list reference definition: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a list colon container with unresolved lazy text after its closer', () => {
    expect(() => parseCursorPrototype('- a\n  - b\n    ::: note\n    x\n    :::\n    text\nlazy\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it('ends a root definition list before a root link definition', () => {
    const source = ':: t\n:  d\n[r]: /u\n\nSee [text][r].\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('ends a root definition list before a root block attribute', () => {
    const source = ':: t\n:  d\n{.k}\ntail\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines an unfinished attribute after a definition body', () => {
    expect(() => parseCursorPrototype(':: t\n: d\n{.open\ntext\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it('reads one quote after a definition first-block marker', () => {
    const source = ':: term\n: +\n> the whole definition is this quote\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a heading at the definition body column and closes before the root tail', () => {
    const source = ':: term\n:  definition\n   # H\ntail\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: t\n:  body\n   > q\n',
    ':: term\n:  definition\n   > quote\n'])
  ('keeps one quote after a plain definition at its body column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('reads adjacent quote and heading blocks in a definition body', () => {
    const source = ':: term\n:  intro\n   > quote\n   # heading\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a quote follower after a definition already starts with a quote', () => {
    expect(() => parseCursorPrototype(':: t\n:  > a\n   > + b |\ntail\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- a\n  - b\n    # N\n  lazy\n',
    '> - a\n>     - child\n>     ```\n>     code\n>     ```\nafter\n',
    '- x\n  - text\n  > q\n\n  ^ cap\n- c\n'])
  ('returns to an ancestor list frame when a line reaches its column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a final under-column lazy line in the deepest open list paragraph', () => {
    const source = '- a\n  - b\n    - c\n   d\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- ```\nx\n```\n', '- ```\n x\n ```\n', '- ~~~\nx\n~~~\n',
    '- a\n  - ```\n  x\n  +\n', '- a\n  - ```\n  x\n    +\n'])
  ('bounds an empty marker-line fence using the next physical line: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('places a quoted ancestor fence after a closed child list', () => {
    const source = '> - a\n>     - child\n>       ```\n>       x\n>       ```\n>   ~~~\nafter\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines the unresolved root-list version of that fence boundary', () => {
    const source = '- a\n    - # h\n  ~~~\nafter\n'
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- - ```\n\ntail\n', '- a\n  - ```\n  +\n  > q\n'])
  ('declines marker-line fences whose physical follower still needs an owner: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- a\n  - > +\n   b\n', '- a\n  - > +\n  # h\n',
    '- a\n  - > +\n  b\n'])
  ('declines an unresolved quote boundary while returning to an ancestor: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it('declines a structural note with another indented block after a blank', () => {
    expect(() => parseCursorPrototype('[^a]: note\n\n  # H\n\n  after\n')).toThrow(UnsupportedCursorSyntax)
  })

  it('keeps a plain footnote continuation and its source positions', () => {
    for (const source of ['[^f]: note\n  more\n\nbody[^f]\n',
      '[^f]: note\n  more text.\n', '[^f]: note\n  Äpfel und Öl.\n',
      '[^f]: note\n\n  more text.\n\nbody[^f]\n',
      '[^f]: note\n  first\n  second\n',
      '[^f]: note\n\n  first\n  second\n']) {
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

  it.each([':: term\n: A definition can now hold\n\n  more than one paragraph.\n',
    ':: term\n: first\n\n  second\n',
    ':: term\n\n: the definition\n'])
  ('keeps a bounded blank inside a root definition list: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a definition continuation marker before a plain follower', () => {
    expect(() => parseCursorPrototype(':: term\n: +\nflush\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype(':: term\n: a\nnext\nthird\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype(':: term\n: a\n    indented\n')).toThrow(UnsupportedCursorSyntax)
    expect(() => parseCursorPrototype(':: term\n: a\nnext\n:: later\n: b\n')).toThrow(UnsupportedCursorSyntax)
  })

  it('keeps a blank before a definition but declines its trailing spaces', () => {
    expect(() => parseCursorPrototype(':: term\n: body  \n')).toThrow(UnsupportedCursorSyntax)
    expect(parseCursorPrototype(':: term\n\n: body\n'))
      .toStrictEqual(parse(':: term\n\n: body\n'))
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

  it('keeps an indented image and caption marker in a literal paragraph', () => {
    const source = ' ![Apollo](a.jpg)\n ^ Figure 1: moon\n'
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

  it.each(['- +\nx\n', '- +\n  x\n'])
  ('attaches a first-block marker to one plain list paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- foo\n  - [ ] +\n> b\n', '- foo\n  - [ ] +\n > b\n',
    '- foo\n  - [ ] +\n  > b\n', '- foo\n  - [ ] +\n    > b\n'])
  ('applies the authored column gate to a task first-block quote: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- foo\n  - [ ] +\n```\nx\n```\n',
    '- foo\n  - [ ] +\n ```\n x\n ```\n',
    '- foo\n  - [ ] +\n  ```\n  x\n  ```\n',
    '- foo\n  - [ ] +\n    ```\n    x\n    ```\n'])
  ('applies the authored column gate to a task first-block fence: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('starts a root indented list span at the authored line start', () => {
    const source = '  - a\n  - b\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- [ ] task\n- plain\n', '- plain\n- [ ] task\n',
    '- [ ] task\n- [x] done\n',
    '- [-] dropped\n- [_] paused\n- [>] deferred\n- [?] maybe\n'])
  ('separates task and ordinary list runs: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps an empty attributed bullet as a list item', () => {
    const source = '-{} A bare item via the empty block.\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- apples\n\n\n\n  still apples\n',
    '- apples\n\n\n\n- oranges\n'])
  ('uses the follower to end a long list blank run: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- outer\n\n  - a\n\n\n\n  - b\n',
    '- outer\n\n  para\n\n  - a\n\n\n\n  - b\n'])
  ('reopens a nested list after a long blank run: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('folds a plain line into a nested ordered item before its sibling', () => {
    const source = '1. outer\n   1. inner\nlazy\n   2. sibling\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['1. outer\n  1. inner\n', '- outer\n - inner\n'])
  ('folds a list marker only while the item paragraph is open: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['1. a\n\n 1. b\n', '1. a\n\n 1. b\n\n  1. c\n'])
  ('starts a sibling list for a below-column marker after a blank: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- +\n', '- +\n- b\n', '- +\n\npara\n',
    '1. +\n', '- [ ] +\n', '1. [ ] +\n'])
  ('keeps a refused first-block marker and its authored span: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: \n', '::\n'])('keeps an empty term marker as paragraph text: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: t\n: \u00a0x\n', ':: \u00a0t\n: d\n',
    ':: t\n: \u000cx\n'])
  ('keeps non-Carve whitespace as definition content: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: A term that\n   wraps\n: d\n',
    ':: A term that\nwraps onto the next line\n: its definition\n',
    ':: term\nwrapped on\n: definition\n',
    ':: `a\nb \n:  d\n',
    ':: term\n+\n: d\n',
    ':: A term that\n   wraps\n+\n: d\n'])
  ('keeps one wrapped term and its literal plus in the term: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: t\n:  body\n> q\n',
    ':: c\n# H\n',
    ':: t\n: a\n```\nb\n```\n',
    ':: t\n: a\n| t |\n'])
  ('ends a root definition list before a block at the document column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: t\n:  body\n    > q\n',
    ':: term\n:    definition\n      # H\ntail\n'])
  ('keeps a structural definition child at or past its content column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a raised definition quote with a lazy plain-line follower', () => {
    expect(() => parseCursorPrototype(':: t\n:  d\n    > q\ntail\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each([':: t\n:  d\n   %% c\ntail\n',
    ':: t\n:  d\n   %% c\n',
    ':: t\n:  d\n   %% c\n   # H\n'])
  ('keeps a line comment inside a root definition body: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: t\n:  d\n   {.k}\ntail\n',
    ':: t\n:  d\n   {.k}\n',
    ':: t\n:  d\n   {.k}\n   # H\n'])
  ('scopes a one-line attribute to its root definition body: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: t\n: a\n- x\n',
    ':: t\n: a\n::: note\nx\n:::\n'])
  ('declines a definition follower whose owner remains unresolved: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['[^n]: First paragraph.\n\n    Second paragraph.\n',
    '[^n]: first\n   continuation\n',
    '[^a]: note\n\tmore\n\nsee[^a]\n',
    '[^a]: note\n\n\tmore\n\nsee[^a]\n'])
  ('keeps a simply indented footnote paragraph at its source column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a plain footnote paragraph after several blank lines', () => {
    const source = '[^n]: first\n\n\n\n    second\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['[^a]: note\n  - item\n\nsee[^a]\n',
    '[^a]: note\n\t- item\n\nsee[^a]\n'])
  ('folds a list-shaped line into an open footnote paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a tabbed list marker whose extra space changes the footnote owner', () => {
    expect(() => parseCursorPrototype('[^a]: note\n\t - item\n\nsee[^a]\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each([':: \tx\n', ':: t\n: \tx\n'])
  ('accepts a tab after the required definition separator space: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a colon quote opener without its required space as paragraph text', () => {
    const source = ':::>\nx\n:::\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['[^n]: first\n  *emphasis*\n', '[^n]: first\n\n  `code`\n'])
  ('keeps inline markup in a simple footnote continuation: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['  ```js\n  c\n  ```', '        ```=html\n        <b>c</b>\n        ```'])
  ('keeps a fenced block after a separated footnote quote: %s', (fence) => {
    const source = `x[^1]\n\n[^1]: > q\n\n${fence}\n`
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines an unseparated fence after a footnote quote', () => {
    expect(() => parseCursorPrototype('x[^1]\n\n[^1]: > q\n   ```js\n   c\n   ```\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each(['> +\nflush\n', '> +\nflush\n\nafter\n'])
  ('attaches a first-block marker to one plain quote paragraph: %s', (source) => {
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
    '- [a]: /x\n\nSee [t][a].\n',
  ])('declines a nested reference definition until its prepass is migrated: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it('parses nested blocks through the same cursor inside a quote', () => {
    const source = '> # Heading\n>\n> - one\n> - two\n>\n> > nested quote\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('handles an unmarked quote follower according to its owning block', () => {
    expect(parseCursorPrototype('> :: term\nlazy\n'))
      .toStrictEqual(parse('> :: term\nlazy\n'))
    expect(parseCursorPrototype('> +\nlazy\n')).toStrictEqual(parse('> +\nlazy\n'))
    expect(() => parseCursorPrototype('> quote\n\tlazy\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['> quote\nlazy\n', '> quote\nlazy\n> more\n',
    '> a\n\\# escaped heading\n', '> first\n> second\nlazy\n',
    '> quote\nlazy\n\n', '> quote\nlazy\n^ Attribution\n'])
  ('keeps a plain quote paragraph open for its unmarked next line: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> ok\n>bad\n', '> q\n>+\n> para\n'])
  ('keeps an unspaced quote-like line as lazy paragraph text: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> :  d\n   :  b\n', '> :  d\n      :  b\n'])
  ('keeps a colon-shaped lazy line in a quote paragraph: %s', (source) => {
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

  it.each(['::: note\n```\nx\n:::\nafter\n',
    '::: note\n```\nx\n\n:::\n'])
  ('ends a bounded unclosed fence at its owned source line: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> ```\nx\n```\n', '> > ```\nc\n', '> ```\n',
    '> ```\ncode no marker\n> still\n'])
  ('keeps a quote-first fence bounded by its physical owner: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- > intro\n ```\n tail\n ```\n',
    '* > intro\n ````\n tail\n ````\n'])
  ('keeps a bounded multiline inline code span in its quoted list paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: term\n:  definition\n > quote\n',
    ':: term\n:  definition\n  # H\n'])
  ('keeps a below-column marker as definition paragraph text: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: term\n:  definition\n  [r]: /u\n',
    ':: term\n:  definition\n  {.k}\n',
    ':: term\n:  definition\n  ```\n'])
  ('keeps a below-column token in its definition paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> ```\n> x', '- > ```\n  x\nx'])
  ('declines a quoted fence with an unresolved continuation owner: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- a\n  - b\n\n    ```\n    p\n ```\n\n    tail\n',
    '- a\n  - b\n\n    ~~~\n    p\n ~~~\n\n    tail\n'])
  ('ends a nested list fence before a closer owned by its root list: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- outer\n  - head\n\n    ```\n    a\n   ```\n\n  tail\n',
    '- a\n  - b\n    - c\n\n      ```\n      x\n   ```\n'])
  ('declines a fence closer still owned by an intermediate list: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['::: figure\nBody\n:::\n', '::: list-table\n- item\n:::\n',
    '> ::: references\n> :::\n',
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
  ('keeps a fence with an invalid language separator as paragraph text: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['```\ncode\n', '~~~\ncode\n',
    'Intro\n\n```\ncode\n', 'Intro\n\n~~~\ncode\n',
    'Intro\n  \n```\ncode\n', 'Intro\n\t\n~~~\ncode\n'])
  ('parses a bare root fence opened at a block boundary through EOF: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps an unclosed fence after open paragraph text in that paragraph', () => {
    const source = 'Text\n```\ncode\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> :: t\ntail\n', '> :: t\n> : d\n>   # H\ntail\n'])
  ('keeps a lazy line in a quote-owned definition list: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> +\n- s\n', '> - > +\n- s\n', '- > > +\n  - s\n'])
  ('keeps an unmarked list marker as lazy text after a refused quoted plus: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- > q\n  - m\n', '- > q\n  1. m\n', '- > q\n  > more\n  - m\n'])
  ('keeps an adjacent item marker in an open quote paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('ends a quoted paragraph before a list marker after a blank line', () => {
    const source = '- a\n\n  > quote\n\n  - nested\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\ntail\n', '- a\ntail\nbar\n',
    '- a\ntail\n  other\nbar\n', '1. a\ntail\n'])
  ('keeps a root list paragraph open across lazy plain lines: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- one\n > q\n', '- one\n # H\n',
    '- a\n > q\ntail\n', '- a\n # H\ntail\n'])
  ('folds a below-column opener while the item paragraph is open: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- one\n ::: note\n x\n :::\n',
    '- one\n ```\n code\n ```\n',
    '- one\n :: term\n : d\n',
    '- one\n | a |\n |---|\n | b |\n'])
  ('keeps a below-column block-shaped line in the open item paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- - a\ntail\n', '- - a\nb\nc\n', '- - a\n - b\n', '- - a\n - b\nc\n'])
  ('keeps a marker-line nested item open for lazy plain text: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- - +\n> q\n', '- - [ ] +\n> q\n', '1. - +\n> q\n'])
  ('attaches a quote through a marker-line nested first-block marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('attaches a quote-owned list first-block marker to its next line', () => {
    const source = '> - +\n> q\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- > +\n> q\n', '- a\n  > +\n  q\n'])
  ('attaches a list-owned quote first-block marker to its next line: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([':: t\n:  - a\n    more\n', ':: t\n:  - a\n    *[HTML]: HyperText\n\nHTML here.\n',
    ':: t\n:  - a\n     ```\n     [r]: /url\n     ```\n\nSee [r][].\n',
    ':: t\n:  - a\n     %%%\n     [r]: /url\n     %%%\n\nSee [r][].\n',
    ':: t\n:  %%%\n   x\n   %%%\n'])
  ('keeps a definition body at its authored column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- intro\n%% c\ntail\n', '- a\n%%%\nc\n%%%\nb\n'])
  ('keeps line-comment retention distinct from a matched comment span: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> - intro\n> %% c\n> tail\n',
    '> - intro\n> %% c\n> \n> tail\n',
    '- - intro\n  %% c\ntail\n'])
  ('retains an ordinary line comment through nested list ownership: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- > intro\n%% c\ntail\n', '- > intro\n%% c\n\ntail\n',
    '- - intro\n%% c\ntail\n', '- - intro\n%% c\n\ntail\n'])
  ('retains a below-column comment after a first-block container: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- intro\n%% c\n tail\n', '- intro\n%% c\n # tail\n',
    '- intro\n%% c\n - tail\n', '- intro\n%% c\n > tail\n',
    '- - intro\n%% c\n - tail\n', '- > intro\n%% c\n - tail\n',
    '- intro\n%% c\n- next\n', '- inner\n  %% c\n code\n'])
  ('applies retained comment ownership to a below-column follower: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- intro\n  %% c\n - next\n',
    '- - intro\n  %% c\n - next\n',
    '- > intro\n  %% c\n - next\n'])
  ('clears list retention after an at-column comment: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- intro\n%% c\n ```\n x\n ```\n',
    '- intro\n%% c\n ~~~\n x\n ~~~\n',
    '- - intro\n%% c\n ```\n tail\n ```\n'])
  ('closes a retained below-column fence before its body misses the item: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> - intro\n> tail\n', '> - intro\n>  tail\n',
    '> - intro\n>  # tail\n', '> - intro\n>  > tail\n',
    '> - intro\n>  ```\n>  tail\n>  ```\n'])
  ('keeps a quote-owned list paragraph open across its continuation: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- - intro\n tail\n', '- - intro\n # tail\n',
    '- - intro\n > tail\n', '- - intro\n ```\n tail\n ```\n'])
  ('keeps a marker-line nested item paragraph open at the outer column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps a below-column list marker in a quote opened on the item marker', () => {
    const source = '- > intro\n - tail\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- > intro\ntail\n', '- > intro\n tail\n',
    '- > intro\n  tail\n', '- > intro\n    tail\n'])
  ('keeps a plain lazy line in a quote opened on the item marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- > a\nlazy\n    > b\n', '- > a\n  x\n    > b\n'])
  ('keeps an overindented quote marker literal after a lazy item quote: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a reference-shaped line after a lazy item quote', () => {
    const source = '- > a\n  b\n [r]: /u\n'
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- > intro\n # tail\n', '- > intro\n > tail\n',
    '- > intro\n   # tail\n', '- > intro\n    # tail\n',
    '- > intro\n    - tail\n',
    '- > intro\n    > tail\n'])
  ('keeps a structural-looking lazy line in a list item quote: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n  - b\ntail\n', '- a\n  - b\n    text\nlazy\n',
    '- a\n  - b\n    - c\nlazy\n',
    '- a\n  - b\n    ```\n    ::: note\n    ```\n    text\nlazy\n',
    '- a\n  - c\nb\n    ```\n    y\n    ```\nflush\n'])
  ('keeps a final plain line in the deepest open list paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n  - b\n  +\npara\n', '- a\n  - b\n  +\nleft\n'])
  ('keeps a refused plus and the following lazy line in one nested paragraph: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> - intro\n>  - tail\n', '> - intro\n> %% c\n>  - tail\n'])
  ('keeps a below-column marker literal in a quote-owned item: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- > q\n\n   ```js\n   c\n   ```\n',
    '- > q\n\n        ```js\n        c\n        ```\n',
    '- intro\n\n    ```\n    tail\n    ```\n',
    '> - intro\n> %% c\n> \n>     ```\n>     tail\n>     ```\n'])
  ('keeps a list tight across a blank before an indented code fence: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- > q\n\n   ```=html\n   <b>c</b>\n   ```\n',
    '- > q\n\n        ```=html\n        <b>c</b>\n        ```\n'])
  ('reads a shifted raw fence after a blank in a list-owned quote: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a shifted raw fence immediately after a nested quote', () => {
    expect(() => parseCursorPrototype('- a\n  > q\n   ```=html\n   <b>r</b>\n   ```\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- intro\n    - tail\n', '- intro\n%% c\n    - tail\n',
    '- > intro\n\n    - tail\n'])
  ('anchors a deep child list span at its root item content column: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- - intro\n    # tail\n', '- - intro\n    > tail\n',
    '- - intro\n%% c\n\n    # tail\n'])
  ('preserves indentation for a marker-line nested list block: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps the existing opaque quote indentation rule', () => {
    const source = '- > ~~~\n  > x\n  > ~~~\n\n    > y\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- - intro\n\n  - tail\n',
    '- - intro\n%% c\n\n  - tail\n'])
  ('keeps a nested list loose after a blank before its sibling: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('keeps an at-column unclosed fence behind the prototype guard', () => {
    expect(() => parseCursorPrototype('- q\n  ```\ntail\n')).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- t\n  {.c}\n   ````\n  x\n',
    '- t\n  {.c}\n  %% c\n   ````\n  x\n'])
  ('keeps an unclosed fence after invisible list lines at its authored base: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- item\n\n    ```\n    a\n   ```\n\n  tail\n',
    '> - a\n>     - child\n>     ```\n>\n>       ```\n>   ~~~\nafter\n'])
  ('declines a shifted fence whose remaining owner is unresolved: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- > ```\n  > x\n  > ```\n   > y\n',
    '- > ~~~\n  > x\n  > ~~~\n    > y\n',
    '- > ```\n  > x\n  > ```\n   > y\n   > z\n',
    '- > ```\n  > x\n  > ```\n   > y\n  > z\n',
    '- > p\n  > ```\n  > x\n  > ```\n    > y\n',
    '- > p\n  >\n  > ```\n  > x\n  > ```\n    > y\n',
    '- > ```\n  > x\n  > ```\n  > ~~~\n  > z\n  > ~~~\n    > y\n'])
  ('keeps a quote fence and its overindented follower with the authored owner: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('attaches a list continuation at its authored marker column', () => {
    const source = ' - a\n +\n > q\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n  - b\n  +\n  > q\n', '- foo\n  - [ ] task\n  +\n  > q\n',
    '- a\n  - b\n  +\n  para\n'])
  ('attaches a block after a nested item continuation marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- a\n  - b\n  +\n', '- a\n  - b\n  +\n> q\n',
    '- a\n  - b\n  +\n    > q\n'])
  ('keeps a refused nested continuation marker in the inner item: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('opens a nested list after a literal plus in the inner item', () => {
    const source = '- foo\n  - b\n  +\n    - x\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['- foo\n  - [ ] task\n  +\n  - x\n',
    '- foo\n  - [ ] task\n    +\n  - x\n',
    '- foo\n  - [ ] task\n  +\n  1. x\n'])
  ('keeps mixed nested list kinds under their parent item: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('loosens the parent list before a nested item continuation marker', () => {
    const source = '- a\n  - b\n\n  +\n  > q\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('attaches a closed fence through a nested item continuation marker', () => {
    const source = '- foo\n  - [ ] task\n  +\n  ```sh\n  npm test\n  ```\n  - [ ] more\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['> [f]: ~\n/\n', '> [ref]: /url\n\nSee [it][ref].\n',
    '> [a]: /x\n\nSee [t][a].\n'])
  ('indexes a simple root quote reference definition: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a definition inside a nested quote until its owner is indexed', () => {
    expect(() => parseCursorPrototype('> > [r]: /u\ntail\n\n[r][]\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it('declines a list-owned quoted definition with unresolved line ownership', () => {
    expect(() => parseCursorPrototype('- > :: t\n> : d\n>   [^f]: n\ntail\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it('declines a table form that has not been migrated', () => {
    expect(() => parseCursorPrototype('| a\\|b | c |\n|---|---|\n| x | y |')).toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- a\n  {.k}\n# H\n', '- a\n\n  {.x}\n\ntail\n'])
  ('ends a list span at its last placed child: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(parseCursorPrototype(source, { positions: false })).toStrictEqual(
      parse(source, { positions: false }))
  })

  it.each(['-{#k} {#h}\n # h\n', '1.{#k} {#h}\n  # h\n',
    '-{#k} [x] {#h}\n # h\n', '- {.k}\ntail\n'])
  ('keeps an empty list item span at its marker: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(parseCursorPrototype(source, { positions: false })).toStrictEqual(
      parse(source, { positions: false }))
  })

  it.each(['- a\n  {.c\n}\npara\n', '- a\n  {.c\n }\npara\n',
    '- a\n  {.c\n.d}\npara\n', '- a\n\n  {.c\n}\npara\n',
    '- a\n  - b\n    {.c\n}\npara\n'])
  ('keeps a wrapped list attribute in its physical owner: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(parseCursorPrototype(source, { positions: false })).toStrictEqual(
      parse(source, { positions: false }))
  })

  it('ends a quoted list at its last placed child after a wrapped attribute', () => {
    const source = '> - a\n>   {.c\n> }\npara\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(parseCursorPrototype(source, { positions: false })).toStrictEqual(
      parse(source, { positions: false }))
  })

  it('declines a wrapped quoted list attribute whose closer leaves the quote', () => {
    expect(() => parseCursorPrototype('> - a\n>   {.c\n}\npara\n'))
      .toThrow(UnsupportedCursorSyntax)
  })

  it.each(['- a\n  {.x}\n  - b\n', '- a\n\n  {.x}\n  1. b\n',
    '- a\n\n  {.x}\n  {#i}\n  - b\n', '- a\n\n   {.c}\n   - b\n'])
  ('attaches trailing item attributes to a nested list: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(parseCursorPrototype(source, { positions: false })).toStrictEqual(
      parse(source, { positions: false }))
  })

  it.each(['- a\n\n  %% note\n  - b\n- c\n', '- a\n\n  {.c}\n- b\n',
    '- a\n\n  {.x}\n  > q\n- c\n',
    '- a\n\n  {.x}\n  ```\n  code\n  ```\n- c\n'])
  ('keeps list tightness across an invisible line: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(parseCursorPrototype(source, { positions: false })).toStrictEqual(
      parse(source, { positions: false }))
  })

  it.each(['- a\n\n   {.c}\n', '- a\n\n     {.c}\n- b\n'])
  ('keeps an indented list attribute invisible: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(parseCursorPrototype(source, { positions: false })).toStrictEqual(
      parse(source, { positions: false }))
  })

  it.each(['> q\n> {.k}\ntail\n', '> intro\n>\n\n  more\n',
    '> intro\n>\n%% c\n  more\n', '> 1. para\n>    {#x}\ntail\n'])
  ('ends a quote span at its last placed child: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    expect(parseCursorPrototype(source, { positions: false })).toStrictEqual(
      parse(source, { positions: false }))
  })
})
