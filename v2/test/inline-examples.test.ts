// All 107 examples of the inline chapter (spec/0.2/syntax-inline.md on next2 of the spec repository), checked at the
// level of the tree. The chapter gives the expected HTML; the shapes below were derived from that
// HTML by hand. The HTML itself is compared once the renderer exists. Notation: support/shape.ts
// and support/inline-shape.ts.
//
// What the shapes do not show, because it is resolution and not parsing: whether a reference,
// a footnote reference or a cross-reference finds its definition (examples 67 to 81 and 88), and
// the abbreviation nodes of example 89. Example 81 is checked without its definition line: the
// block core does not read a footnote definition whose label holds a space yet.
import { describe, expect, it } from 'vitest'
import { checkDocument } from './support/checks.ts'
import { checkInlines } from './support/inline-checks.ts'
import { treeShape } from './support/shape.ts'

// [example number, input lines, tree shape]
const EXAMPLES: readonly (readonly [number, readonly string[], string])[] = [
  [1, ['*a', '', 'b* and `c', '', 'd`'], 'p["*a"] p["b* and " code!"c"] p["d" code!""]'],
  [2, ['> *a', '> b* c'], 'quote[p[strong["a" sb "b"] " c"]]'],
  [3, ['*a `b* c'], 'p["*a " code!"b* c"]'],
  [4, ['*a [b* c](/u)'], 'p["*a " a(/u)["b* c"]]'],
  [5, ['*a [b* c] d'], 'p[strong["a [b"] " c] d"]'],
  [6, ['\\*not strong\\* and \\# and a\\ b and \\a and C:\\dir'], 'p["*not strong* and # and a" nbsp "b and \\a and C:\\dir"]'],
  [7, ['`a\\*b` and [x](/a\\(b) and \\[not a span]{.c}'], 'p[code"a\\*b" " and " a(/a(b)["x"] " and [not a span]{.c}"]'],
  [8, ['`code` and `` a ` b `` and ` x ` and `*a*`'], 'p[code"code" " and " code"a ` b" " and " code"x" " and " code"*a*"]'],
  [9, ['a `b', 'c` d'], 'p["a " code"b|c" " d"]'],
  [10, ['see `unclosed *x* and [y](/u)'], 'p["see " code!"unclosed *x* and [y](/u)"]'],
  [11, ['!`/kaet/` and !`a<b>`{.ipa} and \\!`x`'], 'p[lit"/kaet/" " and " lit"a<b>"{.ipa} " and !" code"x"]'],
  [12, ['$`x^2` and $$`E = mc^2` and $5 and $`x`{.c}'], 'p[math"x^2" " and " dmath"E = mc^2" " and $5 and " math"x"{.c}]'],
  [13, ['the sum $`a + b'], 'p["the sum " math!"a + b"]'],
  [14, ['a `<br>`{=html} b'], 'p["a " raw(html)"<br>" " b"]'],
  [15, ['`<br>`{=html .c} and [s]{=html} and $`x`{=html}'], 'p[code"<br>" "{=html .c} and [s]{=html} and " math"x" "{=html}"]'],
  [16, ['a %% comment', 'b and 50%% and a%%b'], 'p["a" %%" comment" sb "b and 50%% and a%%b"]'],
  [17, ['*a %% b*', 'c* d'], 'p[strong["a" %%" b*" sb "c"] " d"]'],
  [18, ['[a %% b](/u) c'], 'p["[a" %%" b](/u) c"]'],
  [19, ['`a %% b` and [a](/u%%20c) and [a]{k="a %% b"}'], 'p[code"a %% b" " and " a(/u%%20c)["a"] " and " span["a"]{k="a %% b"}]'],
  [20, ['a {% one', 'two %} b and *bo{% c %}ld* and a {% oops'], 'p["a " {%}" one|two " " b and " strong["bo" {%}" c " "ld"] " and a {% oops"]'],
  [21, ['[s]{#a .b k=v} [s]{k="v w" k2=\'x\'} [s]{:en} [s]{ .a } [s]{open}'], 'p[span["s"]{#a .b k=v} " " span["s"]{k="v w" k2=x} " " span["s"]{:en} " " span["s"]{.a} " " span["s"]{open=""}]'],
  [22, ['[s]{.a.b} [s]{k=} [s]{1=2} [s]{#} word{.c} a {.b} c'], 'p["[s]{.a.b} [s]{k=} [s]{1=2} [s]{#} word{.c} a {.b} c"]'],
  [23, ['*bold*{.c} `code`{.c} <https://a.b>{.c} :note[x]{.c}'], 'p[strong["bold"]{.c} " " code"code"{.c} " " auto"https://a.b"{.c} " " ext(note)["x"]{.c}]'],
  [24, ['@user{.c} and #tag{.c}'], 'p[@"user" "{.c} and " #"tag" "{.c}"]'],
  [25, ['*a {k=*} b*'], 'p[strong["a {k=*} b"]]'],
  [26, ['a*{#b} c #}'], 'p["a*{#b} c #}"]'],
  [27, ['word{k="v"} and "v"'], 'p["word{k="v"} and " ‹“› "v" ‹”›]'],
  [28, ['[x]{#i}{.a}{.b} and [s]{#a #b} and [s]{k=1 k=2}'], 'p[span["x"]{#i .a .b} " and " span["s"]{#b} " and " span["s"]{k=2}]'],
  [29, ['[s]{.a #b k=v .c} and *a*{.c}{#d}'], 'p[span["s"]{#b .a .c k=v} " and " strong["a"]{#d .c}]'],
  [30, ['[s]{ID=x Class=y .z} and [s]{k=v :en}'], 'p[span["s"]{#x .y .z} " and " span["s"]{:en k=v}]'],
  [31, ['[s]{} and [s]{}{.b} and *a*{} and a {} b'], 'p[span["s"]{} " and " span["s"]{.b} " and " strong["a"] "{} and a {} b"]'],
  [32, ['[s]{#id} and [s]{#id#} and [s]{#id k=v#}'], 'p[span["s"]{#id} " and [s]" {#}"id" " and " span["s"]{#id k=v#}]'],
  [33, ['a {=a}b=} c and {--} and {---} and [s]{=x=}'], 'p["a " mark["a}b"] " c and " ‹–› " and " del["-"] " and [s]" mark["x"]]'],
  [34, ['a {_k=v_} b and {_a_}'], 'p["a {_k=v_} b and " u["a"]]'],
  [35, ['a {\'x\'} b and {"a": "b"}'], 'p["a {" ‹‘› "x" ‹’› "} b and {" ‹“› "a" ‹”› ": " ‹“› "b" ‹”› "}"]'],
  [36, ['/emphasis/ and *strong* and *a', 'b* and * a* and *a *'], 'p[em["emphasis"] " and " strong["strong"] " and " strong["a" sb "b"] " and * a* and *a *"]'],
  [37, ['*́a* and *a*'], 'p["*́a* and " strong["a"]]'],
  [38, ['/a /b/ c/'], 'p[em["a " em["b"] " c"]]'],
  [39, ['a_*x* and _*x*_'], 'p["a_" strong["x"] " and _" strong["x"] "_"]'],
  [40, ['/*both*/ and */both/*'], 'p[em[strong["both"]] " and " strong[em["both"]]]'],
  [41, ['**bold** and *a** and ***x*** and /b// and //x//'], 'p["**bold** and *a** and ***x*** and /b// and //x//"]'],
  [42, ['a/b testing, 2 * 3 * 4, a*b*c, x^2, $5, --flag, 50%, a = b = c'], 'p["a/b testing, 2 * 3 * 4, a*b*c, x^2, $5, --flag, 50%, a = b = c"]'],
  [43, ['x =1, y= 2 and ~/config and _id'], 'p["x =1, y= 2 and ~/config and _id"]'],
  [44, ['snake_case_name and _private and __init__ and ~5 minutes~ and a == b'], 'p["snake_case_name and _private and __init__ and ~5 minutes~ and a == b"]'],
  [45, ['the /etc/ dir and /usr/local/ and /etc/hosts/ file'], 'p["the " em["etc"] " dir and /usr/local/ and /etc/hosts/ file"]'],
  [46, ['cd /tmp/ && ls /var/'], 'p["cd " em["tmp"] " && ls " em["var"]]'],
  [47, ['glob *.js or src/* and 5 *3 and 4* 2'], 'p["glob " strong[".js or src/"] " and 5 " strong["3 and 4"] " 2"]'],
  [48, ['*a /b* c/'], 'p[strong["a /b"] " c/"]'],
  [49, ['{/x/} {*x*} {_x_} {~x~} {=x=} H{,2,}O mc{^2^} {+new+} {-old-}'], 'p[em["x"] " " strong["x"] " " u["x"] " " s["x"] " " mark["x"] " H" sub["2"] "O mc" sup["2"] " " ins["new"] " " del["old"]]'],
  [50, ['foo{*bar*}baz and {*a {/b/} c*} and {/a/b/} and {*a*}{.c}'], 'p["foo" strong["bar"] "baz and " strong["a " em["b"] " c"] " and " em["a/b"] " and " strong["a"]{.c}]'],
  [51, ['*bold {/note*/} more*'], 'p[strong["bold {/note"] "/} more*"]'],
  [52, ['*bold {/note\\*/} more*'], 'p[strong["bold " em["note*"] " more"]]'],
  [53, ['/a/} and *a*}'], 'p[em["a"] "} and " strong["a"] "}"]'],
  [54, ['{+a {*b+} c*}'], 'p[ins["a {*b"] " c*}"]'],
  [55, ['{*unclosed and *x*'], 'p["{*unclosed and " strong["x"]]'],
  [56, ['{-old-}{+new+} and {-old-}{+new+}{.k}'], 'p[del["old"] ins["new"] " and " del["old"] ins["new"]{.k}]'],
  [57, ['{~a~>b~}'], 'p[s["a~>b"]]'],
  [58, ['{# note *x* #} and {**} and {==}'], 'p[{#}" note *x* " " and {**} and {==}"]'],
  [59, ['[text]{.c} and [a /b/ c]{#i} and [text] {.c} and [text]'], 'p[span["text"]{.c} " and " span["a " em["b"] " c"]{#i} " and [text] {.c} and [text]"]'],
  [60, ['[*x*]{???} and [[t](/v)]{.c}'], 'p["[" strong["x"] "]{???} and " span[a(/v)["t"]]{.c}]'],
  [61, ['[a](/u) [a](/u "T") [a](/u \'T\') [a]() [a](/u(1)) [*b*](/u)'], 'p[a(/u)["a"] " " a(/u "T")["a"] " " a(/u "T")["a"] " " a()["a"] " " a(/u(1))["a"] " " a(/u)[strong["b"]]]'],
  [62, ['[a](/u v) and [a](/u "T) and [a](/u', 'v)'], 'p["[a](/u v) and [a](/u " ‹“› "T) and [a](/u" sb "v)"]'],
  [63, ['[a', 'b](/u) and [[x](/y)](/z)'], 'p[a(/u)["a" sb "b"] " and " a(/z)[a(/y)["x"]]]'],
  [64, ['a](b *c) d*'], 'p["a](b " strong["c) d"]]'],
  [65, ['<https://example.com/a_b?c=*d*> and <a@b.com> and <a@b> and <not a link>'], 'p[auto"https://example.com/a_b?c=*d*" " and " mail"a@b.com" " and <a@b> and <not a link>"]'],
  [66, ['![alt](/i.png) and ![*alt*](/i.png "T"){.c} and a ![x] b'], 'p[img(/i.png)"alt" " and " img(/i.png "T")"*alt*"{.c} " and a ![x] b"]'],
  [67, ['[text][ref] and [ref][] and [ref] and ![img][ref]', '', '[ref]: /u "T"'], 'p[ref(ref)["text"] " and " ref(=ref)["ref"] " and [ref] and " imgref(ref)"img"] def"[ref]: /u "T""'],
  [68, ['[text][nope] and [nope][] and [a][nope]{.c}'], 'p[ref(nope)["text"] " and " ref(=nope)["nope"] " and " ref(nope)["a"]{.c}]'],
  [69, ['[*a*][nope] and [a ^[n] b][nope]'], 'p[ref(nope)[strong["a"]] " and " ref(nope)["a " fn["n"] " b"]]'],
  [70, ['[x][foo  bar] and [x][Foo]', '', '[foo bar]: /u'], 'p[ref(foo bar)["x"] " and " ref(Foo)["x"]] def"[foo bar]: /u"'],
  [71, ['# The Title', '', '[The Title][] and [the title][]'], 'h1["The Title"] p[ref(=The Title)["The Title"] " and " ref(=the title)["the title"]]'],
  [72, ['# The Title', '', '[go][The Title]'], 'h1["The Title"] p[ref(The Title)["go"]]'],
  [73, ['# The Title', '', '![x][The Title]'], 'h1["The Title"] img[imgref(The Title)"x"]'],
  [74, ['[a][r] and [b][r]{.own k=2}', '', '{.def k=1}', '[r]: /u'], 'p[ref(r)["a"] " and " ref(r)["b"]{.own k=2}] {.def k=1}def"[r]: /u"'],
  [75, ['[a][no', 'pe]{.c #i}'], 'p[ref(no pe)["a"]{#i .c}]'],
  [76, ['# A *bold* title', '', '[A *bold* title][] and [A bold title][]'], 'h1["A " strong["bold"] " title"] p[ref(=A *bold* title)["A " strong["bold"] " title"] " and " ref(=A bold title)["A bold title"]]'],
  [77, ['[*foo*', 'bar][] and [x][foo', 'bar]', '', '[*foo* bar]: /u', '', '[foo bar]: /v'], 'p[ref(=*foo* bar)[strong["foo"] sb "bar"] " and " ref(foo bar)["x"]] def"[*foo* bar]: /u" def"[foo bar]: /v"'],
  [78, ['[x][a %% b]'], 'p["[x][a" %%" b]"]'],
  [79, ['[x][a\\]b]', '', '[a\\]b]: /u'], 'p[ref(a\\]b)["x"]] def"[a\\]b]: /u"'],
  [80, ['a[^n] and b[^missing] and c^[inline *note*] and d^[unclosed', '', '[^n]: The note.'], 'p["a" fnref"n" " and b" fnref"missing" " and c" fn["inline " strong["note"]] " and d^[unclosed"] fn[p["The note."]]'],
  [81, ['a[^my', 'note] b'], 'p["a" fnref"my note" " b"]'],
  [82, ['@user and (@user.name). and mail a@b.com and x@user'], 'p[@"user" " and (" @"user.name" "). and mail a@b.com and x@user"]'],
  [83, ['color #fff, issue #123, C# and #tag/sub and #release-1.0.'], 'p["color " #"fff" ", issue #123, C# and " #"tag" "/sub and " #"release-1.0" "."]'],
  [84, ['at 10:30:00 and :+1: and :-: and :a b: and :note[a *b* c] and :1note[t] and :note[a'], 'p["at 10:30:00 and " sym"+1" " and :-: and :a b: and " ext(note)["a " strong["b"] " c"] " and :1note[t] and :note[a"]'],
  [85, ['{-@user-} and @user-name and #tag- x'], 'p[del[@"user"] " and " @"user-name" " and " #"tag" "- x"]'],
  [86, ['see config:items[0]'], 'p["see config:items[0]"]'],
  [87, ['é@user and _@user'], 'p["é@user and _" @"user"]'],
  [88, ['{#intro}', '# Intro', '', 'See </#intro> and </#Intro> and </#intro>{.c}'], '{#intro}h1["Intro"] p["See " xref"intro" " and " xref"Intro" " and " xref"intro" "{.c}"]'],
  [89, ['The HTML spec and HTMLs and XHTML and *HTML* and `HTML` and [HTML](/u).', '', '*[HTML]: Hypertext Markup Language'], 'p["The HTML spec and HTMLs and XHTML and " strong["HTML"] " and " code"HTML" " and " a(/u)["HTML"] "."] abbr"*[HTML]: Hypertext Markup Language"'],
  [90, ['See [@doe2020] and [see @doe2020, p. 3; @roe].'], 'p["See [" @"doe2020" "] and [see " @"doe2020" ", p. 3; " @"roe" "]."]'],
  [91, ['a\\', 'b'], 'p["a" br "b"]'],
  [92, ['line one', '  line two', 'line three'], 'p["line one" sb "line two" sb "line three"]'],
  [93, ['| a\\ | b |'], 'table[tr[td["a" br] td["b"]]]'],
  [94, ['"double" and \'single\' and it\'s and \'90s and "\'nested\'"'], 'p[‹“› "double" ‹”› " and " ‹‘› "single" ‹’› " and it" ‹’› "s and " ‹’› "90s and " ‹“› ‹‘› "nested" ‹’› ‹”›]'],
  [95, ['\'tis the season and \'em\' and rock \'n\' roll and \'I told \'em so,\' he said.'], 'p[‹’› "tis the season and " ‹‘› "em" ‹’› " and rock " ‹‘› "n" ‹’› " roll and " ‹‘› "I told " ‹’› "em so," ‹’› " he said."]'],
  [96, ['"Wait---" he said and he said---"Go" and "app/config/". and and/"or"'], 'p[‹“› "Wait" ‹—› ‹”› " he said and he said" ‹—› ‹“› "Go" ‹”› " and " ‹“› "app/config/" ‹”› ". and and/" ‹“› "or" ‹”›]'],
  [97, ['\'I said \'yes\' twice\' and \'one\' \'two\''], 'p[‹‘› "I said " ‹’› "yes" ‹’› " twice" ‹’› " and " ‹‘› "one" ‹’› " " ‹‘› "two" ‹’›]'],
  [98, ['say \'word'], 'p["say " ‹‘› "word"]'],
  [99, ['pages 1--10 and a---b and a----b and git log --oneline and x --- y'], 'p["pages 1" ‹–› "10 and a" ‹—› "b and a" ‹–› ‹–› "b and git log --oneline and x " ‹—› " y"]'],
  [100, ['a--->b and a<---b and a --> b'], 'p["a" ‹—› ">b and a<" ‹—› "b and a " ‹→› " b"]'],
  [101, ['x {--}y and wait... really and a --> b <-- c <--> d ==> e <== f <=> g'], 'p["x " ‹–› "y and wait" ‹…› " really and a " ‹→› " b " ‹←› " c " ‹↔› " d " ‹⇒› " e " ‹⇐› " f " ‹⇔› " g"]'],
  [102, ['a != b, a <= b, a >= b, 5 +- 1, Carve(tm), (c), x -> y, k => v'], 'p["a " ‹≠› " b, a " ‹≤› " b, a " ‹≥› " b, 5 " ‹±› " 1, Carve" ‹™› ", (c), x -> y, k => v"]'],
  [103, ['\\"straight\\" and `"code"` and [a](/u "it\'s")'], 'p[""straight" and " code""code"" " and " a(/u "it\'s")["a"]]'],
  [104, [`${'{^'.repeat(201)}x${'^}'.repeat(201)}`], `p[${'sup['.repeat(200)}"{^x"${']'.repeat(200)} "^}"]`],
  [105, ['[open and (x and {*y and {% z and ^[w and :ext[v and <http://u'], 'p["[open and (x and {*y and {% z and ^[w and :ext[v and <http://u"]'],
  [106, ['later markup still works: [a and *b* and {=c and `d`'], 'p["later markup still works: [a and " strong["b"] " and {=c and " code"d"]'],
  [107, ['$$`E = mc^2`', '', 'text $$`E = mc^2`'], 'math[dmath"E = mc^2"] p["text " dmath"E = mc^2"]'],
]

describe('examples of the inline chapter', () => {
  it('the table holds every example once', () => {
    expect(EXAMPLES.map((example) => example[0])).toEqual(Array.from({ length: 107 }, (_, index) => index + 1))
  })

  for (const [number, lines, expected] of EXAMPLES) {
    it(`example ${number}`, () => {
      const src = lines.join('\n')
      expect(treeShape(src)).toBe(expected)
      expect(checkDocument(src)).toBeNull()
      expect(checkInlines(src)).toBeNull()
    })
  }
})
