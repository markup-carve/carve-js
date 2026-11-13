// One test or more for every clause of the block chapter (spec/0.2/syntax-blocks.md) that the
// first slice implements. Each test names its clause id. Shape notation: see support/shape.ts.
import { describe, expect, it } from 'vitest'
import { MAX_DEPTH } from '../src/index.ts'
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
    expect(blocks('a', '```')).toBe('p"a" code""')
    expect(blocks('- a', '- b')).toBe('ul(-)[li[p"a"] li[p"b"]]')
  })

  it('C2-B-013: a code fence line interrupts a paragraph and is then tested for ownership', () => {
    expect(blocks('a', '~~~', 'x', '~~~')).toBe('p"a" code"x"')
    expect(blocks('- a', '  ```', '  x')).toBe('ul(-)[li[p"a" code"x"]]')
    expect(blocks('- a', '```', 'x')).toBe('ul(-)[li[p"a"]] code"x"')
    expect(blocks('> a', '```')).toBe('quote[p"a"] code""')
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
    expect(blocks('- ```', '    x', '  y', ' z')).toBe('ul(-)[li[code"  x|y|z"]]')
  })

  it('C2-B-026: the first line of a nested block sets its base column', () => {
    expect(blocks('- a', '', '      ```', '      x', '    y')).toBe('ul(-)[li[p"a" code"x|y"]]')
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
    expect(blocks('> ```', '> a', '', '> b')).toBe('quote[code"a"] quote[p"b"]')
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
    expect(blocks(') a')).toBe('ol())[li[p"a"]]')
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
    expect(blocks('- a', '- ```', '  x', '', '- c')).toBe('ul(-,loose)[li[p"a"] li[code"x"] li[p"c"]]')
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
    expect(blocks('```', 'x')).toBe('code"x"')
    expect(blocks('- ```', '  x', 'y')).toBe('ul(-)[li[code"x"]] p"y"')
    expect(blocks('> ```', '> x', 'y')).toBe('quote[code"x"] p"y"')
    expect(blocks('- ```', '  x', '', '', 'y')).toBe('ul(-)[li[code"x"]] p"y"')
    expect(blocks('- ```', '  x', '', '  y')).toBe('ul(-)[li[code"x||y"]]')
  })

  it('C2-B-084: the body of a code fence is not read for blocks', () => {
    expect(blocks('```', '- a', '> b', '= c', '', '***', '```')).toBe('code"- a|> b|= c||***"')
  })

  it('C2-B-086: a backtick run whose info string holds a backtick is not an opener', () => {
    expect(blocks('```a`b', 'x')).toBe('p"```a`b|x"')
    expect(blocks('~~~a`b', 'x')).toBe('code"x"')
    expect(blocks('```js', 'x', '```')).toBe('code"x"')
  })

  it('C2-B-130: a fence opens whether or not a closer follows', () => {
    expect(blocks('a', '', '```', '= b')).toBe('p"a" code"= b"')
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
    expect(blocks('- %% c')).toBe('ul(-)[li[p"%% c"]]')
    expect(blocks('> %% c')).toBe('quote[p"%% c"]')
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
    expect(blocks('---')).toBe('p"---"')
    expect(blocks('* * *')).toBe('ul(*)[li[ul(*)[li[p"*"]]]]')
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
