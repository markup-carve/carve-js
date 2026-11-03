import { expect, it } from 'vitest'
import { migrateDjot } from '../src/index.js'

const message = 'A line break inside inline code in a definition term becomes a space; a Carve term is one line.'
const reported = (source: string): boolean => migrateDjot(source).report.diagnostics.some(d => d.message === message)

// A Carve term is one line (carve#4861), so a wrapped Djot term joins its line.
it.each([
  ': `A\n  Civil. text`',
  ': `A\r\n  Civil. text`',
  'before\n\n: `A\n  Civil. text`',
  ': x `A\nB` y',
  ': `a` `b\nc`',
  ': term text\n  `code\n  x`\n\n  body',
  '> : `A\n> B`',
  '::: box\n: `term\nword`\n:::',
  ': `A\n  B` and `C\n  # D`',
  '- : A\n   - item `x\n  y`',
  ': A\n: item `x\ny`',
])('reports the line break a joined term drops: %j', source => {
  expect(reported(source)).toBe(true)
})

it.each([
  ': Term\nCivil. text',
  ': `a`\n`b` c',
  ': `A`\n\n  `B\n  C`',
  ': `A\n  : B`',
  ': `A\n   :  B`',
  ': `A\n  : B`{.x}',
  ': `A\n```\nB`',
  ': `A\n:  B`',
  '::: box\n: \\`A\nB`\n:::',
  ': [x](a`b\n  c`d)',
  ': `C\n  # D` and B',
  ': A\n- item `x\ny`',
  ': `A\n - item `x\ny`',
])('reports nothing where the code keeps its line break or none crosses the wrap: %j', source => {
  expect(reported(source)).toBe(false)
})
