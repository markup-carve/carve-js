import { describe, expect, it } from 'vitest'
import { lazyLineArray } from '../src/lazy-line-array.js'

describe('lazy line arrays', () => {
  it('preserves array reads and reflection without materialization', () => {
    const expected = ['one', 'two', 'three']
    let copies = 0
    const array = lazyLineArray(expected.length, i => expected[i]!, () => { copies++ })
    expect(Array.isArray(array)).toBe(true)
    expect(array.length).toBe(3)
    expect(array[0]).toBe('one')
    expect(array[3]).toBeUndefined()
    expect(array.at(-1)).toBe('three')
    expect([...array]).toEqual(expected)
    expect(array.slice(1)).toEqual(expected.slice(1))
    expect(array.map(value => value.toUpperCase())).toEqual(expected.map(value => value.toUpperCase()))
    expect(Object.keys(array)).toEqual(Object.keys(expected))
    expect(Object.getOwnPropertyDescriptors(array)).toEqual(Object.getOwnPropertyDescriptors(expected))
    expect(JSON.stringify(array)).toBe(JSON.stringify(expected))
    expect(copies).toBe(0)
  })

  it('materializes once before mutation and keeps ordinary array behavior', () => {
    const expected = ['one', 'two', 'three']
    let copies = 0
    const array = lazyLineArray(expected.length, i => expected[i]!, () => { copies++ }) as string[]
    array[1] = 'changed'
    array.push('four')
    expect([...array]).toEqual(['one', 'changed', 'three', 'four'])
    expect(copies).toBe(1)
    delete array[0]
    expect(0 in array).toBe(false)
    array.length = 1
    expect(array.length).toBe(1)
    expect(copies).toBe(1)
  })

  it('can be frozen with the same descriptors as an ordinary array', () => {
    const expected = Object.freeze(['one', 'two'])
    const array = lazyLineArray(expected.length, i => expected[i]!, () => {})
    Object.freeze(array)
    expect(Object.isFrozen(array)).toBe(true)
    expect(Object.getOwnPropertyDescriptors(array)).toEqual(Object.getOwnPropertyDescriptors(expected))
  })
})
