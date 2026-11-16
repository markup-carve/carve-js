// A resolver over virtual files for the include tests: each name is its own id (spec/0.2/includes.md, conventions).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Node } from '../../src/ast.ts'
import { type IncludeAnswer, type IncludeConfig, type IncludeRequest } from '../../src/include-settings.ts'
import { type RenderOptions } from '../../src/options.ts'

export interface IncludeExample {
  number: number
  flags: string[]
  files: Record<string, string>
  input: string
  html: string | null
  tree: unknown
}

export const INCLUDE_EXAMPLES: readonly IncludeExample[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../data/include-examples.json'), 'utf8'),
) as IncludeExample[]

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

/** The options an example names beside its number. */
export function exampleOptions(example: IncludeExample): RenderOptions {
  const config = includes(example.files)
  const options: RenderOptions = { includes: config }
  for (const flag of example.flags) {
    if (flag === 'with the depth limit lowered to 1') config.depth = 1
    else if (flag === 'sourceLines on') options.sourceLines = true
    else if (flag === 'profile set to comment') options.profile = 'comment'
    else throw new Error(`unknown flag ${flag}`)
  }
  return options
}

/** The tree as JSON without `pos`, as the examples leave positions out. */
export function withoutPositions(node: Node): unknown {
  return JSON.parse(JSON.stringify(node, (key, value: unknown) => (key === 'pos' ? undefined : value)))
}
