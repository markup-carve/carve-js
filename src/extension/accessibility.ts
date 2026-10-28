import { filterLintWarnings, codepointToUtf16Map, type LintWarning } from '../lint.js'
import { parse } from '../parse.js'

export interface AccessibilityDiagnostic {
  rule: 'a11y/image-alt' | 'heading-level-skip'
  severity: 'warning' | 'error'
  message: string
  startOffset: number | undefined
  endOffset: number | undefined
}

interface PositionedNode {
  type?: unknown
  level?: unknown
  alt?: unknown
  pos?: { startOffset?: number; endOffset?: number; startLine?: number; startColumn?: number }
}

export function lintAccessibility(source: string): AccessibilityDiagnostic[] {
  const document = parse(source, { positions: true })
  const diagnostics: Array<AccessibilityDiagnostic & LintWarning> = []
  const offsets = codepointToUtf16Map(source)
  const location = (node: PositionedNode): Pick<LintWarning, 'line' | 'column' | 'start' | 'end'> => ({
    line: node.pos?.startLine ?? 1, column: node.pos?.startColumn ?? 1,
    start: offsets?.[node.pos?.startOffset ?? 0] ?? node.pos?.startOffset ?? 0,
    end: offsets?.[node.pos?.endOffset ?? 0] ?? node.pos?.endOffset ?? 0,
  })
  let previousHeading: number | undefined
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const node = value as PositionedNode
    if (node.type === 'image' && node.alt === '') {
      diagnostics.push({
        ...location(node),
        rule: 'a11y/image-alt',
        severity: 'error',
        message: 'image has empty alternative text and is not marked decorative',
        startOffset: node.pos?.startOffset,
        endOffset: node.pos?.endOffset,
      })
    }
    if (node.type === 'heading' && typeof node.level === 'number') {
      if (previousHeading !== undefined && node.level > previousHeading + 1) {
        diagnostics.push({
          ...location(node),
          rule: 'heading-level-skip',
          severity: 'warning',
          message: `heading level jumps from ${previousHeading} to ${node.level}`,
          startOffset: node.pos?.startOffset,
          endOffset: node.pos?.endOffset,
        })
      }
      previousHeading = node.level
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'pos' && (Array.isArray(child) || (typeof child === 'object' && child !== null))) {
        visit(child)
      }
    }
  }
  visit(document.children)
  return filterLintWarnings(source, diagnostics).map(({ rule, severity, message, startOffset, endOffset }) =>
    ({ rule, severity, message, startOffset, endOffset }))
}
