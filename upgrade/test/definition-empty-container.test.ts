import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-081 C2-B-083: empty definitions inside list items', () => {
  it('replaces a consumed definition with an empty item', () => {
    const result = upgrade('* [d]:\n')
    expect(result.output).toBe('* {% %}\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-131')
  })

  it('keeps an unrelated table difference as a mismatch', () => {
    const result = upgrade('|= ^|\n\n* [d]:\n')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('keeps a nested item empty and releases a following colon line', () => {
    const result = upgrade('* * [d]: u\n :\n')
    expect(result.output).toBe('* * {% %}\n\n:\n')
    expect(result.check).toBe('pass')
  })

  it('does not hide an unrelated table difference beside the nested item', () => {
    const result = upgrade('* * [d]: u\n :\n\n|= ^|')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('rewrites two consumed definitions in one list', () => {
    const result = upgrade('* [d]:\n* [e]:\n')
    expect(result.output).toBe('* {% %}\n* {% %}\n')
    expect(result.check).toBe('pass')
  })

  it.each([
    ['* [d]: \n text\n', '* {% %}\n\ntext\n'],
    ['* [d]: /u\n :::\n', '[d]: /u\n\n* {% %}\n\n:::\n'],
    ['- [r]: /u\ntail\n\n[r][]\n', '[r]: /u\n\n- {% %}\n\ntail\n\n[r][]\n'],
  ])('releases a sibling after a consumed definition: %s', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
  })

  it('does not absorb a table defect while releasing a sibling', () => {
    expect(upgrade('* [d]: \n text\n\n|= ^|').check).toBe('mismatch')
  })

  it('places a consumed definition beside its list after earlier content', () => {
    const source = '# T\n\npara\n\n* [d]: /u\n :::\n'
    const result = upgrade(source)
    expect(result.output).toBe('# T\n\npara\n\n[d]: /u\n\n* {% %}\n\n:::\n')
    expect(result.check).toBe('pass')
  })

  it('leaves front matter at the start when a later definition moves', () => {
    const source = '---\ntitle: T\n---\n\n* [d]: /u\n :::\n'
    const result = upgrade(source)
    expect(result.output).toBe('---\ntitle: T\n---\n\n[d]: /u\n\n* {% %}\n\n:::\n')
    expect(result.check).toBe('pass')
  })
})
