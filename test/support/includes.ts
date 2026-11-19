// A resolver over virtual files for the include tests: each name is its own id (spec/0.2/includes.md, conventions).
import { CORPUS_EXAMPLES, fileContent } from '../../scripts/corpus.ts'
import { type IncludeAnswer, type IncludeConfig, type IncludeRequest } from '../../src/include-settings.ts'

export interface IncludeExample {
  number: number
  files: Record<string, string | Uint8Array>
  input: string
  html: string | null
  tree: unknown
}

/** The examples of includes.md in the conformance corpus, each with the files its resolver serves. */
const CORPUS_INCLUDES = CORPUS_EXAMPLES.filter((example) => example.kind === 'include')

export const INCLUDE_EXAMPLES: readonly IncludeExample[] = CORPUS_INCLUDES.map((example) => ({
  number: example.number,
  files: Object.fromEntries(Object.entries(example.files ?? {}).map(([name, file]) => [name, fileContent(file)])),
  input: example.input ?? '',
  html: example.expected.html ?? null,
  tree: example.expected.tree ?? null,
}))

export function includeExample(number: number): IncludeExample {
  const example = INCLUDE_EXAMPLES.find((entry) => entry.number === number)
  if (example === undefined) throw new Error(`no include example ${number}`)
  return example
}

/** Serves `files` under their names. A name with a `/` resolves against the directory of the including file. */
export function virtualResolver(files: Readonly<Record<string, string | Uint8Array>>, calls: IncludeRequest[] = []) {
  return (request: IncludeRequest): IncludeAnswer => {
    calls.push(request)
    const text = Object.hasOwn(files, request.path) ? files[request.path] : undefined
    return text === undefined ? { error: 'not_found' } : { text, id: request.path }
  }
}

export function includes(files: Readonly<Record<string, string | Uint8Array>>, more: Partial<IncludeConfig> = {}): IncludeConfig {
  return { resolver: virtualResolver(files), ...more }
}

/** The tree as JSON without `pos`, as the examples leave positions out. */
export function withoutPositions(node: unknown): unknown {
  return JSON.parse(JSON.stringify(node, (key, value: unknown) => (key === 'pos' ? undefined : value)))
}
