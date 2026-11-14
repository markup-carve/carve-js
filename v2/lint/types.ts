import { type Node } from '../src/ast.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { type NodeLayout } from '../src/layout.ts'
import { type RuleId } from './catalog.ts'

export interface LintOptions {
  rules?: Partial<Record<RuleId, 'on' | 'off'>>
  platforms?: readonly 'github'[]
}

export interface Line {
  text: string
  start: number
  end: number
  number: number
  path: string
  opaque: boolean
  paragraph: boolean
}

export interface LintContext {
  source: string
  bytes: Uint32Array
  chars: Uint32Array
  offsetLines: Uint32Array
  lines: Line[]
  layouts: Map<string, NodeLayout>
  nodeTypes: Map<string, Node['type']>
  options: LintOptions
  diagnostics: Diagnostic[]
  findingLines: number[]
  state: {
    headingLevel: number
    headingKinds: Set<string>
    mixedReported: boolean
    referenceUrls: Set<string>
    ids: Set<string>
    fragmentLinks: { node: Node, path: string }[]
    footnoteLabels: Map<string, string>
    attachedLines: Set<number>
    usedReferences: Set<string>
    usedFootnotes: Set<string>
    referenceDefinitions: { node: Node, path: string }[]
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
