// One test or more for every clause of the inline chapter (spec/0.2/syntax-inline.md). Each test
// names its clause id. Shape notation: see support/shape.ts and support/inline-shape.ts.
import { describe, expect, it } from 'vitest'
import { FLAG_BRACED, MAX_DEPTH, parseTree } from '../src/index.ts'
import { checkInlines } from './support/inline-checks.ts'
import { shape, treeShape } from './support/shape.ts'

/** The tree shape of the lines, with the property checks run on the same input. */
function tree(...lines: string[]): string {
  const src = lines.join('\n')
  expect(checkInlines(src)).toBeNull()
  return treeShape(src)
}

/** The inline shape of a document that is one paragraph. */
function inline(...lines: string[]): string {
  const whole = tree(...lines)
  expect(whole.startsWith('p[') && whole.endsWith(']')).toBe(true)
  return whole.slice(2, -1)
}

describe('preliminaries', () => {
  it('C2-I-001: the block pass settles every line before a content is read', () => {
    expect(tree('*a', '', 'b*')).toBe('p["*a"] p["b*"]')
    expect(tree('a `b', '```', 'c`', '```')).toBe('p["a " code!"b"] code"c`"')
    expect(tree('a `b', '', '- c`')).toBe('p["a " code!"b"] ul(-)[li[p["c" code!""]]]')
  })

  it('C2-I-002: a content has no container prefix, no marker and no indent', () => {
    expect(tree('> - *a', '>   b*')).toBe('quote[ul(-)[li[p[strong["a" sb "b"]]]]]')
    expect(tree('= /a', '  b/')).toBe('h1[em["a" sb "b"]]')
  })

  it('C2-I-003: neighboring spans are joined by one line break', () => {
    expect(tree('> `a', '>   b`')).toBe('quote[p[code"a|b"]]')
    expect(inline('a', 'b')).toBe('"a" sb "b"')
  })

  it('C2-I-004: atoms, then brackets, then delimiters, then attachment', () => {
    expect(inline('[*a `]`*](/u){.c}')).toBe('a(/u)[strong["a " code"]"]]{.c}')
    expect(inline('*[a*](/u)*')).toBe('strong[a(/u)["a*"]]')
  })

  it('C2-I-005: an atom is taken whole, and the one that starts first wins', () => {
    expect(inline('`a <b:c` d>')).toBe('code"a <b:c" " d>"')
    expect(inline('<a:b`c> `d`')).toBe('"<a:b" code"c> " "d" code!""')
    expect(inline('{% ` %} `x`')).toBe('{%}" ` " " " code"x"')
    expect(inline('\\`a*`*')).toBe('"`a*" code!"*"')
  })

  it('C2-I-006: a closing bracket pairs with the nearest open one, and a pair with no construct is text', () => {
    expect(inline('a] [b [c](/u)')).toBe('"a] [b " a(/u)["c"]')
    expect(inline('[a [b] c](/u)')).toBe('a(/u)["a [b] c"]')
    expect(inline('[a *b*] c')).toBe('"[a " strong["b"] "] c"')
  })

  it('C2-I-007: a bracket construct is settled before delimiters pair', () => {
    expect(inline('*a [b* c](/u)')).toBe('"*a " a(/u)["b* c"]')
    expect(inline('/a [/b](/u) c/')).toBe('em["a " a(/u)["/b"] " c"]')
    expect(inline('[a /b]{.c} c/')).toBe('span["a /b"]{.c} " c/"')
  })

  it('C2-I-008: bare and braced delimiters pair on one stack', () => {
    expect(inline('{*a /b*} c/')).toBe('strong["a /b"] " c/"')
    expect(inline('/a {*b/ c*}')).toBe('em["a {*b"] " c*}"')
  })

  it('C2-I-009: an attribute block attaches only to a host that has formed', () => {
    expect(inline('*a*{.c}')).toBe('strong["a"]{.c}')
    expect(inline('*a{.c}')).toBe('"*a{.c}"')
    expect(inline('a*{.c}')).toBe('"a*{.c}"')
  })
})

describe('backslash escapes', () => {
  it('C2-I-010: a backslash makes ASCII punctuation literal', () => {
    expect(inline('\\*a\\* \\[b](/u) \\{.d} \\\\ \\`c')).toBe('"*a* [b](/u) {.d} \\ `c"')
    expect(inline('\\!\\"\\#\\$\\%\\&\\\'\\(\\)\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\^\\_\\|\\}\\~')).toBe('"!"#$%&\'()+,-./:;<=>?@^_|}~"')
  })

  it('C2-I-011: a backslash before a space is a no-break space', () => {
    expect(inline('a\\ b')).toBe('"a" nbsp "b"')
    expect(inline('\\ a')).toBe('nbsp "a"')
  })

  it('C2-I-012: a backslash before any other character is literal', () => {
    expect(inline('\\a C:\\dir \\1 \\é')).toBe('"\\a C:\\dir \\1 \\é"')
    expect(inline('a\\', 'b')).toBe('"a" br "b"')
    expect(inline('a\\\tb')).toBe('"a\\\tb"')
  })

  it('C2-I-013: where escapes are read', () => {
    expect(inline('`a\\`')).toBe('code"a\\"')
    expect(inline('<a:b\\>')).toBe('"<a:b>"')
    expect(inline('</#a\\>')).toBe('xref"a\\"')
    expect(inline('{% a \\%} b')).toBe('{%}" a \\" " b"')
    expect(inline('{# a \\#} b')).toBe('{#}" a \\" " b"')
    expect(inline('[a](/x\\*\\(y\\)\\\\z)')).toBe('a(/x\\*(y)\\z)["a"]')
    expect(inline('[a](/u "a\\"b\\c")')).toBe('a(/u "a"b\\c")["a"]')
    expect(inline('[a]{k="a\\"b\\c" j=\'\\\'\'}')).toBe('span["a"]{k="a"b\\c" j=\'}')
  })
})

describe('code spans', () => {
  it('C2-I-014: the opener is the whole backtick run', () => {
    expect(inline('``a`b``')).toBe('code"a`b"')
    expect(inline('```a``b`c```')).toBe('code"a``b`c"')
  })

  it('C2-I-015: the span closes at the next run of exactly the length of the opener', () => {
    expect(inline('`a``b`c')).toBe('code"a``b" "c"')
    expect(inline('``a`` ``b```c``')).toBe('code"a" " " code"b```c"')
    expect(inline('`*a* [b](/u) \\`')).toBe('code"*a* [b](/u) \\"')
    expect(inline('`a', 'b` c')).toBe('code"a|b" " c"')
  })

  it('C2-I-016: one space is removed from each end when both are there', () => {
    expect(inline('` a `')).toBe('code"a"')
    expect(inline('`  a  `')).toBe('code" a "')
    expect(inline('` a`')).toBe('code" a"')
    expect(inline('`a `')).toBe('code"a "')
    expect(inline('` `')).toBe('code" "')
    expect(inline('`   `')).toBe('code"   "')
    expect(inline('`` ` ``')).toBe('code"`"')
  })

  it('C2-I-017: a code span never fails', () => {
    expect(inline('a `b *c*  ')).toBe('"a " code!"b *c*"')
    expect(inline('a ``b` c')).toBe('"a " code!"b` c"')
    expect(inline('a `', 'b', '')).toBe('"a " code!"|b"')
    expect(inline('a `')).toBe('"a " code!""')
    expect(inline('` a ')).toBe('code!" a"')
  })

  it('C2-I-018: a `!` before the run makes a literal-text span', () => {
    expect(inline('!`a<b`')).toBe('lit"a<b"')
    expect(inline('!``a`b``{.c}')).toBe('lit"a`b"{.c}')
    expect(inline('\\!`x`')).toBe('"!" code"x"')
    expect(inline('a!`b')).toBe('"a" lit!"b"')
    expect(inline('a! `b`')).toBe('"a! " code"b"')
  })
})

describe('math spans', () => {
  it('C2-I-019: `$` and `$$` before a code span make math', () => {
    expect(inline('$`x` $$`y` $5 $ `z` $$$`w`')).toBe('math"x" " " dmath"y" " $5 $ " code"z" " $" dmath"w"')
    expect(inline('$`` a`b ``')).toBe('math"a`b"')
    expect(inline('$`*x*`')).toBe('math"*x*"')
  })

  it('C2-I-020: an unclosed math span runs to the end of its content', () => {
    expect(inline('$`a + b ')).toBe('math!"a + b"')
    expect(inline('$$`a', 'b')).toBe('dmath!"a|b"')
  })
})

