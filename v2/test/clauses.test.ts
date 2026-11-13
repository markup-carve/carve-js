// One test or more for every clause of the block chapter (spec/0.2/syntax-blocks.md) that the
// first slice implements. Each test names its clause id. Shape notation: see support/shape.ts.
import { describe, expect, it } from 'vitest'
import { definitionLabel, MAX_DEPTH, parseBlockTree, readOpenerInfo } from '../src/index.ts'
import { captionNumberMark } from '../src/lines.ts'
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
  it('C2-B-011: a line that opens no other block opens a paragraph', () => {
    expect(blocks('a')).toBe('p"a"')
    expect(blocks(':d')).toBe('p":d"')
  })

  it('C2-B-012, C2-B-024: a lazy line at any indent and with any prefix', () => {
    expect(blocks('- a', '        b', 'c')).toBe('ul(-)[li[p"a|b|c"]]')
    expect(blocks('> a', 'b', '> c')).toBe('quote[p"a|b|c"]')
    expect(blocks('- > a', '> b')).toBe('ul(-)[li[quote[p"a|> b"]]]')
    expect(blocks('a', '= b', '> c', '%% d')).toBe('p"a|= b|> c|%% d"')
  })

  it('C2-B-013: a paragraph closes at a blank line, at an interrupter or with its container', () => {
    expect(blocks('a', '', 'b')).toBe('p"a" p"b"')
    expect(blocks('a', '```')).toBe('p"a" code!""')
    expect(blocks('- a', '- b')).toBe('ul(-)[li[p"a"] li[p"b"]]')
  })

  it('C2-B-014: a code fence line interrupts a paragraph and is then tested for ownership', () => {
    expect(blocks('a', '~~~', 'x', '~~~')).toBe('p"a" code"x"')
    expect(blocks('- a', '  ```', '  x')).toBe('ul(-)[li[p"a" code!"x"]]')
    expect(blocks('- a', '```', 'x')).toBe('ul(-)[li[p"a"]] code!"x"')
    expect(blocks('> a', '```')).toBe('quote[p"a"] code!""')
  })

  it('C2-B-015: a list marker interrupts at an open list\'s column or past the item\'s marker', () => {
    expect(blocks('- a', '- b')).toBe('ul(-)[li[p"a"] li[p"b"]]')
    expect(blocks('- a', ' - b')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]]]]')
    expect(blocks('- a', '  1. b')).toBe('ul(-)[li[p"a" ol(1.)[li[p"b"]]]]')
    expect(blocks('- a', '  - b', '- c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]]] li[p"c"]]')
  })

  it('C2-B-015, C2-B-030: a list marker where no list is open, or left of the list, is a lazy line', () => {
    expect(blocks('a', '- b')).toBe('p"a|- b"')
    expect(blocks('> a', '> - b')).toBe('quote[p"a|- b"]')
    expect(blocks('  - a', '- b')).toBe('ul(-)[li[p"a|- b"]]')
  })

  it('C2-B-020: a marker without the mark of the quote its list sits in is a lazy line', () => {
    expect(blocks('> - a', '- b')).toBe('quote[ul(-)[li[p"a|- b"]]]')
    expect(blocks('> - a', '  - b')).toBe('quote[ul(-)[li[p"a|- b"]]]')
    expect(blocks('> - a', '> - b')).toBe('quote[ul(-)[li[p"a"] li[p"b"]]]')
  })

  it('C2-B-021: a marker without the mark of a quote inside an item closes that quote', () => {
    expect(blocks('- > q', '- b')).toBe('ul(-)[li[quote[p"q"]] li[p"b"]]')
    expect(blocks('- > q', '  - b')).toBe('ul(-)[li[quote[p"q"] ul(-)[li[p"b"]]]]')
  })
})

