/*
 * Prettier plugin for Carve.
 *
 * Carve already has a canonical form - `carve fmt` writes it, and PART 11 of
 * the grammar defines it. This plugin does not reimplement that: it hands the
 * source to the same formatter and returns the result, so a repository that
 * runs Prettier over everything gets Carve formatted the same way `carve fmt`
 * and the language server format it, rather than three answers to one question.
 *
 * That is also why Prettier's layout options are ignored. `printWidth`,
 * `tabWidth` and `useTabs` describe a formatter's freedom; Carve's canonical
 * form has none to describe - the spec fixes it, so honoring `printWidth` here
 * would produce output `carve fmt --check` then rejects.
 *
 * Usage:
 *
 *   // .prettierrc
 *   { "plugins": ["@markup-carve/carve/prettier"] }
 *
 * Prettier resolves `.crv` and `.carve` through the language entry below, so no
 * `overrides` block is needed.
 */

import { carveToCarve } from './index.js'

/** What Prettier hands the printer: the source, plus the span it covers. */
interface CarveSourceNode {
  type: 'carve-source'
  source: string
  start: number
  end: number
}

export const languages = [
  {
    name: 'Carve',
    parsers: ['carve'],
    extensions: ['.crv', '.carve'],
    linguistLanguageId: 0,
    vscodeLanguageIds: ['carve'],
  },
]

export const parsers = {
  carve: {
    astFormat: 'carve-source',
    /**
     * Prettier's contract is parse-then-print, and this plugin formats in one
     * step - so the "AST" is the source itself. Parsing here would mean
     * building a tree only to throw it away, and would change what a syntax
     * error does: `carve fmt` never fails on malformed input, it formats what
     * it can, and Prettier should behave the same way rather than refusing the
     * file.
     */
    parse: (text: string): CarveSourceNode => ({
      type: 'carve-source',
      source: text,
      start: 0,
      end: text.length,
    }),
    locStart: (node: CarveSourceNode): number => node.start,
    locEnd: (node: CarveSourceNode): number => node.end,
  },
}

export const printers = {
  'carve-source': {
    print: (path: { node?: CarveSourceNode; getValue?: () => CarveSourceNode }): string => {
      // Prettier 3 exposes `path.node`; Prettier 2 only had `getValue()`.
      // Supporting both is two characters here and one less reason for a
      // consumer to be on a specific major.
      const node = path.node ?? path.getValue?.()

      // Returned verbatim, trailing newline included. Prettier appends one for
      // a Doc, but not for a plain string - and stripping it here made the
      // plugin's output differ from `carve fmt --write` by exactly one byte,
      // so a repository running both had each tool undo the other.
      return carveToCarve(node?.source ?? '')
    },
  },
}

/**
 * Prettier reads `options` from a plugin to know which of ITS options apply.
 * Carve's canonical form is fixed by the spec, so the answer is none - stated
 * explicitly rather than left to look like an oversight.
 */
export const options = {}

export const defaultOptions = {}
