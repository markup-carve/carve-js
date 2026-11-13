import { type Rule } from '../context.ts'
import { attributeLines, openers } from './attributes.ts'
import { blankLines } from './blank-lines.ts'
import { definitions } from './definitions.ts'
import { escapes } from './escapes.ts'
import { fences } from './fences.ts'
import { inline } from './inline.ts'
import { lists } from './lists.ts'
import { includes, tables } from './tables.ts'

/** Every rule, in the order of the contract's groups. The order does not decide which edit wins. */
export const RULES: readonly Rule[] = [blankLines, includes, lists, attributeLines, openers, definitions, fences, tables, inline, escapes]
