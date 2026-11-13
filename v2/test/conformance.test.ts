// Every example of the 0.2 specification, rendered and compared with its expected HTML byte for
// byte. An example passes or has a written verdict in support/conformance.ts.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { examplesOf } from '../scripts/extract-examples.ts'
import { conformance, exampleId, EXAMPLES, renderExample, VERDICTS } from './support/conformance.ts'

describe('the examples of the specification', () => {
  const report = conformance()

  it('there are 356 examples: 226 of the block chapter, 107 of the inline chapter and 23 of the HTML document', () => {
    expect(report.all.total).toBe(356)
    expect([...report.byFile].map(([file, tally]) => [file, tally.total])).toEqual([
      ['syntax-blocks.md', 226], ['syntax-inline.md', 107], ['html.md', 23],
    ])
  })

  it('every example passes or has a verdict, and every verdict names an example that fails', () => {
    expect(report.failures).toEqual([...VERDICTS.keys()])
  })

  for (const example of EXAMPLES) {
    if (VERDICTS.has(exampleId(example))) continue
    it(`${exampleId(example)} (${example.label})`, () => {
      expect(renderExample(example)).toBe(example.html)
    })
  }
})

// The spec checkout is the `spec` submodule, or the directory CARVE_SPEC_DIR names. Until its pin
// holds the 0.2 documents the comparison is skipped.
const spec = join(process.env['CARVE_SPEC_DIR'] ?? join(import.meta.dirname, '../../spec'), 'spec/0.2')
const specPresent = existsSync(join(spec, 'html.md'))

it.skipIf(!specPresent)(
  specPresent ? 'data/examples.json holds the examples of the spec documents' : `no spec documents at ${spec}: comparison skipped`,
  () => {
    const files = ['syntax-blocks.md', 'syntax-inline.md', 'html.md', 'ast.md']
    expect(EXAMPLES).toEqual(files.flatMap((file) => examplesOf(file, readFileSync(join(spec, file), 'utf8'))))
  },
)
