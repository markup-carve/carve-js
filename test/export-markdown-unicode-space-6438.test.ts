import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.ts'
import { toMarkdown } from '../src/export/index.ts'

describe('Markdown export keeps a non-ASCII space at the end of a block (carve#6438)', () => {
  it.each([
    ['A trailing no-break space ', 'A trailing no-break space \n'],
    ['- a \n- b', '- a \n- b\n'],
    ['# a ', '# a \n'],
    [' ﻿ ', '﻿\n'],
    ['> q　', '> q　\n'],
    ['x[^1]\n\n[^1]: n ', 'x[^1]\n\n[^1]: n \n'],
    ['a  \n\nb', 'a\n\nb\n'],
  ])('exports %j', (source, markdown) => {
    expect(toMarkdown(parse(source)).output).toBe(markdown)
  })
})
