import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { upgrade } from '../src/index.ts'

describe('C2-B-081: a note definition moved out of its container', () => {
  it.each([
    // An indented paragraph below a note that moved above the document would join its body.
    ['\ta[^1]\n\t[^1]: ```\n x\n ```\n', '[^1]: ```\n\na[^1]\n\n x\n ```\n'],
    // 0.1 ends the note at column 1 of the line after its fence; that line stays where it is.
    [':: m\n: item\n [^c]: ```\n\n{\n ]\n', ':: m\n: item\n\n[^c]: ```\n\n{\n ]\n'],
  ])('keeps the 0.1 blocks around the moved note: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(render(result.output)).toBe(carveToHtml(source))
  })
})

describe('U-126: an empty quote under the text of a note body', () => {
  it('gets a blank line, or 0.2 reads its mark as a lazy line of the note', () => {
    const source = '[^f]: r\n>\n [^g]: d\n[r]: l\n :\nx[^f]\n'
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(result.output).toContain('[^f]: r\n\n>\n')
    expect(result.records.map((record) => record.entry)).toContain('U-126')
    expect(render(result.output)).toBe(carveToHtml(source))
  })
})
