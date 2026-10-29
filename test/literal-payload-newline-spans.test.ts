import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

type Placed = { type?: string; pos?: { endOffset?: number; endLine?: number; endColumn?: number }; children?: unknown[]; items?: unknown[] }

function lastOfType(source: string, type: string): Placed | undefined {
  let last: Placed | undefined
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Placed
    if (node.type === type && (node.pos?.endOffset ?? -1) > (last?.pos?.endOffset ?? -1)) last = node
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'pos') visit(child)
    }
  }
  visit(parse(source))
  return last
}

const corpusCases: Array<[string, string, number]> = [
  ['291-a-fence-keeps-the-blank-line-at-the-end-of-its-content-5', 'code_block', 9],
  ['291-a-fence-keeps-the-blank-line-at-the-end-of-its-content-6', 'code_block', 11],
  ['365-a-blank-line-before-a-sibling-marker-separates-the-items-whatever-consumed-it-2', 'code_block', 11],
  ['365-a-blank-line-before-a-sibling-marker-separates-the-items-whatever-consumed-it-3', 'code_block', 15],
  ['366-a-raw-block-keeps-the-blank-line-at-the-end-of-its-payload-too-2', 'raw_block', 16],
  ['521-a-zero-line-and-a-one-blank-raw-payload-are-not-the-same-block-8', 'raw_block', 19],
  ['521-a-zero-line-and-a-one-blank-raw-payload-are-not-the-same-block-8', 'block_quote', 19],
  ['619-a-fence-run-that-dedents-out-of-a-child-keeps-the-outer-item-tight-10', 'code_block', 39],
  ['620-generated-container-documents-21', 'code_block', 15],
  ['626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-8', 'code_block', 25],
  ['638-nested-plus-below-fence-and-description-2', 'code_block', 19],
  ['638-nested-plus-below-fence-and-description', 'code_block', 9],
]

describe('interior literal payload LF spans', () => {
  it.each(corpusCases)('%s %s ends after its final payload LF', (slug, type, end) => {
    const source = readFileSync(new URL(`../spec/tests/corpus/${slug}.crv`, import.meta.url), 'utf8')
    expect(lastOfType(source, type)?.pos?.endOffset).toBe(end)
    expect(source[end - 1]).toBe('\n')
  })

  it.each([
    ['closed code fence', '```\nx\n```\n', 'code_block', 9],
    ['closed raw fence', '```=html\nx\n```\n', 'raw_block', 14],
    ['unclosed code without final LF', '```\nx', 'code_block', 5],
    ['unclosed raw without final LF', '```=html\nx', 'raw_block', 10],
    ['terminal code blank at EOF', '```\nx\n\n', 'code_block', 6],
    ['terminal raw blank at EOF', '```=html\nx\n\n', 'raw_block', 11],
    ['unclosed code in a div at EOF', '::: note\n```\nx\n\n:::\n', 'code_block', 19],
    ['container blank with trailing space', '> ```\n> \n\noutside\n', 'code_block', 8],
  ] as const)('%s retains its existing bound', (_name, source, type, end) => {
    expect(lastOfType(source, type)?.pos?.endOffset).toBe(end)
  })

  it('counts both bytes of an interior CRLF payload break', () => {
    const node = lastOfType('> ```=html\r\n>\r\n\r\nb\r\n', 'raw_block')
    expect(node?.pos).toMatchObject({ endOffset: 15, endLine: 3, endColumn: 1 })
  })

  it('checks each independent leaf once at two sizes', () => {
    const measure = (count: number): number => {
      layoutWork.reset()
      layoutWork.on = true
      try {
        parse('```\nx\n\n```\n\n'.repeat(count))
        return layoutWork.literalSpanDecisions
      } finally {
        layoutWork.on = false
        layoutWork.reset()
      }
    }
    expect(measure(128)).toBe(128)
    expect(measure(256)).toBe(256)
  })
})
