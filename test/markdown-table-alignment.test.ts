import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * The Markdown delimiter row is the only place a Markdown table can express
 * alignment, and COLUMN alignment is declared on the HEADER cells - that is where
 * `|=> Age` puts it, and the HTML renderer applies it to every cell in the
 * column.
 *
 * This renderer read the first NON-header row instead, where `align` is set only
 * by a per-cell override. So ordinary aligned tables lost their alignment
 * outright, and a table with one overridden cell reported that cell's alignment
 * as the whole column's (carve#352, corpus 48/49/52/53).
 */
const delimiterRow = (src: string): string => carveToMarkdown(src).split('\n')[1] ?? ''

describe('the Markdown delimiter row carries the column alignment', () => {
  it('keeps right and center from the header', () => {
    expect(delimiterRow('|= Name |=> Age |=~ City |\n| a | 1 | x |\n')).toBe(
      '| --- | ---: | :---: |',
    )
  })

  it('reads the doubled marker form', () => {
    expect(delimiterRow('|=<< Note |= Plain |\n| a | b |\n')).toBe('| :--- | --- |')
  })

  it('does not let a per-cell override speak for the column', () => {
    // The header says right; one body cell overrides to left. Markdown cannot
    // express a per-cell override, so the column keeps what the header declared.
    const src = '|= Item |=> Qty |\n| Apple | 12 |\n| Subtotal |< 12 |\n'
    expect(delimiterRow(src)).toBe('| --- | ---: |')
  })

  it('keeps alignment on a table that also has a colspan', () => {
    const src = '|=> Category |= Item |= Price |\n| Fruit | Apple | $1 |\n| Total | < | $1.50 |\n'
    expect(delimiterRow(src)).toBe('| ---: | --- | --- |')
  })

  it('emits plain delimiters when nothing is aligned', () => {
    expect(delimiterRow('|= A |= B |\n| 1 | 2 |\n')).toBe('| --- | --- |')
  })

  it('sizes the delimiter from a narrow header rather than a wider body row', () => {
    expect(carveToMarkdown('| h |\n|---|\n| |x |\n')).toBe('| h |\n| --- |\n|  | x |\n')
  })
})
