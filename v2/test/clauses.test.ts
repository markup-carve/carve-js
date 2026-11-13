// One test or more for every clause of the block chapter (spec/0.2/syntax-blocks.md) that the
// first slice implements. Each test names its clause id. Shape notation: see support/shape.ts.
import { describe, expect, it } from 'vitest'
import { MAX_DEPTH, readOpenerInfo } from '../src/index.ts'
import { checkDocument } from './support/checks.ts'
import { shape } from './support/shape.ts'

/** The block shape of the lines, with the property checks run on the same input. */
function blocks(...lines: string[]): string {
  const src = lines.join('\n')
  expect(checkDocument(src)).toBeNull()
  return shape(src)
}

describe('preliminaries', () => {
  it('C2-B-001: the same line has another role under another container stack', () => {
    expect(blocks('- b')).toBe('ul(-)[li[p"b"]]')
    expect(blocks('a', '- b')).toBe('p"a|- b"')
    expect(blocks('- a', '- b')).toBe('ul(-)[li[p"a"] li[p"b"]]')
  })

  it('C2-B-003: columns count from behind the quote mark', () => {
    expect(blocks('> - a', '>', '>   b')).toBe('quote[ul(-)[li[p"a" p"b"]]]')
    expect(blocks('> - a', '>', '> b')).toBe('quote[ul(-)[li[p"a"]] p"b"]')
  })

  it('C2-B-004: a leading tab counts to the next multiple of 4 and its bytes are kept in code', () => {
    expect(blocks('   - a', '', '\tb')).toBe('ul(-)[li[p"a" p"b"]]')
    expect(blocks('    - a', '', '\tb')).toBe('ul(-)[li[p"a"]] p"b"')
    expect(blocks('```', '\tx', '```')).toBe('code"\tx"')
  })

  it('C2-B-005: tab stops count from the start of the line', () => {
    // The tab after `> ` ends at column 4 of the line, which is column 3 behind the mark.
    // Counted from behind the mark it would end at column 4 and own the line.
    expect(blocks('>   - a', '>', '> \tb')).toBe('quote[ul(-)[li[p"a"]] p"b"]')
    expect(blocks('>  - a', '>', '> \tb')).toBe('quote[ul(-)[li[p"a" p"b"]]]')
  })

  it('C2-B-006: a marker or a quote mark followed by a tab is text', () => {
    expect(blocks('-\ta')).toBe('p"-\ta"')
    expect(blocks('1.\ta')).toBe('p"1.\ta"')
    expect(blocks('>\ta')).toBe('p">\ta"')
    expect(blocks('=\ta')).toBe('p"=\ta"')
  })

  it('C2-B-007: a tab that straddles the strip column is kept', () => {
    expect(blocks('  ```', '\tx', '  ```')).toBe('code"\tx"')
    expect(blocks('    ```', '\tx', '    ```')).toBe('code"x"')
  })

  it('C2-B-008: prefixes are read outside-in', () => {
    expect(blocks('- > a', '  > b')).toBe('ul(-)[li[quote[p"a|b"]]]')
    expect(blocks('> - a', '>', '>   > b')).toBe('quote[ul(-)[li[p"a" quote[p"b"]]]]')
    expect(blocks('- > = a', '> b')).toBe('ul(-)[li[quote[h1"a"]]] quote[p"b"]')
  })

  it('C2-B-009: a blank line belongs to no container', () => {
    expect(blocks('- a', '', '', '  b')).toBe('ul(-)[li[p"a" p"b"]]')
    expect(blocks('- - a', '', '', '', '', '    b')).toBe('ul(-)[li[ul(-)[li[p"a" p"b"]]]]')
  })
})

describe('paragraphs and interrupters', () => {
  it('C2-B-010: a line that opens no other block opens a paragraph', () => {
    expect(blocks('a')).toBe('p"a"')
    expect(blocks(':d')).toBe('p":d"')
  })

  it('C2-B-011: a lazy line at any indent and with any prefix', () => {
    expect(blocks('- a', '        b', 'c')).toBe('ul(-)[li[p"a|b|c"]]')
    expect(blocks('> a', 'b', '> c')).toBe('quote[p"a|b|c"]')
    expect(blocks('- > a', '> b')).toBe('ul(-)[li[quote[p"a|> b"]]]')
    expect(blocks('a', '= b', '> c', '***', '%% d')).toBe('p"a|= b|> c|***|%% d"')
  })

  it('C2-B-012: a paragraph closes at a blank line, at an interrupter or with its container', () => {
    expect(blocks('a', '', 'b')).toBe('p"a" p"b"')
    expect(blocks('a', '```')).toBe('p"a" code!""')
    expect(blocks('- a', '- b')).toBe('ul(-)[li[p"a"] li[p"b"]]')
  })

  it('C2-B-013: a code fence line interrupts a paragraph and is then tested for ownership', () => {
    expect(blocks('a', '~~~', 'x', '~~~')).toBe('p"a" code"x"')
    expect(blocks('- a', '  ```', '  x')).toBe('ul(-)[li[p"a" code!"x"]]')
    expect(blocks('- a', '```', 'x')).toBe('ul(-)[li[p"a"]] code!"x"')
    expect(blocks('> a', '```')).toBe('quote[p"a"] code!""')
  })

  it('C2-B-014: a list marker interrupts at an open list\'s column or past the item\'s marker', () => {
    expect(blocks('- a', '- b')).toBe('ul(-)[li[p"a"] li[p"b"]]')
    expect(blocks('- a', ' - b')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]]]]')
    expect(blocks('- a', '  1. b')).toBe('ul(-)[li[p"a" ol(1.)[li[p"b"]]]]')
    expect(blocks('- a', '  - b', '- c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]]] li[p"c"]]')
  })

  it('C2-B-014: a list marker where no list is open, or left of the list, is a lazy line', () => {
    expect(blocks('a', '- b')).toBe('p"a|- b"')
    expect(blocks('> a', '> - b')).toBe('quote[p"a|- b"]')
    expect(blocks('  - a', '- b')).toBe('ul(-)[li[p"a|- b"]]')
  })

  it('C2-B-019: a marker without the mark of the quote its list sits in is a lazy line', () => {
    expect(blocks('> - a', '- b')).toBe('quote[ul(-)[li[p"a|- b"]]]')
    expect(blocks('> - a', '  - b')).toBe('quote[ul(-)[li[p"a|- b"]]]')
    expect(blocks('> - a', '> - b')).toBe('quote[ul(-)[li[p"a"] li[p"b"]]]')
  })

  it('C2-B-020: a marker without the mark of a quote inside an item closes that quote', () => {
    expect(blocks('- > q', '- b')).toBe('ul(-)[li[quote[p"q"]] li[p"b"]]')
    expect(blocks('- > q', '  - b')).toBe('ul(-)[li[quote[p"q"] ul(-)[li[p"b"]]]]')
  })
})

