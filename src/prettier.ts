/*
 * Prettier plugin for Carve.
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
    extensions: ['.crv'],
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
    print: (path: { node?: CarveSourceNode; getValue?: () => CarveSourceNode }, options: { carveAlignTables?: boolean }): string => {
      // Prettier 3 exposes `path.node`; Prettier 2 only had `getValue()`.
      // Supporting both is two characters here and one less reason for a
      // consumer to be on a specific major.
      const node = path.node ?? path.getValue?.()

      // Returned verbatim, trailing newline included. Prettier appends one for
      // a Doc, but not for a plain string - and stripping it here made the
      // plugin's output differ from `carve fmt --write` by exactly one byte,
      // so a repository running both had each tool undo the other.
      return carveToCarve(node?.source ?? '', { alignTables: options.carveAlignTables === true })
    },
  },
}

/**
 * Prettier's configuration uses a namespaced key for the optional table mode.
 */
export const options = {
  carveAlignTables: {
    type: 'boolean',
    default: false,
    category: 'Carve',
    description: 'Align table cells by Unicode display width.',
  },
}

export const defaultOptions = {}
