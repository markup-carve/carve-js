import type { Attrs, Extension, InlineNode } from './ast.js'
import type { CarveExtension, ExtensionRenderContext } from './extension.js'

/**
 * Inline color swatch. Tier-3, the standard `color` extension from the spec's
 * Extension Registry.
 *
 * `:color[value]` renders a small color chip and the color value when the value
 * is a safe CSS color (hex, rgb()/hsl(), or an actual CSS named color). Unknown
 * / invalid values defer to the generic extension fallback
 * (`<span class="ext-color">...`).
 *
 * The render is configurable:
 * - `position`: chip `before` the value (default), `after` it, or `none` (chip
 *   only; the value becomes the element `title`).
 * - `shape`: a filled `square` (default), filled `round` dot, or hollow `ring`
 *   (the color is the chip border, not its fill).
 * - `tint`: paint a faint `color-mix()` tint of the color behind the swatch.
 */
export type SwatchPosition = 'before' | 'after' | 'none'
export type SwatchShape = 'square' | 'round' | 'ring'

export interface ColorSwatchOptions {
  position?: SwatchPosition
  shape?: SwatchShape
  tint?: boolean
}

const POSITIONS: readonly SwatchPosition[] = ['before', 'after', 'none']
const SHAPES: readonly SwatchShape[] = ['square', 'round', 'ring']

export function colorSwatch(options: ColorSwatchOptions = {}): CarveExtension {
  const position = options.position ?? 'before'
  const shape = options.shape ?? 'square'
  const tint = options.tint ?? false
  if (!POSITIONS.includes(position)) {
    throw new Error(`Invalid ColorSwatch position "${position}"; expected one of: ${POSITIONS.join(', ')}.`)
  }
  if (!SHAPES.includes(shape)) {
    throw new Error(`Invalid ColorSwatch shape "${shape}"; expected one of: ${SHAPES.join(', ')}.`)
  }

  return {
    name: 'color',
    renderers: {
      color: (node: Extension, ctx: ExtensionRenderContext): string | undefined => {
        const value = safeColor(inlineText(node.content))
        if (value === null) return undefined
        return renderSwatch(node.attrs, ctx, value, position, shape, tint)
      },
    },
  }
}

function renderSwatch(
  nodeAttrs: Attrs | undefined,
  ctx: ExtensionRenderContext,
  value: string,
  position: SwatchPosition,
  shape: SwatchShape,
  tint: boolean,
): string {
  const label = ctx.escapeHtml(value)

  // A ring shows the color as the border; filled shapes as the background.
  const chipClass = shape === 'square' ? 'swatch-chip' : `swatch-chip swatch-chip-${shape}`
  const chipStyle = shape === 'ring' ? `border-color:${value}` : `background-color:${value}`
  const chip = `<span class="${chipClass}" style="${ctx.escapeAttr(chipStyle)}"></span>`

  let attrs = withBaseClass(nodeAttrs, 'swatch')
  if (tint) {
    attrs = addClass(attrs, 'swatch-tint')
    attrs = withDefaultKeyValue(attrs, 'style', `background-color:color-mix(in srgb, ${value} 12%, transparent)`)
  }

  let inner: string
  if (position === 'none') {
    // Chip only: the value is not shown inline, so surface it as the element
    // title so it stays available on hover and to assistive technology.
    attrs = addClass(attrs, 'swatch-chip-only')
    attrs = withDefaultKeyValue(attrs, 'title', value)
    inner = chip
  } else if (position === 'after') {
    inner = `${label} ${chip}`
  } else {
    inner = `${chip} ${label}`
  }

  return `<span${ctx.renderAttrs(attrs)}>${inner}</span>`
}

/**
 * The CSS named colors (plus `transparent` / `currentcolor`). A bare keyword is
 * only treated as a color when it is one of these; arbitrary words like
 * `banana` defer to the generic fallback (parity with carve-php / carve-rs).
 */
const NAMED_COLORS: ReadonlySet<string> = new Set(
  (
    'transparent currentcolor aliceblue antiquewhite aqua aquamarine azure beige bisque black ' +
    'blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral ' +
    'cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen ' +
    'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon ' +
    'darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink ' +
    'deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory ' +
    'khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen ' +
    'seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan ' +
    'teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
)

function safeColor(s: string): string | null {
  const value = s.trim()
  if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return value
  }
  // rgb()/hsl(): only safe chars inside, and at least one digit (rejects
  // `rgb(/)` / empty args). Author never escapes; the value cannot break out.
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]*[0-9][0-9.,%\s/]*\)$/.test(value)) {
    return value
  }
  // A bare keyword is a color only when it is an actual CSS named color (or
  // `transparent` / `currentcolor`); arbitrary words are not.
  if (/^[a-zA-Z]+$/.test(value) && NAMED_COLORS.has(value.toLowerCase())) {
    return value
  }
  return null
}

/** Merge a base class ahead of the author classes (a fresh Attrs copy). */
function withBaseClass(attrs: Attrs | undefined, base: string): Attrs {
  const a: Attrs = attrs ? { ...attrs } : {}
  a.classes = [base, ...(a.classes ?? [])]
  return a
}

/** Append a class after the existing ones, de-duplicated. */
function addClass(attrs: Attrs, cls: string): Attrs {
  const classes = attrs.classes ?? []
  if (classes.includes(cls)) return attrs
  return { ...attrs, classes: [...classes, cls] }
}

/** Set a key-value only when the author did not already provide it. */
function withDefaultKeyValue(attrs: Attrs, key: string, value: string): Attrs {
  const keyValues = attrs.keyValues ?? {}
  if (key in keyValues) return attrs
  return { ...attrs, keyValues: { ...keyValues, [key]: value } }
}

/** Flatten an inline tree to its text content. */
function inlineText(nodes: InlineNode[]): string {
  let s = ''
  for (const node of nodes) {
    const n = node as unknown as Record<string, unknown>
    if (typeof n.value === 'string') s += n.value
    if (typeof n.name === 'string' && n.type === 'tag') s += `#${n.name}`
    const kids = n.children ?? n.content
    if (Array.isArray(kids)) s += inlineText(kids as InlineNode[])
  }
  return s
}