describe('container ownership and stripping', () => {
  it('C2-B-023: a line belongs to the innermost item whose marker it is indented past', () => {
    expect(blocks('- a', '  - b', '', '   c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b" p"c"]]]]')
    expect(blocks('- a', '  - b', '', '  c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] p"c"]]')
    expect(blocks('- a', '  - b', '', ' c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] p"c"]]')
    expect(blocks('10. a', '', ' b')).toBe('ol(10.)[li[p"a" p"b"]]')
  })

  it('C2-B-024: a container that does not own the line closes with everything inside it', () => {
    expect(blocks('- a', '  - > b', '', 'c')).toBe('ul(-)[li[p"a" ul(-)[li[quote[p"b"]]]]] p"c"')
  })

  it('C2-B-025: the content of an item is stripped by at most its content column', () => {
    expect(blocks('- ```', '    x', '  y', ' z')).toBe('ul(-)[li[code!"  x|y|z"]]')
  })

  it('C2-B-026: the first line of a nested block sets its base column', () => {
    expect(blocks('- a', '', '      ```', '      x', '    y')).toBe('ul(-)[li[p"a" code!"x|y"]]')
  })

  it('C2-B-027: fence content is stripped by at most the opener\'s indent', () => {
    expect(blocks('  ```', '  a', '    b', ' c', '  ```')).toBe('code"a|  b|c"')
    expect(blocks('> ```', '>   a', '> ```')).toBe('quote[code"  a"]')
  })
})

describe('block quotes', () => {
  it('C2-B-028: the quote mark is `>` and a space or the end of the line', () => {
    expect(blocks('> a')).toBe('quote[p"a"]')
    expect(blocks('>')).toBe('quote[]')
    expect(blocks('>a')).toBe('p">a"')
    expect(blocks('> > a')).toBe('quote[quote[p"a"]]')
    expect(blocks('>> a')).toBe('p">> a"')
  })

  it('C2-B-029: a blank line without the mark ends the quote', () => {
    expect(blocks('> a', '', '> b')).toBe('quote[p"a"] quote[p"b"]')
    expect(blocks('> a', '>', '> b')).toBe('quote[p"a" p"b"]')
    expect(blocks('> = a', 'b')).toBe('quote[h1"a"] p"b"')
    expect(blocks('- > a', '', '  > b')).toBe('ul(-)[li[quote[p"a"] quote[p"b"]]]')
    expect(blocks('> ```', '> a', '', '> b')).toBe('quote[code!"a"] quote[p"b"]')
  })
})

describe('lists', () => {
  it('C2-B-030: a marker needs one space and a further character', () => {
    expect(blocks('-')).toBe('p"-"')
    expect(blocks('- ')).toBe('p"- "')
    expect(blocks('-a')).toBe('p"-a"')
    expect(blocks('1.')).toBe('p"1."')
    expect(blocks('-   a')).toBe('ul(-)[li[p"a"]]')
  })

  it('C2-B-031: a bullet marker is `-` or `*`', () => {
    expect(blocks('- a')).toBe('ul(-)[li[p"a"]]')
    expect(blocks('* a')).toBe('ul(*)[li[p"a"]]')
  })

  it('C2-B-032: the other bullet character starts another list', () => {
    expect(blocks('- a', '* b', '* c')).toBe('ul(-)[li[p"a"]] ul(*)[li[p"b"] li[p"c"]]')
  })

  it('C2-B-033: an ordered marker is one to nine digits or nothing, then `.` or `)`', () => {
    expect(blocks('123456789. a')).toBe('ol(123456789.)[li[p"a"]]')
    expect(blocks('1234567890. a')).toBe('p"1234567890. a"')
    expect(blocks('7) a')).toBe('ol(7))[li[p"a"]]')
    expect(blocks('. a')).toBe('ol(.)[li[p"a"]]')
    expect(blocks(') a')).toBe('p") a"')
    expect(blocks('1: a')).toBe('p"1: a"')
  })

  it('C2-B-034: the delimiter is part of the kind of an ordered list', () => {
    expect(blocks('1. a', '2) b', '3) c')).toBe('ol(1.)[li[p"a"]] ol(2))[li[p"b"] li[p"c"]]')
  })

  it('C2-B-038: the list starts at its first marker and the bare dot numbers automatically', () => {
    expect(blocks('3. a', '9. b')).toBe('ol(3.)[li[p"a"] li[p"b"]]')
    expect(blocks('0. a')).toBe('ol(0.)[li[p"a"]]')
    expect(blocks('. a', '. b')).toBe('ol(.)[li[p"a"] li[p"b"]]')
    expect(blocks('1. a', '. b')).toBe('ol(1.)[li[p"a"] li[p"b"]]')
  })

  it('C2-B-039: a task box stands directly after a bullet\'s space', () => {
    expect(blocks('- [ ] a')).toBe('ul(-,task)[li( )[p"a"]]')
    expect(blocks('* [X] a')).toBe('ul(*,task)[li(x)[p"a"]]')
    for (const state of ['x', '_', '/', '!', '-', '>', '?']) {
      expect(blocks(`- [${state}] a`)).toBe(`ul(-,task)[li(${state})[p"a"]]`)
    }
  })

  it('C2-B-040: in every other case the brackets are content', () => {
    expect(blocks('- [ ]')).toBe('ul(-)[li[p"[ ]"]]')
    expect(blocks('- [x]a')).toBe('ul(-)[li[p"[x]a"]]')
    expect(blocks('- [y] a')).toBe('ul(-)[li[p"[y] a"]]')
    expect(blocks('-  [x] a')).toBe('ul(-)[li[p"[x] a"]]')
    expect(blocks('1. [x] a')).toBe('ol(1.)[li[p"[x] a"]]')
  })

  it('C2-B-041: a matching marker at the list\'s column is a sibling', () => {
    expect(blocks('- [ ] a', '- [x] b')).toBe('ul(-,task)[li( )[p"a"] li(x)[p"b"]]')
    expect(blocks('2) a', '5) b')).toBe('ol(2))[li[p"a"] li[p"b"]]')
  })

  it('C2-B-042: a marker that does not match closes the list and opens a new one', () => {
    expect(blocks('- a', '1. b')).toBe('ul(-)[li[p"a"]] ol(1.)[li[p"b"]]')
    expect(blocks('- [ ] a', '- b')).toBe('ul(-,task)[li( )[p"a"]] ul(-)[li[p"b"]]')
    expect(blocks('- a', '  - b', '  * c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] ul(*)[li[p"c"]]]]')
  })

  it('C2-B-043: one or two blank lines do not end a list', () => {
    expect(blocks('- a', '', '- b')).toBe('ul(-,loose)[li[p"a"] li[p"b"]]')
    expect(blocks('1. a', '', '', '2. b')).toBe('ol(1.,loose)[li[p"a"] li[p"b"]]')
  })

  it('C2-B-044: three blank lines before a marker at the list\'s column end the list', () => {
    expect(blocks('- a', '', '', '', '- b')).toBe('ul(-)[li[p"a"]] ul(-)[li[p"b"]]')
    expect(blocks('- a', '  - b', '', '', '', '  - c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] ul(-)[li[p"c"]]]]')
    expect(blocks('> - a', '>', '>', '>', '> - b')).toBe('quote[ul(-)[li[p"a"]] ul(-)[li[p"b"]]]')
  })

  it('C2-B-045: two lists of one kind with fewer than three blank lines between them are one list', () => {
    expect(blocks('  - = a', '- b')).toBe('ul(-)[li[h1"a"] li[p"b"]]')
    expect(blocks('  - a', '', '', '', '- b')).toBe('ul(-)[li[p"a"]] ul(-)[li[p"b"]]')
    expect(blocks('- a', '', 'x', '', '- b')).toBe('ul(-)[li[p"a"]] p"x" ul(-)[li[p"b"]]')
  })

  it('C2-B-046: after a blank line a marker left of every open list continues the list', () => {
    expect(blocks('  - a', '', '- b', '- c')).toBe('ul(-,loose)[li[p"a"] li[p"b"] li[p"c"]]')
    expect(blocks('  - a', '    - b', '', '- c')).toBe('ul(-,loose)[li[p"a" ul(-)[li[p"b"]]] li[p"c"]]')
    expect(blocks('  - a', '', '1. b')).toBe('ul(-)[li[p"a"]] ol(1.)[li[p"b"]]')
  })

  it('C2-B-047: a marker between the columns of two open lists joins the deeper list', () => {
    expect(blocks('- a', '    - b', '  - c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"] li[p"c"]]]]')
    expect(blocks('- a', '    - b', '', '  - c')).toBe('ul(-)[li[p"a" ul(-,loose)[li[p"b"] li[p"c"]]]]')
    expect(blocks('- a', '    - b', '  1. c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] ol(1.)[li[p"c"]]]]')
  })

  it('C2-B-048: a marker indented past an item\'s marker opens a nested list without a blank line', () => {
    expect(blocks('- a', '  7. b')).toBe('ul(-)[li[p"a" ol(7.)[li[p"b"]]]]')
    expect(blocks('1. a', ' - b')).toBe('ol(1.)[li[p"a" ul(-)[li[p"b"]]]]')
  })

  it('C2-B-049: an item may start with any block on the marker line', () => {
    expect(blocks('- = a')).toBe('ul(-)[li[h1"a"]]')
    expect(blocks('- > a')).toBe('ul(-)[li[quote[p"a"]]]')
    expect(blocks('- ***')).toBe('ul(-)[li[hr]]')
    expect(blocks('1. ~~~', '   x', '   ~~~')).toBe('ol(1.)[li[code"x"]]')
    expect(blocks('> = a')).toBe('quote[h1"a"]')
  })

  it('C2-B-050: a marker line that holds another marker with content has a nested list', () => {
    expect(blocks('- 1. a')).toBe('ul(-)[li[ol(1.)[li[p"a"]]]]')
    expect(blocks('- -')).toBe('ul(-)[li[p"-"]]')
    expect(blocks('- - a', '  - b', '- c')).toBe('ul(-)[li[ul(-)[li[p"a"] li[p"b"]]] li[p"c"]]')
    expect(blocks('- [ ] - a')).toBe('ul(-,task)[li( )[ul(-)[li[p"a"]]]]')
  })

  it('C2-B-051: a line that starts with `+` is text', () => {
    expect(blocks('+ a', '+ b')).toBe('p"+ a|+ b"')
  })

  it('C2-B-052: a list is loose only when a blank line stands between two of its items', () => {
    expect(blocks('- a', '', '  b', '- c')).toBe('ul(-)[li[p"a" p"b"] li[p"c"]]')
    expect(blocks('- a', '  - b', '', '- c')).toBe('ul(-,loose)[li[p"a" ul(-)[li[p"b"]]] li[p"c"]]')
    expect(blocks('- a', '', '  - b', '  - c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"] li[p"c"]]]]')
    expect(blocks('- a', '')).toBe('ul(-)[li[p"a"]]')
    expect(blocks('- a', '- ```', '  x', '', '- c')).toBe('ul(-,loose)[li[p"a"] li[code!"x"] li[p"c"]]')
  })

  it('C2-B-132: tightness is set when the list closes', () => {
    expect(blocks('- one', '- two', '', '- three')).toBe('ul(-,loose)[li[p"one"] li[p"two"] li[p"three"]]')
  })
})

describe('code fences', () => {
  it('C2-B-080: a run of three or more backticks or tildes opens a code fence', () => {
    expect(blocks('```', 'x', '```')).toBe('code"x"')
    expect(blocks('~~~~', 'x', '~~~~')).toBe('code"x"')
    expect(blocks('``', 'x', '``')).toBe('p"``|x|``"')
  })

  it('C2-B-081: the closer has the opener\'s character and at least its length, at any column', () => {
    expect(blocks('```', 'x', '~~~', '`````', 'y')).toBe('code"x|~~~" p"y"')
    expect(blocks('````', '```', '````')).toBe('code"```"')
    expect(blocks('```', 'x', '      ```', 'y')).toBe('code"x" p"y"')
    expect(blocks('- ```', '  x', ' ```', '  y')).toBe('ul(-)[li[code"x" p"y"]]')
  })

  it('C2-B-082: a run followed by other text is content', () => {
    expect(blocks('```', '``` a', '```')).toBe('code"``` a"')
    expect(blocks('~~~', '~~~ a', '~~~  ')).toBe('code"~~~ a"')
  })

  it('C2-B-083: an unclosed fence ends with its container and never turns back into text', () => {
    expect(blocks('```', 'x')).toBe('code!"x"')
    expect(blocks('- ```', '  x', 'y')).toBe('ul(-)[li[code!"x"]] p"y"')
    expect(blocks('> ```', '> x', 'y')).toBe('quote[code!"x"] p"y"')
    expect(blocks('- ```', '  x', '', '', 'y')).toBe('ul(-)[li[code!"x"]] p"y"')
    expect(blocks('- ```', '  x', '', '  y')).toBe('ul(-)[li[code!"x||y"]]')
  })

  it('C2-B-084: the body of a code fence is not read for blocks', () => {
    expect(blocks('```', '- a', '> b', '= c', '', '***', '```')).toBe('code"- a|> b|= c||***"')
  })

  it('C2-B-086: a backtick run whose info string holds a backtick is not an opener', () => {
    expect(blocks('```a`b', 'x')).toBe('p"```a`b|x"')
    expect(blocks('~~~a`b', 'x')).toBe('code!"x"')
    expect(blocks('```js', 'x', '```')).toBe('code"x"')
  })

  it('C2-B-130: a fence opens whether or not a closer follows', () => {
    expect(blocks('a', '', '```', '= b')).toBe('p"a" code!"= b"')
  })
})

describe('comments', () => {
  it('C2-B-091: the line form is never an interrupter and stays in its leaf', () => {
    expect(blocks('a', '%% c', 'b')).toBe('p"a|%% c|b"')
    expect(blocks('- a', '%% c', '- b')).toBe('ul(-)[li[p"a|%% c"] li[p"b"]]')
  })

  it('C2-B-093: in the body of a code fence `%%` is code', () => {
    expect(blocks('```', '%% c', '```')).toBe('code"%% c"')
  })

  it('C2-B-094: after a marker a comment counts as content', () => {
    expect(blocks('- %% c')).toBe('ul(-)[li[%"%% c"]]')
    expect(blocks('> %% c')).toBe('quote[%"%% c"]')
    expect(blocks('= %% c')).toBe('h1"%% c"')
  })

  it('C2-B-095: a comment-only line is skipped by ownership and by the count of blank lines', () => {
    expect(blocks('- a', '', '%% c', '  b')).toBe('ul(-)[li[p"a" %"%% c" p"b"]]')
    expect(blocks('- a', '', '', '%% c', '', '- b')).toBe('ul(-)[li[p"a" %"%% c"]] ul(-)[li[p"b"]]')
    expect(blocks('- a', '', '%% c', '- b')).toBe('ul(-,loose)[li[p"a" %"%% c"] li[p"b"]]')
    expect(blocks('- > = a', '%% c', '  > b')).toBe('ul(-)[li[quote[h1"a" %"%% c" p"b"]]]')
  })

  it('C2-B-096: the comment is a child of the innermost open container, whatever its indent', () => {
    expect(blocks('%% c')).toBe('%"%% c"')
    expect(blocks('- - = a', '%% c')).toBe('ul(-)[li[ul(-)[li[h1"a" %"%% c"]]]]')
    expect(blocks('= a', '        %% c')).toBe('h1"a" %"%% c"')
  })

  it('C2-B-097: a line that holds only a braced comment is a paragraph', () => {
    expect(blocks('- = a', '{% c %}')).toBe('ul(-)[li[h1"a"]] p"{% c %}"')
  })
})

describe('headings', () => {
  it('C2-B-104: one to six `=`, one space and a further character', () => {
    expect(blocks('= a')).toBe('h1"a"')
    expect(blocks('====== a')).toBe('h6"a"')
    expect(blocks('======= a')).toBe('p"======= a"')
    expect(blocks('=')).toBe('p"="')
    expect(blocks('== ')).toBe('p"== "')
    expect(blocks('==a')).toBe('p"==a"')
  })

  it('C2-B-105: `#` is accepted in place of `=`', () => {
    expect(blocks('## a')).toBe('h2"a"')
    expect(blocks('#= a')).toBe('p"#= a"')
  })

  it('C2-B-106: everything after the space is heading text', () => {
    expect(blocks('== a ==')).toBe('h2"a =="')
    expect(blocks('= a {.c}')).toBe('h1"a {.c}"')
  })

  it('C2-B-107: a heading is one line', () => {
    expect(blocks('= a', 'b', '= c', '= d')).toBe('h1"a" p"b|= c|= d"')
    expect(blocks('= a', '= b')).toBe('h1"a" h1"b"')
  })
})

describe('thematic break', () => {
  it('C2-B-110: three or more stars and nothing else, at any indent', () => {
    expect(blocks('***')).toBe('hr')
    expect(blocks('     ******  ')).toBe('hr')
    expect(blocks('**')).toBe('p"**"')
    expect(blocks('*** a')).toBe('p"*** a"')
    expect(blocks('a', '', '---')).toBe('p"a" p"---"')
    expect(blocks('* * *')).toBe('ul(*)[li[ul(*)[li[p"*"]]]]')
  })
})

describe('readings the chapter leaves open', () => {
  it('C2-B-023: an item that joined its list at another column owns lines from its own column on', () => {
    expect(blocks('- a', '    - b', '  - c', '    - d')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"] li[p"c" ul(-)[li[p"d"]]]]]]')
  })

  it('C2-B-046: with nested lists open, a marker left of them is judged against the outermost list', () => {
    expect(blocks('  - a', '    1. b', '', '1. c')).toBe('ul(-)[li[p"a" ol(1.)[li[p"b"]]]] ol(1.)[li[p"c"]]')
  })

  it('C2-B-093: a comment line the container of an open fence does not own ends that container', () => {
    expect(blocks('- ```', '  x', '%% c', '  y')).toBe('ul(-)[li[code!"x"]] %"%% c" p"y"')
    expect(blocks('- ```', '  x', '  %% c', '  y')).toBe('ul(-)[li[code!"x|%% c|y"]]')
    expect(blocks('> ```', '> x', '%% c', '> y')).toBe('quote[code!"x"] %"%% c" quote[p"y"]')
  })

  it('C2-B-096: with no leaf open in a quote, a comment line is a comment node', () => {
    expect(blocks('> = a', '> %% c')).toBe('quote[h1"a" %"%% c"]')
  })

  it('a lone carriage return is not a line ending', () => {
    expect(blocks('a\rb')).toBe('p"a\rb"')
  })
})

describe('the fallback rule', () => {
  it('C2-B-131: past depth 200 an opener is text', () => {
    const marks = '> '.repeat(MAX_DEPTH)
    expect(blocks(`${marks}a`)).toBe(`${'quote['.repeat(MAX_DEPTH)}p"a"${']'.repeat(MAX_DEPTH)}`)
    expect(blocks(`${marks}> a`)).toBe(`${'quote['.repeat(MAX_DEPTH)}p"> a"${']'.repeat(MAX_DEPTH)}`)
    const quotes = '> '.repeat(MAX_DEPTH - 1)
    expect(blocks(`${quotes}- a`)).toBe(`${'quote['.repeat(MAX_DEPTH - 1)}p"- a"${']'.repeat(MAX_DEPTH - 1)}`)
  })
})

describe('ordered lists with letters and roman numerals', () => {
  it('C2-B-033: a marker is one letter or a roman numeral, and a bare delimiter is the dot only', () => {
    expect(blocks('a) x')).toBe('ol(a1))[li[p"x"]]')
    expect(blocks('XIV) x')).toBe('ol(I14))[li[p"x"]]')
    expect(blocks('ab) x')).toBe('p"ab) x"')
    expect(blocks('iV) x')).toBe('p"iV) x"')
    expect(blocks('a1) x')).toBe('p"a1) x"')
  })

  it('C2-B-034: the first marker alone fixes the style', () => {
    expect(blocks('i) x')).toBe('ol(i1))[li[p"x"]]')
    expect(blocks('I) x')).toBe('ol(I1))[li[p"x"]]')
    expect(blocks('c) x')).toBe('ol(a3))[li[p"x"]]')
    expect(blocks('v) x', 'vi) y')).toBe('ol(a22))[li[p"x"]] ol(i6))[li[p"y"]]')
    expect(blocks('ii) x')).toBe('ol(i2))[li[p"x"]]')
    expect(blocks('a) x', 'B) y')).toBe('ol(a1))[li[p"x"]] ol(A2))[li[p"y"]]')
  })

  it('C2-B-035: in a roman list a single roman letter is a sibling', () => {
    expect(blocks('iv) x', 'v) y', 'vi) z')).toBe('ol(i4))[li[p"x"] li[p"y"] li[p"z"]]')
    expect(blocks('i) x', 'b) y')).toBe('ol(i1))[li[p"x"]] ol(a2))[li[p"y"]]')
  })

  it('C2-B-036: in an alphabetic list every single letter is a sibling', () => {
    expect(blocks('h) x', 'i) y', 'j) z')).toBe('ol(a8))[li[p"x"] li[p"y"] li[p"z"]]')
    expect(blocks('h) x', 'ii) y')).toBe('ol(a8))[li[p"x"]] ol(i2))[li[p"y"]]')
  })

  it('C2-B-037: a letter or roman marker with a dot needs two spaces', () => {
    expect(blocks('a.  x')).toBe('ol(a1.)[li[p"x"]]')
    expect(blocks('a. x')).toBe('p"a. x"')
    expect(blocks('iv.  x')).toBe('ol(i4.)[li[p"x"]]')
    expect(blocks('iv. x')).toBe('p"iv. x"')
    expect(blocks('a) x')).toBe('ol(a1))[li[p"x"]]')
    expect(blocks('1. x')).toBe('ol(1.)[li[p"x"]]')
  })

  it('C2-B-038: the bare dot is of the kind of a decimal marker', () => {
    expect(blocks('a.  x', '. y')).toBe('ol(a1.)[li[p"x"]] ol(.)[li[p"y"]]')
  })
})

describe('description lists', () => {
  it('C2-B-055: term lines and description lines at the list\'s column form a description list', () => {
    expect(blocks(':: t', ': d')).toBe('dl[dt"t" dd[p"d"]]')
    expect(blocks('  :: t', '  : d', '  :: u')).toBe('dl[dt"t" dd[p"d"] dt"u"]')
    expect(blocks(':: t', ': d', '', '', ': e')).toBe('dl[dt"t" dd[p"d"] dd[p"e"]]')
    expect(blocks(':: t', ': d', '', '', '', ': e')).toBe('dl[dt"t" dd[p"d"]] p": e"')
    expect(blocks('::t')).toBe('p"::t"')
    expect(blocks('::')).toBe('p"::"')
  })

  it('C2-B-056: terms alone are an entry, and a description line with no term above it is text', () => {
    expect(blocks(':: t', ':: u')).toBe('dl[dt"t" dt"u"]')
    expect(blocks(': d')).toBe('p": d"')
    expect(blocks('- : d')).toBe('ul(-)[li[p": d"]]')
  })

  it('C2-B-057: a term is one leaf with lazy lines and takes no block opener', () => {
    expect(blocks(':: t', '      more', '= not a heading')).toBe('dl[dt"t|more|= not a heading"]')
    expect(blocks(':: > t')).toBe('dl[dt"> t"]')
    expect(blocks(':: t', '  : indented')).toBe('dl[dt"t|: indented"]')
  })

  it('C2-B-058: a fence line below term text closes the description list, whatever its indent', () => {
    expect(blocks(':: t', '    ```', '    x')).toBe('dl[dt"t"] code!"x"')
    expect(blocks(':: t', ':::', 'x')).toBe('dl[dt"t"] div[p"x"]')
  })

  it('C2-B-059: after a blank line only a mark at the list\'s column continues a list that ends in a term', () => {
    expect(blocks(':: t', '', '  x')).toBe('dl[dt"t"] p"x"')
    expect(blocks(':: t', '', ': d')).toBe('dl[dt"t" dd[p"d"]]')
    expect(blocks(':: t', '', ' : d')).toBe('dl[dt"t"] p": d"')
  })

  it('C2-B-060: a description may start with any block and owns lines indented past its mark', () => {
    expect(blocks(':: t', ': = h', '', '  p', '', ' - x')).toBe('dl[dt"t" dd[h1"h" p"p" ul(-)[li[p"x"]]]]')
    expect(blocks(':: t', ': :: u', '  : e')).toBe('dl[dt"t" dd[dl[dt"u" dd[p"e"]]]]')
    expect(blocks(':: t', ': d', '', 'x')).toBe('dl[dt"t" dd[p"d"]] p"x"')
  })

  it('C2-B-015: a mark at the open description list\'s column interrupts term and description text', () => {
    expect(blocks(':: t', ': d', 'lazy', ': e', ':: u')).toBe('dl[dt"t" dd[p"d|lazy"] dd[p"e"] dt"u"]')
    expect(blocks(':: t', ': d', '  : not a mark')).toBe('dl[dt"t" dd[p"d|: not a mark"]]')
    expect(blocks('a', ':: t')).toBe('p"a|:: t"')
  })

  it('C2-B-019: a mark without the mark of the quote the description list sits in is a lazy line', () => {
    expect(blocks('> :: t', ': d')).toBe('quote[dl[dt"t|: d"]]')
    expect(blocks('> :: t', '> : d')).toBe('quote[dl[dt"t" dd[p"d"]]]')
  })

  it('C2-B-021: a list marker at the column of a description list is a lazy line', () => {
    expect(blocks(':: t', '- x')).toBe('dl[dt"t|- x"]')
    expect(blocks(':: t', ': d', '- x')).toBe('dl[dt"t" dd[p"d|- x"]]')
    expect(blocks(':: t', ': d', ' - x')).toBe('dl[dt"t" dd[p"d" ul(-)[li[p"x"]]]]')
    expect(blocks('- a', '', '  :: t', '  : d', '- b')).toBe('ul(-)[li[p"a" dl[dt"t" dd[p"d"]]] li[p"b"]]')
  })

  it('C2-B-022: a term mark directly after paragraph text inside an item is a lazy line', () => {
    expect(blocks('- a', '  :: t')).toBe('ul(-)[li[p"a|:: t"]]')
    expect(blocks('- a', '', '  :: t')).toBe('ul(-)[li[p"a" dl[dt"t"]]]')
  })
})

describe('definitions', () => {
  it('C2-B-062: a definition stands at column 0 outside every container', () => {
    expect(blocks('[a]: /u')).toBe('def"[a]: /u"')
    expect(blocks(' [a]: /u')).toBe('p"[a]: /u"')
    expect(blocks('> [a]: /u')).toBe('quote[p"[a]: /u"]')
    expect(blocks('- [^a]: x')).toBe('ul(-)[li[p"[^a]: x"]]')
    expect(blocks('::: x', '*[a]: b')).toBe('div[p"*[a]: b"]')
  })

  it('C2-B-063: a footnote definition holds its content and the blocks indented past its marker', () => {
    expect(blocks('[^a]: x', '', ' y', '', 'z')).toBe('fn[p"x" p"y"] p"z"')
    expect(blocks('[^a]: > q', '  - i')).toBe('fn[quote[p"q"] ul(-)[li[p"i"]]]')
    expect(blocks('[^a]:')).toBe('p"[^a]:"')
    expect(blocks('[^]: x')).toBe('p"[^]: x"')
    expect(blocks('[^a b]: x')).toBe('p"[^a b]: x"')
  })

  it('C2-B-064: a link definition is one line with a URL without spaces and an optional quoted title', () => {
    expect(blocks('[a b]: /u "t"', 'x')).toBe('def"[a b]: /u "t"" p"x"')
    expect(blocks('[a]: ')).toBe('def"[a]: "')
    expect(blocks('[a]:')).toBe('p"[a]:"')
    expect(blocks('[a]: "t"')).toBe('def"[a]: "t""')
    expect(blocks('[a]: /u more')).toBe('p"[a]: /u more"')
    expect(blocks('[a]:/u')).toBe('p"[a]:/u"')
  })

  it('C2-B-065: an abbreviation definition has a label without spaces and an expansion', () => {
    expect(blocks('*[a]: b c')).toBe('abbr"*[a]: b c"')
    expect(blocks('*[a b]: c')).toBe('p"*[a b]: c"')
    expect(blocks('*[a-b]: c')).toBe('p"*[a-b]: c"')
    expect(blocks('*[A1]: c')).toBe('abbr"*[A1]: c"')
    expect(blocks('*[a]:')).toBe('p"*[a]:"')
  })

  it('C2-B-015: a definition line at column 0 is a sibling of an open definition, and else a lazy line', () => {
    expect(blocks('[^a]: x', '[^b]: y', '[c]: /u', '*[d]: e')).toBe('fn[p"x"] fn[p"y"] def"[c]: /u" abbr"*[d]: e"')
    expect(blocks('a', '[c]: /u')).toBe('p"a|[c]: /u"')
    expect(blocks('[^a]: x', 'lazy')).toBe('fn[p"x|lazy"]')
  })

  it('C2-B-014: a list marker indented past a footnote marker opens a list in the body', () => {
    expect(blocks('[^a]: x', ' - i', '- j')).toBe('fn[p"x" ul(-)[li[p"i|- j"]]]')
  })
})

describe('attribute lines', () => {
  it('C2-B-068: one or more glued brace blocks, alone on the line', () => {
    expect(blocks('{.a}', 'x')).toBe('{.a}p"x"')
    expect(blocks('  {.a}{#b}  ', 'x')).toBe('{.a}{#b}p"x"')
    expect(blocks('{.a} {.b}', 'x')).toBe('p"{.a} {.b}|x"')
    expect(blocks('{.a} y', 'x')).toBe('p"{.a} y|x"')
    expect(blocks('{k="}"}', 'x')).toBe('{k="}"}p"x"')
    expect(blocks('{}', 'x')).toBe('p"{}|x"')
  })

  it('C2-B-069: the block that starts on the next line in the same container takes the line', () => {
    expect(blocks('{.a}', '- x', '- y')).toBe('{.a}ul(-)[li[p"x"] li[p"y"]]')
    expect(blocks('{.a}', '      = h')).toBe('{.a}h1"h"')
    expect(blocks('> {.a}', '> x')).toBe('quote[{.a}p"x"]')
    expect(blocks('- x', '', '  {.a}', '  - y')).toBe('ul(-)[li[p"x" {.a}ul(-)[li[p"y"]]]]')
  })

  it('C2-B-002, C2-B-070: an attribute line waits for the next line and is a paragraph when no block takes it', () => {
    expect(blocks('{.a}')).toBe('p"{.a}"')
    expect(blocks('{.a}', '', 'x')).toBe('p"{.a}" p"x"')
    expect(blocks('> {.a}', 'x')).toBe('quote[p"{.a}"] p"x"')
    expect(blocks('- x', '', '  {.a}', '- y')).toBe('ul(-)[li[p"x" p"{.a}"] li[p"y"]]')
    expect(blocks('::: x', '{.a}', ':::')).toBe('div[p"{.a}"]')
  })

  it('C2-B-071: consecutive attribute lines merge', () => {
    expect(blocks('{.a}', '{.b}', 'x')).toBe('{.a|.b}p"x"')
    expect(blocks('{.a}', '', '{.b}', '{.c}', 'x')).toBe('p"{.a}" {.b|.c}p"x"')
    expect(blocks('{.a}', '{.b}')).toBe('p"{.a}" p"{.b}"')
  })

  it('C2-B-073: every block takes an attribute line, a definition and a comment block included', () => {
    expect(blocks('{.a}', '[b]: /u')).toBe('{.a}def"[b]: /u"')
    expect(blocks('{.a}', '[^b]: x')).toBe('{.a}fn[p"x"]')
    expect(blocks('{.a}', '%%%', 'x', '%%%')).toBe('{.a}%%%"x"')
    expect(blocks('{.a}', '> x')).toBe('{.a}quote[p"x"]')
    expect(blocks('{.a}', '```', 'x', '```')).toBe('{.a}code"x"')
    expect(blocks('{.a}', ':: t')).toBe('{.a}dl[dt"t"]')
    expect(blocks('{.a}', '***')).toBe('{.a}hr')
  })

  it('C2-B-074: a caption takes no attribute line', () => {
    expect(blocks('```', 'x', '```', '{.a}', '^ c')).toBe('code"x" {.a}p"^ c"')
  })

  it('C2-B-075: an attribute line its container does not own closes it, and the lists around it are not adjacent', () => {
    expect(blocks('- a', '', '{.x}', '- b')).toBe('ul(-)[li[p"a"]] {.x}ul(-)[li[p"b"]]')
  })

  it('C2-B-095: a comment-only line is skipped by a pending attribute line', () => {
    expect(blocks('{.a}', '%% c', 'x')).toBe('%"%% c" {.a}p"x"')
  })

  it('C2-B-078, C2-B-079: the attributes of an item abut the marker and close on its line', () => {
    expect(blocks('-{.i} b')).toBe('ul(-)[li{}[p"b"]]')
    expect(blocks('1.{.i}{#j} b')).toBe('ol(1.)[li{}[p"b"]]')
    expect(blocks('-{.i}b')).toBe('p"-{.i}b"')
    expect(blocks('-{.i', '} b')).toBe('p"-{.i|} b"')
    expect(blocks('- {.i} b')).toBe('ul(-)[li[p"{.i} b"]]')
  })
})

describe('divs, sigil divs and comment blocks', () => {
  it('C2-B-080: a colon run opens or closes a div and a percent run opens a comment block', () => {
    expect(blocks('::: note', 'x', ':::')).toBe('div[p"x"]')
    expect(blocks('%%%', 'x', '%%%', 'y')).toBe('%%%"x" p"y"')
    expect(blocks('a', ':::', 'b')).toBe('p"a" div[p"b"]')
    expect(blocks('a', '%%%', 'b')).toBe('p"a" %%%!"b"')
  })

  it('C2-B-081: the closer of a div stands on a line owned by the same container', () => {
    expect(blocks('::: a', '- x', '  :::', '  y', ':::')).toBe('div[ul(-)[li[p"x" div[p"y"]]]]')
    expect(blocks('> ::: a', '> x', '> :::', '> y')).toBe('quote[div[p"x"] p"y"]')
    expect(blocks('::: a', 'x', '      :::', 'y')).toBe('div[p"x"] p"y"')
  })

  it('C2-B-082: the closer of a comment block is a bare run', () => {
    expect(blocks('%%%', '%%% x', '%%%%', 'y')).toBe('%%%"%%% x" p"y"')
  })

  it('C2-B-083: an unclosed div or comment block ends with its container', () => {
    expect(blocks('- ::: a', '  x', '', 'y')).toBe('ul(-)[li[div[p"x"]]] p"y"')
    expect(blocks('> %%%', '> x', 'y')).toBe('quote[%%%!"x"] p"y"')
    expect(blocks('::: a', 'x')).toBe('div[p"x"]')
  })

  it('C2-B-084: the body of a comment block is not read and the body of a div is read as blocks', () => {
    expect(blocks('%%%', '- a', '```', '%%%')).toBe('%%%"- a|```"')
    expect(blocks('::: a', '- a', '', '= h', ':::')).toBe('div[ul(-)[li[p"a"]] h1"h"]')
  })

  it('C2-B-087: the body of a line block is one leaf that knows only prefixes and the closer', () => {
    expect(blocks('::: |', '- a', '  = b', '', '%% c', ':::', 'x')).toBe('lines"- a|  = b||%% c" p"x"')
    expect(blocks('> ::: |', '>  a', '> :::')).toBe('quote[lines" a"]')
    expect(blocks(':::: |', ':::', '::::')).toBe('lines":::"')
    expect(blocks('- ::: |', '  a', 'b')).toBe('ul(-)[li[lines!"a"]] p"b"')
  })

  it('C2-B-088: a hard-break block and a quote fence are containers', () => {
    expect(blocks('::: \\', '- a', ':::')).toBe('div(\\)[ul(-)[li[p"a"]]]')
    expect(blocks('::: >', '= h', ':::')).toBe('div(>)[h1"h"]')
    expect(blocks(':::>', 'x', ':::')).toBe('div(>)[p"x"]')
  })

  it('C2-B-089: a bare colon run closes the innermost div it is long enough for, or opens an anonymous div', () => {
    expect(blocks('::::', ':::', 'x', ':::', '::::', 'y')).toBe('div[div[p"x"]] p"y"')
    expect(blocks('::: a', ':::: b', 'x', ':::', 'y')).toBe('div[div[p"x"]] p"y"')
    expect(blocks('::: a', ':::: b', 'x', '::::', 'y')).toBe('div[div[p"x"] p"y"]')
    expect(blocks(':::', 'x')).toBe('div[p"x"]')
  })

  it('C2-B-090: a colon run followed by a name or a sigil always opens a div', () => {
    expect(blocks('::: a', '::: b', 'x', ':::', ':::', 'y')).toBe('div[div[p"x"]] p"y"')
    expect(blocks('::: a', ':::::::: |', 'x')).toBe('div[lines!"x"]')
  })

  it('C2-B-100: a comment block at column 0 between two list items ends the first list', () => {
    expect(blocks('- a', '%%%', 'x', '%%%', '- b')).toBe('ul(-)[li[p"a"]] %%%"x" ul(-)[li[p"b"]]')
    expect(blocks('- a', '  %%%', '  x', '  %%%', '- b')).toBe('ul(-)[li[p"a" %%%"x"] li[p"b"]]')
  })

  it('C2-B-093: in a line block and in a comment block a `%%` line is body text', () => {
    expect(blocks('- ::: |', '  a', '  %% c', '  b', '  :::')).toBe('ul(-)[li[lines"a|%% c|b"]]')
    expect(blocks('- %%%', '  a', '  %% c', '  %%%')).toBe('ul(-)[li[%%%"a|%% c"]]')
    expect(blocks('- ::: |', '  a', '%% c')).toBe('ul(-)[li[lines!"a"]] %"%% c"')
  })

  it('C2-B-131: a div counts toward the depth cap', () => {
    const marks = '> '.repeat(MAX_DEPTH)
    expect(blocks(`${marks}::: a`)).toBe(`${'quote['.repeat(MAX_DEPTH)}p"::: a"${']'.repeat(MAX_DEPTH)}`)
  })
})

describe('the fence opener and titles', () => {
  it('C2-B-085: an opener holds an optional word and an optional quoted title', () => {
    const read = (src: string, run: number): [string, string, boolean] => {
      const info = readOpenerInfo(src, run)
      return [src.slice(info.wordStart, info.wordEnd), src.slice(info.titleStart, info.titleEnd), info.extra]
    }
    expect(read('```python "src/app.py"\ncode', 3)).toEqual(['python', 'src/app.py', false])
    expect(read('~~~~\ncode', 4)).toEqual(['', '', false])
    expect(read('::: note "A \\" B"', 3)).toEqual(['note', 'A \\" B', false])
    expect(read('::: "Title"', 3)).toEqual(['', 'Title', false])
    expect(read('```js extra words', 3)).toEqual(['js', '', true])
    expect(read(':::: |\r\nx', 4)).toEqual(['|', '', false])
    expect(blocks('```python "src/app.py"', 'code', '```')).toBe('code"code"')
  })
})

describe('captions', () => {
  it('C2-B-101: a caption line stands directly below its block and is owned by the same container', () => {
    expect(blocks('```', 'x', '```', '^ c')).toBe('code"x" cap"c"')
    expect(blocks('```', 'x', '```', '        ^   c')).toBe('code"x" cap"c"')
    expect(blocks('```', 'x', '```', '', '^ c')).toBe('code"x" p"^ c"')
    expect(blocks('- ```', '  x', '  ```', '  ^ c')).toBe('ul(-)[li[code"x" cap"c"]]')
    expect(blocks('- ```', '  x', '  ```', '^ c')).toBe('ul(-)[li[code"x"]] p"^ c"')
    expect(blocks('```', 'x', '```', '^c')).toBe('code"x" p"^c"')
    expect(blocks('```', 'x', '```', '^ ')).toBe('code"x" p"^ "')
    expect(blocks('^ c')).toBe('p"^ c"')
    expect(blocks('= h', '^ c')).toBe('h1"h" p"^ c"')
  })

  it('C2-B-102: a code block, a quote, a quote fence, a figure group, an image and a math block take a caption', () => {
    expect(blocks('> q', '^ c')).toBe('quote[p"q"] cap"c"')
    expect(blocks('::: >', 'q', ':::', '^ c')).toBe('div(>)[p"q"] cap"c"')
    expect(blocks('::: figure', 'x', ':::', '^ c')).toBe('div(figure)[p"x"] cap"c"')
    expect(blocks('::: note', 'x', ':::', '^ c')).toBe('div[p"x"] p"^ c"')
    expect(blocks('![a](b)', '^ c')).toBe('img"![a](b)" cap"c"')
    expect(blocks('$$`x`', '^ c')).toBe('p"$$`x`" cap"c"')
    expect(blocks('%%%', 'x', '%%%', '^ c')).toBe('%%%"x" p"^ c"')
  })

  it('C2-B-103: a caption takes lazy lines and ends as a paragraph does', () => {
    expect(blocks('> q', '^ c', '^ d', 'e', '', 'f')).toBe('quote[p"q"] cap"c|^ d|e" p"f"')
    expect(blocks('```', 'x', '```', '^ c', '```', 'y')).toBe('code"x" cap"c" code!"y"')
  })

  it('C2-B-016: a caption line interrupts a paragraph only when it holds nothing but an image', () => {
    expect(blocks('![a](b)', '^ c')).toBe('img"![a](b)" cap"c"')
    expect(blocks('![a][r]{.x}', '^ c')).toBe('img"![a][r]{.x}" cap"c"')
    expect(blocks('![a](b) t', '^ c')).toBe('p"![a](b) t|^ c"')
    expect(blocks('![a](b)', '![c](d)', '^ c')).toBe('p"![a](b)|![c](d)|^ c"')
    expect(blocks('a', '^ c')).toBe('p"a|^ c"')
    expect(blocks('- ![a](b)', '  ^ c')).toBe('ul(-)[li[img"![a](b)" cap"c"]]')
    expect(blocks('- ![a](b)', '^ c')).toBe('ul(-)[li[p"![a](b)|^ c"]]')
  })

  it('C2-B-017: a caption line without the mark closes a quote that ends in a paragraph and captions it', () => {
    expect(blocks('> q', '> r', '^ c')).toBe('quote[p"q|r"] cap"c"')
    expect(blocks('> q', '> ^ c')).toBe('quote[p"q|^ c"]')
    expect(blocks('> - q', '^ c')).toBe('quote[ul(-)[li[p"q|^ c"]]]')
    expect(blocks('- > q', '  ^ c')).toBe('ul(-)[li[quote[p"q"] cap"c"]]')
  })

  it('C2-B-095: a comment-only line does not separate a caption from its block', () => {
    expect(blocks('```', 'x', '```', '%% n', '^ c')).toBe('code"x" %"%% n" cap"c"')
  })
})

describe('one-line constructs', () => {
  it('C2-B-108: an include directive is a block of one line and not an interrupter', () => {
    expect(blocks('{{ a.crv }}', 'x')).toBe('inc"{{ a.crv }}" p"x"')
    expect(blocks('x', '{{ a.crv }}')).toBe('p"x|{{ a.crv }}"')
    expect(blocks('{{ a.crv }} x')).toBe('p"{{ a.crv }} x"')
    expect(blocks('- {{ a.crv }}')).toBe('ul(-)[li[inc"{{ a.crv }}"]]')
  })

  it('C2-B-109, C2-B-132: a paragraph that closes holding nothing but one image is a block image', () => {
    expect(blocks('![a](b)')).toBe('img"![a](b)"')
    expect(blocks('![a](b)', 'x')).toBe('p"![a](b)|x"')
    expect(blocks('![a](b) x')).toBe('p"![a](b) x"')
    expect(blocks('![a [b]](c (d))')).toBe('img"![a [b]](c (d))"')
    expect(blocks('[a](b)')).toBe('p"[a](b)"')
  })
})

describe('frontmatter', () => {
  it('C2-B-111: line 1 opens frontmatter when it is exactly three hyphens at column 0', () => {
    expect(blocks('---', 'a: b', '---', 'x')).toBe('fm"a: b" p"x"')
    expect(blocks('--- toml  ', 'a', '---')).toBe('fm"a"')
    expect(blocks('﻿---', 'a', '---')).toBe('fm"a"')
    expect(blocks('----', 'a')).toBe('p"----|a"')
    expect(blocks(' ---', 'a')).toBe('p"---|a"')
    expect(blocks('', '---', 'a')).toBe('p"---|a"')
    expect(blocks('--- a b', 'x')).toBe('p"--- a b|x"')
  })

  it('C2-B-112: the closer is exactly three hyphens plus trailing spaces', () => {
    expect(blocks('---', ' ---', '----', '--- x', '---  ', 'y')).toBe('fm" ---|----|--- x" p"y"')
    expect(blocks('---', '- a', '', '> b', '---')).toBe('fm"- a||> b"')
  })

  it('C2-B-113: unclosed frontmatter runs to the end of the document and is marked', () => {
    expect(blocks('---', 'a', '', 'b')).toBe('fm!"a||b"')
  })
})

// Cases found by scripts/mutate.ts: each fails under a mutation that the tests above let pass.
describe('boundaries pinned by the mutation check', () => {
  const quotes = (count: number): string => '> '.repeat(count)
  const inQuotes = (count: number, inner: string): string => 'quote['.repeat(count) + inner + ']'.repeat(count)

  it('C2-B-131: a list needs two levels and opens at the cap exactly', () => {
    expect(blocks(`${quotes(MAX_DEPTH - 2)}- a`)).toBe(inQuotes(MAX_DEPTH - 2, 'ul(-)[li[p"a"]]'))
    expect(blocks(`${quotes(MAX_DEPTH - 1)}1. a`)).toBe(inQuotes(MAX_DEPTH - 1, 'p"1. a"'))
    expect(blocks(`${quotes(MAX_DEPTH - 4)}- a`, `${quotes(MAX_DEPTH - 4)}  - b`))
      .toBe(inQuotes(MAX_DEPTH - 4, 'ul(-)[li[p"a" ul(-)[li[p"b"]]]]'))
    expect(blocks(`${quotes(MAX_DEPTH - 3)}- a`, `${quotes(MAX_DEPTH - 3)}  - b`))
      .toBe(inQuotes(MAX_DEPTH - 3, 'ul(-)[li[p"a|- b"]]'))
    expect(blocks(`${quotes(MAX_DEPTH - 4)}- > q`, `${quotes(MAX_DEPTH - 4)}  - b`))
      .toBe(inQuotes(MAX_DEPTH - 4, 'ul(-)[li[quote[p"q"] ul(-)[li[p"b"]]]]'))
    expect(blocks(`${quotes(MAX_DEPTH - 3)}- > q`, `${quotes(MAX_DEPTH - 3)}  - b`))
      .toBe(inQuotes(MAX_DEPTH - 3, 'ul(-)[li[quote[p"q|- b"]]]'))
  })

  it('C2-B-131: a div, a description list and a description open at the cap exactly', () => {
    expect(blocks(`${quotes(MAX_DEPTH - 1)}::: a`)).toBe(inQuotes(MAX_DEPTH - 1, 'div[]'))
    expect(blocks(`${quotes(MAX_DEPTH - 1)}:: t`)).toBe(inQuotes(MAX_DEPTH - 1, 'dl[dt"t"]'))
    expect(blocks(`${quotes(MAX_DEPTH)}:: t`)).toBe(inQuotes(MAX_DEPTH, 'p":: t"'))
    expect(blocks(`${quotes(MAX_DEPTH - 2)}:: t`, `${quotes(MAX_DEPTH - 2)}: d`))
      .toBe(inQuotes(MAX_DEPTH - 2, 'dl[dt"t" dd[p"d"]]'))
  })

  it('C2-B-049: a block opener stands after an ordered marker', () => {
    expect(blocks('1. > a')).toBe('ol(1.)[li[quote[p"a"]]]')
  })

  it('C2-B-017, C2-B-101: only the innermost open quote is closed and captioned by a caption line', () => {
    expect(blocks('> = h', '^ c')).toBe('quote[h1"h"] cap"c"')
    expect(blocks('> - = h', '^ c')).toBe('quote[ul(-)[li[h1"h"]]] p"^ c"')
    expect(blocks('> > = h', '^ c')).toBe('quote[quote[h1"h"]] p"^ c"')
  })

  it('C2-B-021: below description text a list marker is judged against the description list first', () => {
    expect(blocks('- a', '', '  :: t', '  : d', '  - x')).toBe('ul(-)[li[p"a" dl[dt"t" dd[p"d|- x"]]]]')
    expect(blocks('- :: t', '  : d', ' - y')).toBe('ul(-)[li[dl[dt"t" dd[p"d"]] ul(-)[li[p"y"]]]]')
  })

  it('C2-B-080: fewer than three percent signs open no comment block', () => {
    expect(blocks('% a', 'b')).toBe('p"% a|b"')
  })

  it('C2-B-097, C2-B-108: a braced comment and a lone brace pair are no attribute line and no include', () => {
    expect(blocks('{% c %}', 'x')).toBe('p"{% c %}|x"')
    expect(blocks('{{}}', 'x')).toBe('inc"{{}}" p"x"')
    expect(blocks('{{ a }}  ', 'x')).toBe('inc"{{ a }}  " p"x"')
    expect(blocks('{x}}', 'y')).toBe('p"{x}}|y"')
    expect(blocks('{{ a }', 'y')).toBe('p"{{ a }|y"')
    expect(blocks('{{ a} }', 'y')).toBe('p"{{ a} }|y"')
    expect(blocks('{{ a }x', 'y')).toBe('p"{{ a }x|y"')
  })

  it('C2-B-033: the last letter of the alphabet and the longest roman numeral', () => {
    expect(blocks('z) x')).toBe('ol(a26))[li[p"x"]]')
    expect(blocks('Z) x')).toBe('ol(A26))[li[p"x"]]')
    expect(blocks('A) x')).toBe('ol(A1))[li[p"x"]]')
    expect(blocks(`${'m'.repeat(15)}) x`)).toBe('ol(i15000))[li[p"x"]]')
    expect(blocks(`${'m'.repeat(16)}) x`)).toBe(`p"${'m'.repeat(16)}) x"`)
    expect(blocks('ai) x')).toBe('p"ai) x"')
    expect(blocks('ia) x')).toBe('p"ia) x"')
  })

  it('C2-B-039: a task box is three characters between brackets', () => {
    expect(blocks('- [xy a')).toBe('ul(-)[li[p"[xy a"]]')
    expect(blocks('- ax] b')).toBe('ul(-)[li[p"ax] b"]]')
  })

  it('C2-B-087, C2-B-088: a sigil stands alone after the run', () => {
    expect(blocks('::: |x', 'a', ':::')).toBe('div[p"a"]')
    expect(blocks('::: |x y', 'a', ':::')).toBe('div[p"a"]')
    expect(blocks('::: >x', 'a', ':::', '^ c')).toBe('div[p"a"] p"^ c"')
  })

  it('C2-B-063, C2-B-064, C2-B-065: the colon stands directly behind the label', () => {
    expect(blocks('[a]  x')).toBe('p"[a]  x"')
    expect(blocks('[^a]  x')).toBe('p"[^a]  x"')
    expect(blocks('*^a]: x')).toBe('p"*^a]: x"')
    expect(blocks('[ab]: /u')).toBe('def"[ab]: /u"')
    expect(blocks('[[a]: b')).toBe('p"[[a]: b"')
    expect(blocks('[a]: /u x"')).toBe('p"[a]: /u x""')
    expect(blocks('[a]: /u ""')).toBe('def"[a]: /u """')
  })

  it('C2-B-109: an image starts with `![` and has a target', () => {
    expect(blocks('a[b](c)')).toBe('p"a[b](c)"')
    expect(blocks('![a]')).toBe('p"![a]"')
    expect(blocks('![a]x')).toBe('p"![a]x"')
  })

  it('C2-B-102: a math block is `$$` and one closed backtick span', () => {
    expect(blocks('a$`x`', '^ c')).toBe('p"a$`x`|^ c"')
    expect(blocks('$a`x`', '^ c')).toBe('p"$a`x`|^ c"')
    expect(blocks('$$x', '^ c')).toBe('p"$$x|^ c"')
    expect(blocks('$$`x', '^ c')).toBe('p"$$`x|^ c"')
  })

  it('C2-B-111: the format word stands after one space', () => {
    expect(blocks('---yaml', 'a')).toBe('p"---yaml|a"')
    expect(blocks('--- 1', 'a')).toBe('p"--- 1|a"')
  })
})
