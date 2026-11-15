import { describe, expect, it } from 'vitest'
import { parse, validateTree } from '../src/index.ts'

describe('generated parser findings', () => {
  it('C2-A-143, C2-B-165: a leading byte order mark takes no column', () => {
    const source = '\ufeffP'
    const document = parse(source)
    expect(document.children[0]?.pos?.startColumn).toBe(1)
    expect(() => validateTree(document, undefined, source)).not.toThrow()
  })

  it('C2-A-093, C2-B-173: a row span continues from the body into the footer', () => {
    const source = '{footer-rows}\n||\n|^|\n|^|\n'
    expect(() => validateTree(parse(source), undefined, source)).not.toThrow()
  })
})
