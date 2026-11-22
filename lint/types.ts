import { type Node } from '../src/ast.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { type NodeLayout } from '../src/layout.ts'
import { type RuleId } from './catalog.ts'
import { type DataWalk } from './data-model.ts'
import { type ExtensionDefinition } from '../src/extensions/types.ts'
import { type HeadingIds } from '../src/options.ts'
import { type ResolvedTree } from '../src/api.ts'

export interface LintOptions {
  rules?: Partial<Record<RuleId, 'on' | 'off'>>
  platforms?: readonly 'github'[]
  /** C2-N-085: a resolver, or the `includes` option of a parse, through which the included files are linted too. */
  includes?: unknown
  extensions?: readonly ExtensionDefinition[]
  headingIds?: HeadingIds
}

export interface Line {
  text: string
  start: number
  end: number
  number: number
  path: string
  opaque: boolean
  paragraph: boolean
  paragraphLeaf: boolean
  /** Where the text of the line's leaf block starts, behind every container prefix. */
  content?: number
}

export interface LintContext {
  source: string
  bytes: Uint32Array
  chars: Uint32Array
  offsetLines: Uint32Array
  leafMask: Uint8Array
  lines: Line[]
  layouts: Map<string, NodeLayout>
  nodeTypes: Map<string, Node['type']>
  nodeRules: Map<Node['type'], Rule[]>
  options: LintOptions
  diagnostics: Diagnostic[]
  findingLines: number[]
  /** The records of the data rules, filled during the visit when they are on. */
  dataWalk?: DataWalk
  /** The resolved tree of the parse, which the id records render (C2-W-150). */
  resolved?: ResolvedTree
  state: {
    headingLevel: number
    headingKinds: Set<string>
    mixedReported: boolean
    firstHeading: { range: [number, number], path: string } | null
    referenceUrls: Set<string>
    footnoteKeys: Map<string, string>
    attachedLines: Set<number>
    containerClosers: Set<number>
    usedReferences: Set<string>
    usedFootnotes: Set<string>
    footnoteDefinitions: { node: Node, path: string }[]
  }
  report: (id: RuleId, start: number, end: number, path: string, values?: Record<string, string>, message?: number) => void
}

export interface Rule {
  id: RuleId
  lines?: boolean
  nodes?: readonly Node['type'][]
  checkLine?: (line: Line, context: LintContext) => void
  checkNode?: (node: Node, path: string, context: LintContext) => void
}
