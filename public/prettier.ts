/**
 * The Prettier plugin of Carve (`@markup-carve/carve/prettier`): Prettier formats `.crv` files exactly as `format`
 * does (C2-W-001, C2-W-127), with the same options under Prettier's namespaced names.
 */
import { format } from '../src/format.ts'

/** What the printer gets: the whole source. `format` parses and writes in one step, so there is no tree to hand over. */
interface CarveSource {
  type: 'carve-source'
  source: string
}

interface PrintOptions {
  carveAlignTables?: boolean
  carveNormalize?: boolean
  [option: string]: unknown
}

export const languages = [
  { name: 'Carve', parsers: ['carve'], extensions: ['.crv'], vscodeLanguageIds: ['carve'] },
]

export const parsers = {
  carve: {
    astFormat: 'carve-source',
    parse: (text: string): CarveSource => ({ type: 'carve-source', source: text }),
    locStart: (): number => 0,
    locEnd: (node: CarveSource): number => node.source.length,
  },
}

export const printers = {
  'carve-source': {
    // A string is returned as it is; its final line feed keeps the output equal to `carve fmt` byte for byte.
    print: (path: { node: CarveSource }, options: PrintOptions): string =>
      format(path.node.source, { alignTables: options.carveAlignTables === true, normalize: options.carveNormalize === true }),
  },
}

/** The options of `format`: `alignTables` (C2-W-068) and `normalize` (C2-W-127). */
export const options = {
  carveAlignTables: {
    type: 'boolean' as const,
    default: false,
    category: 'Carve',
    description: 'Pad the cells of each pipe table column to one display width (alignTables).',
  },
  carveNormalize: {
    type: 'boolean' as const,
    default: false,
    category: 'Carve',
    description: 'Write as if the source had no layout to keep (normalize).',
  },
}

export const defaultOptions = {}
