// The examples of the block chapter (spec/0.2/syntax-blocks.md) that use only the constructs
// of the first slice, checked at the block level. The chapter gives the expected HTML; the
// shapes below were derived from that HTML by hand. The HTML itself is compared once the
// renderer exists. Shape notation: see support/shape.ts.
import { describe, expect, it } from 'vitest'
import { checkDocument } from './support/checks.ts'
import { shape } from './support/shape.ts'

// [example number, input lines, block shape]
const EXAMPLES: readonly (readonly [number, readonly string[], string])[] = [
  [1, ['- a', '', '\tb'], 'ul(-)[li[p"a" p"b"]]'],
  [2, ['-\ta'], 'p"-\ta"'],
  [3, ['- > a', '  > b'], 'ul(-)[li[quote[p"a|b"]]]'],
  [4, ['- a', '', '', '', '  b'], 'ul(-)[li[p"a" p"b"]]'],
  [5, ['Some text', '= not a heading', '- not a list'], 'p"Some text|= not a heading|- not a list"'],
  [6, ['Some text', '# not a heading', '> not a quote', '***', '{.x}'], 'p"Some text|# not a heading|> not a quote|***|{.x}"'],
  [7, ['- a', '  b', ' c', 'd'], 'ul(-)[li[p"a|b|c|d"]]'],
  [8, ['text', '```', 'code', '```'], 'p"text" code"code"'],
  [10, ['> - a', '- b'], 'quote[ul(-)[li[p"a|- b"]]]'],
  [11, ['- > q', '  - child'], 'ul(-)[li[quote[p"q"] ul(-)[li[p"child"]]]]'],
  [12, ['- > q', '- b'], 'ul(-)[li[quote[p"q"]] li[p"b"]]'],
  [13, ['- a', '', '  b', '', 'c'], 'ul(-)[li[p"a" p"b"]] p"c"'],
  [14, ['- a', '', ' b'], 'ul(-)[li[p"a" p"b"]]'],
  [15, [' 9. a', '10. b'], 'ol(9.)[li[p"a|10. b"]]'],
  [16, ['  ```', '  a', '    b', ' c', '  ```'], 'code"a|  b|c"'],
  [17, ['> a', 'b'], 'quote[p"a|b"]'],
  [18, ['> a', '>', '> b'], 'quote[p"a" p"b"]'],
  [19, ['> a', '', '> b'], 'quote[p"a"] quote[p"b"]'],
  [20, ['> > a'], 'quote[quote[p"a"]]'],
  [21, ['>a'], 'p">a"'],
  [22, ['* a', '* b'], 'ul(*)[li[p"a"] li[p"b"]]'],
  [23, ['- a', '* b'], 'ul(-)[li[p"a"]] ul(*)[li[p"b"]]'],
  [24, ['-a', '', '-', '', '1.', '', '*'], 'p"-a" p"-" p"1." p"*"'],
  [25, ['. a', '. b'], 'ol(.)[li[p"a"] li[p"b"]]'],
  [26, ['3. a', '4. b'], 'ol(3.)[li[p"a"] li[p"b"]]'],
  [29, ['i. a'], 'p"i. a"'],
  [30, ['1. a', '2) b'], 'ol(1.)[li[p"a"]] ol(2))[li[p"b"]]'],
  [31, ['1234567890. a'], 'p"1234567890. a"'],
  [32, ['- [ ] a', '- [x] b', '- [X] c', '- [_] d'], 'ul(-,task)[li( )[p"a"] li(x)[p"b"] li(x)[p"c"] li(_)[p"d"]]'],
  [33, ['- [ ]'], 'ul(-)[li[p"[ ]"]]'],
  [34, ['1. [x] a'], 'ol(1.)[li[p"[x] a"]]'],
  [35, ['- [ ] a', '- b'], 'ul(-,task)[li( )[p"a"]] ul(-)[li[p"b"]]'],
  [36, ['- a', '', '', '- b'], 'ul(-,loose)[li[p"a"] li[p"b"]]'],
  [37, ['- a', '', '', '', '- b'], 'ul(-)[li[p"a"]] ul(-)[li[p"b"]]'],
  [38, ['- a', '1. b'], 'ul(-)[li[p"a"]] ol(1.)[li[p"b"]]'],
  [39, ['- a', '    - b', '  - c'], 'ul(-)[li[p"a" ul(-)[li[p"b"] li[p"c"]]]]'],
  [40, ['  - a', '', '- b'], 'ul(-,loose)[li[p"a"] li[p"b"]]'],
  [41, ['- item text', '  - child', '  3. also a child list'], 'ul(-)[li[p"item text" ul(-)[li[p"child"]] ol(3.)[li[p"also a child list"]]]]'],
  [42, ['- > quote in the item', '', '  second block of the item'], 'ul(-)[li[quote[p"quote in the item"] p"second block of the item"]]'],
  [43, ['- - a'], 'ul(-)[li[ul(-)[li[p"a"]]]]'],
  [44, ['- a', '-', '- c'], 'ul(-)[li[p"a|-"] li[p"c"]]'],
  [45, ['- - -'], 'ul(-)[li[ul(-)[li[p"-"]]]]'],
  [46, ['+ a'], 'p"+ a"'],
  [47, ['- a', '  - b', '', '- c'], 'ul(-,loose)[li[p"a" ul(-)[li[p"b"]]] li[p"c"]]'],
  [48, ['- a', '', '  b', '- c'], 'ul(-)[li[p"a" p"b"] li[p"c"]]'],
  [49, ['- one', '- two', '', '  ```', '  code', '  ```'], 'ul(-)[li[p"one"] li[p"two" code"code"]]'],
  [50, ['- > q', '', '  p', '- ```', '  code', '  ```', '  p2'], 'ul(-)[li[quote[p"q"] p"p"] li[code"code" p"p2"]]'],
  [84, ['```', 'code', '`````'], 'code"code"'],
  [85, ['````', '```', '````'], 'code"```"'],
  [86, ['```', 'code', '``` not a closer', '```'], 'code"code|``` not a closer"'],
  [87, ['```', 'code'], 'code"code"'],
  [88, ['- ```', '  code', 'after'], 'ul(-)[li[code"code"]] p"after"'],
  [89, ['```', 'code', '  ```'], 'code"code"'],
  [92, ['```python "src/app.py"', 'code', '```'], 'code"code"'],
  [93, ['~~~', 'code', '~~~'], 'code"code"'],
  [95, ['```a`b', 'x'], 'p"```a`b|x"'],
  [103, ['- one', '  %% todo', '  two'], 'ul(-)[li[p"one|%% todo|two"]]'],
  [104, ['text %% trailing', 'more'], 'p"text %% trailing|more"'],
  [105, ['a%% b'], 'p"a%% b"'],
  [106, ['- a', '%% c', '- b'], 'ul(-)[li[p"a|%% c"] li[p"b"]]'],
  [107, ['- %% empty'], 'ul(-)[li[p"%% empty"]]'],
  [108, ['```', '%% not a comment', '```'], 'code"%% not a comment"'],
  [109, ['- a {% c', '- b %}'], 'ul(-)[li[p"a {% c"] li[p"b %}"]]'],
  [111, ['- {% c %}'], 'ul(-)[li[p"{% c %}"]]'],
  [112, ['- a', '', '  {% c %}', '- b'], 'ul(-)[li[p"a" p"{% c %}"] li[p"b"]]'],
  [126, ['= Title', 'text'], 'h1"Title" p"text"'],
  [127, ['# Title', 'text'], 'h1"Title" p"text"'],
  [128, ['==== Title =='], 'h4"Title =="'],
  [129, ['# A {.c}'], 'h1"A {.c}"'],
  [130, ['=', '', '======= seven'], 'p"=" p"======= seven"'],
  [132, ['- # In an item'], 'ul(-)[li[h1"In an item"]]'],
  [134, ['text', '{{ part.crv }}'], 'p"text|{{ part.crv }}"'],
  [136, ['![alt](a.png)', 'next line'], 'p"![alt](a.png)|next line"'],
  [137, ['a', '', '***', '', 'b'], 'p"a" hr p"b"'],
  [138, ['  *****'], 'hr'],
  [139, ['- ***'], 'ul(-)[li[hr]]'],
  [140, ['text', '***'], 'p"text|***"'],
  [141, ['a', '', '___', '', 'b'], 'p"a" p"___" p"b"'],
  [162, ['-a', '', '>c', '', ':d', '', '======='], 'p"-a" p">c" p":d" p"======="'],
  [166, ['- one', '- two', '', '- three'], 'ul(-,loose)[li[p"one"] li[p"two"] li[p"three"]]'],
]

describe('block chapter examples, block level', () => {
  for (const [number, lines, expected] of EXAMPLES) {
    it(`example ${number}`, () => {
      const src = lines.join('\n')
      expect(shape(src)).toBe(expected)
      expect(checkDocument(src)).toBeNull()
    })
  }
})
