import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

for (const [name, marker] of [
  ['roundtrip-export-acceptance-fixtures.json', 'nested-definition-list-flattened'],
  ['render-loss-report.schema.json', 'definition-list-flattened'],
]) {
  test(`ahead-of-pin resource: ${name}`, () => {
    expect(readFileSync(new URL(`fixtures/ahead-of-pin/${name}`, import.meta.url), 'utf8')).toContain(marker)
    expect(readFileSync(new URL(`../spec/resources/${name}`, import.meta.url), 'utf8'),
      'the pinned spec now holds this resource: delete the vendored copy and this entry').not.toContain(marker)
  })
}