describe('raw inline', () => {
  it('C2-I-021: a closed code span with `{=name}` glued to it is raw inline', () => {
    expect(inline('`<b>`{=html}')).toBe('raw(html)"<b>"')
    expect(inline('`` a ` b ``{=_x-1}')).toBe('raw(_x-1)"a ` b"')
    expect(inline('`a`{=1x} `a`{=} `a`{=x y} `a` {=x}')).toBe('code"a" "{=1x} " code"a" "{=} " code"a" "{=x y} " code"a" " {=x}"')
  })

  it('C2-I-022: only a plain code span takes the marker', () => {
    expect(inline('!`a`{=html} $`a`{=html}')).toBe('lit"a" "{=html} " math"a" "{=html}"')
    expect(inline('a{=html} b=}')).toBe('"a" mark["html} b"]')
    expect(inline('`a`{.c}{=html}')).toBe('code"a"{.c} "{=html}"')
    expect(inline('`a{=html}')).toBe('code!"a{=html}"')
  })
})

describe('comments', () => {
  it('C2-I-023: `%%` at the start of a line or after whitespace starts a line comment', () => {
    expect(inline('a %% b')).toBe('"a" %%" b"')
    expect(inline('a\t%%b')).toBe('"a" %%"b"')
    expect(inline('a', '%% b', 'c')).toBe('"a" sb %%" b" sb "c"')
    expect(inline('50%% a%%b (%%c')).toBe('"50%% a%%b (%%c"')
    expect(inline('a  %%')).toBe('"a" %%""')
  })

  it('C2-I-024: a line comment takes the rest of its line with every closer on it', () => {
    expect(inline('*a %% b*', 'c* d')).toBe('strong["a" %%" b*" sb "c"] " d"')
    expect(inline('`a` %% `b', 'c`')).toBe('code"a" %%" `b" sb "c" code!""')
    expect(inline('x {*a %% *}', '*}')).toBe('"x " strong["a" %%" *}" sb]')
  })

  it('C2-I-025: a braced comment closes at the first `%}` and may cross lines', () => {
    expect(inline('a {% b', 'c %} d')).toBe('"a " {%}" b|c " " d"')
    expect(inline('{% a {% b %} c %}')).toBe('{%}" a {% b " " c %}"')
    expect(inline('{%%} {% a')).toBe('{%}"" " {% a"')
    expect(inline('{%} a %}')).toBe('{%}"} a "')
  })

  it('C2-I-026: a braced comment counts as nothing for its neighbors', () => {
    expect(inline('*bo{% c %}ld*')).toBe('strong["bo" {%}" c " "ld"]')
    expect(inline('a{% c %}*b*')).toBe('"a" {%}" c " "*b*"')
    expect(inline('*a{% c %} b*')).toBe('strong["a" {%}" c " " b"]')
    expect(inline('*a {% c %}*')).toBe('"*a " {%}" c " "*"')
    expect(inline('a{% c %}@b')).toBe('"a" {%}" c " "@b"')
    expect(inline('a {% c %}{.d}')).toBe('"a " {%}" c " "{.d}"')
    expect(inline('a{% c %}"b"')).toBe('"a" {%}" c " ‹”› "b" ‹”›')
  })

  it('C2-I-027: a braced comment whose closer stands behind an interrupter line stays text', () => {
    expect(tree('a {% b', '', 'c %} d')).toBe('p["a {% b"] p["c %} d"]')
    expect(tree('- a {% b', '- c %} d')).toBe('ul(-)[li[p["a {% b"]] li[p["c %} d"]]]')
  })
})

describe('attribute blocks', () => {
  it('C2-I-028: braces, optional spaces and parts separated by spaces, on one line', () => {
    expect(inline('[s]{.a}')).toBe('span["s"]{.a}')
    expect(inline('[s]{  .a   #b  }')).toBe('span["s"]{#b .a}')
    expect(inline('[s]{.a', '.b}')).toBe('"[s]{.a" sb ".b}"')
    expect(inline('[s]{.a\t.b}')).toBe('"[s]{.a\t.b}"')
    expect(inline('[s]{.a')).toBe('"[s]{.a"')
  })

  it('C2-I-029: the parts are an id, a class, a language, a key with a value and a bare key', () => {
    expect(inline('[s]{#i .c :en k=v b}')).toBe('span["s"]{#i .c :en k=v b=""}')
  })

  it('C2-I-030: the shapes of a name, a key and a language tag', () => {
    expect(inline('[s]{#a-1_B .-x :en-US _k=1 k-2_x=2}')).toBe('span["s"]{#a-1_B .-x :en-US _k=1 k-2_x=2}')
    expect(inline('[s]{:} [s]{:en-} [s]{:-en} [s]{:en--us} [s]{:e_n}')).toBe('span["s"]{:} " [s]{:en-} [s]{:-en} [s]{:en" ‹–› "us} [s]{:e_n}"')
    expect(inline('[s]{1k=v} [s]{-k=v} [s]{k.x=v} [s]{#a.b} [s]{.é}')).toBe('"[s]{1k=v} [s]{-k=v} [s]{k.x=v} [s]{#a.b} [s]{.é}"')
  })

  it('C2-I-031: a bare key does not start with an underscore', () => {
    expect(inline('[s]{_k} [s]{k_}')).toBe('"[s]{_k} " span["s"]{k_=""}')
  })

  it('C2-I-032: an unquoted value has no space, tab, quote, backslash, pipe or closing brace', () => {
    expect(inline('[s]{k=a.b/c:d#e=f{g}')).toBe('span["s"]{k=a.b/c:d#e=f{g}')
    expect(inline('[s]{k=a"b} [s]{k=a\'b} [s]{k=a\\b} [s]{k=a|b} [s]{k=}')).toBe('"[s]{k=a" ‹”› "b} [s]{k=a" ‹’› "b} [s]{k=a\\b} [s]{k=a|b} [s]{k=}"')
    expect(inline('[s]{k=a}b}')).toBe('span["s"]{k=a} "b}"')
  })

  it('C2-I-033: a quoted value stands in double or single quotes and reads escapes', () => {
    expect(inline('[s]{k="a b" j=\'c "d"\' e="" f="x}y"}')).toBe('span["s"]{k="a b" j="c "d"" e="" f=x}y}')
    expect(inline('[s]{k="a\\*b\\nc"}')).toBe('span["s"]{k=a*b\\nc}')
    expect(inline('[s]{k="a}')).toBe('"[s]{k=" ‹“› "a}"')
    expect(inline('[s]{k="a"b}')).toBe('"[s]{k=" ‹“› "a" ‹”› "b}"')
  })

  it('C2-I-034: one part that fits no shape makes the run no attribute block', () => {
    expect(inline('[s]{.a ?}')).toBe('"[s]{.a ?}"')
    expect(inline('[s]{.a =b=}')).toBe('"[s]{.a =b=}"')
    expect(inline('[s]{=b .a=}')).toBe('"[s]" mark["b .a"]')
    expect(inline('[s]{*a .b*}')).toBe('"[s]" strong["a .b"]')
  })

  it('C2-I-035: a valid block is an atom wherever it stands, and is printed as written when it attaches to nothing', () => {
    expect(inline('*a {k=*} b*')).toBe('strong["a {k=*} b"]')
    expect(inline('a {k="it\'s --- x"} b')).toBe('"a {k="it\'s --- x"} b"')
    expect(inline('[a {k="](/u)"} c](/v)')).toBe('a(/v)["a {k="](/u)"} c"]')
    expect(inline('a {k="]"} [b](/u)')).toBe('"a {k="]"} " a(/u)["b"]')
  })

  it('C2-I-036: the hosts', () => {
    expect(inline('[a]{.c} [a](/u){.c} ![a](/u){.c} <a:b>{.c} [a][b]{.c}')).toBe('span["a"]{.c} " " a(/u)["a"]{.c} " " img(/u)"a"{.c} " " auto"a:b"{.c} " " ref(b)["a"]{.c}')
    expect(inline('`a`{.c} !`a`{.c} $`a`{.c} a[^n]{.c} ^[a]{.c} :a:{.c} :n[a]{.c}')).toBe('code"a"{.c} " " lit"a"{.c} " " math"a"{.c} " a" fnref"n"{.c} " " fn["a"]{.c} " " sym"a"{.c} " " ext(n)["a"]{.c}')
    expect(inline('/a/{.c} *a*{.c} {_a_}{.c} {-a-}{.c}')).toBe('em["a"]{.c} " " strong["a"]{.c} " " u["a"]{.c} " " del["a"]{.c}')
    expect(inline('*a* {.c}')).toBe('strong["a"] " {.c}"')
  })

  it('C2-I-037: what is not a host', () => {
    expect(inline('word{.c} @a{.c} #a{.c} </#a>{.c} {# a #}{.c} `a`{=x}{.c} "a"{.c} ...{.c} \\*{.c}')).toBe(
      '"word{.c} " @"a" "{.c} " #"a" "{.c} " xref"a" "{.c} " {#}" a " "{.c} " raw(x)"a" "{.c} " ‹“› "a" ‹”› "{.c} " ‹…› "{.c} *{.c}"',
    )
    expect(inline('a %% b {.c}')).toBe('"a" %%" b {.c}"')
  })

  it('C2-I-038: a reference is a host whether or not its label resolves', () => {
    expect(inline('[a][nope]{.c} [a][]{#i}')).toBe('ref(nope)["a"]{.c} " " ref(=a)["a"]{#i}')
  })

  it('C2-I-039: glued blocks after one host merge in the order written', () => {
    expect(inline('[x]{#i .a k=1}{.b #j k=2 l=3}{.a}')).toBe('span["x"]{#j .a .b .a k=2 l=3}')
    expect(inline('*a*{.c} {.d}')).toBe('strong["a"]{.c} " {.d}"')
    expect(inline('[x]{k=1 K=2 j=3}')).toBe('span["x"]{k=2 j=3}')
  })

  it('C2-I-040: the block with no part is valid only in the glued run after a bracket pair', () => {
    expect(inline('[a]{} [a]{ } [a]{}{.b} [a]{.b}{}')).toBe('span["a"]{} " " span["a"]{} " " span["a"]{.b} " " span["a"]{.b}')
    expect(inline('*a*{} `a`{} a {} [a](/u){} [a] {}')).toBe('strong["a"] "{} " code"a" "{} a {} " a(/u)["a"] "{} [a] {}"')
  })

  it('C2-I-041: the order inside a block is fixed in the tree', () => {
    expect(inline('[s]{k=v .a :en #b .c j=w}')).toBe('span["s"]{#b .a .c :en k=v j=w}')
  })

  it('C2-I-042: a key named id or class folds into the id or the classes', () => {
    expect(inline('[s]{ID=x Class="y  z\tw" .v}')).toBe('span["s"]{#x .y .z .w .v}')
    expect(inline('[s]{#a id=b} [s]{id=b #a} [s]{class=""}')).toBe('span["s"]{#b} " " span["s"]{#a} " " span["s"]{}')
  })
})

