import { describe, expect, it } from 'vitest'
import { CarveOptionError, parse, render } from '../src/index.ts'

describe('option refusal paths', () => {
  it('names the option for a wrong stage and an invalid value', () => {
    expect(() => render('x', { alignTables: true } as never)).toThrowError(CarveOptionError)
    try { render('x', { alignTables: true } as never) } catch (error) {
      expect((error as CarveOptionError).path).toBe('/alignTables')
    }
    try { parse('x', { mode: 'static' } as never) } catch (error) {
      expect((error as CarveOptionError).path).toBe('/mode')
    }
    try { render('x', { maxLosses: -1 } as never) } catch (error) {
      expect((error as CarveOptionError).path).toBe('/maxLosses')
    }
  })
})
