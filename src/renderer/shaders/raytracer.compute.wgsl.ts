/**
 * Backward-compatibility shim.
 *
 * The WGSL sources moved to sibling `.wgsl` files imported via `?raw` in
 * `./shaders.ts`, so this module no longer contains giant TS template
 * literals. Keeping this path alive means any stale import of
 * `raytracer.compute.wgsl(.ts)` — including the one referenced by the
 * /app/applet deploy — resolves to a 1-line re-export that cannot produce
 * `Transform failed ... Unexpected "export"`.
 */
export { getComputeShaderWGSL, BLIT_SHADER_WGSL } from './shaders.ts';