describe('the opening brace', () => {
  it('C2-I-043: the first form that matches at an opening brace', () => {
    expect(inline('[s]{#id}')).toBe('span["s"]{#id}')
    expect(inline('a{%b%}c')).toBe('"a" {%}"b" "c"')
    expect(inline('a{#b#}c {##} {#}')).toBe('"a" {#}"b" "c {##} {#}"')
    expect(inline('a{--}b')).toBe('"a" ‹–› "b"')
    expect(inline('{*a*}{/b/}{_c_}{~d~}{=e=}{+f+}{-g-}{^h^}{,i,}')).toBe('strong["a"] em["b"] u["c"] s["d"] mark["e"] ins["f"] del["g"] sup["h"] sub["i"]')
    expect(inline('{% a {# b #} %}')).toBe('{%}" a {# b #} "')
    expect(inline('{# a {% b %} #}')).toBe('{#}" a {% b %} "')
    expect(inline('{-- } {---}')).toBe('"{" ‹–› " } " del["-"]')
  })

  it('C2-I-044: a brace that starts none of these is text', () => {
    expect(inline('{a} { b } {} {1} {!x!}')).toBe('"{a} { b } {} {1} {!x!}"')
    expect(inline('a } b {')).toBe('"a } b {"')
  })

  it('C2-I-045: glued to a closed code span the raw marker is tried before the highlight opener', () => {
    expect(inline('`a`{=x} b=}')).toBe('raw(x)"a" " b=}"')
    expect(inline('`a`{=x y=}')).toBe('code"a" mark["x y"]')
    expect(inline('`a`{=x .c}')).toBe('code"a" "{=x .c}"')
  })
})

describe('emphasis and strong', () => {
  it('C2-I-046: the slash and the star are the bare delimiters', () => {
    expect(inline('/a/ *b* _c_ ~d~ =e= ^f^ ,g,')).toBe('em["a"] " " strong["b"] " _c_ ~d~ =e= ^f^ ,g,"')
  })

  it('C2-I-047: a delimiter can open after no word character and before no whitespace', () => {
    expect(inline('a*b* (*c*) _*d* é*e*')).toBe('"a*b* (" strong["c"] ") _" strong["d"] " é*e*"')
    expect(inline('x * a* *', 'b*')).toBe('"x * a* *" sb "b*"')
    expect(inline('1/2/')).toBe('"1/2/"')
  })

  it('C2-I-048: a delimiter can close after no whitespace and before no word character', () => {
    expect(inline('*a *b *c*')).toBe('"*a *b " strong["c"]')
    expect(inline('*a*b *c*.')).toBe('"*a*b " strong["c"] "."')
    expect(inline('*a', '* b')).toBe('"*a" sb "* b"')
    expect(inline('/a/é /b/_')).toBe('"/a/é " em["b"] "_"')
  })

  it('C2-I-049: a run of two or more of one bare delimiter is text', () => {
    expect(inline('**a** //b// *a** /b// ***')).toBe('"**a** //b// *a** /b// ***"')
    expect(inline('*a /b// c*')).toBe('strong["a /b// c"]')
    expect(inline('*/a/*')).toBe('strong[em["a"]]')
  })

  it('C2-I-050: a delimiter before a combining mark, a variation selector or a joiner is text', () => {
    expect(inline('*\u0301a* *b*')).toBe('"*\u0301a* " strong["b"]')
    expect(inline('*a*\ufe0f /a/\u200db')).toBe('"*a*\ufe0f /a/\u200db"')
    expect(inline('{*\u0301a*} {%\u0301a%} {#\u0301a#}')).toBe('"{*\u0301a*} {%\u0301a%} {#\u0301a#}"')
  })

  it('C2-I-051: a closer closes the nearest entry of its kind, and the entries above it are text', () => {
    expect(inline('*a /b* c/')).toBe('strong["a /b"] " c/"')
    expect(inline('*a *b* c*')).toBe('strong["a " strong["b"] " c"]')
    expect(inline('/a *b {_c/ d*')).toBe('em["a *b {_c"] " d*"')
    expect(inline('*a* *b*')).toBe('strong["a"] " " strong["b"]')
    expect(inline('.*.a*')).toBe('"." strong[".a"]')
  })

  it('C2-I-052: strong emphasis is plain nesting in the order written', () => {
    expect(inline('/*a*/ */a/* /*a/* */a*/')).toBe('em[strong["a"]] " " strong[em["a"]] " " em["*a"] "* " strong["/a"] "/"')
  })

  it('C2-I-053: a bare span that holds its own delimiter between two word characters does not form', () => {
    expect(inline('/usr/local/ *2*3*')).toBe('"/usr/local/ *2*3*"')
    expect(inline('/a `b/c` d/ /a [b/c](/u) d/ /a {*b/c*} d/')).toBe('em["a " code"b/c" " d"] " " em["a " a(/u)["b/c"] " d"] " " em["a " strong["b/c"] " d"]')
    expect(inline('/a *b/c* d/')).toBe('"/a " strong["b/c"] " d/"')
    expect(inline('*a /b/c d/ e*')).toBe('strong["a /b/c d/ e"]')
    expect(inline('/a {*b/c d/ e*}')).toBe('"/a " strong["b/c d/ e"]')
    expect(inline('/a /b/c d/ e/')).toBe('"/a /b/c d/ e/"')
    expect(inline('/a b\\/c d/')).toBe('em["a b/c d"]')
    expect(inline('/a/b /c/')).toBe('"/a/b " em["c"]')
  })

  it('C2-I-054: an opener with no closer in its content is text', () => {
    expect(inline('*a /b')).toBe('"*a /b"')
    expect(tree('*a', '', 'b*')).toBe('p["*a"] p["b*"]')
  })
})

