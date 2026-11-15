import assert from 'node:assert/strict'
import { test } from 'node:test'
import { check } from './check.ts'
import { random } from './generate.ts'

void test('C2-W-022: an empty document has an empty canonical form', () => {
  assert.equal(check('format', '', random(1)), null)
})

void test('C2-W-007: a space in an image alt value is content', () => {
  assert.equal(check('format', '![ \n`a`]()', random(1)), null)
})

void test('C2-W-011: an unspellable field is reported before checking stability', () => {
  assert.equal(check('format', '\r', random(1))?.kind, 'writer-accounting')
})

void test('C2-W-011: an unspellable structure is reported before checking stability', () => {
  assert.equal(check('format', '/\\{*\\`*/', random(1))?.kind, 'writer-accounting')
})
