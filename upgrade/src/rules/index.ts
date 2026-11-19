import { type Rule } from '../context.ts'
import { attributeLines, openers } from './attributes.ts'
import { blankLines } from './blank-lines.ts'
import { commentLineBreaks, explicitInline, lineComments, typedQuotes } from './late.ts'
import { definitions, definitionsAtTop, definitionsKept, definitionsNested } from './definitions.ts'
import { escapes } from './escapes.ts'
import { fences } from './fences.ts'
import { inline, inlineBraced, lineBlockSpaces, unclosedRuns } from './inline.ts'
import { lists } from './lists.ts'
import { orderedTasks } from './ordered-tasks.ts'
import { shortcuts } from './shortcuts.ts'
import { includes, tables } from './tables.ts'

/** Every rule, in the order of the contract's groups. The order does not decide which edit wins. */
export const RULES: readonly Rule[] = [blankLines, includes, lists, orderedTasks, attributeLines, openers, definitions, fences, tables,
  inline, lineBlockSpaces, escapes, shortcuts, unclosedRuns]

/** Rules that run only when the first pass leaves a difference, so a source that already upgrades keeps its result. */
export const LATE_RULES: readonly Rule[] = [lineComments, typedQuotes]

/** Each late variant replaces first-pass rules with the late rules in their place, tried in order. */
export const LATE_VARIANTS: readonly (readonly Rule[])[] = [
  [...RULES, ...LATE_RULES],
  [...RULES.map((rule) => rule === definitions ? definitionsAtTop : rule), ...LATE_RULES],
  [...RULES.map((rule) => rule === definitions ? definitionsKept : rule), ...LATE_RULES],
  [...RULES, ...LATE_RULES, commentLineBreaks],
  [...RULES.map((rule) => rule === inline ? inlineBraced : rule), ...LATE_RULES],
  [...RULES, ...LATE_RULES, explicitInline],
  [...RULES.map((rule) => rule === definitions ? definitionsNested : rule), ...LATE_RULES],
]