describe('braced delimiters', () => {
  it('C2-I-055: a braced token has no condition on the characters around it', () => {
    expect(inline('a{*b*}c { {* b *} }')).toBe('"a" strong["b"] "c { " strong[" b "] " }"')
    expect(inline('{* *}')).toBe('strong[" "]')
  })

  it('C2-I-056: a braced opener only opens and a braced closer only closes', () => {
    expect(inline('{*a{*b*}c*}')).toBe('strong["a" strong["b"] "c"]')
    expect(inline('*} a {*')).toBe('"*} a {*"')
  })

  it('C2-I-057: a mark before `}` is a braced closer only while a braced opener of that mark is open', () => {
    expect(inline('/a/} *a*} _a_}')).toBe('em["a"] "} " strong["a"] "} _a_}"')
    expect(inline('{/a *b*} c/}')).toBe('em["a " strong["b"] "} c"]')
    expect(inline('{*a**}')).toBe('strong["a*"]')
    expect(inline('a**} b')).toBe('"a**} b"')
    expect(inline('{~a /b/} c~}')).toBe('s["a " em["b"] "} c"]')
  })

  it('C2-I-058: a braced closer pairs with the nearest braced opener of its mark and never with a bare delimiter', () => {
    expect(inline('{*a {*b*} c*}')).toBe('strong["a " strong["b"] " c"]')
    expect(inline('*a*} {*b*')).toBe('strong["a"] "} {*b*"')
    expect(inline('*a {*b* c*}')).toBe('strong["a {*b"] " c*}"')
    expect(inline('{*a *b*} c*')).toBe('strong["a *b"] " c*"')
  })

  it('C2-I-059: the first pair closed wins, and every entry opened after its opener is text', () => {
    expect(inline('{+a {*b+} c*}')).toBe('ins["a {*b"] " c*}"')
    expect(inline('{*a /b {_c*} d/ e_}')).toBe('strong["a /b {_c"] " d/ e_}"')
  })

  it('C2-I-060: a braced opener that finds no closer is two characters of text', () => {
    expect(inline('{*a and *b*')).toBe('"{*a and " strong["b"]')
    expect(inline('{/a/')).toBe('"{/a/"')
    expect(inline('{/a/ b/')).toBe('"{/a/ b/"')
  })

  it('C2-I-061: a braced opener glued to its own closer forms nothing', () => {
    expect(inline('{**} {//} {__} {~~} {==} {++} {^^} {,,}')).toBe('"{**} {//} {__} {~~} {==} {++} {^^} {,,}"')
    expect(inline('{*{**}*}')).toBe('strong["{**}"]')
    expect(inline('{* *}')).toBe('strong[" "]')
  })

  it('C2-I-062: a replacement is a deletion with an insertion glued to it', () => {
    expect(inline('{-a-}{+b+}')).toBe('del["a"] ins["b"]')
    expect(inline('{~a~>b~} a ~> b')).toBe('s["a~>b"] " a ~> b"')
  })

  it('C2-I-063: an editorial comment is literal and holds at least one character', () => {
    expect(inline('{# a *b* `c #} d')).toBe('{#}" a *b* `c " " d"')
    expect(inline('{#a', 'b#}')).toBe('{#}"a|b"')
    expect(inline('{##} {# #} {#a')).toBe('"{##} " {#}" " " {#a"')
    expect(inline('{#a#}{.c}')).toBe('{#}"a" "{.c}"')
  })
})

describe('spans', () => {
  it('C2-I-064: a bracket pair with a valid attribute block glued to it is a span', () => {
    expect(inline('[a *b*]{.c}{#d}')).toBe('span["a " strong["b"]]{#d .c}')
    expect(inline('[]{.c}')).toBe('span[]{.c}')
    expect(inline('[[a]{.b}]{.c}')).toBe('span[span["a"]{.b}]{.c}')
  })

  it('C2-I-065: a bracket pair followed by anything else is text', () => {
    expect(inline('[a] {.c} [a]b [a]{?} [a]')).toBe('"[a] {.c} [a]b [a]{?} [a]"')
  })
})

describe('links and images', () => {
  it('C2-I-066: a bracket pair with a link tail glued to it is an inline link', () => {
    expect(inline('[a](/u) [a] (/u)')).toBe('a(/u)["a"] " [a] (/u)"')
    expect(inline('[](/u)')).toBe('a(/u)[]')
  })

  it('C2-I-067: a destination has no whitespace and balanced or escaped parentheses', () => {
    expect(inline('[a]() [a](b(c)d) [a](b\\(c) [a](b\\)c) [a]((()))')).toBe('a()["a"] " " a(b(c)d)["a"] " " a(b(c)["a"] " " a(b)c)["a"] " " a((()))["a"]')
    expect(inline('[a](b(c) [a](b c) [a](b\tc)')).toBe('"[a](b(c) [a](b c) [a](b\tc)"')
    expect(inline('[a](b)c)')).toBe('a(b)["a"] "c)"')
    expect(inline('[a](<b>) [a]([b]) [a](*b*)')).toBe('a(<b>)["a"] " " a([b])["a"] " " a(*b*)["a"]')
  })

  it('C2-I-068: a title follows the destination after exactly one space', () => {
    expect(inline('[a](/u "T") [a](/u \'T\') [a](/u "T"  ) [a](/u "")')).toBe('a(/u "T")["a"] " " a(/u "T")["a"] " " a(/u "T")["a"] " " a(/u "")["a"]')
    expect(inline('[a](/u "a\\"b") [a](/u \'a\\\'b\')')).toBe('a(/u "a"b")["a"] " " a(/u "a\'b")["a"]')
    expect(inline('[a]( "T")')).toBe('a( "T")["a"]')
    expect(inline('[a](/u  "T")')).toBe('"[a](/u  " ‹“› "T" ‹”› ")"')
    expect(inline('[a](/u "T" x)')).toBe('"[a](/u " ‹“› "T" ‹”› " x)"')
    expect(inline('[a](/u "T)')).toBe('"[a](/u " ‹“› "T)"')
    expect(inline('[a](/u T)')).toBe('"[a](/u T)"')
    expect(inline('[a](/u )')).toBe('"[a](/u )"')
  })

  it('C2-I-069: the link tail is an atom on one line, read only glued to the closing bracket of a pair', () => {
    expect(inline('[a](/u*) *b*')).toBe('a(/u*)["a"] " " strong["b"]')
    expect(inline('a](b *c) d*')).toBe('"a](b " strong["c) d"]')
    expect(inline('[a](/u', 'v)')).toBe('"[a](/u" sb "v)"')
    expect(inline('[a](/u "T', 'U")')).toBe('"[a](/u " ‹“› "T" sb "U" ‹”› ")"')
    expect(inline('[a]((x[b](y "T")')).toBe('"[a]((x" a(y "T")["b"]')
    expect(inline('[a](x[b](y) z)')).toBe('"[a](x" a(y)["b"] " z)"')
  })

  it('C2-I-070: link text is inline content and may cross line breaks', () => {
    expect(inline('[a *b*', 'c `d`](/u)')).toBe('a(/u)["a " strong["b"] sb "c " code"d"]')
  })

  it('C2-I-071: a link inside link text stays a node', () => {
    expect(inline('[a [b](/x) ![c](/y) [d]{.e}](/z)')).toBe('a(/z)["a " a(/x)["b"] " " img(/y)"c" " " span["d"]{.e}]')
    expect(inline('[<a:b>](/z)')).toBe('a(/z)[auto"a:b"]')
  })

  it('C2-I-072: full and collapsed references, and no shortcut form', () => {
    expect(inline('[a][b] [a][] [a]')).toBe('ref(b)["a"] " " ref(=a)["a"] " [a]"')
    expect(inline('[a][b][c] [a] [b]')).toBe('ref(b)["a"] "[c] [a] [b]"')
    expect(inline('[ ][] [][]')).toBe('"[ ][] [][]"')
    expect(inline('[a *b*][]')).toBe('ref(=a *b*)["a " strong["b"]]')
  })

  it('C2-I-073: an autolink holds a URL or an email address', () => {
    expect(inline('<a:b> <a1+.-:b> <1a:b> <a:> <a b:c> <a:b c>')).toBe('auto"a:b" " " auto"a1+.-:b" " <1a:b> <a:> <a b:c> <a:b c>"')
    expect(inline('<http://é.x/ü?[a]#(b)>')).toBe('auto"http://é.x/ü?[a]#(b)"')
    expect(inline('<a:b<c> <a:b"c> <a:b\u200bc>')).toBe('"<a:b<c> <a:b" ‹”› "c> <a:b\u200bc>"')
    expect(inline('<a.b+c_d-e@f-g.h.io> <a@b.c1> <@b.c> <a@.c> <a@b.> <a@b> <a@b..c>')).toBe('mail"a.b+c_d-e@f-g.h.io" " <a@b.c1> <" @"b.c" "> <a@.c> <a@b.> <a@b> " mail"a@b..c"')
    expect(inline('<a:b', 'c>')).toBe('"<a:b" sb "c>"')
  })

  it('C2-I-074: a `!` before a link or a reference makes an image', () => {
    expect(inline('![a *b* [c](/x)](/u "T") ![a][b] ![a][]')).toBe('img(/u "T")"a *b* [c](/x)" " " imgref(b)"a" " " imgref(=a)"a"')
    expect(inline('![a] ![a]{.c} \\![a](/u) ! [a](/u)')).toBe('"![a] !" span["a"]{.c} " !" a(/u)["a"] " ! " a(/u)["a"]')
    expect(inline('![a', 'b](/u)')).toBe('img(/u)"a|b"')
    expect(inline('![a `]` b](/u)')).toBe('img(/u)"a `]` b"')
    expect(inline('*a ![b* c](/u)*')).toBe('strong["a " img(/u)"b* c"]')
  })
})

