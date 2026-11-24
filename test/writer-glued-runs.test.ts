// C2-W-117, C2-W-124: a span whose closing run joins the opener of the span behind it reads on to the closer the
// reader finds. Every sibling whose spelling starts before that closer is reported (carve#6340, carve#6341).
import { describe, expect, it } from 'vitest'
import { type DocumentNode, type Inline, parse, writeWithDiagnostics } from '../src/index.ts'
import { documentOf, paragraph } from './support/tree.ts'

const code = (value: string): Inline => ({ type: 'code', value })
const math = (value: string): Inline => ({ type: 'math', display: false, value })
const raw = (value: string): Inline => ({ type: 'raw_inline', format: 'html', value })

function losses(tree: DocumentNode): string[] {
  return writeWithDiagnostics(tree).diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`).sort()
}

const written = (tree: DocumentNode) => writeWithDiagnostics(tree).source
const at = (index: number) => `/children/0/children/${index}`

describe('glued backtick runs', () => {
  it('a run behind math reports every node it takes', () => {
    const tree = documentOf(paragraph(math('m'), code('c'), raw('r')))
    expect(written(tree)).toBe('$`m``c``r`{=html}\n')
    expect(losses(tree)).toEqual([`field-unspellable ${at(0)}/value`, `structure-unspellable ${at(1)}`, `structure-unspellable ${at(2)}`])
  })

  it('a code-led run that ends in a raw span loses its code spans', () => {
    const tree = documentOf(paragraph(code('a'), code('b'), raw('r')))
    expect(losses(tree)).toEqual([`structure-unspellable ${at(0)}`, `structure-unspellable ${at(1)}`])
  })

  it('a two-backtick fence reads on past a raw and a math span to the next run of two', () => {
    const tree = documentOf(paragraph(code('`q'), raw('r'), math('m'), raw('r')))
    expect(written(tree)).toBe('`` `q```r`{=html}$`m``r`{=html}\n')
    expect(losses(tree)).toEqual([`field-unspellable ${at(0)}/value`,
      `structure-unspellable ${at(1)}`, `structure-unspellable ${at(2)}`, `structure-unspellable ${at(3)}`])
  })

  it('text the span takes is reported, and code spans glued behind it count as one', () => {
    const tree = documentOf(paragraph(math('m'), code('c'), code('d'), raw('r')))
    expect(losses(tree)).toEqual([`field-unspellable ${at(0)}/value`,
      `structure-unspellable ${at(1)}`, `structure-unspellable ${at(2)}`, `structure-unspellable ${at(3)}`])
    const taken = documentOf(paragraph(math('q`'), code('b'), { type: 'text', value: 'x`' }, { ...code('a'), attrs: { classes: ['c'] } }))
    expect(losses(taken)).toEqual([`field-unspellable ${at(0)}/value`, `field-unspellable ${at(2)}/value`,
      `structure-unspellable ${at(1)}`, `structure-unspellable ${at(3)}`])
  })

  it('a span the leftover of a lost node opens takes the siblings before its own end (carve-js#5320)', () => {
    const tree = documentOf(paragraph(math('m'), raw('r`'), math('m'), code('c'), math('m')))
    expect(written(tree)).toBe('$`m```r` ``{=html}$`m``c`$`m`\n')
    expect(losses(tree)).toEqual([`field-unspellable ${at(0)}/value`, `structure-unspellable ${at(1)}`,
      `structure-unspellable ${at(2)}`, `structure-unspellable ${at(3)}`, `structure-unspellable ${at(4)}`])
  })

  it('the comparison goes on behind the run, so a later span is repaired', () => {
    const tree = documentOf(paragraph(math('a'), raw('<b>'), raw('<b>'), { type: 'text', value: 'x`' }, raw('r')))
    const source = written(tree)
    expect(source).toBe('$`a``<b>`{=html}`<b>`{=html}x\\``r`{=html}\n')
    expect(parse(source).children[0]).toMatchObject({ children: [{}, {}, {}, { type: 'text', value: 'x`' }, { type: 'raw_inline', value: 'r' }] })
  })

  it('a span that starts inside a lost span reads on and takes the siblings before its end (carve-js#5322)', () => {
    const first = documentOf(paragraph(math('q`'), code('m')))
    expect(written(first)).toBe('$``q` ```m`\n')
    expect(losses(first)).toEqual([`structure-unspellable ${at(0)}`, `structure-unspellable ${at(1)}`])
    const second = documentOf(paragraph(raw('`q'), math('`q'), code('r')))
    expect(written(second)).toBe('`` `q``{=html}$`` `q```r`\n')
    expect(losses(second)).toEqual([`structure-unspellable ${at(1)}`, `structure-unspellable ${at(2)}`])
    const third = documentOf(paragraph(math('` `'), code('a``b'), raw('q`'), raw('m'), code('x`')))
    expect(written(third)).toBe('$`` ` ` ```a``b```q` ``{=html}`m`{=html}``x` ``\n')
    expect(losses(third)).toEqual([`field-unspellable ${at(0)}/value`, `structure-unspellable ${at(1)}`,
      `structure-unspellable ${at(2)}`, `structure-unspellable ${at(3)}`, `structure-unspellable ${at(4)}`])
  })
})
