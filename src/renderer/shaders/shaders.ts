/**
 * Happy Home - Shader module (WebGPU / WGSL only)
 *
 * The WGSL sources live in sibling `.wgsl` files and are imported with Vite's
 * `?raw` loader, so esbuild NEVER parses shader text as TypeScript. This
 * structurally eliminates the class of dev-server failure previously seen as:
 *   Transform failed ... raytracer.compute.wgsl.ts:1220:0: ERROR: Unexpected "export"
 * which happens when a giant TS template literal gets unterminated/duplicated.
 *
 * Dynamic scene hooks are plain comment placeholders inside compute.wgsl and
 * are substituted at runtime (no template-literal interpolation of WGSL).
 */

import computeWGSLRaw from './compute.wgsl?raw';
import blitWGSLRaw from './blit.wgsl?raw';
import { sanitizeInjectedWGSL } from './wgslSafety.ts';

const DYNAMIC_SDF_PLACEHOLDER = '//__HAPPYHOME_DYNAMIC_SDF__';
const DYNAMIC_MATS_PLACEHOLDER = '//__HAPPYHOME_DYNAMIC_MATS__';

function assertPlaceholdersPresent(): void {
  if (!computeWGSLRaw.includes(DYNAMIC_SDF_PLACEHOLDER) || !computeWGSLRaw.includes(DYNAMIC_MATS_PLACEHOLDER)) {
    throw new Error('compute.wgsl is missing dynamic hook placeholders.');
  }
}

assertPlaceholdersPresent();

/**
 * Builds the full compute-shader WGSL with sanitized dynamic scene hooks.
 * Sanitization runs BEFORE substitution so a hostile snippet can never break
 * shader structure (no backticks / interpolation / WebGL allowed).
 */
export const getComputeShaderWGSL = (dynamicSDF: string = '', dynamicMats: string = ''): string => {
  const safeSDF = sanitizeInjectedWGSL(dynamicSDF, 'dynamicSDF');
  const safeMats = sanitizeInjectedWGSL(dynamicMats, 'dynamicMats');
  return computeWGSLRaw
    .split(DYNAMIC_SDF_PLACEHOLDER).join(safeSDF)
    .split(DYNAMIC_MATS_PLACEHOLDER).join(safeMats);
};

/** Full-screen blit (vertex + fragment) WGSL with ACES tonemapping. */
export const BLIT_SHADER_WGSL: string = blitWGSLRaw;