describe('reference resolution', () => {
  it('C2-I-075: a reference is a node whether or not its label resolves', () => {
    expect(tree('[a][b]')).toBe('p[ref(b)["a"]]')
    expect(tree('[a][b]', '', '[b]: /u')).toBe('p[ref(b)["a"]] def"[b]: /u"')
  })

  it('C2-I-076: a label is taken whole', () => {
    expect(inline('[a][b `c] d` e]')).toBe('ref(b `c)["a"] " d" code!" e]"')
    expect(inline('[a][*b*] [a][b [c] [a][<x:y>]')).toBe('ref(*b*)["a"] " " ref(b [c)["a"] " " ref(<x:y>)["a"]')
    expect(inline('[a][b\\]c] [a][b\\\\]c]')).toBe('ref(b\\]c)["a"] " " ref(b\\\\)["a"] "c]"')
  })

  it('C2-I-077: a line comment that starts inside a label takes the rest of its line', () => {
    expect(inline('[x][a %% b]')).toBe('"[x][a" %%" b]"')
    expect(inline('[x][a', '%% b]')).toBe('"[x][a" sb %%" b]"')
    expect(inline('[x][a%% b] [^a %% b]')).toBe('ref(a%% b)["x"] " [^a" %%" b]"')
  })

  it('C2-I-078: a label that starts with an at-sign is no reference label', () => {
    expect(inline('[a][@b] [a][ @b]')).toBe('"[a][" @"b" "] " ref(@b)["a"]')
  })

  it('C2-I-079: the key of a label folds whitespace and keeps case and backslashes', () => {
    expect(inline('[x][ a  \t b ] [x][A\\*b]')).toBe('ref(a b)["x"] " " ref(A\\*b)["x"]')
    expect(inline('[x][ ] [x][\t]')).toBe('"[x][ ] [x][\t]"')
    expect(inline('[  a  b ][]')).toBe('ref(=a b)["  a  b "]')
  })

  it('C2-I-080: a label may wrap', () => {
    expect(inline('[x][a ', '  b]')).toBe('ref(a b)["x"]')
    expect(tree('> [x][a', '> b]')).toBe('quote[p[ref(a b)["x"]]]')
    expect(tree('[x][a', '', 'b]')).toBe('p["[x][a"] p["b]"]')
    expect(tree('> [a', '> b][]')).toBe('quote[p[ref(=a b)["a" sb "b"]]]')
  })

  it('C2-I-081: the lookup in link definitions and headings is resolution, and the scan keeps the key for it', () => {
    expect(tree('# T', '', '[T][] [go][T]', '', '[T]: /u')).toBe('h1["T"] p[ref(=T)["T"] " " ref(T)["go"]] def"[T]: /u"')
  })

  it('C2-I-082: the attributes of a definition merge at resolution, and the reference keeps its own', () => {
    expect(tree('[b][r]{.own k=2}', '', '{.def k=1}', '[r]: /u')).toBe('p[ref(r)["b"]{.own k=2}] {.def k=1}def"[r]: /u"')
  })

  it('C2-I-083: an image reference is a node with its key, and the heading lookup is resolution', () => {
    expect(tree('# T', '', 'a ![x][T]')).toBe('h1["T"] p["a " imgref(T)"x"]')
  })

  it('C2-I-084: the key that a heading is matched with is the folded source', () => {
    expect(inline('[A *bold*  title][]')).toBe('ref(=A *bold* title)["A " strong["bold"] "  title"]')
  })

  it('C2-I-085: an unresolved reference is still a reference node with its children', () => {
    expect(inline('[*a*][no', 'pe]{.c #i}')).toBe('ref(no pe)[strong["a"]]{#i .c}')
  })

  it('C2-I-086: a footnote inside a reference is an ordinary footnote', () => {
    expect(inline('[a ^[n] b[^m]][nope]')).toBe('ref(nope)["a " fn["n"] " b" fnref"m"]')
  })
})

describe('footnotes', () => {
  it('C2-I-087: a footnote reference takes no link tail and no reference label', () => {
    expect(inline('a[^n] [^n](/u) [^n][b] [^a b]')).toBe('"a" fnref"n" " " fnref"n" "(/u) " fnref"n" "[b] " fnref"a b"')
    expect(inline('a[^my', 'note] b')).toBe('"a" fnref"my note" " b"')
    expect(inline('[^] [^ ] [^ ](/u) [^a')).toBe('"[^] [^ ] [^ ](/u) [^a"')
    expect(inline('[^a `]` b]')).toBe('fnref"a `" code!" b]"')
    expect(inline('[[^a]](/u) *[^a*]*')).toBe('a(/u)[fnref"a"] " " strong[fnref"a*"]')
  })

  it('C2-I-088: a footnote reference with no definition is still a node', () => {
    expect(tree('b[^missing]')).toBe('p["b" fnref"missing"]')
  })

  it('C2-I-089: `^[` opens an inline footnote that closes at its matching bracket', () => {
    expect(inline('a^[b *c* [d](/u)] e')).toBe('"a" fn["b " strong["c"] " " a(/u)["d"]] " e"')
    expect(inline('a^[b [c] d] e')).toBe('"a" fn["b [c] d"] " e"')
    expect(inline('a^[b](/u) ^[c][d]')).toBe('"a" fn["b"] "(/u) " fn["c"] "[d]"')
    expect(inline('a^[b')).toBe('"a^[b"')
    expect(inline('*a ^[b* c]*')).toBe('strong["a " fn["b* c"]]')
  })
})

describe('mention, tag, symbol and inline extension', () => {
  it('C2-I-090: a sigil starts a form only at the start of the content or after no letter and no number', () => {
    expect(inline('@a (@a) _@a a@a 1@a é@a')).toBe('@"a" " (" @"a" ") _" @"a" " a@a 1@a é@a"')
    expect(inline('#a a#a :a: a:a: 1:n[x]')).toBe('#"a" " a#a " sym"a" " a:a: 1:n[x]"')
    expect(inline('*@a* {.c}@a')).toBe('strong[@"a"] " {.c}" @"a"')
  })

  it('C2-I-091: the name is the longest run that fits its shape', () => {
    expect(inline('@abc!d #a_b-c. @ # : @é')).toBe('@"abc" "!d " #"a_b-c" ". @ # : @é"')
  })

  it('C2-I-092: the name of a mention or a tag', () => {
    expect(inline('@a.b.c @a..b @a.-b @a-.b @1.a @123 @1-2 @_ @a. @a- @a-- @a.-')).toBe(
      '@"a.b.c" " " @"a" "..b " @"a.-b" " " @"a-.b" " " @"1.a" " @123 @1-2 @_ " @"a" ". " @"a" "- " @"a" ‹–› " " @"a" ".-"',
    )
    expect(inline('#release-1.0. #fff #123 #a/b')).toBe('#"release-1.0" ". " #"fff" " #123 " #"a" "/b"')
  })

  it('C2-I-093: a symbol is a colon, a name and a colon', () => {
    expect(inline(':a: :+1: :-1: :1a_b: :a-: :-: :_a: :a b: :a :a:b:')).toBe('sym"a" " " sym"+1" " " sym"-1" " " sym"1a_b" " :a-: :-: :_a: :a b: :a " sym"a" "b:"')
  })

  it('C2-I-094: an inline extension is a colon, a name, a bracket, content and the matching bracket', () => {
    expect(inline(':n[a *b* [c] d] :_n-1[x] :1n[x] :n [x] :n[a')).toBe('ext(n)["a " strong["b"] " [c] d"] " " ext(_n-1)["x"] " :1n[x] :n [x] :n[a"')
    expect(inline(':n[a](/u)')).toBe('ext(n)["a"] "(/u)"')
  })

  it('C2-I-095: a mention, a tag and a symbol are atoms, and an inline extension is a bracket construct', () => {
    expect(inline('*@a.b* /#c/ [:d:](/u) {-@e-}')).toBe('strong[@"a.b"] " " em[#"c"] " " a(/u)[sym"d"] " " del[@"e"]')
    expect(inline('*a :n[b* c]*')).toBe('strong["a " ext(n)["b* c"]]')
  })
})