describe('container ownership and stripping', () => {
  it('C2-B-025: a line belongs to the innermost item whose marker it is indented past', () => {
    expect(blocks('- a', '  - b', '', '   c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b" p"c"]]]]')
    expect(blocks('- a', '  - b', '', '  c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] p"c"]]')
    expect(blocks('- a', '  - b', '', ' c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] p"c"]]')
    expect(blocks('10. a', '', ' b')).toBe('ol(10.)[li[p"a" p"b"]]')
  })

  it('C2-B-026: a container that does not own the line closes with everything inside it', () => {
    expect(blocks('- a', '  - > b', '', 'c')).toBe('ul(-)[li[p"a" ul(-)[li[quote[p"b"]]]]] p"c"')
  })

  it('C2-B-027: the content of an item is stripped by at most its content column', () => {
    expect(blocks('- ```', '    x', '  y', ' z')).toBe('ul(-)[li[code!"  x|y|z"]]')
  })

  it('C2-B-028: the first line of a nested block sets its base column', () => {
    expect(blocks('- a', '', '      ```', '      x', '    y')).toBe('ul(-)[li[p"a" code!"x|y"]]')
  })

  it('C2-B-029: fence content is stripped by at most the opener\'s indent', () => {
    expect(blocks('  ```', '  a', '    b', ' c', '  ```')).toBe('code"a|  b|c"')
    expect(blocks('> ```', '>   a', '> ```')).toBe('quote[code"  a"]')
  })
})

describe('block quotes', () => {
  it('C2-B-031: the quote mark is `>` and a space or the end of the line', () => {
    expect(blocks('> a')).toBe('quote[p"a"]')
    expect(blocks('>')).toBe('quote[]')
    expect(blocks('>a')).toBe('p">a"')
    expect(blocks('> > a')).toBe('quote[quote[p"a"]]')
    expect(blocks('>> a')).toBe('p">> a"')
  })

  it('C2-B-032: a blank line without the mark ends the quote', () => {
    expect(blocks('> a', '', '> b')).toBe('quote[p"a"] quote[p"b"]')
    expect(blocks('> a', '>', '> b')).toBe('quote[p"a" p"b"]')
    expect(blocks('> = a', 'b')).toBe('quote[h1"a"] p"b"')
    expect(blocks('- > a', '', '  > b')).toBe('ul(-)[li[quote[p"a"] quote[p"b"]]]')
    expect(blocks('> ```', '> a', '', '> b')).toBe('quote[code!"a"] quote[p"b"]')
  })
})

describe('lists', () => {
  it('C2-B-033: a marker needs one space and a further character', () => {
    expect(blocks('-')).toBe('p"-"')
    expect(blocks('- ')).toBe('p"- "')
    expect(blocks('-a')).toBe('p"-a"')
    expect(blocks('1.')).toBe('p"1."')
    expect(blocks('-   a')).toBe('ul(-)[li[p"a"]]')
  })

  it('C2-B-034: a bullet marker is `-` or `*`', () => {
    expect(blocks('- a')).toBe('ul(-)[li[p"a"]]')
    expect(blocks('* a')).toBe('ul(*)[li[p"a"]]')
  })

  it('C2-B-035: the other bullet character starts another list', () => {
    expect(blocks('- a', '* b', '* c')).toBe('ul(-)[li[p"a"]] ul(*)[li[p"b"] li[p"c"]]')
  })

  it('C2-B-036: an ordered marker is one to nine digits or nothing, then `.` or `)`', () => {
    expect(blocks('123456789. a')).toBe('ol(123456789.)[li[p"a"]]')
    expect(blocks('1234567890. a')).toBe('p"1234567890. a"')
    expect(blocks('7) a')).toBe('ol(7))[li[p"a"]]')
    expect(blocks('. a')).toBe('ol(.)[li[p"a"]]')
    expect(blocks(') a')).toBe('p") a"')
    expect(blocks('1: a')).toBe('p"1: a"')
  })

  it('C2-B-037: the delimiter is part of the kind of an ordered list', () => {
    expect(blocks('1. a', '2) b', '3) c')).toBe('ol(1.)[li[p"a"]] ol(2))[li[p"b"] li[p"c"]]')
  })

  it('C2-B-041, C2-B-043: the list starts at its first marker and the bare dot numbers automatically', () => {
    expect(blocks('3. a', '9. b')).toBe('ol(3.)[li[p"a"] li[p"b"]]')
    expect(blocks('0. a')).toBe('ol(0.)[li[p"a"]]')
    expect(blocks('. a', '. b')).toBe('ol(.)[li[p"a"] li[p"b"]]')
    expect(blocks('1. a', '. b')).toBe('ol(1.)[li[p"a"] li[p"b"]]')
  })

  it('C2-B-046, C2-B-048: a task box stands directly after a bullet\'s space, and `X` is read as `x`', () => {
    expect(blocks('- [ ] a')).toBe('ul(-,task)[li( )[p"a"]]')
    expect(blocks('* [X] a')).toBe('ul(*,task)[li(x)[p"a"]]')
    for (const state of ['x', '_', '/', '!', '-', '>', '?']) {
      expect(blocks(`- [${state}] a`)).toBe(`ul(-,task)[li(${state})[p"a"]]`)
    }
  })

  it('C2-B-047: in every other case the brackets are content', () => {
    expect(blocks('- [ ]')).toBe('ul(-)[li[p"[ ]"]]')
    expect(blocks('- [x]a')).toBe('ul(-)[li[p"[x]a"]]')
    expect(blocks('- [y] a')).toBe('ul(-)[li[p"[y] a"]]')
    expect(blocks('-  [x] a')).toBe('ul(-)[li[p"[x] a"]]')
    expect(blocks('1. [x] a')).toBe('ol(1.)[li[p"[x] a"]]')
  })

  it('C2-B-049: a matching marker at the list\'s column is a sibling', () => {
    expect(blocks('- [ ] a', '- [x] b')).toBe('ul(-,task)[li( )[p"a"] li(x)[p"b"]]')
    expect(blocks('2) a', '5) b')).toBe('ol(2))[li[p"a"] li[p"b"]]')
  })

  it('C2-B-050: a marker that does not match closes the list and opens a new one', () => {
    expect(blocks('- a', '1. b')).toBe('ul(-)[li[p"a"]] ol(1.)[li[p"b"]]')
    expect(blocks('- [ ] a', '- b')).toBe('ul(-,task)[li( )[p"a"]] ul(-)[li[p"b"]]')
    expect(blocks('- a', '  - b', '  * c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] ul(*)[li[p"c"]]]]')
  })

  it('C2-B-051: one or two blank lines do not end a list', () => {
    expect(blocks('- a', '', '- b')).toBe('ul(-,loose)[li[p"a"] li[p"b"]]')
    expect(blocks('1. a', '', '', '2. b')).toBe('ol(1.,loose)[li[p"a"] li[p"b"]]')
  })

  it('C2-B-052: three blank lines before a marker at the list\'s column end the list', () => {
    expect(blocks('- a', '', '', '', '- b')).toBe('ul(-)[li[p"a"]] ul(-)[li[p"b"]]')
    expect(blocks('- a', '  - b', '', '', '', '  - c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] ul(-)[li[p"c"]]]]')
    expect(blocks('> - a', '>', '>', '>', '> - b')).toBe('quote[ul(-)[li[p"a"]] ul(-)[li[p"b"]]]')
  })

  it('C2-B-053: two lists of one kind with fewer than three blank lines between them are one list', () => {
    expect(blocks('  - = a', '- b')).toBe('ul(-)[li[h1"a"] li[p"b"]]')
    expect(blocks('  - a', '', '', '', '- b')).toBe('ul(-)[li[p"a"]] ul(-)[li[p"b"]]')
    expect(blocks('- a', '', 'x', '', '- b')).toBe('ul(-)[li[p"a"]] p"x" ul(-)[li[p"b"]]')
  })

  it('C2-B-054: after a blank line a marker left of every open list continues the list', () => {
    expect(blocks('  - a', '', '- b', '- c')).toBe('ul(-,loose)[li[p"a"] li[p"b"] li[p"c"]]')
    expect(blocks('  - a', '    - b', '', '- c')).toBe('ul(-,loose)[li[p"a" ul(-)[li[p"b"]]] li[p"c"]]')
    expect(blocks('  - a', '', '1. b')).toBe('ul(-)[li[p"a"]] ol(1.)[li[p"b"]]')
  })

  it('C2-B-055: a marker between the columns of two open lists joins the deeper list', () => {
    expect(blocks('- a', '    - b', '  - c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"] li[p"c"]]]]')
    expect(blocks('- a', '    - b', '', '  - c')).toBe('ul(-)[li[p"a" ul(-,loose)[li[p"b"] li[p"c"]]]]')
    expect(blocks('- a', '    - b', '  1. c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"]] ol(1.)[li[p"c"]]]]')
  })

  it('C2-B-056, C2-B-060: a marker indented past an item\'s marker opens a nested list, at any number', () => {
    expect(blocks('- a', '  7. b')).toBe('ul(-)[li[p"a" ol(7.)[li[p"b"]]]]')
    expect(blocks('1. a', ' - b')).toBe('ol(1.)[li[p"a" ul(-)[li[p"b"]]]]')
  })

  it('C2-B-057: an item may start with any block on the marker line', () => {
    expect(blocks('- = a')).toBe('ul(-)[li[h1"a"]]')
    expect(blocks('- > a')).toBe('ul(-)[li[quote[p"a"]]]')
    expect(blocks('- ***')).toBe('ul(-)[li[hr]]')
    expect(blocks('1. ~~~', '   x', '   ~~~')).toBe('ol(1.)[li[code"x"]]')
    expect(blocks('> = a')).toBe('quote[h1"a"]')
  })

  it('C2-B-058, C2-B-061: a marker line that holds another marker with content has a nested list', () => {
    expect(blocks('- 1. a')).toBe('ul(-)[li[ol(1.)[li[p"a"]]]]')
    expect(blocks('- -')).toBe('ul(-)[li[p"-"]]')
    expect(blocks('- - a', '  - b', '- c')).toBe('ul(-)[li[ul(-)[li[p"a"] li[p"b"]]] li[p"c"]]')
    expect(blocks('- [ ] - a')).toBe('ul(-,task)[li( )[ul(-)[li[p"a"]]]]')
  })

  it('C2-B-059: a line that starts with `+` is text', () => {
    expect(blocks('+ a', '+ b')).toBe('p"+ a|+ b"')
  })

  it('C2-B-062, C2-B-065: a list is loose only when a blank line stands between two of its items', () => {
    expect(blocks('- a', '', '  b', '- c')).toBe('ul(-)[li[p"a" p"b"] li[p"c"]]')
    expect(blocks('- a', '  - b', '', '- c')).toBe('ul(-,loose)[li[p"a" ul(-)[li[p"b"]]] li[p"c"]]')
    expect(blocks('- a', '', '  - b', '  - c')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"] li[p"c"]]]]')
    expect(blocks('- a', '')).toBe('ul(-)[li[p"a"]]')
    expect(blocks('- a', '- ```', '  x', '', '- c')).toBe('ul(-,loose)[li[p"a"] li[code!"x"] li[p"c"]]')
  })

  it('C2-B-191: tightness is set when the list closes', () => {
    expect(blocks('- one', '- two', '', '- three')).toBe('ul(-,loose)[li[p"one"] li[p"two"] li[p"three"]]')
  })
})

describe('code fences', () => {
  it('C2-B-108: a run of three or more backticks or tildes opens a code fence', () => {
    expect(blocks('```', 'x', '```')).toBe('code"x"')
    expect(blocks('~~~~', 'x', '~~~~')).toBe('code"x"')
    expect(blocks('``', 'x', '``')).toBe('p"``|x|``"')
  })

  it('C2-B-109: the closer has the opener\'s character and at least its length, at any column', () => {
    expect(blocks('```', 'x', '~~~', '`````', 'y')).toBe('code"x|~~~" p"y"')
    expect(blocks('````', '```', '````')).toBe('code"```"')
    expect(blocks('```', 'x', '      ```', 'y')).toBe('code"x" p"y"')
    expect(blocks('- ```', '  x', ' ```', '  y')).toBe('ul(-)[li[code"x" p"y"]]')
  })

  it('C2-B-110: a run followed by other text is content', () => {
    expect(blocks('```', '``` a', '```')).toBe('code"``` a"')
    expect(blocks('~~~', '~~~ a', '~~~  ')).toBe('code"~~~ a"')
  })

  it('C2-B-111, C2-B-113: an unclosed fence ends with its container, without the blank lines at its end', () => {
    expect(blocks('```', 'x')).toBe('code!"x"')
    expect(blocks('- ```', '  x', 'y')).toBe('ul(-)[li[code!"x"]] p"y"')
    expect(blocks('> ```', '> x', 'y')).toBe('quote[code!"x"] p"y"')
    expect(blocks('- ```', '  x', '', '', 'y')).toBe('ul(-)[li[code!"x"]] p"y"')
    expect(blocks('- ```', '  x', '', '  y')).toBe('ul(-)[li[code!"x||y"]]')
  })

  it('C2-B-112: the body of a code fence is not read for blocks', () => {
    expect(blocks('```', '- a', '> b', '= c', '', '***', '```')).toBe('code"- a|> b|= c||***"')
  })

  it('C2-B-118: a backtick run whose info string holds a backtick is not an opener', () => {
    expect(blocks('```a`b', 'x')).toBe('p"```a`b|x"')
    expect(blocks('~~~a`b', 'x')).toBe('code!"x"')
    expect(blocks('```js', 'x', '```')).toBe('code"x"')
  })

  it('C2-B-189: a fence opens whether or not a closer follows', () => {
    expect(blocks('a', '', '```', '= b')).toBe('p"a" code!"= b"')
  })
})

describe('comments', () => {
  it('C2-B-143: the line form is never an interrupter and stays in its leaf', () => {
    expect(blocks('a', '%% c', 'b')).toBe('p"a|%% c|b"')
    expect(blocks('- a', '%% c', '- b')).toBe('ul(-)[li[p"a|%% c"] li[p"b"]]')
  })

  it('C2-B-135: in the body of a code fence `%%` is code', () => {
    expect(blocks('```', '%% c', '```')).toBe('code"%% c"')
  })

  it('C2-B-136: after a marker a comment counts as content', () => {
    expect(blocks('- %% c')).toBe('ul(-)[li[%"%% c"]]')
    expect(blocks('> %% c')).toBe('quote[%"%% c"]')
    expect(blocks('= %% c')).toBe('h1"%% c"')
  })

  it('C2-B-137: a comment-only line is skipped by ownership and by the count of blank lines', () => {
    expect(blocks('- a', '', '%% c', '  b')).toBe('ul(-)[li[p"a" %"%% c" p"b"]]')
    expect(blocks('- a', '', '', '%% c', '', '- b')).toBe('ul(-)[li[p"a" %"%% c"]] ul(-)[li[p"b"]]')
    expect(blocks('- a', '', '%% c', '- b')).toBe('ul(-,loose)[li[p"a" %"%% c"] li[p"b"]]')
    expect(blocks('- > = a', '%% c', '  > b')).toBe('ul(-)[li[quote[h1"a" %"%% c" p"b"]]]')
  })

  it('C2-B-138: the comment is a child of the innermost open container, whatever its indent', () => {
    expect(blocks('%% c')).toBe('%"%% c"')
    expect(blocks('- - = a', '%% c')).toBe('ul(-)[li[ul(-)[li[h1"a" %"%% c"]]]]')
    expect(blocks('= a', '        %% c')).toBe('h1"a|%% c"')
  })

  it('C2-B-139: a line that holds only a braced comment is a paragraph', () => {
    expect(blocks('- = a', '{% c %}')).toBe('ul(-)[li[h1"a"]] p"{% c %}"')
  })
})

describe('headings', () => {
  it('C2-B-151: one to six `=`, one space and a further character', () => {
    expect(blocks('= a')).toBe('h1"a"')
    expect(blocks('====== a')).toBe('h6"a"')
    expect(blocks('======= a')).toBe('p"======= a"')
    expect(blocks('=')).toBe('p"="')
    expect(blocks('== ')).toBe('p"== "')
    expect(blocks('==a')).toBe('p"==a"')
  })

  it('C2-B-152: `#` is accepted in place of `=`', () => {
    expect(blocks('## a')).toBe('h2"a"')
    expect(blocks('#= a')).toBe('p"#= a"')
  })

  it('C2-B-153: everything after the space is heading text', () => {
    expect(blocks('== a ==')).toBe('h2"a =="')
    expect(blocks('= a {.c}')).toBe('h1"a {.c}"')
  })

  it('C2-B-154: a heading takes the lines indented past its marker', () => {
    expect(blocks('== a', '   b', 'c')).toBe('h2"a|b" p"c"')
    expect(blocks('##### a', ' b', '  c')).toBe('h5"a|b|c"')
    expect(blocks('= a', ' = b')).toBe('h1"a|= b"')
    expect(blocks('= a', ' b', '', ' c')).toBe('h1"a|b" p"c"')
    expect(blocks('= a', ' ***', ' b')).toBe('h1"a" hr p"b"')
    expect(blocks('= a', ' | x |')).toBe('h1"a" table[tr[td"x"]]')
    expect(blocks('- = a', '   b', '  c')).toBe('ul(-)[li[h1"a|b" p"c"]]')
    expect(blocks('> = a', '>  b', '> c', ' d')).toBe('quote[h1"a|b" p"c|d"]')
    expect(blocks('| a \\|')).toBe('p"| a \\|"')
    expect(blocks('= a', 'b', '= c', '= d')).toBe('h1"a" p"b|= c|= d"')
    expect(blocks('= a', '= b')).toBe('h1"a" h1"b"')
  })
})

describe('thematic break', () => {
  it('C2-B-159: three or more stars and nothing else, at any indent', () => {
    expect(blocks('***')).toBe('hr')
    // C2-B-200: a thematic break interrupts a paragraph, like a fence line.
    expect(blocks('a', '***', 'b')).toBe('p"a" hr p"b"')
    expect(blocks('a', '*** b')).toBe('p"a|*** b"')
    expect(blocks('a', '**')).toBe('p"a|**"')
    expect(blocks('- a', '***', 'b')).toBe('ul(-)[li[p"a"]] hr p"b"')
    expect(blocks('- a', '  ***')).toBe('ul(-)[li[p"a" hr]]')
    expect(blocks('> a', '***')).toBe('quote[p"a"] hr')
    expect(blocks('     ******  ')).toBe('hr')
    expect(blocks('**')).toBe('p"**"')
    expect(blocks('*** a')).toBe('p"*** a"')
    expect(blocks('a', '', '---')).toBe('p"a" p"---"')
    expect(blocks('* * *')).toBe('ul(*)[li[ul(*)[li[p"*"]]]]')
  })
})

describe('readings the chapter leaves open', () => {
  it('C2-B-025: an item that joined its list at another column owns lines from its own column on', () => {
    expect(blocks('- a', '    - b', '  - c', '    - d')).toBe('ul(-)[li[p"a" ul(-)[li[p"b"] li[p"c" ul(-)[li[p"d"]]]]]]')
  })

  it('C2-B-054: with nested lists open, a marker left of them is judged against the outermost list', () => {
    expect(blocks('  - a', '    1. b', '', '1. c')).toBe('ul(-)[li[p"a" ol(1.)[li[p"b"]]]] ol(1.)[li[p"c"]]')
  })

  it('C2-B-135: a comment line the container of an open fence does not own ends that container', () => {
    expect(blocks('- ```', '  x', '%% c', '  y')).toBe('ul(-)[li[code!"x"]] %"%% c" p"y"')
    expect(blocks('- ```', '  x', '  %% c', '  y')).toBe('ul(-)[li[code!"x|%% c|y"]]')
    expect(blocks('> ```', '> x', '%% c', '> y')).toBe('quote[code!"x"] %"%% c" quote[p"y"]')
  })

  it('C2-B-138: with no leaf open in a quote, a comment line is a comment node', () => {
    expect(blocks('> = a', '> %% c')).toBe('quote[h1"a" %"%% c"]')
  })

  it('C2-B-010: a lone carriage return is not a line ending', () => {
    expect(blocks('a\rb')).toBe('p"a\rb"')
  })
})

describe('the fallback rule', () => {
  it('C2-B-190: past depth 200 an opener is text', () => {
    const marks = '> '.repeat(MAX_DEPTH)
    expect(blocks(`${marks}a`)).toBe(`${'quote['.repeat(MAX_DEPTH)}p"a"${']'.repeat(MAX_DEPTH)}`)
    expect(blocks(`${marks}> a`)).toBe(`${'quote['.repeat(MAX_DEPTH)}p"> a"${']'.repeat(MAX_DEPTH)}`)
    const quotes = '> '.repeat(MAX_DEPTH - 1)
    expect(blocks(`${quotes}- a`)).toBe(`${'quote['.repeat(MAX_DEPTH - 1)}p"- a"${']'.repeat(MAX_DEPTH - 1)}`)
  })
})

describe('ordered lists with letters and roman numerals', () => {
  it('C2-B-036: a marker is one letter or a roman numeral, and a bare delimiter is the dot only', () => {
    expect(blocks('a) x')).toBe('ol(a1))[li[p"x"]]')
    expect(blocks('XIV) x')).toBe('ol(I14))[li[p"x"]]')
    expect(blocks('ab) x')).toBe('p"ab) x"')
    expect(blocks('iV) x')).toBe('p"iV) x"')
    expect(blocks('a1) x')).toBe('p"a1) x"')
  })

  it('C2-B-042: the first marker alone fixes the style', () => {
    expect(blocks('i) x')).toBe('ol(i1))[li[p"x"]]')
    expect(blocks('I) x')).toBe('ol(I1))[li[p"x"]]')
    expect(blocks('c) x')).toBe('ol(a3))[li[p"x"]]')
    expect(blocks('v) x', 'vi) y')).toBe('ol(a22))[li[p"x"]] ol(i6))[li[p"y"]]')
    expect(blocks('ii) x')).toBe('ol(i2))[li[p"x"]]')
    expect(blocks('a) x', 'B) y')).toBe('ol(a1))[li[p"x"]] ol(A2))[li[p"y"]]')
  })

  it('C2-B-038: in a roman list a single roman letter is a sibling', () => {
    expect(blocks('iv) x', 'v) y', 'vi) z')).toBe('ol(i4))[li[p"x"] li[p"y"] li[p"z"]]')
    expect(blocks('i) x', 'b) y')).toBe('ol(i1))[li[p"x"]] ol(a2))[li[p"y"]]')
  })

  it('C2-B-039: in an alphabetic list every single letter is a sibling', () => {
    expect(blocks('h) x', 'i) y', 'j) z')).toBe('ol(a8))[li[p"x"] li[p"y"] li[p"z"]]')
    expect(blocks('h) x', 'ii) y')).toBe('ol(a8))[li[p"x"]] ol(i2))[li[p"y"]]')
  })

  it('C2-B-040: a letter or roman marker with a dot needs two spaces', () => {
    expect(blocks('a.  x')).toBe('ol(a1.)[li[p"x"]]')
    expect(blocks('a. x')).toBe('ol(a1.)[li[p"x"]]')
    expect(blocks('A. Smith')).toBe('p"A. Smith"')
    expect(blocks('I. Claudius')).toBe('p"I. Claudius"')
    expect(blocks('A.  x')).toBe('ol(A1.)[li[p"x"]]')
    expect(blocks('IV. x')).toBe('ol(I4.)[li[p"x"]]')
    expect(blocks('iv.  x')).toBe('ol(i4.)[li[p"x"]]')
    expect(blocks('iv. x')).toBe('ol(i4.)[li[p"x"]]')
    expect(blocks('a) x')).toBe('ol(a1))[li[p"x"]]')
    expect(blocks('1. x')).toBe('ol(1.)[li[p"x"]]')
  })

  it('C2-B-042: the bare dot is of the decimal style', () => {
    expect(blocks('a.  x', '. y')).toBe('ol(a1.)[li[p"x"]] ol(.)[li[p"y"]]')
  })
})

describe('description lists', () => {
  it('C2-B-067, C2-B-080: term lines and description lines at the list\'s column form a description list', () => {
    expect(blocks(':: t', ': d')).toBe('dl[dt"t" dd[p"d"]]')
    expect(blocks('  :: t', '  : d', '  :: u')).toBe('dl[dt"t" dd[p"d"] dt"u"]')
    expect(blocks(':: t', ': d', '', '', ': e')).toBe('dl[dt"t" dd[p"d"] dd[p"e"]]')
    expect(blocks(':: t', ': d', '', '', '', ': e')).toBe('dl[dt"t" dd[p"d"]] p": e"')
    expect(blocks('::t')).toBe('p"::t"')
    expect(blocks('::')).toBe('p"::"')
  })

  it('C2-B-068, C2-B-074: terms alone are an entry, and a description line with no term above it is text', () => {
    expect(blocks(':: t', ':: u')).toBe('dl[dt"t" dt"u"]')
    expect(blocks(': d')).toBe('p": d"')
    expect(blocks('- : d')).toBe('ul(-)[li[p": d"]]')
  })

  it('C2-B-069, C2-B-075: a term is one leaf with lazy lines and takes no block opener', () => {
    expect(blocks(':: t', '      more', '= not a heading')).toBe('dl[dt"t|more|= not a heading"]')
    expect(blocks(':: > t')).toBe('dl[dt"> t"]')
    expect(blocks(':: t', '  : indented')).toBe('dl[dt"t|: indented"]')
  })

  it('C2-B-070: a fence line below term text closes the description list, whatever its indent', () => {
    expect(blocks(':: t', '    ```', '    x')).toBe('dl[dt"t"] code!"x"')
    expect(blocks(':: t', ':::', 'x')).toBe('dl[dt"t"] div[p"x"]')
  })

  it('C2-B-071: after a blank line only a mark at the list\'s column continues a list that ends in a term', () => {
    expect(blocks(':: t', '', '  x')).toBe('dl[dt"t"] p"x"')
    expect(blocks(':: t', '', ': d')).toBe('dl[dt"t" dd[p"d"]]')
    expect(blocks(':: t', '', ' : d')).toBe('dl[dt"t"] p": d"')
  })

  it('C2-B-072, C2-B-076, C2-B-079: a description may start with any block and owns lines indented past its mark', () => {
    expect(blocks(':: t', ': = h', '', '  p', '', ' - x')).toBe('dl[dt"t" dd[h1"h" p"p" ul(-)[li[p"x"]]]]')
    expect(blocks(':: t', ': :: u', '  : e')).toBe('dl[dt"t" dd[dl[dt"u" dd[p"e"]]]]')
    expect(blocks(':: t', ': d', '', 'x')).toBe('dl[dt"t" dd[p"d"]] p"x"')
  })

  it('C2-B-016: a mark at the open description list\'s column interrupts term and description text', () => {
    expect(blocks(':: t', ': d', 'lazy', ': e', ':: u')).toBe('dl[dt"t" dd[p"d|lazy"] dd[p"e"] dt"u"]')
    expect(blocks(':: t', ': d', '  : not a mark')).toBe('dl[dt"t" dd[p"d|: not a mark"]]')
    expect(blocks('a', ':: t')).toBe('p"a|:: t"')
  })

  it('C2-B-020: a mark without the mark of the quote the description list sits in is a lazy line', () => {
    expect(blocks('> :: t', ': d')).toBe('quote[dl[dt"t|: d"]]')
    expect(blocks('> :: t', '> : d')).toBe('quote[dl[dt"t" dd[p"d"]]]')
  })

  it('C2-B-022: a list marker at the column of a description list is a lazy line', () => {
    expect(blocks(':: t', '- x')).toBe('dl[dt"t|- x"]')
    expect(blocks(':: t', ': d', '- x')).toBe('dl[dt"t" dd[p"d|- x"]]')
    expect(blocks(':: t', ': d', ' - x')).toBe('dl[dt"t" dd[p"d" ul(-)[li[p"x"]]]]')
    expect(blocks('- a', '', '  :: t', '  : d', '- b')).toBe('ul(-)[li[p"a" dl[dt"t" dd[p"d"]]] li[p"b"]]')
  })

  it('C2-B-023: a term mark directly after paragraph text inside an item is a lazy line', () => {
    expect(blocks('- a', '  :: t')).toBe('ul(-)[li[p"a|:: t"]]')
    expect(blocks('- a', '', '  :: t')).toBe('ul(-)[li[p"a" dl[dt"t"]]]')
  })
})

describe('definitions', () => {
  it('C2-B-081: a definition stands at column 0 outside every container', () => {
    expect(blocks('[a]: /u')).toBe('def"[a]: /u"')
    expect(blocks(' [a]: /u')).toBe('p"[a]: /u"')
    expect(blocks('> [a]: /u')).toBe('quote[p"[a]: /u"]')
    expect(blocks('- [^a]: x')).toBe('ul(-)[li[p"[^a]: x"]]')
    expect(blocks('::: x', '*[a]: b')).toBe('div[p"*[a]: b"]')
  })

  it('C2-B-082, C2-B-087: a footnote definition holds its content and the blocks indented past its marker', () => {
    expect(blocks('[^a]: x', '', ' y', '', 'z')).toBe('fn[p"x" p"y"] p"z"')
    expect(blocks('[^a]: > q', '  - i')).toBe('fn[quote[p"q"] ul(-)[li[p"i"]]]')
    expect(blocks('[^a]:')).toBe('p"[^a]:"')
    expect(blocks('[^]: x')).toBe('p"[^]: x"')
    expect(blocks('[^a b]: x')).toBe('fn[p"x"]')
  })

  it('C2-B-083, C2-B-089: a link definition is one line with a URL without spaces and an optional quoted title', () => {
    expect(blocks('[a b]: /u "t"', 'x')).toBe('def"[a b]: /u "t"" p"x"')
    expect(blocks('[a]: ')).toBe('p"[a]: "')
    expect(blocks('[a]:')).toBe('p"[a]:"')
    expect(blocks('[a]: "t"')).toBe('def"[a]: "t""')
    expect(blocks('[a]: /u more')).toBe('p"[a]: /u more"')
    expect(blocks('[a]:/u')).toBe('p"[a]:/u"')
    expect(blocks('[a]:   /u')).toBe('def"[a]:   /u"')
    expect(blocks(':::   note', 'x', ':::')).toBe(blocks('::: note', 'x', ':::'))
  })

  it('C2-B-084: an abbreviation definition has a label of ASCII letters and digits and an expansion', () => {
    expect(blocks('*[a]: b c')).toBe('abbr"*[a]: b c"')
    expect(blocks('*[a b]: c')).toBe('p"*[a b]: c"')
    expect(blocks('*[a-b]: c')).toBe('p"*[a-b]: c"')
    expect(blocks('*[A1]: c')).toBe('abbr"*[A1]: c"')
    expect(blocks('*[a]:')).toBe('p"*[a]:"')
  })

  it('C2-B-016: a definition line at column 0 is a sibling of an open definition, and else a lazy line', () => {
    expect(blocks('[^a]: x', '[^b]: y', '[c]: /u', '*[d]: e')).toBe('fn[p"x"] fn[p"y"] def"[c]: /u" abbr"*[d]: e"')
    expect(blocks('a', '[c]: /u')).toBe('p"a|[c]: /u"')
    expect(blocks('[^a]: x', 'lazy')).toBe('fn[p"x|lazy"]')
  })

  it('C2-B-015: a list marker indented past a footnote marker opens a list in the body', () => {
    expect(blocks('[^a]: x', ' - i', '- j')).toBe('fn[p"x" ul(-)[li[p"i|- j"]]]')
  })
})

describe('attribute lines', () => {
  it('C2-B-090, C2-B-093, C2-B-193: one or more glued brace blocks, alone on the line', () => {
    expect(blocks('{.a}', 'x')).toBe('{.a}p"x"')
    expect(blocks('  {.a}{#b}  ', 'x')).toBe('{.a}{#b}p"x"')
    expect(blocks('{.a} {.b}', 'x')).toBe('p"{.a} {.b}|x"')
    expect(blocks('{.a} y', 'x')).toBe('p"{.a} y|x"')
    expect(blocks('{k="}"}', 'x')).toBe('{k="}"}p"x"')
    expect(blocks('{}', 'x')).toBe('p"{}|x"')
  })

  it('C2-B-091: the block that starts on the next line in the same container takes the line', () => {
    expect(blocks('{.a}', '- x', '- y')).toBe('{.a}ul(-)[li[p"x"] li[p"y"]]')
    expect(blocks('{.a}', '      = h')).toBe('{.a}h1"h"')
    expect(blocks('> {.a}', '> x')).toBe('quote[{.a}p"x"]')
    expect(blocks('- x', '', '  {.a}', '  - y')).toBe('ul(-)[li[p"x" {.a}ul(-)[li[p"y"]]]]')
  })

  it('C2-B-002, C2-B-092: an attribute line waits for the next line and is a paragraph when no block takes it', () => {
    expect(blocks('{.a}')).toBe('p"{.a}"')
    expect(blocks('{.a}', '', 'x')).toBe('p"{.a}" p"x"')
    expect(blocks('> {.a}', 'x')).toBe('quote[p"{.a}"] p"x"')
    expect(blocks('- x', '', '  {.a}', '- y')).toBe('ul(-)[li[p"x" p"{.a}"] li[p"y"]]')
    expect(blocks('::: x', '{.a}', ':::')).toBe('div[p"{.a}"]')
  })

  it('C2-B-102, C2-B-192: consecutive attribute lines merge, also into one paragraph when no block takes them', () => {
    expect(blocks('{.a}', '{.b}', 'x')).toBe('{.a|.b}p"x"')
    expect(blocks('{.a}', '', '{.b}', '{.c}', 'x')).toBe('p"{.a}" {.b|.c}p"x"')
    expect(blocks('{.a}', '{.b}')).toBe('p"{.a}|{.b}"')
    expect(blocks('{.a}', '{.b}', '', 'x')).toBe('p"{.a}|{.b}" p"x"')
    expect(blocks('- x', '', '  {.a}', '  {.b}', 'y')).toBe('ul(-)[li[p"x" p"{.a}|{.b}"]] p"y"')
  })

  it('C2-B-095: every block takes an attribute line, a definition and a comment block included', () => {
    expect(blocks('{.a}', '[b]: /u')).toBe('{.a}def"[b]: /u"')
    expect(blocks('{.a}', '[^b]: x')).toBe('{.a}fn[p"x"]')
    expect(blocks('{.a}', '%%%', 'x', '%%%')).toBe('{.a}%%%"x"')
    expect(blocks('{.a}', '> x')).toBe('{.a}quote[p"x"]')
    expect(blocks('{.a}', '```', 'x', '```')).toBe('{.a}code"x"')
    expect(blocks('{.a}', ':: t')).toBe('{.a}dl[dt"t"]')
    expect(blocks('{.a}', '***')).toBe('{.a}hr')
  })

  it('C2-B-096: a caption takes no attribute line', () => {
    expect(blocks('```', 'x', '```', '{.a}', '^ c')).toBe('code"x" p"{.a}" p"^ c"')
    expect(blocks('{.a}', '^ c')).toBe('p"{.a}" p"^ c"')
  })

  it('C2-B-097: an attribute line its container does not own closes it, and the lists around it are not adjacent', () => {
    expect(blocks('- a', '', '{.x}', '- b')).toBe('ul(-)[li[p"a"]] {.x}ul(-)[li[p"b"]]')
  })

  it('C2-B-137: a comment-only line is skipped by a pending attribute line', () => {
    expect(blocks('{.a}', '%% c', 'x')).toBe('%"%% c" {.a}p"x"')
  })

  it('C2-B-100, C2-B-101, C2-B-194: the attributes of an item abut the marker and close on its line', () => {
    expect(blocks('-{.i} b')).toBe('ul(-)[li{}[p"b"]]')
    expect(blocks('1.{.i}{#j} b')).toBe('ol(1.)[li{}[p"b"]]')
    expect(blocks('-{.i}b')).toBe('p"-{.i}b"')
    expect(blocks('-{.i', '} b')).toBe('p"-{.i|} b"')
    expect(blocks('- {.i} b')).toBe('ul(-)[li[p"{.i} b"]]')
    expect(blocks('::{.c} t', ': d')).toBe('p"::{.c} t|: d"')
    expect(blocks(':: t', ':{.c} d')).toBe('dl[dt"t|:{.c} d"]')
  })
})

describe('divs, sigil divs and comment blocks', () => {
  it('C2-B-108: a colon run opens or closes a div and a percent run opens a comment block', () => {
    expect(blocks('::: note', 'x', ':::')).toBe('div[p"x"]')
    expect(blocks('%%%', 'x', '%%%', 'y')).toBe('%%%"x" p"y"')
    expect(blocks('a', ':::', 'b')).toBe('p"a" div[p"b"]')
    expect(blocks('a', '%%%', 'b')).toBe('p"a" %%%!"b"')
  })

  it('C2-B-109: the closer of a div stands on a line owned by the same container', () => {
    expect(blocks('::: a', '- x', '  :::', '  y', ':::')).toBe('div[ul(-)[li[p"x" div[p"y"]]]]')
    expect(blocks('> ::: a', '> x', '> :::', '> y')).toBe('quote[div[p"x"] p"y"]')
    expect(blocks('::: a', 'x', '      :::', 'y')).toBe('div[p"x"] p"y"')
  })

  it('C2-B-109: the closer of a comment block is a bare run of at least the opener\'s length', () => {
    expect(blocks('%%%', '%%% x', '%%%%', 'y')).toBe('%%%"%%% x" p"y"')
  })

  it('C2-B-111: an unclosed div or comment block ends with its container', () => {
    expect(blocks('- ::: a', '  x', '', 'y')).toBe('ul(-)[li[div[p"x"]]] p"y"')
    expect(blocks('> %%%', '> x', 'y')).toBe('quote[%%%!"x"] p"y"')
    expect(blocks('::: a', 'x')).toBe('div[p"x"]')
  })

  it('C2-B-112, C2-B-115: the body of a comment block is not read and the body of a div is read as blocks', () => {
    expect(blocks('%%%', '- a', '```', '%%%')).toBe('%%%"- a|```"')
    expect(blocks('::: a', '- a', '', '= h', ':::')).toBe('div[ul(-)[li[p"a"]] h1"h"]')
  })

  it('C2-B-123: the body of a line block is one leaf that knows only prefixes and the closer', () => {
    expect(blocks('::: |', '- a', '  = b', '', '%% c', ':::', 'x')).toBe('lines"- a|  = b||%% c" p"x"')
    expect(blocks('> ::: |', '>  a', '> :::')).toBe('quote[lines" a"]')
    expect(blocks(':::: |', ':::', '::::')).toBe('lines":::"')
    expect(blocks('- ::: |', '  a', 'b')).toBe('ul(-)[li[lines!"a"]] p"b"')
  })

  it('C2-B-124: a hard-break block and a quote fence are containers', () => {
    expect(blocks('::: \\', '- a', ':::')).toBe('div(\\)[ul(-)[li[p"a"]]]')
    expect(blocks('::: >', '= h', ':::')).toBe('div(>)[h1"h"]')
    expect(blocks(':::  >', 'x', ':::')).toBe('div(>)[p"x"]')
  })

  it('C2-B-196: a sigil glued to the colon run makes the line text', () => {
    expect(blocks(':::>', 'x')).toBe('p":::>|x"')
    expect(blocks(':::|', 'x')).toBe('p":::||x"')
    expect(blocks('a', ':::\\ b')).toBe('p"a|:::\\ b"')
    expect(blocks(':::>x', 'y')).toBe('p":::>x|y"')
  })

  it('C2-B-119: a div name stands after a space behind the colon run', () => {
    expect(blocks(':::e', 'x')).toBe('p":::e|x"')
    expect(blocks(':::warning', 'x', ':::')).toBe('p":::warning|x" div[]')
    expect(blocks('::: warning', 'x', ':::')).toBe('div[p"x"]')
    expect(blocks(':::  ', 'x', ':::')).toBe('div[p"x"]')
    expect(blocks('- m', '   :::e', '   :::', 'l')).toBe('ul(-)[li[p"m|:::e" div[]]] p"l"')
  })

  it('C2-B-125: a bare colon run closes the innermost div it is long enough for, or opens an anonymous div', () => {
    expect(blocks('::::', ':::', 'x', ':::', '::::', 'y')).toBe('div[div[p"x"]] p"y"')
    expect(blocks('::: a', ':::: b', 'x', ':::', 'y')).toBe('div[div[p"x"]] p"y"')
    expect(blocks('::: a', ':::: b', 'x', '::::', 'y')).toBe('div[div[p"x"] p"y"]')
    expect(blocks(':::', 'x')).toBe('div[p"x"]')
  })

  it('C2-B-126: a colon run followed by a name or a sigil always opens a div', () => {
    expect(blocks('::: a', '::: b', 'x', ':::', ':::', 'y')).toBe('div[div[p"x"]] p"y"')
    expect(blocks('::: a', ':::::::: |', 'x')).toBe('div[lines!"x"]')
  })

  it('C2-B-142: a comment block at column 0 between two list items ends the first list', () => {
    expect(blocks('- a', '%%%', 'x', '%%%', '- b')).toBe('ul(-)[li[p"a"]] %%%"x" ul(-)[li[p"b"]]')
    expect(blocks('- a', '  %%%', '  x', '  %%%', '- b')).toBe('ul(-)[li[p"a" %%%"x"] li[p"b"]]')
  })

  it('C2-B-114, C2-B-144: in a line block and in a comment block a `%%` line is body text', () => {
    expect(blocks('- ::: |', '  a', '  %% c', '  b', '  :::')).toBe('ul(-)[li[lines"a|%% c|b"]]')
    expect(blocks('- %%%', '  a', '  %% c', '  %%%')).toBe('ul(-)[li[%%%"a|%% c"]]')
    expect(blocks('- ::: |', '  a', '%% c')).toBe('ul(-)[li[lines!"a"]] %"%% c"')
  })

  it('C2-B-190: a div counts toward the depth cap', () => {
    const marks = '> '.repeat(MAX_DEPTH)
    expect(blocks(`${marks}::: a`)).toBe(`${'quote['.repeat(MAX_DEPTH)}p"::: a"${']'.repeat(MAX_DEPTH)}`)
  })
})

describe('the fence opener and titles', () => {
  it('C2-B-117, C2-B-119: an opener holds an optional word and an optional quoted title', () => {
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

  it('C2-B-121: a label in brackets stands after the title', () => {
    const src = '```php "t" [Composer]'
    const info = readOpenerInfo(src, 3)
    expect([src.slice(info.labelStart, info.labelEnd), info.extra]).toEqual(['Composer', false])
    expect(readOpenerInfo('::: note [x] y', 3).extra).toBe(true)
  })

  it('C2-B-082, C2-B-083, C2-B-084: the label of a definition is recorded by its offsets', () => {
    const label = (src: string): string => src.slice(...definitionLabel(src, 0))
    expect(label('[^note]: x')).toBe('note')
    expect(label('[a b]: /u')).toBe('a b')
    expect(label('*[HTML]: x')).toBe('HTML')
  })
})

describe('captions', () => {
  it('C2-B-146: a caption line stands directly below its block and is owned by the same container', () => {
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

  it('C2-B-147: a code block, a quote, a quote fence, a figure group, an image and a math block take a caption', () => {
    expect(blocks('> q', '^ c')).toBe('quote[p"q"] cap"c"')
    expect(blocks('::: >', 'q', ':::', '^ c')).toBe('div(>)[p"q"] cap"c"')
    expect(blocks('::: figure', 'x', ':::', '^ c')).toBe('div(figure)[p"x"] cap"c"')
    // C2-B-127: with a title or a label the opener is a plain div, which takes no caption.
    expect(blocks('::: figure "T"', 'x', ':::', '^ c')).toBe('div[p"x"] p"^ c"')
    // C2-B-159: trailing spaces do not stop a thematic break. C2-B-087: a footnote marker line starts with any block.
    expect(blocks('*** ', 'next')).toBe('hr p"next"')
    // C2-B-082: a footnote label may hold spaces. C2-B-090: a brace run that is no valid attribute block is text.
    expect(blocks('[^my note]: Text.')).toBe('fn[p"Text."]')
    expect(blocks('{*a %% *}', 'para')).toBe('p"{*a %% *}|para"')
    expect(blocks('{.a key="v" #i}{:en}', 'para')).toBe('{.a key="v" #i}{:en}p"para"')
    // C2-B-164: the format name is glued or stands after one space.
    expect(blocks('---markdown', 'a = 1', '---', 'x')).toBe(blocks('---toml', 'a = 1', '---', 'x'))
    expect(blocks('--- toml', 'a = 1', '---', 'x')).toBe('p"--- toml|a = 1|---|x"')
    expect(blocks('---  toml', 'a')).toBe('p"---  toml|a"')
    expect(blocks('---Foo', 'a')).toBe('p"---Foo|a"')
    expect(blocks('---x-2', 'a', '---')).toBe('fm"a"')
    expect(blocks('--- ', 'a: 1', '---')).toBe('fm"a: 1"')
    // C2-B-151: spaces and tabs alone are no content, so the marker is text.
    expect(blocks('= \t', 'following')).toBe('p"= 	|following"')
    expect(blocks('- \t')).toBe('p"- 	"')
    // C2-B-031: a quote mark alone is an empty quote. C2-B-162, C2-B-089: closers and definitions may end in spaces and tabs.
    expect(blocks('>')).toBe('quote[]')
    expect(blocks('---', 'a: 1', '---\t', 'x')).toBe('fm"a: 1" p"x"')
    expect(blocks('[x]: /u ')).toBe('def"[x]: /u "')
    expect(blocks('= H', '', '%% c')).toBe('h1"H" %"%% c"')
    // C2-B-108: text on a comment block opener is the first line of its value. C2-B-083: a footnote shape is tested first.
    expect(blocks('%%% extra', 'body', '%%%')).toBe('%%%"extra|body"')
    expect(blocks('[^n]: text')).toBe('fn[p"text"]')
    // C2-B-122: a raw fence and a sigil div take no title and no label, and still open.
    expect(blocks('```=html "T" [G]', '<b>', '```')).toBe('raw"<b>"')
    expect(blocks('::: > "T" [G]', 'q', ':::')).toBe('div(>)[p"q"]')
    expect(blocks('::: | "T"', 'l', ':::')).toBe('lines"l"')
    expect(blocks('[^n]: > q')).toBe('fn[quote[p"q"]]')
    expect(blocks('::: note', 'x', ':::', '^ c')).toBe('div[p"x"] p"^ c"')
    expect(blocks('![a](b)', '^ c')).toBe('img"![a](b)" cap"c"')
    expect(blocks('$$`x`', '^ c')).toBe('math"$$`x`" cap"c"')
    expect(blocks('%%%', 'x', '%%%', '^ c')).toBe('%%%"x" p"^ c"')
  })

  it('C2-B-148: a caption takes lazy lines and ends as a paragraph does', () => {
    expect(blocks('> q', '^ c', '^ d', 'e', '', 'f')).toBe('quote[p"q"] cap"c|^ d|e" p"f"')
    expect(blocks('```', 'x', '```', '^ c', '```', 'y')).toBe('code"x" cap"c" code!"y"')
  })

  it('C2-B-017: a caption line interrupts a paragraph only when it holds nothing but an image', () => {
    expect(blocks('![a](b)', '^ c')).toBe('img"![a](b)" cap"c"')
    expect(blocks('![a][r]{.x}', '^ c')).toBe('img"![a][r]{.x}" cap"c"')
    expect(blocks('![a](b) t', '^ c')).toBe('p"![a](b) t|^ c"')
    expect(blocks('![a](b)', '![c](d)', '^ c')).toBe('p"![a](b)|![c](d)|^ c"')
    expect(blocks('a', '^ c')).toBe('p"a|^ c"')
    expect(blocks('- ![a](b)', '  ^ c')).toBe('ul(-)[li[img"![a](b)" cap"c"]]')
    expect(blocks('- ![a](b)', '^ c')).toBe('ul(-)[li[p"![a](b)|^ c"]]')
  })

  it('C2-B-018: a caption line without the mark closes the open quote and captions it', () => {
    expect(blocks('> q', '> r', '^ c')).toBe('quote[p"q|r"] cap"c"')
    expect(blocks('> q', '> ^ c')).toBe('quote[p"q|^ c"]')
    expect(blocks('> - q', '^ c')).toBe('quote[ul(-)[li[p"q"]]] cap"c"')
    expect(blocks('> > q', '> ^ c')).toBe('quote[quote[p"q"] cap"c"]')
    expect(blocks('- > q', '^ c')).toBe('ul(-)[li[quote[p"q|^ c"]]]')
    expect(blocks('- > q', '  ^ c')).toBe('ul(-)[li[quote[p"q"] cap"c"]]')
  })

  it('C2-B-137: a comment-only line does not separate a caption from its block', () => {
    expect(blocks('```', 'x', '```', '%% n', '^ c')).toBe('code"x" %"%% n" cap"c"')
  })
})

describe('one-line constructs', () => {
  it('C2-B-156: an include directive is a block of one line and not an interrupter', () => {
    expect(blocks('{{ a.crv }}', 'x')).toBe('inc"{{ a.crv }}" p"x"')
    expect(blocks('x', '{{ a.crv }}')).toBe('p"x|{{ a.crv }}"')
    expect(blocks('{{ a.crv }} x')).toBe('p"{{ a.crv }} x"')
    expect(blocks('- {{ a.crv }}')).toBe('ul(-)[li[inc"{{ a.crv }}"]]')
  })

  it('C2-B-157, C2-B-158, C2-B-197, C2-B-198, C2-B-191: a paragraph that closes as one image line or one math line is promoted', () => {
    expect(blocks('![a](b)')).toBe('img"![a](b)"')
    expect(blocks('![a](b)', 'x')).toBe('p"![a](b)|x"')
    expect(blocks('![a](b) x')).toBe('p"![a](b) x"')
    expect(blocks('$$`x^2`')).toBe('math"$$`x^2`"')
    expect(blocks('$$`x`{.c}  ')).toBe('math"$$`x`{.c}  "')
    expect(blocks('$$`x` y')).toBe('p"$$`x` y"')
    expect(blocks('$$`x`', 'y')).toBe('p"$$`x`|y"')
    expect(blocks('![a [b]](c (d))')).toBe('img"![a [b]](c (d))"')
    expect(blocks('[a](b)')).toBe('p"[a](b)"')
  })
})

describe('frontmatter', () => {
  it('C2-B-161, C2-B-165: line 1 opens frontmatter when it is exactly three hyphens at column 0', () => {
    expect(blocks('---', 'a: b', '---', 'x')).toBe('fm"a: b" p"x"')
    expect(blocks('---toml  ', 'a', '---')).toBe('fm"a"')
    expect(blocks('---  toml', 'a', '---')).toBe('p"---  toml|a|---"')
    expect(blocks('﻿---', 'a', '---')).toBe('fm"a"')
    expect(blocks('----', 'a')).toBe('p"----|a"')
    expect(blocks(' ---', 'a')).toBe('p"---|a"')
    expect(blocks('', '---', 'a')).toBe('p"---|a"')
    expect(blocks('--- a b', 'x')).toBe('p"--- a b|x"')
  })

  it('C2-B-162: the closer is exactly three hyphens plus trailing spaces', () => {
    expect(blocks('---', ' ---', '----', '--- x', '---  ', 'y')).toBe('fm" ---|----|--- x" p"y"')
    expect(blocks('---', '- a', '', '> b', '---')).toBe('fm"- a||> b"')
  })

  it('C2-B-163: unclosed frontmatter runs to the end of the document and is marked', () => {
    expect(blocks('---', 'a', '', 'b')).toBe('fm!"a||b"')
  })
})

// Cases found by scripts/mutate.ts: each fails under a mutation that the tests above let pass.
describe('boundaries pinned by the mutation check', () => {
  const quotes = (count: number): string => '> '.repeat(count)
  const inQuotes = (count: number, inner: string): string => 'quote['.repeat(count) + inner + ']'.repeat(count)

  it('C2-B-190: a list needs two levels and opens at the cap exactly', () => {
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

  it('C2-B-190: a div, a description list and a description open at the cap exactly', () => {
    expect(blocks(`${quotes(MAX_DEPTH - 1)}::: a`)).toBe(inQuotes(MAX_DEPTH - 1, 'div[]'))
    expect(blocks(`${quotes(MAX_DEPTH - 1)}:: t`)).toBe(inQuotes(MAX_DEPTH - 1, 'dl[dt"t"]'))
    expect(blocks(`${quotes(MAX_DEPTH)}:: t`)).toBe(inQuotes(MAX_DEPTH, 'p":: t"'))
    expect(blocks(`${quotes(MAX_DEPTH - 2)}:: t`, `${quotes(MAX_DEPTH - 2)}: d`))
      .toBe(inQuotes(MAX_DEPTH - 2, 'dl[dt"t" dd[p"d"]]'))
  })

  it('C2-B-057: a block opener stands after an ordered marker', () => {
    expect(blocks('1. > a')).toBe('ol(1.)[li[quote[p"a"]]]')
  })

  it('C2-B-018: the quote whose mark is missing is closed and captioned, whatever its last block is', () => {
    expect(blocks('> = h', '^ c')).toBe('quote[h1"h"] cap"c"')
    expect(blocks('> - = h', '^ c')).toBe('quote[ul(-)[li[h1"h"]]] cap"c"')
    expect(blocks('> > = h', '^ c')).toBe('quote[quote[h1"h"]] cap"c"')
  })

  it('C2-B-022: below description text a list marker is judged against the description list first', () => {
    expect(blocks('- a', '', '  :: t', '  : d', '  - x')).toBe('ul(-)[li[p"a" dl[dt"t" dd[p"d|- x"]]]]')
    expect(blocks('- :: t', '  : d', ' - y')).toBe('ul(-)[li[dl[dt"t" dd[p"d"]] ul(-)[li[p"y"]]]]')
  })

  it('C2-B-108: fewer than three percent signs open no comment block', () => {
    expect(blocks('% a', 'b')).toBe('p"% a|b"')
  })

  it('C2-B-139, C2-B-156: a braced comment and a lone brace pair are no attribute line and no include', () => {
    expect(blocks('{% c %}', 'x')).toBe('p"{% c %}|x"')
    expect(blocks('{{}}', 'x')).toBe('inc"{{}}" p"x"')
    expect(blocks('{{ a }}  ', 'x')).toBe('inc"{{ a }}  " p"x"')
    expect(blocks('{x}}', 'y')).toBe('p"{x}}|y"')
    expect(blocks('{{ a }', 'y')).toBe('p"{{ a }|y"')
    expect(blocks('{{ a} }', 'y')).toBe('p"{{ a} }|y"')
    expect(blocks('{{ a }x', 'y')).toBe('p"{{ a }x|y"')
  })

  it('C2-B-036: the last letter of the alphabet and a roman numeral of nine letters', () => {
    expect(blocks('z) x')).toBe('ol(a26))[li[p"x"]]')
    expect(blocks('Z) x')).toBe('ol(A26))[li[p"x"]]')
    expect(blocks('A) x')).toBe('ol(A1))[li[p"x"]]')
    expect(blocks('dccclxxxv) x')).toBe('ol(i885))[li[p"x"]]')
    expect(blocks('mdccclxxxv) x')).toBe('p"mdccclxxxv) x"')
    // C2-B-036: two or more letters are a marker only as a standard roman numeral.
    expect(blocks('vx. a')).toBe('p"vx. a"')
    expect(blocks('civil. war')).toBe('p"civil. war"')
    expect(blocks('iiii. a')).toBe('p"iiii. a"')
    expect(blocks('xiv. a')).toBe('ol(i14.)[li[p"a"]]')
    expect(blocks('MCMXC. a')).toBe('ol(I1990.)[li[p"a"]]')
    expect(blocks('---\t', 'a: 1', '---')).toBe('fm"a: 1"')
    expect(blocks('ai) x')).toBe('p"ai) x"')
    expect(blocks('ia) x')).toBe('p"ia) x"')
  })

  it('C2-B-046: a task box is three characters between brackets', () => {
    expect(blocks('- [xy a')).toBe('ul(-)[li[p"[xy a"]]')
    expect(blocks('- ax] b')).toBe('ul(-)[li[p"ax] b"]]')
  })

  it('C2-B-123, C2-B-124: a sigil stands alone, one space or more after the run', () => {
    expect(blocks('::: |x', 'a', ':::')).toBe('div[p"a"]')
    expect(blocks('::: |x y', 'a', ':::')).toBe('div[p"a"]')
    expect(blocks('::: >x', 'a', ':::', '^ c')).toBe('div[p"a"] p"^ c"')
  })

  it('C2-B-082, C2-B-083, C2-B-084: the colon stands directly behind the label', () => {
    expect(blocks('[a]  x')).toBe('p"[a]  x"')
    expect(blocks('[^a]  x')).toBe('p"[^a]  x"')
    expect(blocks('*^a]: x')).toBe('p"*^a]: x"')
    expect(blocks('[ab]: /u')).toBe('def"[ab]: /u"')
    expect(blocks('[[a]: b')).toBe('p"[[a]: b"')
    expect(blocks('[a]: /u x"')).toBe('p"[a]: /u x""')
    expect(blocks('[a]: /u ""')).toBe('def"[a]: /u """')
    expect(blocks(' [^a]: x')).toBe('p"[^a]: x"')
    expect(blocks('*[]: x')).toBe('p"*[]: x"')
    expect(blocks('*[a]x y')).toBe('p"*[a]x y"')
    expect(blocks('*[a-: x')).toBe('p"*[a-: x"')
  })

  it('C2-B-157: an image starts with `![` and has a target', () => {
    expect(blocks('a[b](c)')).toBe('p"a[b](c)"')
    expect(blocks('![a]')).toBe('p"![a]"')
    expect(blocks('![a]x')).toBe('p"![a]x"')
  })

  it('C2-B-158: a math block is `$$` and one closed backtick span', () => {
    expect(blocks('a$`x`', '^ c')).toBe('p"a$`x`|^ c"')
    expect(blocks('$a`x`', '^ c')).toBe('p"$a`x`|^ c"')
    expect(blocks('$$x', '^ c')).toBe('p"$$x|^ c"')
    expect(blocks('$$`x', '^ c')).toBe('p"$$`x|^ c"')
  })

  it('C2-B-164: the format name is `yaml`, `toml` or `json`, glued to the hyphens', () => {
    expect(blocks('---yaml', 'a', '---')).toBe('fm"a"')
    expect(blocks('---json', 'a', '---')).toBe('fm"a"')
    expect(blocks('---yml', 'a', '---')).toBe('fm"a"')
    expect(blocks('---Yml', 'a', '---')).toBe('p"---Yml|a|---"')
    expect(blocks('---y ml', 'a', '---')).toBe('p"---y ml|a|---"')
    expect(blocks('--- 1', 'a')).toBe('p"--- 1|a"')
  })
})

describe('tables', () => {
  it('C2-B-166: a row starts and ends with a pipe, and a pipe alone is text', () => {
    expect(blocks('| a |')).toBe('table[tr[td"a"]]')
    expect(blocks('  | a | b |  ')).toBe('table[tr[td"a" td"b"]]')
    expect(blocks('||')).toBe('table[tr[td""]]')
    expect(blocks('| a ||')).toBe('table[tr[td"a" td""]]')
    expect(blocks('|')).toBe('p"|"')
    expect(blocks('| a')).toBe('p"| a"')
    expect(blocks('a | b |')).toBe('p"a | b |"')
    expect(blocks('- | a |', '  | b |')).toBe('ul(-)[li[table[tr[td"a"] tr[td"b"]]]]')
    expect(blocks('> | a |', '> | b |', '| c |')).toBe('quote[table[tr[td"a"] tr[td"b"]]] table[tr[td"c"]]')
  })

  it('C2-B-019: a table row interrupts a paragraph', () => {
    expect(blocks('text', '| a |')).toBe('p"text" table[tr[td"a"]]')
    expect(blocks('- text', '| a |')).toBe('ul(-)[li[p"text"]] table[tr[td"a"]]')
    expect(blocks('- text', '  | a |')).toBe('ul(-)[li[p"text" table[tr[td"a"]]]]')
    expect(blocks('text', '| a')).toBe('p"text|| a"')
  })

  it('C2-B-070, C2-B-078: a row below term text closes the description list, and below description text it follows its indent', () => {
    expect(blocks(':: t', '  | a |')).toBe('dl[dt"t"] table[tr[td"a"]]')
    expect(blocks(':: t', ': d', '| a |')).toBe('dl[dt"t" dd[p"d"]] table[tr[td"a"]]')
    expect(blocks(':: t', ': d', '  | a |')).toBe('dl[dt"t" dd[p"d" table[tr[td"a"]]]]')
  })

  it('C2-B-167: a row attribute and a line comment may follow the closing pipe', () => {
    expect(blocks('| a |{.r}')).toBe('table[tr{}[td"a"]]')
    expect(blocks('| a | {.r}')).toBe('table[tr{}[td"a"]]')
    expect(blocks('| a |  {.r}')).toBe('p"| a |  {.r}"')
    expect(blocks('| a | %% note')).toBe('table[tr[td"a"]]')
    expect(blocks('| a | {.r}{#i}  %% note | x')).toBe('p"| a | {.r}{#i}  %% note | x"')
    expect(blocks('| a | {.r} x')).toBe('p"| a | {.r} x"')
    const row = parseBlockTree('| a | {.r}').children![0]!.children![0]!
    expect(row.aux).toBe(6)
  })

  it('C2-B-168, C2-B-170: a table ends at the first line that is neither a row nor a continuation row', () => {
    expect(blocks('| a |', '| b', '| c |')).toBe('table[tr[td"a"]] p"| b" table[tr[td"c"]]')
    expect(blocks('| a |', '', '| b |')).toBe('table[tr[td"a"]] table[tr[td"b"]]')
    expect(blocks('| a |', 'x')).toBe('table[tr[td"a"]] p"x"')
    expect(blocks('| a |', '{% c %}', '| b |')).toBe('table[tr[td"a"]] p"{% c %}" table[tr[td"b"]]')
    expect(blocks('- | a |', '| b |')).toBe('ul(-)[li[table[tr[td"a"]]]] table[tr[td"b"]]')
  })

  it('C2-B-169: an escaped pipe and a pipe in a closed backtick span do not split cells', () => {
    expect(blocks('| a \\| b | c |')).toBe('table[tr[td"a \\| b" td"c"]]')
    expect(blocks('| `a | b` | c |')).toBe('table[tr[td"`a | b`" td"c"]]')
    expect(blocks('| ``a ` | b`` | c |')).toBe('table[tr[td"``a ` | b``" td"c"]]')
    expect(blocks('| `a | b | c |')).toBe('table[tr[td"`a" td"b" td"c"]]')
  })

  it('C2-B-171, C2-B-182: the cell prefix is the header mark, a glued brace block and one space', () => {
    expect(blocks('|= A | b |')).toBe('table[tr[th"A" td"b"]]')
    expect(blocks('|={>} A |{~ .x} b |{.x} c |{<}d|')).toBe('table[tr[th(>){}"A" td(~){}"b" td{}"c" td(<){}"d"]]')
    expect(blocks('| = a |')).toBe('table[tr[td"= a"]]')
    expect(blocks('| {.x} a |')).toBe('table[tr[td"{.x} a"]]')
  })

  it('C2-B-172, C2-B-183: a cell that holds only a span mark joins the cell to its left or above', () => {
    expect(blocks('| a | < | < |')).toBe('table[tr[td(c3)"a"]]')
    expect(blocks('| a | b |', '| ^ | c |', '| ^ | d |')).toBe('table[tr[td(r3)"a" td"b"] tr[td"c"] tr[td"d"]]')
    expect(blocks('| a | ^ |', '| b | c |')).toBe('table[tr[td"a" td""] tr[td"b" td"c"]]')
    expect(blocks('| << | a |')).toBe('table[tr[td"<<" td"a"]]')
    expect(blocks('|= < | a |')).toBe('table[tr[th"<" td"a"]]')
  })

  it('C2-B-173: a failed span is an empty cell', () => {
    expect(blocks('| < | a |')).toBe('table[tr[td"" td"a"]]')
    expect(blocks('| ^ | a |')).toBe('table[tr[td"" td"a"]]')
    expect(blocks('| a |', '| b | ^ |')).toBe('table[tr[td"a"] tr[td"b" td""]]')
    expect(blocks('| a | < |', '| b | ^ |')).toBe('table[tr[td(c2)"a"] tr[td"b" td""]]')
  })

  it('C2-B-174: a row span does not cross the head boundary', () => {
    expect(blocks('|= H |', '| ^ |', '| a |')).toBe('table(h1)[tr[th"H"] tr[td""] tr[td"a"]]')
    expect(blocks('|= H |', '|= ^ |')).toBe('table(h2)[tr[th"H"] tr[th"^"]]')
    expect(blocks('|= H |', '| a |', '| ^ |')).toBe('table(h1)[tr[th"H"] tr[td(r2)"a"] tr[]]')
  })

  it('C2-B-175, C2-B-184, C2-B-185: a continuation row joins its fragments to the cells above', () => {
    expect(blocks('| 1 | 2 |', '+ a | b |')).toBe('table[tr[td"1|a" td"2|b"]]')
    expect(blocks('| 1 | 2 |', '+ | b |', '+ c | |')).toBe('table[tr[td"1|c" td"2|b"]]')
    expect(blocks('| 1 | 2 |', '+ < |= x |{.r}')).toBe('table[tr[td"1" td"2"]] p"+ < |= x |{.r}"')
    expect(blocks('| 1 |', '+ = a |')).toBe('table[tr[td"1|= a"]]')
    expect(blocks('| 1 |', '+a |')).toBe('table[tr[td"1|a"]]')
    expect(blocks('| 1 |', '+|')).toBe('table[tr[td"1"]]')
    expect(blocks('| 1 | 2 |', '+ a |b |')).toBe('table[tr[td"1|a" td"2|b"]]')
  })

  it('C2-B-184: a fragment joins the cell that covers its column after the span marks are resolved', () => {
    expect(blocks('| a | b |', '| < | c |', '+ x | y |')).toBe('table[tr[td"a" td"b"] tr[td"x" td"c|y"]]')
    expect(blocks('| a | < |', '+ x | y |')).toBe('table[tr[td(c2)"a|x|y"]]')
    expect(blocks('| a | b |', '| ^ | c |', '+ x | y |')).toBe('table[tr[td(r2)"a|x" td"b"] tr[td"c|y"]]')
    expect(blocks('| a | < |', '+ x | y | z |')).toBe('table[tr[td(c2)"a|x|y" td"z"]]')
    expect(blocks('+ a |')).toBe('p"+ a |"')
    expect(blocks('| 1 |', '', '+ a |')).toBe('table[tr[td"1"]] p"+ a |"')
  })

  it('C2-B-176: a fragment past the last column forms a new cell', () => {
    expect(blocks('| 1 |', '+ a | b |', '| 2 |')).toBe('table[tr[td"1|a" td"b"] tr[td"2"]]')
  })

  it('C2-B-177: without the closing pipe a `+` line is text and ends the table', () => {
    expect(blocks('| 1 |', '+ a', '| 2 |')).toBe('table[tr[td"1"]] p"+ a" table[tr[td"2"]]')
  })

  it('C2-B-178: the head is the leading rows made only of header cells', () => {
    expect(blocks('|= A |= B |', '|= C |= D |', '| 1 | 2 |')).toBe('table(h2)[tr[th"A" th"B"] tr[th"C" th"D"] tr[td"1" td"2"]]')
    expect(blocks('|= A | b |', '| 1 | 2 |')).toBe('table[tr[th"A" td"b"] tr[td"1" td"2"]]')
    expect(blocks('| 1 |', '|= A |')).toBe('table[tr[td"1"] tr[th"A"]]')
    expect(blocks('|= A | < |', '| 1 | 2 |')).toBe('table(h1)[tr[th(c2)"A"] tr[td"1" td"2"]]')
    expect(blocks('|= A |', '| ^ |')).toBe('table(h1)[tr[th"A"] tr[td""]]')
  })

  it('C2-B-187, C2-B-191: the footer rows are set when the table closes', () => {
    expect(blocks('{footer-rows=1}', '| a |', '| b |')).toBe('{footer-rows=1}table(f1)[tr[td"a"] tr[td"b"]]')
    expect(blocks('{.x footer-rows=2}', '|= H |', '| a |')).toBe('{.x footer-rows=2}table(h1,f1)[tr[th"H"] tr[td"a"]]')
    expect(blocks('{xfooter-rows=1}', '| a |')).toBe('{xfooter-rows=1}table[tr[td"a"]]')
    expect(blocks('{footer-rows=1}', '', '| a |')).toBe('p"{footer-rows=1}" table[tr[td"a"]]')
  })

  it('C2-B-137: a comment-only line does not end a table, whatever its indent', () => {
    expect(blocks('| a |', '%% c', '| b |')).toBe('table[tr[td"a"] %"%% c" tr[td"b"]]')
    expect(blocks('- | a |', '%% c', '  | b |')).toBe('ul(-)[li[table[tr[td"a"] %"%% c" tr[td"b"]]]]')
  })

  it('C2-B-147: a table takes a caption', () => {
    expect(blocks('| a |', '^ c', '^ d')).toBe('table[tr[td"a"]] cap"c|^ d"')
    expect(blocks('{#f}', '| a |', '^ c')).toBe('{#f}table[tr[td"a"]] cap"c"')
    expect(blocks('| a |', '', '^ c')).toBe('table[tr[td"a"]] p"^ c"')
  })

  it('C2-B-180, C2-B-179: a csv or tsv fence under the table attribute is a delimited table', () => {
    expect(blocks('{table}', '```csv', 'a,b', '1,2', '```')).toBe('{table}csv(h1)[a,b / 1,2]')
    expect(blocks('{.x table header-rows=2}', '~~~tsv', 'a\tb', '```')).toBe('{.x table header-rows=2}csv(h2)[a,b / ```]')
    expect(blocks('{table}', '```csv', '"a ""b"", c",d', '```')).toBe('{table}csv(h1)[a "b", c,d]')
    expect(blocks('{table}', '```csv', 'a,b', '1,', '```')).toBe('{table}csv(h1)[a,b / 1,]')
    expect(blocks('{table}', '```csv', 'a,', '```')).toBe('{table}csv(h1)[a,]')
    expect(blocks('{table}', '```js', 'a,b', '```')).toBe('{table}code"a,b"')
    expect(blocks('{tables}', '```csv', 'a,b', '```')).toBe('{tables}code"a,b"')
    expect(blocks('```csv', 'a,b', '```')).toBe('code"a,b"')
  })

  it('C2-B-181: an unclosed quote in a delimited table runs to the end of the fence body', () => {
    expect(blocks('{table}', '```csv', 'a,b', '1,"2', '3,4', '```')).toBe('{table}csv(h1)![a,b / 1,2|3,4]')
  })
})

describe('raw blocks and the caption number', () => {
  it('C2-B-116: a code fence whose info string is `=` and a format name is a raw block', () => {
    expect(blocks('```=html', '<b>', '```')).toBe('raw"<b>"')
    expect(blocks('```=Xml', '<b>', '```')).toBe('raw"<b>"')
    expect(blocks('```=x', '<b>', '```')).toBe('raw"<b>"')
    expect(blocks('```= html', '<b>', '```')).toBe('code"<b>"')
    expect(blocks('```html', '<b>', '```')).toBe('code"<b>"')
    expect(blocks('```=html', '%% c', '```')).toBe('raw"%% c"')
  })

  it('C2-B-150: the first bare `#` in a caption is the caption number mark', () => {
    const mark = (text: string): number => captionNumberMark(text, 0, text.length)
    expect(mark('Table #: one')).toBe(6)
    expect(mark('Table \\#, then #')).toBe(15)
    expect(mark('`#` and ``a ` #`` #')).toBe(18)
    expect(mark('none')).toBe(-1)
  })
})
