// Inputs of tickets filed against Carve 0.1 whose subject is gone or decided in 0.2. Each row pins
// what the 0.2 engine gives, checked against the clauses the row names, so the ticket can stay closed.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

interface Row {
  ticket: string
  verdict: string
  clauses: string[]
  input: string
  html: string
}

interface Placed {
  type: string
  pos?: { startOffset: number, endOffset: number }
  children?: Placed[]
}

const ROWS = JSON.parse(readFileSync(new URL('./fixtures/superseded-tickets.json', import.meta.url), 'utf8')) as Row[]

/** `type@start-end` of every node of `src` that has a position, in document order. */
function spans(src: string): string[] {
  const out: string[] = []
  const walk = (node: Placed): void => {
    if (node.pos !== undefined) out.push(`${node.type}@${node.pos.startOffset}-${node.pos.endOffset}`)
    for (const child of node.children ?? []) walk(child)
  }
  walk(parse(src) as unknown as Placed)
  return out
}

describe('inputs of superseded 0.1 tickets', () => {
  ROWS.forEach((row, index) => {
    it(`${row.ticket} (${row.verdict}, ${row.clauses.join(' ')}) row ${index + 1}`, () => {
      expect(render(row.input)).toBe(row.html)
    })
  })

  it('carve-php#5174, carve#5976 (C2-A-148): a container with leading indent starts at its marker', () => {
    expect(spans(' > a\n').slice(0, 2)).toEqual(['block_quote@1-4', 'paragraph@3-4'])
    expect(spans(' > - a\n >  - c\n')).toContain('list@11-14')
    expect(spans(' :: t\n : a\n')).toEqual(expect.arrayContaining(['definition_list@1-10', 'definition_description@7-10']))
    expect(spans('  - a\n')[0]).toBe('list@2-5')
  })

  it('carve#6032 (C2-H-040): a comment block in a description is no second block', () => {
    expect(render(':: t\n: head\n  %%%\n  x\n  %%%\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>head</dd>\n</dl>')
  })
})