describe('cross-references', () => {
  it('C2-I-096: `</#`, an id and `>` form a cross-reference', () => {
    expect(inline('</#a> </#a.b:c/d> </#é>')).toBe('xref"a" " " xref"a.b:c/d" " " xref"é"')
    expect(inline('</#> x')).toBe('"</#> x"')
    expect(inline('</#a b>')).toBe('"</" #"a" " b>"')
    expect(inline('</#a', 'b>')).toBe('"</" #"a" sb "b>"')
    expect(inline('</#a</#b>')).toBe('xref"a</#b"')
    expect(inline('*</#a*>*')).toBe('strong[xref"a*"]')
  })

  it('C2-I-097: the id is kept as typed for an exact match', () => {
    expect(inline('</#Intro> </#intro>')).toBe('xref"Intro" " " xref"intro"')
  })
})

describe('abbreviations', () => {
  it('C2-I-098: an abbreviation node is made at resolution, so the scan leaves the term in the text', () => {
    expect(tree('The HTML spec', '', '*[HTML]: Hypertext Markup Language')).toBe('p["The HTML spec"] abbr"*[HTML]: Hypertext Markup Language"')
  })

  it('C2-I-099: an element edge is no boundary, so the text around a node stays one run per side', () => {
    expect(inline('X*HTML*s')).toBe('"X*HTML*s"')
  })

  it('C2-I-100: the inside of an atom is no text of the flow', () => {
    expect(inline('`HTML` <a:HTML> @HTML')).toBe('code"HTML" " " auto"a:HTML" " " @"HTML"')
  })
})

describe('citations', () => {
  it('C2-I-101: a bracket pair that starts with an at-sign forms no construct in the core', () => {
    expect(inline('[@a] [see @a, p. 3; @b]')).toBe('"[" @"a" "] [see " @"a" ", p. 3; " @"b" "]"')
    expect(inline('[@a](/u) [@a][b] [@a]{.c}')).toBe('a(/u)[@"a"] " " ref(b)[@"a"] " " span[@"a"]{.c}')
  })
})

describe('hard break and soft break', () => {
  it('C2-I-102: a backslash at the end of a line or of the content is a hard break', () => {
    expect(inline('a\\', 'b')).toBe('"a" br "b"')
    expect(inline('a\\')).toBe('"a" br')
    expect(inline('a\\  ')).toBe('"a" br')
    expect(tree('| a\\ | b |')).toBe('table[tr[td["a" br] td["b"]]]')
    expect(inline('a\\\\', 'b')).toBe('"a\\" sb "b"')
    expect(inline('*a\\', 'b*')).toBe('strong["a" br "b"]')
  })

  it('C2-I-103: every other line break is a soft break, and the spaces around it are dropped', () => {
    expect(inline('a  ', 'b\t', 'c')).toBe('"a" sb "b" sb "c"')
    expect(tree('= a', '   b')).toBe('h1["a" sb "b"]')
    expect(inline('`a`  ', '*b*')).toBe('code"a" sb strong["b"]')
  })
})

describe('smart typography', () => {
  it('C2-I-104: where a straight quote opens', () => {
    expect(inline('"a" ("b") ["c"] {"d"} ="e" :"f" -"g" a"h"')).toBe(
      '‹“› "a" ‹”› " (" ‹“› "b" ‹”› ") [" ‹“› "c" ‹”› "] {" ‹“› "d" ‹”› "} =" ‹“› "e" ‹”› " :" ‹“› "f" ‹”› " -" ‹“› "g" ‹”› " a" ‹”› "h" ‹”›',
    )
    expect(inline('a\\ "b" “"c" *"d"* [e]{.c}"f" `g`"h" ["i"](/u)')).toBe(
      '"a" nbsp ‹“› "b" ‹”› " “" ‹“› "c" ‹”› " " strong[‹“› "d" ‹”›] " " span["e"]{.c} ‹”› "f" ‹”› " " code"g" ‹”› "h" ‹”› " " a(/u)[‹“› "i" ‹”›]',
    )
    expect(inline('a', '"b"')).toBe('"a" sb ‹“› "b" ‹”›')
    expect(inline('."a" !"b" x\\"')).toBe('"." ‹”› "a" ‹”› " !" ‹”› "b" ‹”› " x""')
  })

  it('C2-I-105: a single quote before an ASCII digit is an apostrophe', () => {
    expect(inline("'90s a '5 ('6)")).toBe('‹’› "90s a " ‹’› "5 (" ‹’› "6)"')
  })

  it('C2-I-106: after a hyphen, a dash or a slash a quote closes before the end, whitespace or closing punctuation', () => {
    expect(inline('"a---" b a/" c -"d" e/"f" g-"')).toBe('‹“› "a" ‹—› ‹”› " b a/" ‹”› " c -" ‹“› "d" ‹”› " e/" ‹“› "f" ‹”› " g-" ‹”›')
    expect(inline('a/". a/", a/"; a/": a/"! a/"? a/") a/"] a/"\' a/""')).toBe(
      '"a/" ‹”› ". a/" ‹”› ", a/" ‹”› "; a/" ‹”› ": a/" ‹”› "! a/" ‹”› "? a/" ‹”› ") a/" ‹”› "] a/" ‹”› ‹’› " a/" ‹”› ‹”›',
    )
    expect(inline("a-'b a-' c")).toBe('"a-" ‹‘› "b a-" ‹’› " c"')
  })

  it('C2-I-107: a single quote that would open before one of the listed words is an apostrophe', () => {
    expect(inline("'tis 'Tis 'TWAS 'em 'cause 'til 'n 'bout 'twere 'twill 'twould 'tisn't 'twasn't")).toBe(
      '‹’› "tis " ‹’› "Tis " ‹’› "TWAS " ‹’› "em " ‹’› "cause " ‹’› "til " ‹’› "n " ‹’› "bout " ‹’› "twere " ‹’› "twill " ‹’› "twould " ‹’› "tisn" ‹’› "t " ‹’› "twasn" ‹’› "t"',
    )
    expect(inline("'emily")).toBe('‹‘› "emily"')
  })

  it('C2-I-108: the word is quoted when a single quote and no letter or number follow it', () => {
    expect(inline("'em' 'n'. 'em's 'til'")).toBe('‹‘› "em" ‹’› " " ‹‘› "n" ‹’› ". " ‹’› "em" ‹’› "s " ‹‘› "til" ‹’›')
  })

  it('C2-I-109: single quotes do not nest', () => {
    expect(inline("'a 'b' c' 'd'")).toBe('‹‘› "a " ‹’› "b" ‹’› " c" ‹’› " " ‹‘› "d" ‹’›')
    expect(inline("'a b's 'c' d'")).toBe('‹‘› "a b" ‹’› "s " ‹’› "c" ‹’› " d" ‹’›')
    expect(inline("'a ^['b' 'c'] 'd'")).toBe('‹‘› "a " fn[‹‘› "b" ‹’› " " ‹‘› "c" ‹’›] " " ‹’› "d" ‹’›')
    expect(inline("'a '(b)'")).toBe('‹‘› "a " ‹‘› "(b)" ‹’›')
    expect(tree("'a", '', "'b'")).toBe('p[‹‘› "a"] p[‹‘› "b" ‹’›]')
  })

  it('C2-I-110: a quote that was emitted is never changed', () => {
    expect(inline("say 'word and \"more")).toBe('"say " ‹‘› "word and " ‹“› "more"')
  })

  it('C2-I-111: a run of two or more hyphens becomes dashes', () => {
    expect(inline('a-b a--b a---b a----b a-----b a------b a-------b')).toBe(
      '"a-b a" ‹–› "b a" ‹—› "b a" ‹–› ‹–› "b a" ‹—› ‹–› "b a" ‹—› ‹—› "b a" ‹—› ‹–› ‹–› "b"',
    )
    expect(inline('a -- b --')).toBe('"a " ‹–› " b " ‹–›')
  })

  it('C2-I-112: a hyphen run that is a command-line flag stays as typed', () => {
    expect(inline('git --all (--x) "--y" \'--z\' a(--b) --')).toBe('"git --all (--x) " ‹“› "--y" ‹”› " " ‹‘› "--z" ‹’› " a(" ‹–› "b) " ‹–›')
    expect(inline('--a', '--b')).toBe('"--a" sb "--b"')
    expect(inline('*--a*')).toBe('strong["--a"]')
    expect(inline('a ---b')).toBe('"a ---b"')
  })

  it('C2-I-113: `{--}` is an en dash', () => {
    expect(inline('x {--}y {--}{.c} *{--}*')).toBe('"x " ‹–› "y " ‹–› "{.c} " strong[‹–›]')
  })

  it('C2-I-114: three dots become an ellipsis', () => {
    expect(inline('a... b.. c.... d......')).toBe('"a" ‹…› " b.. c" ‹…› ". d" ‹…› ‹…›')
  })

  it('C2-I-115: six runs become arrows, and the longest match is taken', () => {
    expect(inline('a --> b <-- c <--> d ==> e <== f <=> g')).toBe('"a " ‹→› " b " ‹←› " c " ‹↔› " d " ‹⇒› " e " ‹⇐› " f " ‹⇔› " g"')
    expect(inline('a -> b <- c => d')).toBe('"a -> b <- c => d"')
    expect(inline('a-->b a<--b')).toBe('"a" ‹→› "b a" ‹←› "b"')
    expect(inline('a ===> b <==> c')).toBe('"a =" ‹⇒› " b " ‹⇐› "> c"')
  })

  it('C2-I-116: an arrow needs its exact hyphen run', () => {
    expect(inline('a--->b a<---b a<---->b a ---> b')).toBe('"a" ‹—› ">b a<" ‹—› "b a<" ‹–› ‹–› ">b a ---> b"')
  })

  it('C2-I-117: the comparison signs, plus-minus and the trademark sign', () => {
    expect(inline('a != b <= c >= d +- e(tm) (c) (r) (TM)')).toBe('"a " ‹≠› " b " ‹≤› " c " ‹≥› " d " ‹±› " e" ‹™› " (c) (r) (TM)"')
    expect(inline('`a != b` <a:b!=c> [x](/u!=v)')).toBe('code"a != b" " " auto"a:b!=c" " " a(/u!=v)["x"]')
    expect(inline('a \\!= b !\\= c')).toBe('"a != b != c"')
  })
})

