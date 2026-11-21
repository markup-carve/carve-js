// Fourth replay pass (markup-carve/carve#6183, #6181): generated-pack sources that the last late variant repairs.
import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

const written: [string, string, string][] = [
  // An inserted blank line stands above an escape inserted at the same line start.
  ['U-106 U-104', ':: c\n::: t:: note\nbody\n:::\n',
    ':: c\n\n\\::: t:: note\nbody\n:::\n'],
  ['U-106 U-104', ':: a\n::: note: b\n\n  :: c\n  %% note\n\t\n  more\n',
    ':: a\n\n\\::: note: b\n\n  :: c\n  %% note\n\t\n  more\n'],
  ['U-106 U-065', ':: t\n_u_\n:  [^q]: noe\n    *x y child\ntail\n',
    ':: t\n\n{_u_}\n:  [^q]: noe\n    *x y child\ntail\n'],
  // C2-I-111 does not reach a line 0.2 writes as an include directive.
  ['U-011', '{{ dat---a/p2.csv @code:csv @lines:01-2 }}\n',
    '{{ dat---a/p2.csv @code:csv @lines:01-2 }}\n'],
  // A span mark after the cells a plus row formed joins in both versions (C2-B-173, C2-B-174).
  ['U-259', '| a | < |\n+ x | y |\n',
    '| a | < |\n+ x | y |\n'],
  ['U-259', '| ^--- | < |\n+ x | y |\n',
    '| ^--- | < |\n+ x | y |\n'],
  ['U-005 U-017 U-259', '| ^ | c |\n| < | d |\n- foo\n  - +\n  - +\n  + x\n[^f]: t\n',
    '|  | c |\n|  | d |\n- foo\n  - {%%}\n  - + x\n\n[^f]: t\n'],
  // The next item of the same list needs no blank line after an emptied item.
  ['U-017', '- foo\n  - +\n  - +\n  + x\n',
    '- foo\n  - {%%}\n  - + x\n'],
  // U-016 keeps the quote marks a line already has and the indent of a quote inside an item.
  ['U-016', '> > q\n> +\n > para\n\n',
    '> > q\n>\n > para\n\n'],
  ['U-016', '> - a\n>   b\n> +\n>  para\n',
    '> - a\n>   b\n>\n> para\n'],
  ['U-002 U-016', '\n- a\n  > q\n  > q\n  +\n  para\n',
    '\n- a\n\n  > q\n  > q\n  >\n  > para\n'],
  // A definition that 0.1 read as the only content of a quote inside a quote leaves the empty quote.
  ['U-038', '> :: t\n> : d\n> >   [^f]: n\n > tai\n',
    '> :: t\n> : d\n>\n> >\n\n[^f]: n\ntai\n'],
  ['U-004 U-038', '> : d\n> :: t\n>  >  [r]: /u\n\ntail\n',
    '> : d\n>\n> :: t\n>\n>  >\n\n[r]: /u\n\ntail\n'],
  // A block after a description list moves to the list's column with the blank line (C2-B-067).
  ['U-001', '\n> :: t\n> :  d\n>   # H\ntail\n\n',
    '\n> :: t\n> :  d\n>\n> # H\ntail\n\n'],
  ['U-003 U-180', ':: t\n :  d\n   {.k}\n   # H\n',
    ' :: t\n :  d\n\n{.k}\n# H\n'],
  // A plus line that ends an item becomes a blank line.
  ['U-014 U-109', '-  a\n+  \n b\n\nx\n',
    '-  a\n\nb\n\nx\n'],
  // A joined attribute block is detached from its block over a comment line.
  ['U-032 U-031', '{.a\n\t.b}\n%%\n\nparagraph\n',
    '{.a .b}\n%%\nparagraph\n'],
  // U-109 also reads a footnote body whose last block is a quote.
  ['U-002 U-109', '[^n]: intro\n  > quote\n    ordinary line\n\n see[^n]\n',
    '[^n]: intro\n\n  > quote\n    ordinary line\n\nsee[^n]\n'],
  // A glued attribute block that 0.1 wrote as text after a substitution stays text.
  ['U-069', '{~a~>b~}{.k} c\n{~a~>b~}{.k} c\n\n{#note#}{.k} c\n',
    '{-a-}{+b+}\\{.k} c\n{-a-}{+b+}\\{.k} c\n\n{#note#}{.k} c\n'],
  // A term on the marker line of a later item needs no blank line (C2-B-015).
  ['U-008', '- para\n- :: t\n  : para\n  - li\n',
    '- para\n- :: t\n  : para\n\n  - li\n'],
  [' ', ' - :: term\n-   : body\n- \n    text\n@user\n',
    ' - :: term\n-   : body\n- \n    text\n@user\n'],
  // U-435 also moves a block that stands after a blank line below a description.
  ['U-009 U-435', '- intro\n   :: term\n   : body\n \n    text\n',
    '- intro\n\n   :: term\n   : body\n \n   text\n'],
  // A quoted `+` line that ends its quote attaches nothing.
  ['U-002 U-014', '>- ```\n> - s\n> +\n',
    '>- ```\n\n> - s\n'],
  // U-430 reads the line of the difference where the rewrite's added lines moved it.
  ['U-038 U-430', '- a\n  [^f]: note\n    more\n\ntail\nsee[^    -  xf]\n',
    '- a\n\n[^f]: note\n  more\n\ntail\nsee\\[^    -  xf]\n'],
]

describe('the replay repairs', () => {
  it.each(written)('%s writes %j as %j', (rows, source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(canWriteUpgrade(result)).toBe(true)
    for (const id of rows.trim().split(' ').filter(Boolean)) {
      if (source !== output) expect(result.records.some((record) => record.entry === id)).toBe(true)
    }
  })
})
