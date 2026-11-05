import { expect, it } from 'vitest'
import { lintCarve } from '../src/index.js'

it('reports a colon fence whose only later colon run is indented past its owner', () => {
  const source = '::: note\nx\n\n    :::\n'
  expect(lintCarve(source).filter(warning => warning.rule === 'unclosed-container-fence')).toMatchObject([
    { line: 1, column: 1, start: 0, end: 3 },
  ])
})

for (const opener of ['::: note', '::: tip', '::: box', ':::: note', ':::: box']) {
  for (const indent of ['    ', '     ', '      ', '\t']) {
    const width = opener.match(/^:+/)![0]
    it(`reports an indented apparent closer for ${opener} with ${JSON.stringify(indent)}`, () => {
      const source = `${opener}\nbody\n\n${indent}${width}\n`
      expect(lintCarve(source).filter(warning => warning.rule === 'unclosed-container-fence')).toMatchObject([
        { line: 1, column: 1, start: 0, end: width.length },
      ])
    })
  }
}