describe('the depth cap', () => {
  it('C2-I-118: an opener past the cap is text', () => {
    const depth = (shapeText: string, open: string): number => shapeText.split(open).length - 1
    expect(depth(inline(`${'{^'.repeat(MAX_DEPTH + 1)}x${'^}'.repeat(MAX_DEPTH + 1)}`), 'sup[')).toBe(MAX_DEPTH)
    expect(depth(inline(`${'*a '.repeat(MAX_DEPTH + 5)}${'b* '.repeat(MAX_DEPTH + 5)}`), 'strong[')).toBe(MAX_DEPTH)
    expect(depth(inline(`${'['.repeat(MAX_DEPTH + 1)}x${']{.c}'.repeat(MAX_DEPTH + 1)}`), 'span[')).toBe(MAX_DEPTH)
    expect(depth(inline(`${'^['.repeat(MAX_DEPTH + 1)}x${']'.repeat(MAX_DEPTH + 1)}`), 'fn[')).toBe(MAX_DEPTH)
    expect(depth(inline(`${':n['.repeat(MAX_DEPTH + 1)}x${']'.repeat(MAX_DEPTH + 1)}`), 'ext(n)[')).toBe(MAX_DEPTH)
    // Blocks and inlines count together: two quotes leave room for 198 inline nodes.
    expect(depth(tree(`> > ${'{^'.repeat(MAX_DEPTH)}x${'^}'.repeat(MAX_DEPTH)}`), 'sup[')).toBe(MAX_DEPTH - 2)
    expect(depth(tree(`> - ${'['.repeat(MAX_DEPTH)}x${']{.c}'.repeat(MAX_DEPTH)}`), 'span[')).toBe(MAX_DEPTH - 3)
    // Brackets and delimiters count together.
    const mixed = inline(`${'['.repeat(150)}${'{^'.repeat(60)}x${'^}'.repeat(60)}${']{.c}'.repeat(150)}`)
    expect(depth(mixed, 'span[') + depth(mixed, 'sup[')).toBe(MAX_DEPTH)
    const reversed = inline(`${'{^'.repeat(150)}${'['.repeat(60)}x${']{.c}'.repeat(60)}${'^}'.repeat(150)}`)
    expect(depth(reversed, 'span[') + depth(reversed, 'sup[')).toBe(MAX_DEPTH)
  })
})

describe('the fallback rule', () => {
  it('C2-I-119: a failed opener is literal text, and the scan goes on directly behind it', () => {
    expect(inline('[a *b* {=c `d`')).toBe('"[a " strong["b"] " {=c " code"d"')
    expect(inline('^[a *b*')).toBe('"^[a " strong["b"]')
    expect(inline(':n[a @b')).toBe('":n[a " @"b"')
    expect(inline('{.a *b*')).toBe('"{.a " strong["b"]')
    expect(inline('{%a *b*')).toBe('"{%a " strong["b"]')
    expect(inline('{#a #b')).toBe('"{#a " #"b"')
    expect(inline('<a:b *c*')).toBe('"<a:b " strong["c"]')
    expect(inline('</#a *b*')).toBe('"</" #"a" " " strong["b"]')
    expect(inline('[a](/u *b*')).toBe('"[a](/u " strong["b"]')
    expect(inline('![a *b*')).toBe('"![a " strong["b"]')
  })

  it('C2-I-120: no inline form crosses the end of its content', () => {
    expect(tree('| *a | b* |')).toBe('table[tr[td["*a"] td["b*"]]]')
    expect(tree('| `a | b` |')).toBe('table[tr[td[code"a | b"]]]')
    expect(tree('| `a | b |')).toBe('table[tr[td[code!"a"] td["b"]]]')
    expect(tree('= *a', '', 'b*')).toBe('h1["*a"] p["b*"]')
    expect(tree(':: [a', ': b](/u)')).toBe('dl[dt["[a"] dd[p["b](/u)"]]]')
    expect(tree('![a](b)', '^ {*c', 'd*}')).toBe('img[img(b)"a"] cap[strong["c" sb "d"]]')
  })
})

describe('the display math line', () => {
  it('C2-I-121: a line that consists of exactly one display math span', () => {
    expect(shape('$$`E = mc^2`')).toBe('math"$$`E = mc^2`"')
    expect(shape('$$`a`{.c}{#d}  ')).toBe('math"$$`a`{.c}{#d}  "')
    expect(shape('text $$`a`')).toBe('p"text $$`a`"')
    expect(shape('$$`a` b')).toBe('p"$$`a` b"')
    expect(shape('$$`a')).toBe('p"$$`a"')
    expect(tree('$$`a`{.c}')).toBe('math[dmath"a"{.c}]')
  })
})

