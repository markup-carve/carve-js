import { colorSwatchExtension, colorSwatchRenderer } from './inline/color-swatch.ts'
import { imgFenceExtensions, imgFenceRenderers } from './blocks/img-fence.ts'
import { listTableExtension, listTableRenderer } from './blocks/list-table.ts'

export { colorSwatchExtension, colorSwatchRenderer, createColorSwatch } from './inline/color-swatch.ts'
export { imgFenceExtensions, imgFenceRenderers, createImgFence } from './blocks/img-fence.ts'
export { sanitizeSvg } from './blocks/svg-sanitize.ts'
export { listTableExtension, listTableRenderer } from './blocks/list-table.ts'

export const migrationExtensions = [colorSwatchExtension, listTableExtension, ...imgFenceExtensions]
export const migrationRenderers = { 'carve.colorSwatch': colorSwatchRenderer, 'carve.listTable': listTableRenderer, ...imgFenceRenderers }
