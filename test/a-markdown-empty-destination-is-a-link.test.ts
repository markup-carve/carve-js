import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// Empty Markdown destinations have native Carve spellings. Reference
// definitions with empty destinations remain definitions after conversion.

const written = (markdown: string) => markdownToCarve(markdown).replace(/\n+$/, '')

describe('a Markdown link or image with an empty destination', () => {
  it.each([
    ["an empty inline destination", "[x]()", "[x]()"],
    ["an image with an empty source", "![y]()", "![y]()"],
    ["an empty pointy destination", "[z](<>)", "[z]()"],
    ["whitespace around an empty destination", "[z]( <> )", "[z]()"],
    ["an empty link keeps its title", "[q](<> \"t q\")", "[q]( \"t q\")"],
    ["an empty image keeps its title", "![h](<> (paren))", "![h]( \"paren\")"],
    ["a title is decoded, then quoted", "[f](<> \"a\\\"b &ast;\")", "[f]( \"a\\\"b *\")"],
    ["an image is written as its plain alt text", "![a *b* `c` [d](u) \\* &amp;]()", "![a b c d * &]()"],
    ["an image alt drops a code span's padding", "![a `` `x` `` b]()", "![a `x` b]()"],
    ["an image at the start of a line escapes its block opener", "![- x]()", "![- x]()"],
    ["an image alt drops defined reference links only", "![a [b][r] [r][] [r] [z]]()\n\n[r]: /u", "![a b r r [z]]()\n\n[r]: /u"],
    ["deeply nested brackets", "[a [b [c]]]()", "[a [b [c]]]()"],
    ["the label keeps its formatting", "pre [a *b* `c`]() post", "pre [a {/b/} `c`]() post"],
    ["a full reference", "[w][r]\n\n[r]: <>", "[w][r]\n\n[r]:"],
    ["collapsed, shortcut and case-folded references", "[r][] [r] [R]\n\n[r]: <>", "[r][] [r][] [R][r]\n\n[r]:"],
    ["a reference title is decoded", "[v][s]\n\n[s]: <> \"a &amp; \\\"b\"", "[v]( \"a & \\\"b\")"],
    ["a reference title on the next line", "[v][s]\n\n[s]: <>\n'next title'", "[v]( \"next title\")"],
    ["an indented title on the next line", "[v][s]\n\n[s]: <>\n    'code'", "[v]( \"code\")"],
    ["a definition before its reference leaves no blank line", "[r]: <>\n\n[r]", "[r][]\n\n[r]:"],
    ["a definition after a thematic break", "---\n[r]: <>\n\n[r]", "---\n\n[r][]\n\n[r]:"],
    ["a block quote interrupting a paragraph opens a definition", "text\n> [r]: <>\n\n[r]", "text\n\n> \n\n[r][]\n\n[r]:"],
    ["a definition in a block quote", "[r]\n\n> [r]: <>", "[r][]\n\n> \n\n[r]:"],
    ["a label holding a character reference", "[x][a&amp;b]\n\n[a&amp;b]: <>", "[x][a&b]\n\n[a&b]:"],
    ["a definition after a closed HTML comment", "<!-- c -->\n[r]: <>\n\n[r]", "```=html\n<!-- c -->\n```\n\n[r][]\n\n[r]:"],
    ["a definition after a multi-line HTML comment", "<!--\nx\n-->\n[r]: <>\n\n[r]", "```=html\n<!--\nx\n-->\n```\n\n[r][]\n\n[r]:"],
    ["a definition after a quote ends its open HTML block", "> <script>\n> x\n\n[r]: <>\n\n[r]", "> ```=html\n> <script>\n> x\n> ```\n\n[r][]\n\n[r]:"],
    ["a definition opening a later list item", "- one\n- [r]: <>\n\n[r]", "- one\n- %%\n\n[r][]\n\n[r]:"],
    ["a definition opening a list item", "- [r]: <>\n- two\n\n[r]", "- %%\n- two\n\n[r][]\n\n[r]:"],
    ["a definition continuing a list item", "- a\n\n    [r]: <>\n\n[r]", "- a\n\n[r][]\n\n[r]:"],
    ["a title on the line after a list item definition", "- [r]: <>\n  \"t\"\n- two\n\n[r]", "- %%\n- two\n\n[r]( \"t\")"],
    ["a later non-empty definition stays", "[r]\n\n[r]: <>\n[r]: /later", "[r][]\n\n[r]:"],
    ["an empty destination on the next line", "[r]\n\n[r]:\n<>", "[r][]\n\n[r]:"],
    ["a first definition continued on the next line wins", "[x][d]\n\n[d]:\n  /url\n[d]: <>", "[x][d]\n\n[d]: /url"],
    ["the first definition wins", "[x][d]\n\n[d]: /url\n[d]: <>", "[x][d]\n\n[d]: /url"],
    ["a destination on an inline link is not a reference", "[r](/u)\n\n[r]: <>", "[r](/u)\n\n[r]:"],
    ["a label at the start of a line escapes its block opener", "[- x]()", "[- x]()"],
    ["a label at the start of a quote escapes its block opener", "> [- x]()", "> [- x]()"],
    ["a label mid-line is not escaped", "a [- x]()", "a [- x]()"],
  ])('writes %s', (_, markdown, carve) => {
    expect(written(markdown)).toBe(carve)
  })
})

describe('a Markdown link whose destination is not empty', () => {
  it.each([
    ["a quoted destination after a space", "[u]( \"t\")", "[u](%22t%22)"],
    ["spaces around a destination", "[k]( /u )", "[k](/u)"],
    ["a definition interrupting a paragraph", "text\n[p]: <>", "text\n\\[p]: <>"],
    ["a definition in a fence", "[c]\n\n```\n\n[c]: <>\n```", "[c]\n\n```\n\n[c]: <>\n```"],
    ["a definition after definition-like paragraph text", "[x]\n\n[x]: a b c\n[x]: <>", "[x]\n\n[x]: a b c\n\\[x]: <>"],
    ["an indented code block after a list", "- a\n\nb\n\n    [r]: <>\n\n[r]", "- a\n\nb\n\n```\n[r]: <>\n```\n\n[r]"],
    ["a definition in an open HTML block", "<script>\n\n[r]: <>\n</script>\n\n[r]", "```=html\n<script>\n\n[r]: <>\n</script>\n```\n\n[r]"],
    ["a code span", "`[d]()`", "`[d]()`"],
  ])('keeps %s', (_, markdown, carve) => {
    expect(written(markdown)).toBe(carve)
  })

  it('does not treat a pointy destination holding a space as empty', () => {
    expect(written('[m](< >)')).not.toBe('m')
  })

  it('reads an empty link label without opening a list', () => {
    expect(carveToHtml(markdownToCarve('[- x]()')).trim()).toBe('<p><a href="">- x</a></p>')
  })
})
