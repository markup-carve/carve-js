import { expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'
import { parse } from '../src/parse.js'

const emphasis = (source: string) => lintCarve(source).filter(warning => warning.rule === 'unclosed-inline-emphasis')

it('does not scan parsed image alt text for unmatched emphasis', () => {
  const alts = ['x *y', 'x /y', 'x *y z', 'x /y z', 'a [b *c]', 'a [b /c]', 'x ![b *c]', 'x ![b /c]', '*a', '/a']
  const siblings = [
    (image: string) => `before ${image} after`,
    (image: string) => `${image} after`,
    (image: string) => `before ${image}`,
    (image: string) => `before [label ${image}](/link) after`,
    (image: string) => `before ${image} and ![other *alt](/second) after`,
  ]
  const containers = [
    (line: string) => `${line}\n`,
    (line: string) => `> ${line}\n`,
    (line: string) => `- ${line}\n`,
    (line: string) => `> - ${line}\n`,
    (line: string) => `::: note\n${line}\n:::\n`,
  ]
  let variants = 0
  for (const alt of alts) {
    for (const sibling of siblings) {
      for (const container of containers) {
        for (let shift = 0; shift < 4; shift++) {
          const source = container(`${' '.repeat(shift)}${sibling(`![${alt}](/image)`)}`)
          expect(JSON.stringify(parse(source)), source).toContain('"type":"image"')
          expect(emphasis(source), source).toEqual([])
          variants++
        }
      }
    }
  }
  expect(variants).toBe(1_000)
})

it('still reports an unmatched opener in link text or beside an image', () => {
  expect(emphasis('[label *open](/link)')).toHaveLength(1)
  expect(emphasis('![x *alt](/image) then *open')).toHaveLength(1)
})

it('masks the parsed span of a resolved reference image', () => {
  const source = 'before ![x *alt][photo] after\n\n[photo]: /image\n'
  expect(JSON.stringify(parse(source))).toContain('"type":"image"')
  expect(emphasis(source)).toEqual([])
})
