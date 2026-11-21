// The render examples of the specification, read from the conformance corpus (scripts/corpus.ts).
import { type RenderOptions } from '../../src/index.ts'
import { EXAMPLES, type SpecExample } from '../../scripts/corpus.ts'

export { EXAMPLES, type SpecExample }

/** The options the flags of an example set, by the names of `data/options.json`. */
export function exampleOptions(example: SpecExample): RenderOptions {
  return example.options
}
