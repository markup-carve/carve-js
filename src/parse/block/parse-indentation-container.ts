import { Lexer, indentColumns, isBlankLine } from '../parse-lexer.js'
import { sourceColumn } from './parse-block-boundaries.js'

export type ContainerHost = 'list' | 'description' | 'footnote'

export interface ContainerAdmission {
  host: ContainerHost
  line: string
  lineNumber: number
  sourceLine: string
  sourceColumn: number
  markerColumn: number
  contentColumn: number
  kind: 'blank' | 'content' | 'below' | 'outside'
  precedingBlanks: readonly number[]
}

/** Blanks admitted by a host but not yet assigned to its next block. */
export class ContainerBlankBuffer {
  count = 0
  lineNumbers: number[] = []
  lines: string[] = []

  add(line: string, lineNumber: number): void {
    this.count++
    this.lineNumbers.push(lineNumber)
    this.lines.push(line)
  }

  clear(): void {
    this.count = 0
    this.lineNumbers = []
    this.lines = []
  }
}

/** Look past buffered blank lines; a host may also treat another line as deferred. */
export function nextContainerContent(
  lexer: Lexer,
  deferred: (offset: number) => boolean = () => false,
): { offset: number; line: string | undefined } {
  let offset = 1
  while (true) {
    const line = lexer.peek(offset)
    if (line === undefined || (!isBlankLine(line) && !deferred(offset))) return { offset, line }
    offset++
  }
}

export function runIndentationContainer(
  lexer: Lexer,
  host: ContainerHost,
  markerColumn: number,
  contentColumn: number,
  quoteDepth: number,
  onAdmission: (admission: ContainerAdmission) => 'continue' | 'stop',
): void {
  let precedingBlanks: number[] = []
  while (!lexer.eof()) {
    const index = lexer.pos
    const line = lexer.peek()!
    const lineNumber = lexer.lineNumber(index)
    const sourceLine = (lexer.rootLines ?? lexer.lines)[lineNumber - 1] ?? line
    const physicalColumn = sourceColumn(sourceLine, quoteDepth)
    const kind = isBlankLine(line) ? 'blank'
      : indentColumns(line, contentColumn) >= contentColumn ? 'content'
        : physicalColumn < markerColumn ? 'outside' : 'below'
    const action = onAdmission({
      host, line, lineNumber, sourceLine, sourceColumn: physicalColumn,
      markerColumn, contentColumn, kind, precedingBlanks,
    })
    if (action === 'stop') break
    if (lexer.pos <= index) throw new Error(`container collector did not advance at line ${lineNumber}`)
    if (kind === 'blank') precedingBlanks.push(lineNumber)
    else precedingBlanks = []
  }
}