// Cases the mutation run asked for: each one is told apart from a small change of the scanner
// that the tests above did not notice.
describe('more cases per clause', () => {
  it('C2-I-010: the edges of ASCII punctuation', () => {
    expect(inline('\\0 \\9 \\A \\Z \\a \\z \\\x7f')).toBe('"\\0 \\9 \\A \\Z \\a \\z \\\x7f"')
    expect(inline('{\\*a*')).toBe('"{*a*"')
    expect(inline('a@\\*b* @\\*b* ]\\*b* a:\\*b* :\\*b*')).toBe('"a@*b* @*b* ]*b* a:*b* :*b*"')
  })

  it('C2-I-018: a literal-text span at the very end of the content', () => {
    expect(inline('a!`')).toBe('"a" lit!""')
  })

  it('C2-I-021: the format name and a later node keep their source offsets in a container', () => {
    expect(tree('> a `x`{=html} {--}')).toBe('quote[p["a " raw(html)"x" " " ‹–›]]')
  })

  it('C2-I-023: a line comment behind a no-break space, and a percent sign before other forms', () => {
    expect(inline('x\\ %% c')).toBe('"x" nbsp %%" c"')
    expect(inline('50%\\', 'b')).toBe('"50%" br "b"')
    expect(inline('5%`a`')).toBe('"5%" code"a"')
  })

  it('C2-I-026: what stands behind a delimiter is read through braced comments only', () => {
    expect(inline('x*{%%}')).toBe('"x*" {%}""')
    expect(inline('*5%* {%c%}')).toBe('strong["5%"] " " {%}"c"')
    expect(inline('*{a* b%}')).toBe('strong["{a"] " b%}"')
    expect(inline('*{a%b* c%}')).toBe('strong["{a%b"] " c%}"')
    expect(inline('*{%a*')).toBe('strong["{%a"]')
    expect(inline('*5% off*')).toBe('strong["5% off"]')
    expect(inline('x *}*')).toBe('"x " strong["}"]')
  })

  it('C2-I-033: the search for a closing quote of one kind says nothing about the other kind', () => {
    expect(inline('[s]{a=\'x [t]{b="y"}')).toBe('"[s]{a=" ‹‘› "x " span["t"]{b=y}')
    expect(inline('[s]{a="x [t]{b=\'y\'}')).toBe('"[s]{a=" ‹“› "x " span["t"]{b=y}')
  })

  it('C2-I-047: an ASCII letter at the end of the alphabet and a letter outside the basic plane are word characters', () => {
    expect(inline('z*a* Z*a* *a*z *a*Z')).toBe('"z*a* Z*a* *a*z *a*Z"')
    expect(inline('𝐀*a*')).toBe('"𝐀*a*"')
    expect(inline('x 𝐀*a*')).toBe('"x 𝐀*a*"')
    expect(inline('*a*𝐀')).toBe('"*a*𝐀"')
    expect(inline('*a*𝐀 b')).toBe('"*a*𝐀 b"')
    expect(inline('\u{10000}*a* *a*\u{10000}')).toBe('"\u{10000}*a* *a*\u{10000}"')
    expect(inline('😀*a*😀')).toBe('"😀" strong["a"] "😀"')
  })

  it('C2-I-049: a run before a backslash', () => {
    expect(inline('a**\\', 'b')).toBe('"a**" br "b"')
  })

  it('C2-I-053: an entry that left the stack does not disturb the entries around it', () => {
    expect(inline('/a *b {_c c/d e/ f_} {^h^} g*')).toBe('"/a " strong["b " u["c c/d e/ f"] " " sup["h"] " g"]')
    expect(inline('/a *b {_c c/d e/ {^h^} f_} g*')).toBe('"/a " strong["b " u["c c/d e/ " sup["h"] " f"] " g"]')
    expect(inline('/a *b c/d e/ {^h {,i,}^} g*')).toBe('"/a " strong["b c/d e/ " sup["h " sub["i"]] " g"]')
  })

  it('C2-I-055: the enter event tells the braced form from the bare one', () => {
    const [bare, , braced] = parseTree('*a* {*b*}').children![0]!.inlines!
    expect([bare!.flags & FLAG_BRACED, braced!.flags & FLAG_BRACED]).toEqual([0, FLAG_BRACED])
  })

  it('C2-I-067: an escaped backslash in a destination', () => {
    expect(inline('[a](\\\\))')).toBe('a(\\)["a"] ")"')
  })

  it('C2-I-068: a title stays on its line and follows a space, not a tab', () => {
    expect(inline('[a](/u "T', ')')).toBe('"[a](/u " ‹“› "T" sb ")"')
    expect(inline('[a](/u\t"T")')).toBe('"[a](/u\t" ‹“› "T" ‹”› ")"')
  })

  it('C2-I-073: the shapes next to an autolink that are none', () => {
    expect(inline('<a:\uffff>')).toBe('auto"a:\uffff"')
    expect(inline('<a>b.cd>')).toBe('"<a>b.cd>"')
    expect(inline('<a@*b.cd>')).toBe('"<a@*b.cd>"')
    expect(inline('<a@b.cd e>')).toBe('"<a@b.cd e>"')
    expect(inline('</<a:b>')).toBe('"</" auto"a:b"')
  })

  it('C2-I-076: a label that starts with an escaped bracket', () => {
    expect(inline('[a][\\]b]')).toBe('ref(\\]b)["a"]')
  })

  it('C2-I-087: behind a footnote reference that fails the caret is read as usual', () => {
    expect(inline('{^a [^}')).toBe('sup["a ["]')
  })

  it('C2-I-092: a dot at the end of the content and at the start of a name', () => {
    expect(inline('@a.b')).toBe('@"a.b"')
    expect(inline('@.a')).toBe('"@.a"')
  })

  it('C2-I-093: behind a colon that starts no form the scan goes on', () => {
    expect(inline('a:`b` :`c`')).toBe('"a:" code"b" " :" code"c"')
    expect(inline('@`b` #`c` ]`d`')).toBe('"@" code"b" " #" code"c" " ]" code"d"')
  })

  it('C2-I-096: behind a cross-reference that fails the slash is a delimiter like any other', () => {
    expect(inline('</#a b/')).toBe('"<" em[#"a" " b"]')
    expect(inline('</#> a/')).toBe('"<" em["#> a"]')
    expect(inline('</#a</#b c/')).toBe('"<" em[#"a" "<"] #"b" " c/"')
  })

  it('C2-I-103: a soft break does not take the space of a no-break space', () => {
    expect(inline('a\\ ', 'b')).toBe('"a" nbsp sb "b"')
  })

  it('C2-I-104: what a quote sees before it', () => {
    expect(inline('\\["a"')).toBe('"[" ‹“› "a" ‹”›')
    expect(inline('`(`"a"')).toBe('code"(" ‹”› "a" ‹”›')
    expect(inline('a "{%c%}"b')).toBe('"a " ‹“› {%}"c" ‹“› "b"')
  })

  it('C2-I-106: a backslash that follows the quote is a character like any other', () => {
    expect(inline('a/"\\', 'b')).toBe('"a/" ‹“› br "b"')
  })

  it('C2-I-107: the word ends where its letters end', () => {
    expect(inline("'em2 x")).toBe('‹‘› "em2 x"')
    expect(inline("'tisx y")).toBe('‹‘› "tisx y"')
  })

  it('C2-I-109: a link keeps the run of single quotes, and a footnote gives it back', () => {
    expect(inline("'a [b](/u) 'c d'")).toBe('‹‘› "a " a(/u)["b"] " " ‹’› "c d" ‹’›')
    expect(inline("x ^['a [b](/u) 'c d']")).toBe('"x " fn[‹‘› "a " a(/u)["b"] " " ‹’› "c d" ‹’›]')
  })

  it('C2-I-112: what stands before the character before a hyphen run', () => {
    expect(inline('a\\ (--b)')).toBe('"a" nbsp "(" ‹–› "b)"')
    expect(inline('*a* (--b)')).toBe('strong["a"] " (--b)"')
    expect(inline('a', '(--b)')).toBe('"a" sb "(--b)"')
    expect(inline('a \\"--b')).toBe('"a "--b"')
  })

  it('C2-I-116: a hyphen that belongs to a braced closer is no part of the run', () => {
    expect(inline('{-a---}')).toBe('del["a" ‹–›]')
    expect(inline('{-<---}')).toBe('del[‹←›]')
    expect(inline('a <-->- b')).toBe('"a " ‹↔› "- b"')
    expect(inline('{=<=}')).toBe('mark["<"]')
  })

  it('C2-I-118: what an opener past the cap leaves behind', () => {
    const deep = '{^'.repeat(MAX_DEPTH)
    const close = '^}'.repeat(MAX_DEPTH)
    const inner = (src: string): string => inline(src).slice('sup['.repeat(MAX_DEPTH).length, -']'.repeat(MAX_DEPTH).length)
    expect(inner(`${deep}[a](/u) *b* [c][d] [e]{.f}${close}`)).toBe('"[a](/u) *b* [c][d] [e]{.f}"')
    expect(inner(`${deep}^[a]\`c\` :n[b]\`d\`${close}`)).toBe('"^[a]" code"c" " :n[b]" code"d"')
    const spans = inline(`${'['.repeat(MAX_DEPTH + 1)}x${']{.c}'.repeat(MAX_DEPTH + 1)}`)
    expect(spans.slice('span['.repeat(MAX_DEPTH).length, 'span['.repeat(MAX_DEPTH).length + 9)).toBe('"[x"]{.c}')
    expect(spans.endsWith(']{.c} "]{.c}"')).toBe(true)
    expect(inline(`${'['.repeat(MAX_DEPTH)}[*a*]${']{.c}'.repeat(MAX_DEPTH)}`)).toContain('span["[[" strong["a"] "]"]{.c}')
  })
})
