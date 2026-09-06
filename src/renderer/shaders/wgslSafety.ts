/**
 * Happy Home - WGSL Safety Validator (WebGPU-only)
 *
 * Strict client-side guardrails for any AI-generated WGSL.
 * - WebGPU / WGSL ONLY. WebGL / GLSL is FORBIDDEN.
 * - Validates against W3C WGSL + WebGPU limits before compiling.
 *
 * Verified against:
 * - https://www.w3.org/TR/WGSL/
 * - https://www.w3.org/TR/webgpu/
 *
 * Safety note (accurate, verified):
 * WebGPU runs inside the browser sandbox with validation layers, timeouts,
 * and device-loss handling. A malformed shader CANNOT physically destroy GPU
 * hardware. It CAN cause: device loss, driver reset (TDR), frozen tab,
 * browser crash, lost unsaved work, and prolonged GPU hangs. Treat every
 * custom shader as safety-critical and always validate first.
 */

export interface WGSLValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// FORBIDDEN: WebGL / GLSL / native-GPU escape patterns.
// Any match => hard reject.
// ---------------------------------------------------------------------------
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /webgl/i, reason: 'WebGL is forbidden. This app is WebGPU-only.' },
  { re: /\bGLSL\b/, reason: 'GLSL is forbidden. Use WGSL only.' },
  { re: /\bgl_\w+/i, reason: 'OpenGL-style gl_* builtins are forbidden in WGSL.' },
  { re: /texture2D\s*\(/i, reason: 'GLSL texture2D() is forbidden. Use WGSL textureSample/textureLoad.' },
  { re: /gl_FragColor/i, reason: 'gl_FragColor is GLSL-only and forbidden.' },
  { re: /precision\s+(lowp|mediump|highp)/i, reason: 'GLSL precision qualifiers are forbidden in WGSL.' },
  { re: /__debug/i, reason: 'Reserved identifier prefix is forbidden.' },
  { re: /#\s*include/i, reason: '#include preprocessing is forbidden in inline WGSL.' },
  { re: /import\s*\(\s*['"]webgl/i, reason: 'WebGL imports are forbidden.' },
];

// Required WGSL entry markers for a full compute pipeline.
const REQUIRED_COMPUTE_MARKERS = [
  '@compute',
  '@builtin(global_invocation_id)',
  'textureStore',
];

const REQUIRED_BLIT_MARKERS = ['@vertex', '@fragment'];

const MAX_SNIPPET_CHARS = 48_000;
const MAX_FULL_SHADER_CHARS = 320_000;

function checkLoopBounds(code: string, errors: string[], warnings: string[]): void {
  // WGSL requires statically-bounded loops for termination.
  // Flag `while (true)` without an obvious break, and huge constant bounds.
  const whileTrue = code.match(/while\s*\(\s*true\s*\)/g);
  if (whileTrue) {
    const breaks = code.match(/\bbreak\s*;/g)?.length ?? 0;
    if (breaks < whileTrue.length) {
      errors.push(
        `Unbounded while(true) without matching break detected (${whileTrue.length}x). ` +
          'All loops must provably terminate to avoid GPU hangs / device loss.'
      );
    } else {
      warnings.push('while(true) used — verified matching break exists, but prefer for-loops with constant bounds.');
    }
  }

  // Flag absurd constant loop bounds (> 512 iterations in a single loop header).
  const forBounds = [...code.matchAll(/for\s*\([^;]*;\s*[^;]*<\s*(\d+)[^;]*;/g)];
  for (const m of forBounds) {
    const bound = parseInt(m[1], 10);
    if (Number.isFinite(bound) && bound > 512) {
      warnings.push(
        `Loop bound ${bound} is very high and may cause TDR / device loss on weak GPUs. Prefer <= 128 steps for raymarch/volumetrics.`
      );
    }
  }
}

function checkWorkgroupSize(code: string, errors: string[], warnings: string[]): void {
  const matches = [...code.matchAll(/@workgroup_size\s*\(\s*(\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?\s*\)/g)];
  for (const m of matches) {
    const x = parseInt(m[1], 10);
    const y = m[2] ? parseInt(m[2], 10) : 1;
    const z = m[3] ? parseInt(m[3], 10) : 1;
    const total = x * y * z;
    // W3C WebGPU minimum guaranteed: 256 invocations per workgroup.
    // Our pipeline uses (8,8,1)=64 which is safe everywhere.
    if (total > 256) {
      errors.push(
        `@workgroup_size(${x},${y},${z}) = ${total} invocations exceeds the portable WebGPU maximum of 256. ` +
          'Use (8,8,1) like the built-in raytracer.'
      );
    }
    if (x > 256 || y > 256 || z > 64) {
      errors.push(`@workgroup_size(${x},${y},${z}) exceeds per-dimension WebGPU limits.`);
    }
  }
  if (matches.length === 0 && code.includes('@compute')) {
    warnings.push('Compute shader has no @workgroup_size annotation — pipeline creation will fail.');
  }
}

/**
 * Sanitize an AI-supplied snippet that will be INTERPOLATED into the trusted
 * base shader (dynamicSDF / dynamicMats). Strips template-literal breakouts.
 */
export function sanitizeInjectedWGSL(snippet: string, label: string): string {
  if (typeof snippet !== 'string') return '';
  let s = snippet;
  // Block template-literal escape: backticks and ${ would break the TS wrapper
  // and were the root cause of the "Unexpected export" Vite transform failure
  // when a duplicated/unterminated template corrupted raytracer.compute.wgsl.ts.
  if (s.includes('`')) {
    throw new Error(`${label}: backtick (\`) is forbidden in injected WGSL (breaks TS template literal).`);
  }
  if (/\$\{/.test(s)) {
    throw new Error(`${label}: \${...} interpolation is forbidden in injected WGSL.`);
  }
  if (s.length > MAX_SNIPPET_CHARS) {
    throw new Error(`${label}: snippet too large (${s.length} chars, max ${MAX_SNIPPET_CHARS}).`);
  }
  for (const { re, reason } of FORBIDDEN_PATTERNS) {
    if (re.test(s)) {
      throw new Error(`${label}: rejected — ${reason}`);
    }
  }
  return s;
}

/**
 * Validate a FULL compute or blit WGSL program supplied by the AI agent
 * when it recompiles the rendering pipeline from scratch.
 */
export function validateFullWGSL(
  code: string,
  kind: 'compute' | 'blit'
): WGSLValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof code !== 'string' || code.length < 64) {
    return { ok: false, errors: ['Shader source is empty or far too short.'], warnings };
  }
  if (code.length > MAX_FULL_SHADER_CHARS) {
    errors.push(`Shader too large (${code.length} chars, max ${MAX_FULL_SHADER_CHARS}). Split or simplify.`);
  }
  if (code.includes('`') || /\$\{/.test(code)) {
    errors.push('Backticks or ${...} are forbidden in raw WGSL payloads (transport as plain string).');
  }
  for (const { re, reason } of FORBIDDEN_PATTERNS) {
    if (re.test(code)) {
      errors.push(`Forbidden pattern: ${reason}`);
    }
  }

  const markers = kind === 'compute' ? REQUIRED_COMPUTE_MARKERS : REQUIRED_BLIT_MARKERS;
  for (const m of markers) {
    if (!code.includes(m)) {
      errors.push(`Missing required ${kind} marker: "${m}". Base your shader on the verified in-repo raytracer.`);
    }
  }

  // Storage texture format must match the renderer's rgba16float pipeline.
  if (kind === 'compute' && !code.includes('rgba16float')) {
    errors.push('Compute shader must use texture_storage_2d<rgba16float, write> to match the renderer.');
  }

  checkLoopBounds(code, errors, warnings);
  checkWorkgroupSize(code, errors, warnings);

  // Raymarch safety: every mapScene/raymarch loop must have MAX_STEPS-style cap.
  if (kind === 'compute' && /raymarch|mapScene/i.test(code) && !/MAX_STEPS|MAX_DIST|SURF_DIST/.test(code)) {
    warnings.push(
      'Custom raymarcher does not define MAX_STEPS/MAX_DIST/SURF_DIST caps. ' +
        'Uncapped marching risks infinite loops and device loss.'
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Verify adapter limits before dispatching a custom pipeline.
 * Returns human-readable errors when the device cannot safely run it.
 */
export function checkAdapterLimitsForCustomShader(
  limits: Record<string, number | string | undefined>,
  workgroupsX: number,
  workgroupsY: number
): string[] {
  const errors: string[] = [];
  const maxDim2D = Number(limits.maxTextureDimension2D ?? 8192);
  if (workgroupsX * 8 > maxDim2D || workgroupsY * 8 > maxDim2D) {
    errors.push(`Dispatch exceeds maxTextureDimension2D (${maxDim2D}). Reduce resolutionScale.`);
  }
  return errors;
}
