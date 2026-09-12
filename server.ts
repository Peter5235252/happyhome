import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from 'dotenv';
dotenv.config();

const defaultGemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// ---------------------------------------------------------------------------
// WEBGPU SAFETY CONSTITUTION (STRICT, NON-NEGOTIABLE)
// Grounded in verified WebGPU data as of Sept 2026:
// - WGSL spec: https://www.w3.org/TR/WGSL/
// - WebGPU spec: https://www.w3.org/TR/webgpu/
// ---------------------------------------------------------------------------
const WEBGPU_SAFETY_CONSTITUTION = `
WEBGPU SAFETY CONSTITUTION — STRICT, NON-NEGOTIABLE. VIOLATION = REJECT THE ACTION.

1. WebGPU ONLY. WebGL IS ABSOLUTELY FORBIDDEN.
   - NEVER emit, suggest, or inject WebGL, GLSL, gl_*, texture2D(), gl_FragColor,
     precision lowp/mediump/highp, or any <canvas>.getContext('webgl'|'webgl2'|'experimental-webgl').
   - The ONLY valid graphics API in this app is navigator.gpu + WGSL +
     GPUComputePipeline/GPURenderPipeline. If a snippet contains WebGL it must be
     refused and rewritten in WGSL.

2. WGSL MUST BE VALID, GROUNDED, AND VERIFIED.
   - Ground every shader in the W3C WGSL spec (https://www.w3.org/TR/WGSL/) and the
     WebGPU spec (https://www.w3.org/TR/webgpu/). Do NOT invent builtins, attributes,
     or texture formats.
   - Allowed compute entry: @compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) ...).
     Allowed blit entries: @vertex fn vs_main + @fragment fn fs_main.
   - Allowed storage format for the raytracer pipeline: texture_storage_2d<rgba16float, write>.
   - Backticks and \${...} are FORBIDDEN inside raw WGSL payloads (they break the TS
     template wrapper and caused the production "Unexpected export" Vite failure).

3. RESPECT ADAPTER LIMITS AND TERMINATION.
   - Query adapter.limits first (maxComputeWorkgroupSizeX/Y, maxComputeInvocationsPerWorkgroup=256,
     maxBufferSize, maxTextureDimension2D, maxStorageBufferBindingSize).
   - Total workgroup invocations MUST be <= 256. Our safe default is (8,8,1)=64.
   - Every loop MUST provably terminate: for-loops with small constant bounds
     (raymarch <= 110 steps, shadows <= 28, volumetrics <= 8-16, AO <= 5).
     while(true) without break is FORBIDDEN.
   - Uncapped raymarching / unbounded volumetrics are FORBIDDEN.

4. CONSEQUENCES ARE SEVERE — TREAT EVERY SHADER AS SAFETY-CRITICAL.
   - FACT (verified, do not overstate): WebGPU runs in the browser sandbox with
     validation layers, timeouts, and device-loss handling. A bad WGSL shader
     CANNOT physically melt or permanently destroy GPU hardware.
   - FACT (verified, must emphasize): a bad shader CAN and WILL cause real harm:
     WebGPU device loss, OS driver reset / Timeout Detection & Recovery (TDR),
     frozen browser tab, full browser crash, lost unsaved user work, hours-long
     GPU hangs on weak hardware, and corrupted frame output requiring reload.
   - THEREFORE: always validate with getCompilationInfo() + pushErrorScope('validation')
     BEFORE presenting output. On any error, ABORT the pipeline swap, keep the last
     known-good pipeline running, surface the exact Line:col message, and offer a fix.
     Never retry a failing shader in a hot loop. Never suppress validation errors.
`;

const FULL_AGENTIC_CHARTER = `
FULL AGENTIC CONTROL & STRUCTURE-AGNOSTIC CREATION CHARTER:
You are NOT limited to a predefined set of templates or just the starter cottage. You have complete agentic
control to speak ANY 3D world or structure into existence in real time:
- SPEAK THINGS INTO EXISTENCE (buildStructure): The user can ask for ANY scene or structure — a Greek Parthenon,
  Japanese pagoda, gothic castle, desert pyramid, sci-fi obsidian monolith, glowing stargate portal, spiral tower,
  suspended bridge, modern glass villa, or ancient stone henge. Call 'buildStructure' with the matching archetype,
  color palette, and environment. It automatically hides the cottage and constructs the monument procedurally.
- ENVIRONMENT & TERRAIN (setEnvironment): Instantly morph the world into a meadow, limestone courtyard plaza,
  rolling desert sand dunes, reflective ocean water, deep void/obsidian mirror, or alien cybernetic grid.
- BASE COTTAGE CONTROL (setBaseStructure): Show or hide the starter cottage at any time.
- 3D SCENE GRAPH (create / batch / modify / remove / clear objects): Add arbitrary geometric components,
  statues, glowing energy cores, lanterns, pillars, crystals, and ornaments.
- LIGHTING & ATMOSPHERE: Shift dawn, golden hour, midnight stars, volumetric godrays, fog, and cloud cover.
- CAMERA & CINEMATICS: Swoop to monumental, structure_wide, dramatic_low, cinematic, aerial, or custom angles.
- RENDERER SOURCE ITSELF: Author raw WGSL for custom SDFs and materials (updateSceneShader), or recompile the pipeline.
Chain as many tool calls as needed in ONE response to realize the user's vision instantly.
`;

// Server-side WGSL guard (mirrors src/renderer/shaders/wgslSafety.ts).
function validateCustomWGSLServer(
  code: unknown,
  kind: 'snippet' | 'compute' | 'blit'
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof code !== 'string' || code.length < 16) {
    return { ok: false, errors: ['WGSL payload is empty or too short.'] };
  }
  if (code.length > 320_000) {
    errors.push(`WGSL payload too large (${code.length} chars).`);
  }
  if (code.includes('`') || /\$\{/.test(code)) {
    errors.push('Backticks or ${...} are forbidden in WGSL payloads.');
  }
  const forbidden: Array<[RegExp, string]> = [
    [/webgl/i, 'WebGL is forbidden (WebGPU-only app).'],
    [/\bGLSL\b/, 'GLSL is forbidden (WGSL only).'],
    [/\bgl_\w+/i, 'gl_* builtins are forbidden.'],
    [/texture2D\s*\(/i, 'texture2D() is GLSL-only.'],
    [/gl_FragColor/i, 'gl_FragColor is GLSL-only.'],
    [/precision\s+(lowp|mediump|highp)/i, 'GLSL precision qualifiers are forbidden.'],
  ];
  for (const [re, msg] of forbidden) {
    if (re.test(code)) errors.push(`Forbidden pattern: ${msg}`);
  }
  if (kind === 'compute') {
    for (const m of ['@compute', '@builtin(global_invocation_id)', 'textureStore', 'rgba16float']) {
      if (!code.includes(m)) errors.push(`Custom compute shader missing required marker: "${m}".`);
    }
    const wg = [...code.matchAll(/@workgroup_size\s*\(\s*(\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?\s*\)/g)];
    for (const m of wg) {
      const total = parseInt(m[1], 10) * (m[2] ? parseInt(m[2], 10) : 1) * (m[3] ? parseInt(m[3], 10) : 1);
      if (total > 256) errors.push(`@workgroup_size total ${total} exceeds portable WebGPU max 256. Use (8,8,1).`);
    }
    if (/while\s*\(\s*true\s*\)/.test(code) && (code.match(/\bbreak\s*;/g)?.length ?? 0) === 0) {
      errors.push('Unbounded while(true) without break is forbidden (GPU hang / device loss risk).');
    }
  }
  if (kind === 'blit') {
    for (const m of ['@vertex', '@fragment']) {
      if (!code.includes(m)) errors.push(`Custom blit shader missing required marker: "${m}".`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Normalize historic / alias model ids to exact provider API ids (verified Sept 2026:
// Gemini gemini-3.5/3.6/3.7/3.8-flash, OpenAI gpt-5.6-luna/terra/sol + gpt-6-astra,
// xAI grok-4.6 (dot), Anthropic claude-sonnet-5 / claude-opus-5 / claude-fable-5-1
// (hyphen)). Unknown values fall back to the default
// EXPLICITLY with a warning — never silently route to Gemini.
const KNOWN_API_MODEL_IDS = new Set([
  'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash',
  'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra',
  'grok-4.6',
  'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1',
]);

export function resolveApiModelIdServer(uiModelId: string): string {
  if (!uiModelId) return 'gemini-3.8-flash';
  if (uiModelId === 'claude-fable-5.1') return 'claude-fable-5-1'; // historic dot-bug
  if (KNOWN_API_MODEL_IDS.has(uiModelId)) return uiModelId;
  console.warn(`Unknown model id "${uiModelId}" — falling back to gemini-3.8-flash.`);
  return 'gemini-3.8-flash';
}

const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "buildStructure",
      description: "Speaks entire architectural structures and environments into existence instantly in real-time 3D (e.g. Greek temples, Japanese pagodas, medieval castles, sci-fi monoliths, portals, towers, pyramids, bridges, modern villas, stone henges, or custom monuments). Totally agnostic toward any structure or building.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["temple", "castle", "pagoda", "tower", "pyramid", "bridge", "monolith", "portal", "modern_villa", "henge", "custom"],
            description: "The architectural archetype to construct."
          },
          style: {
            type: "string",
            description: "Aesthetic style, e.g. 'ancient', 'futuristic', 'minimalist', 'cyberpunk', 'stone', 'golden', 'mystical'."
          },
          position: {
            type: "array",
            items: { type: "number" },
            description: "[x, y, z] center origin for the structure. Default is [0, 0, 0]."
          },
          scale: {
            type: "number",
            description: "Overall scale multiplier (default 1.0)."
          },
          primaryColor: {
            type: "array",
            items: { type: "number" },
            description: "[r, g, b] normalized color for the primary walls/pillars/stone (0.0 to 1.0)."
          },
          secondaryColor: {
            type: "array",
            items: { type: "number" },
            description: "[r, g, b] normalized color for roof tiles, trims, accents (0.0 to 1.0)."
          },
          emissiveColor: {
            type: "array",
            items: { type: "number" },
            description: "[r, g, b] glow color for flames, energy cores, beacons, or interior light."
          },
          roughness: {
            type: "number",
            description: "PBR roughness from 0.0 (polished mirror) to 1.0 (rough stone)."
          },
          metallic: {
            type: "number",
            description: "PBR metallic from 0.0 (stone/wood/glass) to 1.0 (gold/steel)."
          },
          environment: {
            type: "string",
            enum: ["meadow", "courtyard", "desert", "water", "void", "alien"],
            description: "Surrounding environment/terrain to complement the structure: 'meadow', 'courtyard', 'desert', 'water', 'void', 'alien'."
          },
          clearBaseCottage: {
            type: "boolean",
            description: "Whether to hide the default cottage so the new structure takes center stage (default true)."
          },
          replaceExisting: {
            type: "boolean",
            description: "Whether to replace previous dynamic objects or add alongside (default true)."
          }
        },
        required: ["type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "setEnvironment",
      description: "Transforms the surrounding terrain and environment style (meadow, stone courtyard plaza, desert dunes, reflective water/ocean, void/obsidian mirror, or alien cyber grid).",
      parameters: {
        type: "object",
        properties: {
          environmentStyle: {
            type: "string",
            enum: ["meadow", "courtyard", "desert", "water", "void", "alien"],
            description: "The terrain/environment archetype: 'meadow', 'courtyard', 'desert', 'water', 'void', 'alien'."
          },
          showBaseCottage: {
            type: "boolean",
            description: "Whether the base cottage is rendered in this environment."
          }
        },
        required: ["environmentStyle"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "setBaseStructure",
      description: "Toggles the base cottage structure visible or hidden (useful when clearing the canvas for custom creations or restoring the cottage).",
      parameters: {
        type: "object",
        properties: {
          visible: {
            type: "boolean",
            description: "True to show the cottage, false to hide it."
          }
        },
        required: ["visible"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "createObject",
      description: "Places an individual 3D object in the raytraced scene with custom geometry, position, color, and PBR/emissive material.",
      parameters: {
        type: "object",
        properties: {
          shape: {
            type: "string",
            enum: ["sphere", "box", "cylinder", "capsule", "torus", "cone", "crystal", "lantern"],
            description: "Shape geometry: 'sphere', 'box', 'cylinder', 'capsule', 'torus', 'cone', 'crystal', or 'lantern'."
          },
          position: {
            type: "array",
            items: { type: "number" },
            description: "[x, y, z] coordinates. The house is centered at [0, 0, 0]. Ground is y=0. Porch is at [0, 0.4, 1.8]. Pathway extends forward towards z=4.0. Roof top is around y=2.8."
          },
          size: {
            type: "array",
            items: { type: "number" },
            description: "[width/radius, height, depth]. e.g. [0.4, 0.4, 0.4] for medium orb, or [0.15, 0.6, 0.15] for pillar/lantern."
          },
          color: {
            type: "array",
            items: { type: "number" },
            description: "[r, g, b] normalized color from 0.0 to 1.0 (e.g. [1.0, 0.85, 0.3] for warm gold, [0.2, 0.8, 1.0] for cyan crystal, [1.0, 0.3, 0.2] for ruby)."
          },
          roughness: {
            type: "number",
            description: "0.0 (mirror-like glossy) to 1.0 (matte clay)."
          },
          metallic: {
            type: "number",
            description: "0.0 (dielectric) to 1.0 (pure reflective metal)."
          },
          emissive: {
            type: "array",
            items: { type: "number" },
            description: "[r, g, b] emissive intensity for glowing lights and lanterns (e.g. [2.0, 1.5, 0.8] for a luminous warm lantern)."
          },
          label: {
            type: "string",
            description: "A short descriptive name (e.g. 'golden porch lantern', 'floating crystal')."
          }
        },
        required: ["shape", "position", "size", "color"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "batchCreateObjects",
      description: "Spawns multiple coordinated 3D objects at once to construct scenes, arrays of path lanterns, crystal gardens, or decorative arrangements.",
      parameters: {
        type: "object",
        properties: {
          objects: {
            type: "array",
            items: {
              type: "object",
              properties: {
                shape: { type: "string", enum: ["sphere", "box", "cylinder", "capsule", "torus", "cone", "crystal", "lantern"] },
                position: { type: "array", items: { type: "number" } },
                size: { type: "array", items: { type: "number" } },
                color: { type: "array", items: { type: "number" } },
                roughness: { type: "number" },
                metallic: { type: "number" },
                emissive: { type: "array", items: { type: "number" } },
                label: { type: "string" }
              },
              required: ["shape", "position", "size", "color"]
            },
            description: "Array of object definitions to spawn simultaneously."
          }
        },
        required: ["objects"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "modifyObject",
      description: "Modifies or restyles existing dynamic objects in the scene by index or descriptive label.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number", description: "0-based index of the dynamic object to alter." },
          label: { type: "string", description: "Label of the object to alter if index is unknown." },
          position: { type: "array", items: { type: "number" } },
          size: { type: "array", items: { type: "number" } },
          color: { type: "array", items: { type: "number" } },
          emissive: { type: "array", items: { type: "number" } },
          roughness: { type: "number" },
          metallic: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "removeObject",
      description: "Removes a specific dynamic object from the scene by index or label.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number", description: "0-based index of object to remove." },
          label: { type: "string", description: "Label or description of the object to remove." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "clearObjects",
      description: "Clears all user-created dynamic 3D objects from the raytraced scene.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "setLighting",
      description: "Adjusts the solar angle, time of day, volumetric godrays, and global illumination.",
      parameters: {
        type: "object",
        properties: {
          timeOfDay: {
            type: "number",
            description: "Time of day from 0.0 to 1.0 (0.05=night with stars, 0.2=sunrise, 0.35=crisp noon, 0.68=golden hour, 0.82=vibrant sunset, 0.92=twilight blue hour)."
          },
          godrayIntensity: {
            type: "number",
            description: "Volumetric sunbeam intensity from 0.0 (clear) to 2.5 (dramatic atmospheric shafts)."
          },
          giIntensity: {
            type: "number",
            description: "Global illumination diffuse bounce intensity (0.0 to 2.0)."
          },
          aoIntensity: {
            type: "number",
            description: "Ambient occlusion contact shadow depth (0.0 to 2.0)."
          },
          reflectionsEnabled: {
            type: "boolean",
            description: "Whether raytraced specular reflections are active."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "setAtmosphere",
      description: "Controls atmospheric wind, chimney smoke drift, and cloud density.",
      parameters: {
        type: "object",
        properties: {
          smokeSpeed: { type: "number", description: "Speed of chimney smoke rising (0.0 to 3.0)." },
          windSpeed: { type: "number", description: "Wind sway for trees and foliage (0.0 to 3.0)." },
          cloudDensity: { type: "number", description: "Atmospheric cloud density (0.0 to 1.5)." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "setCamera",
      description: "Positions and angles the camera freely, or switches to a cinematic camera preset.",
      parameters: {
        type: "object",
        properties: {
          preset: {
            type: "string",
            enum: ["home_perspective", "svg_perspective", "cinematic", "meadow", "sunset", "aerial", "dramatic_low", "close_up"],
            description: "Quick camera composition preset."
          },
          azimuth: { type: "number", description: "Horizontal orbit angle in radians." },
          elevation: { type: "number", description: "Vertical pitch angle in radians (e.g. 1.48 for eye level, 0.8 for high overhead, 1.8 for dramatic ground view)." },
          distance: { type: "number", description: "Camera distance from target (4.0 = close, 10.0 = medium, 16.0 = wide establishing)." },
          target: { type: "array", items: { type: "number" }, description: "[x, y, z] point in 3D space the camera is looking at." },
          fov: { type: "number", description: "Field of view in degrees (35 = telephoto portrait, 50 = standard, 70 = wide-angle)." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "updateSceneShader",
      description: "FULL AGENTIC SHADER CONTROL (safe injection): supplies raw WGSL for the scene SDF hook (customSDF, inserted into mapScene) and material hook (customMats, chained else-if on material id). WebGPU/WGSL ONLY — WebGL/GLSL is forbidden and rejected. Loops must terminate; keep snippets under ~48k chars; no backticks or ${}.",
      parameters: {
        type: "object",
        properties: {
          customSDF: { type: "string", description: "WGSL statements using p: vec3f, mapScene helpers (sdSphere/sdBox/sdRoundBox/sdCylinder/sdCapsule/sdTorus/sdCone/sdOctahedron/smin/opU) and res = opU(res, Hit(d, MAT_IDu, uv)). Example: let d = sdSphere(p - vec3f(0.0,1.0,0.0), 0.4); res = opU(res, Hit(d, 100u, p.xy));" },
          customMats: { type: "string", description: "WGSL chained branches like: else if (mat == 100u) { m.albedo = vec3f(1.0,0.8,0.3); m.roughness = 0.25; m.metallic = 0.0; m.emission = vec3f(0.0); }" },
          reason: { type: "string", description: "Short human-readable reason for the shader change." }
        },
        required: ["customSDF"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "compileCustomComputePipeline",
      description: "FULL PIPELINE RECOMPILE FROM SCRATCH: replaces the ENTIRE WebGPU compute shader (and optionally the blit vertex/fragment shader) with AI-authored WGSL. STRICT SAFETY: WebGPU/WGSL only, must include @compute @workgroup_size(8,8,1) + texture_storage_2d<rgba16float,write> + textureStore, bounded loops, adapter limits. Invalid shaders are rejected before touching the GPU to prevent device loss / driver reset / tab crash.",
      parameters: {
        type: "object",
        properties: {
          computeWGSL: { type: "string", description: "Complete WGSL compute program as plain text (no backticks, no ${}). Must be grounded in https://www.w3.org/TR/WGSL/." },
          blitWGSL: { type: "string", description: "Optional complete WGSL blit program with @vertex vs_main + @fragment fs_main + ACES tonemap." },
          reason: { type: "string", description: "Why a full recompile is needed instead of updateSceneShader." }
        },
        required: ["computeWGSL"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "restoreBuiltInPipeline",
      description: "Restores the verified built-in Happy Home raytracer pipeline after agentic shader experiments. Call this whenever a custom shader fails validation or the user asks to reset rendering.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "setRenderPipelineSettings",
      description: "Full-app render control beyond lighting: resolution scale, debug layer, godrays/GI/AO toggles and intensities, reflections, camera preset. Use for performance vs quality tradeoffs and layer isolation.",
      parameters: {
        type: "object",
        properties: {
          resolutionScale: { type: "number", description: "0.5, 0.75, or 1.0. Lower this FIRST on weak GPUs before touching shaders." },
          debugMode: { type: "number", description: "0=beauty, 1=normals, 2=GI, 3=godrays, 4=AO, 5=shadow, 6=complexity heatmap." },
          godraysEnabled: { type: "boolean" },
          giEnabled: { type: "boolean" },
          godrayIntensity: { type: "number" },
          giIntensity: { type: "number" },
          aoIntensity: { type: "number" },
          reflectionsEnabled: { type: "boolean" },
          cameraPreset: { type: "string", description: "home_perspective, cinematic, meadow, sunset, aerial, dramatic_low, close_up" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getSceneDiagnostics",
      description: "Reads live full-app state for grounded decisions: GPU adapter, limits, shaderStatus, fps, camera, settings, dynamicObjects, resolution. Call this before authoring custom WGSL so workgroup sizes and dispatch fit the actual device.",
      parameters: { type: "object", properties: {} }
    }
  }
];

const CLAUDE_TOOLS = OPENAI_TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters
}));

const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: "buildStructure",
    description: "Speaks entire architectural structures and environments into existence instantly in real-time 3D (e.g. Greek temples, Japanese pagodas, medieval castles, sci-fi monoliths, portals, towers, pyramids, bridges, modern villas, stone henges, or custom monuments). Totally agnostic toward any structure or building.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        type: {
          type: Type.STRING,
          description: "The architectural archetype: 'temple', 'castle', 'pagoda', 'tower', 'pyramid', 'bridge', 'monolith', 'portal', 'modern_villa', 'henge', 'custom'"
        },
        style: { type: Type.STRING, description: "Aesthetic style ('ancient', 'futuristic', 'minimalist', 'cyberpunk', 'stone', 'golden', 'mystical')" },
        position: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[x, y, z] center origin" },
        scale: { type: Type.NUMBER, description: "Scale multiplier" },
        primaryColor: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[r, g, b] primary color (0.0 to 1.0)" },
        secondaryColor: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[r, g, b] secondary accent (0.0 to 1.0)" },
        emissiveColor: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[r, g, b] glow color" },
        roughness: { type: Type.NUMBER, description: "0.0 to 1.0" },
        metallic: { type: Type.NUMBER, description: "0.0 to 1.0" },
        environment: { type: Type.STRING, description: "'meadow', 'courtyard', 'desert', 'water', 'void', 'alien'" },
        clearBaseCottage: { type: Type.BOOLEAN, description: "Hide base cottage (default true)" },
        replaceExisting: { type: Type.BOOLEAN, description: "Replace previous dynamic objects (default true)" }
      },
      required: ["type"]
    }
  },
  {
    name: "setEnvironment",
    description: "Transforms the surrounding terrain and environment style (meadow, stone courtyard plaza, desert dunes, reflective water/ocean, void/obsidian mirror, or alien cyber grid).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        environmentStyle: { type: Type.STRING, description: "'meadow', 'courtyard', 'desert', 'water', 'void', 'alien'" },
        showBaseCottage: { type: Type.BOOLEAN, description: "Whether to render the base cottage" }
      },
      required: ["environmentStyle"]
    }
  },
  {
    name: "setBaseStructure",
    description: "Toggles the base cottage structure visible or hidden.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        visible: { type: Type.BOOLEAN, description: "True to show, false to hide." }
      },
      required: ["visible"]
    }
  },
  {
    name: "createObject",
    description: "Places an individual 3D object in the raytraced scene with custom geometry, position, color, and PBR/emissive material.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        shape: { type: Type.STRING, description: "'sphere', 'box', 'cylinder', 'capsule', 'torus', 'cone', 'crystal', or 'lantern'" },
        position: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[x, y, z] coordinates." },
        size: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[width/radius, height, depth]." },
        color: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[r, g, b] normalized 0.0 to 1.0." },
        roughness: { type: Type.NUMBER, description: "0.0 to 1.0." },
        metallic: { type: Type.NUMBER, description: "0.0 to 1.0." },
        emissive: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[r, g, b] glow intensity." },
        label: { type: Type.STRING, description: "Short descriptive label." }
      },
      required: ["shape", "position", "size", "color"]
    }
  },
  {
    name: "batchCreateObjects",
    description: "Spawns multiple coordinated 3D objects at once to construct scenes, arrays of path lanterns, crystal gardens, or decorative arrangements.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        objects: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              shape: { type: Type.STRING },
              position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              size: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              color: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              roughness: { type: Type.NUMBER },
              metallic: { type: Type.NUMBER },
              emissive: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              label: { type: Type.STRING }
            },
            required: ["shape", "position", "size", "color"]
          }
        }
      },
      required: ["objects"]
    }
  },
  {
    name: "modifyObject",
    description: "Modifies or restyles existing dynamic objects in the scene by index or descriptive label.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        index: { type: Type.NUMBER },
        label: { type: Type.STRING },
        position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        size: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        color: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        emissive: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        roughness: { type: Type.NUMBER },
        metallic: { type: Type.NUMBER }
      }
    }
  },
  {
    name: "removeObject",
    description: "Removes a specific dynamic object from the scene by index or label.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        index: { type: Type.NUMBER },
        label: { type: Type.STRING }
      }
    }
  },
  {
    name: "clearObjects",
    description: "Clears all user-created dynamic 3D objects from the raytraced scene.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "setLighting",
    description: "Adjusts the solar angle, time of day, volumetric godrays, and global illumination.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeOfDay: { type: Type.NUMBER, description: "0.0 to 1.0 (0.05=night, 0.2=sunrise, 0.35=noon, 0.7=golden hour, 0.82=sunset, 0.92=twilight)" },
        godrayIntensity: { type: Type.NUMBER, description: "0.0 to 2.5" },
        giIntensity: { type: Type.NUMBER, description: "0.0 to 2.0" },
        aoIntensity: { type: Type.NUMBER, description: "0.0 to 2.0" },
        reflectionsEnabled: { type: Type.BOOLEAN }
      }
    }
  },
  {
    name: "setAtmosphere",
    description: "Controls atmospheric wind, chimney smoke drift, and cloud density.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        smokeSpeed: { type: Type.NUMBER },
        windSpeed: { type: Type.NUMBER },
        cloudDensity: { type: Type.NUMBER }
      }
    }
  },
  {
    name: "setCamera",
    description: "Positions and angles the camera freely, or switches to a cinematic camera preset.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        preset: { type: Type.STRING, description: "'home_perspective', 'cinematic', 'meadow', 'sunset', 'aerial', 'dramatic_low', 'close_up'" },
        azimuth: { type: Type.NUMBER },
        elevation: { type: Type.NUMBER },
        distance: { type: Type.NUMBER },
        target: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        fov: { type: Type.NUMBER }
      }
    }
  },
  {
    name: "updateSceneShader",
    description: "FULL AGENTIC SHADER CONTROL (safe injection): raw WGSL for SDF hook + material hook. WebGPU/WGSL ONLY — WebGL/GLSL forbidden. Bounded loops only; no backticks or ${}.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        customSDF: { type: Type.STRING, description: "WGSL using sdSphere/sdBox/etc + res = opU(res, Hit(d, MAT_IDu, uv))." },
        customMats: { type: Type.STRING, description: "Chained else-if branches on mat id setting albedo/roughness/metallic/emission." },
        reason: { type: Type.STRING }
      },
      required: ["customSDF"]
    }
  },
  {
    name: "compileCustomComputePipeline",
    description: "FULL PIPELINE RECOMPILE FROM SCRATCH with AI-authored WGSL. STRICT: WebGPU/WGSL only, @compute @workgroup_size(8,8,1), rgba16float, bounded loops. Invalid = rejected before GPU touch.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        computeWGSL: { type: Type.STRING, description: "Complete WGSL compute program, grounded in https://www.w3.org/TR/WGSL/." },
        blitWGSL: { type: Type.STRING },
        reason: { type: Type.STRING }
      },
      required: ["computeWGSL"]
    }
  },
  {
    name: "restoreBuiltInPipeline",
    description: "Restores the verified built-in raytracer pipeline after custom shader experiments.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "setRenderPipelineSettings",
    description: "Full-app render control: resolutionScale, debugMode, godrays/GI/AO toggles and intensities, reflections, cameraPreset.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        resolutionScale: { type: Type.NUMBER },
        debugMode: { type: Type.NUMBER },
        godraysEnabled: { type: Type.BOOLEAN },
        giEnabled: { type: Type.BOOLEAN },
        godrayIntensity: { type: Type.NUMBER },
        giIntensity: { type: Type.NUMBER },
        aoIntensity: { type: Type.NUMBER },
        reflectionsEnabled: { type: Type.BOOLEAN },
        cameraPreset: { type: Type.STRING }
      }
    }
  },
  {
    name: "getSceneDiagnostics",
    description: "Reads live full-app GPU state (adapter, limits, shaderStatus, fps, camera, settings) before authoring WGSL.",
    parameters: { type: Type.OBJECT, properties: {} }
  }
];

/** Max memory facts rendered into a prompt (unbounded lists bloat bodies + LLM input). */
export const MAX_PROMPT_MEMORY_FACTS = 40;

export function buildSystemPrompt(context: any): string {
  const objectsDesc = context?.dynamicObjects && context.dynamicObjects.length > 0
    ? context.dynamicObjects.map((o: any, idx: number) => `[#${idx} ${o.label || o.shape} at ${JSON.stringify(o.position || [])}]`).join(', ')
    : 'None currently.';

  const memoryFacts: string[] = context?.memory?.facts || [];
  const recentFacts = memoryFacts.slice(-MAX_PROMPT_MEMORY_FACTS);
  const truncatedCount = memoryFacts.length - recentFacts.length;
  const memorySection = context?.memory
    ? `
CROSS-SESSION USER MEMORY (Saved from previous sessions):
- Memory Summary: ${context.memory.summary || "First meeting."}
- Remembered Preferences & Facts${truncatedCount > 0 ? ` (showing ${recentFacts.length} most recent of ${memoryFacts.length})` : ''}:
${recentFacts.map((f: string) => `  • ${f}`).join('\n') || "  • None recorded yet."}
*(Use this memory context naturally to personalize your creative suggestions, honor their aesthetic preferences, and remember their past creations!)*`
    : '';

  return `You are the creative, highly capable, and spontaneous AI 3D Director & Voice Companion for "Happy Home" — a live photorealistic WebGPU raytracer.
${FULL_AGENTIC_CHARTER}

3D SCENE COORDINATES & GEOMETRY:
- The cottage is centered around [0, 0, 0]. Front porch & door are at [0, 0.4, 1.8].
- The cobblestone pathway extends forward from z = 1.8 to z = 5.0 (x between -0.8 and 0.8).
- The front lawn areas are x: -4.0 to -1.2 (left) and x: 1.2 to 4.0 (right).
- Ground level is y = 0.0 to 0.3. Floating items can be placed at y = 1.0 to 2.5.
- Roof gable peaks at y = 2.8. Chimney is at [1.0, 3.2, -0.4].

CURRENT 3D SCENE STATE:
- Dynamic Objects: ${context?.dynamicObjectsCount || 0} objects (${objectsDesc})
- Environment Style: ${context?.settings?.environmentStyle ?? 'meadow'} (meadow, courtyard, desert, water, void, alien)
- Base Cottage Visible: ${context?.settings?.showBaseCottage ?? true}
- Time of Day: ${context?.settings?.timeOfDay ?? 0.35} (0.05=starry night, 0.2=sunrise, 0.35=noon, 0.7=golden hour, 0.82=sunset, 0.92=twilight)
- Volumetric Godrays: ${context?.settings?.godrayIntensity ?? 1.2}x
- Global Illumination: ${context?.settings?.giIntensity ?? 1.0}x
- Camera: Preset "${context?.settings?.cameraPreset ?? 'home_perspective'}"
- GPU Diagnostics: ${context?.diagnostics ? JSON.stringify(context.diagnostics).slice(0, 800) : 'not yet reported — call getSceneDiagnostics before authoring WGSL'}
${memorySection}

${WEBGPU_SAFETY_CONSTITUTION}

CORE AGENTIC BEHAVIORS:
1. SPEAK THINGS INTO EXISTENCE: When the user asks to create or see any structure (e.g. "make a Japanese pagoda", "build a Greek temple", "create a sci-fi monolith in the desert", "make a gothic castle", "build a pyramid", "make a floating stargate"), immediately call 'buildStructure' with the appropriate type, style, environment, and colors! You are totally structure-agnostic — don't hesitate to replace the starter cottage whenever the user describes something new.
2. CHAIN ACTIONS FREELY: You can call multiple tools in a single response! For instance, when asked for a desert temple, seamlessly call 'buildStructure' (temple, environment: desert), 'setLighting' (golden hour), and 'setCamera' (monumental angle).
3. PREFER SAFE INCREMENTAL SHADERS: use buildStructure/createObject/batchCreateObjects + updateSceneShader first. Only use compileCustomComputePipeline when the user explicitly asks for a new look that hooks cannot express, and ALWAYS call getSceneDiagnostics first so workgroup sizes fit the real device.
4. TONE — INFORMAL, FRIENDLY, ENTHUSIASTIC: Sound like an excited world-builder friend, never corporate, never robotic. No filler openers ("As an AI...", "Great question..."). Start with the point.
4. BREVITY IS MANDATORY (every reply, all providers): MAX 2 short sentences, under 45 words total, one idea per reply. NEVER write lists, bullets, numbers, dashes, markdown, or emojis in speech. If asked what you can do, tease 2-3 powers in ONE flowing sentence and invite them to try something ("I can scatter lanterns, paint the sunset, and swoop the camera — say the word!").
5. SPOKEN AUDIO RULES: Your speech will be read aloud AND hard-truncated past ~380 characters, so front-load the point. Keep it concise (1 to 2 natural sentences). Do not use markdown symbols (*, #, \`, bullets, emojis) in the spoken text.
6. ON SHADER REJECTION: if the system reports a WGSL validation error, explain it in plain language in your NEXT spoken turn, keep the last good pipeline running, and offer a corrected retry — never silently retry in a loop.`;
}

// ---------------------------------------------------------------------------
// BREVITY ENFORCEMENT (all LLMs, all providers)
// The voice UI speaks `speechText` aloud: long bulleted answers like the one
// reported ("I can direct the entire Happy Home world. I can: - Add... -
// Change... - Shape...") are unusable when spoken. Three layers enforce the
// concise, informal, friendly tone on every provider:
//  1. System prompt tone/brevity rules (above).
//  2. Per-provider output token caps (builders below).
//  3. This server-side hard truncate: strips list markup and cuts past
//     MAX_SPEECH_CHARS at a sentence boundary. Guaranteed short speech even
//     if a model ignores 1+2.
// ---------------------------------------------------------------------------
export const MAX_SPEECH_CHARS = 380;
export const CHAT_MAX_OUTPUT_TOKENS = 200;
export const RESPONSES_TOOL_MAX_OUTPUT_TOKENS = 1000; // includes reasoning tokens
export const RESPONSES_TEXT_MAX_OUTPUT_TOKENS = 250;
export const CLAUDE_MAX_TOKENS = 220;
export const GEMINI_MAX_OUTPUT_TOKENS = 200;
export const COMPAT_MAX_TOKENS = 200; // xAI chat completions

export function enforceConciseSpeech(text: unknown): string {
  let s = typeof text === 'string' ? text : '';
  s = s
    .replace(/[*#`_]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-–—•]|\d+[.)])\s+/, ''))
    .join(' ')
    .replace(/\s+-\s+/g, ', ') // mid-line "- " list markers ("I can: - Add, - Change")
    .replace(/:\s*,\s*/g, ': ') // tidy "word:, next" left by the rule above
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > MAX_SPEECH_CHARS) {
    const cut = s.slice(0, MAX_SPEECH_CHARS);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = (end > MAX_SPEECH_CHARS * 0.4 ? cut.slice(0, end + 1) : cut).trim();
  }
  return s;
}

/** Gemini generation config. Pure (exported for tests). */
export function buildGeminiConfig(systemText: string | undefined, withTools: boolean): Record<string, any> {
  const config: Record<string, any> = {
    temperature: 0.75,
    maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
  };
  if (systemText !== undefined) config.systemInstruction = systemText;
  if (withTools) {
    config.tools = [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS as any }];
  }
  return config;
}

/**
 * Detects whether an error from Google GenAI is due to exceeded quota, rate limits,
 * service overload, model capacity limits, or high demand conditions.
 */
export function isGeminiDemandOrQuotaError(err: any): boolean {
  if (!err) return false;

  const status =
    err.status ||
    err.statusCode ||
    err.error?.code ||
    err.error?.status ||
    (err.response && err.response.status);

  if (
    status === 429 ||
    status === 503 ||
    status === 529 ||
    status === 'RESOURCE_EXHAUSTED' ||
    status === 'UNAVAILABLE' ||
    status === 'MODEL_CAPACITY_EXCEEDED'
  ) {
    return true;
  }

  const rawMsg = [
    err.message,
    err.error?.message,
    err.statusText,
    typeof err === 'string' ? err : '',
    err.stack,
    JSON.stringify(err),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    rawMsg.includes('resource_exhausted') ||
    rawMsg.includes('quota') ||
    rawMsg.includes('rate limit') ||
    rawMsg.includes('rate_limit') ||
    rawMsg.includes('high demand') ||
    rawMsg.includes('high_demand') ||
    rawMsg.includes('overloaded') ||
    rawMsg.includes('overload') ||
    rawMsg.includes('capacity') ||
    rawMsg.includes('too many requests') ||
    rawMsg.includes('503') ||
    rawMsg.includes('429') ||
    rawMsg.includes('unavailable') ||
    rawMsg.includes('temporarily unavailable') ||
    rawMsg.includes('try again later') ||
    rawMsg.includes('exceeded your current quota') ||
    rawMsg.includes('check your plan and billing details')
  );
}

/**
 * Computes the fallback cascade for a requested Gemini model.
 * If the primary is Gemini 3.8 Flash -> [3.8, 3.7, 3.6].
 * If Gemini 3.7 Flash -> [3.7, 3.6].
 * If Gemini 3.6 Flash -> [3.6].
 * Any other Gemini model -> [requested, 3.7, 3.6].
 */
export function getGeminiFallbackChain(requestedModel: string): string[] {
  const model = resolveApiModelIdServer(requestedModel || 'gemini-3.8-flash');
  if (model === 'gemini-3.8-flash') {
    return ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash'];
  }
  return [model, 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash'];
}

export interface GeminiFallbackExecutionResult<T> {
  result: T;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackNotice?: string;
}

/**
 * Executes a Gemini operation with proactive monitoring for high demand and exceeded quota.
 * Automatically cascades through Gemini 3.8 Flash -> Gemini 3.7 Flash -> Gemini 3.6 Flash.
 */
export async function executeGeminiWithQuotaFallback<T>(
  initialModel: string,
  operation: (modelId: string) => Promise<T>,
  contextTag: string = 'Gemini operation'
): Promise<GeminiFallbackExecutionResult<T>> {
  const chain = getGeminiFallbackChain(initialModel);
  let lastError: any = null;

  for (let i = 0; i < chain.length; i++) {
    const currentModel = chain[i];
    try {
      if (i > 0) {
        console.warn(
          `[Gemini Quota/Demand Monitor] Attempting ${contextTag} with fallback model "${currentModel}"...`
        );
      }
      const result = await operation(currentModel);
      const fallbackOccurred = i > 0;
      const fallbackNotice = fallbackOccurred
        ? `High demand/quota on ${chain[0]}: automatically switched to ${currentModel}`
        : undefined;

      if (fallbackOccurred) {
        console.log(
          `[Gemini Quota/Demand Monitor] Succeeded for ${contextTag} using fallback model "${currentModel}"!`
        );
      }

      return {
        result,
        modelUsed: currentModel,
        fallbackOccurred,
        fallbackNotice,
      };
    } catch (err: any) {
      lastError = err;
      const isQuotaOrDemand = isGeminiDemandOrQuotaError(err);
      const hasNext = i < chain.length - 1;

      console.warn(
        `[Gemini Quota/Demand Monitor] ${contextTag} on "${currentModel}" failed: ${err?.message || err}. (isQuotaOrDemand: ${isQuotaOrDemand}, nextFallbackAvailable: ${hasNext})`
      );

      if (isQuotaOrDemand && hasNext) {
        const nextModel = chain[i + 1];
        console.warn(
          `[Gemini Quota/Demand Monitor] Exceeded quota or high demand on "${currentModel}". Cascading to "${nextModel}"...`
        );
        continue;
      }

      // Check if upstream returned a 5xx or server capacity error
      const status =
        err.status || err.statusCode || err.error?.code || (err.response && err.response.status);
      if (typeof status === 'number' && status >= 500 && hasNext) {
        console.warn(
          `[Gemini Quota/Demand Monitor] Upstream 5xx status (${status}) on "${currentModel}". Cascading to "${chain[i + 1]}"...`
        );
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

async function handleGeminiCall(model: string, apiKey: string | undefined, message: string, context: any, history: any[] = []) {
  const genAI = apiKey ? new GoogleGenAI({ apiKey }) : defaultGemini;
  
  const contents = [
    ...(history || []).slice(-6).map((h: any) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    })),
    {
      role: "user",
      parts: [{ text: message }]
    }
  ];

  const execution = await executeGeminiWithQuotaFallback(
    model || "gemini-3.8-flash",
    async (activeModel) => {
      return await genAI.models.generateContent({
        model: activeModel,
        contents,
        config: buildGeminiConfig(buildSystemPrompt(context), true),
      });
    },
    'voice-agent command'
  );

  const response = execution.result;
  const candidate = response.candidates?.[0];
  const functionCalls: any[] = [];
  let speechText = "";

  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        functionCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args
        });
      }
      if (part.text) {
        speechText += part.text + " ";
      }
    }
  }

  // If the model invoked tools without verbal text, generate a natural conversational summary
  if (!speechText.trim() && functionCalls.length > 0) {
    try {
      const summaryExecution = await executeGeminiWithQuotaFallback(
        execution.modelUsed,
        async (activeModel) => {
          return await genAI.models.generateContent({
            model: activeModel,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `${buildSystemPrompt(context)}\n\nThe user requested: "${message}".\nYou just performed these 3D scene actions: ${JSON.stringify(functionCalls)}.\nIn exactly 1-2 short, warm, spoken sentences (under 45 words, no lists, no markdown), describe what you did and converse with the user.`
                  }
                ]
              }
            ],
            config: buildGeminiConfig(undefined, false),
          });
        },
        'voice-agent speech summary'
      );
      speechText = summaryExecution.result.text || "";
    } catch {
      // Fallback
    }
  }

  return {
    speechText: speechText.trim(),
    functionCalls,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackNotice: execution.fallbackNotice,
  };
}

// ---------------------------------------------------------------------------
// OpenAI payload rules (verified against official docs, Sept 2026):
// - https://developers.openai.com/api/docs/guides/reasoning
// - https://developers.openai.com/api/docs/guides/migrate-to-responses
// - https://developers.openai.com/api/docs/guides/latest-model
// - https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning
//
// gpt-5.6 (luna/terra/sol) are reasoning models defaulting to `medium` effort.
// On /v1/chat/completions ANY request carrying function `tools` fails — even
// with no explicit reasoning_effort — unless `reasoning_effort` is "none":
//   400 Function tools with reasoning_effort are not supported for
//   gpt-5.6-luna in /v1/chat/completions. To use function tools, use
//   /v1/responses or set reasoning_effort to 'none'.
// gpt-6-astra is stricter: `none` itself 400s, and Chat Completions does not
// support function calling with it at all — tool calls MUST use /v1/responses.
// Reasoning models also reject `temperature`/`top_p` on Chat Completions.
// Third-party OpenAI-compatible endpoints (xAI) are unaffected.
// ---------------------------------------------------------------------------
export function isFirstPartyOpenAI(endpointUrl: string): boolean {
  return endpointUrl.includes('api.openai.com');
}

export function isOpenAIReasoningModel(apiModel: string): boolean {
  return /^gpt-(5|6|o)/.test(apiModel);
}

/** gpt-6+ cannot do function tools on Chat Completions at all → /v1/responses. */
export function openAIToolsNeedResponses(apiModel: string): boolean {
  return /^gpt-6/.test(apiModel);
}

function openAIAuthHeaders(key: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

/** Chat Completions body. Pure (exported for tests). */
export function buildChatCompletionsBody(
  endpointUrl: string,
  apiModel: string,
  messages: any[],
  withTools: boolean
): Record<string, any> {
  const body: Record<string, any> = { model: apiModel, messages };
  const firstPartyReasoning = isFirstPartyOpenAI(endpointUrl) && isOpenAIReasoningModel(apiModel);
  if (withTools) {
    body.tools = OPENAI_TOOLS;
    if (firstPartyReasoning) {
      // Documented workaround: tools without reasoning on Chat Completions.
      body.reasoning_effort = 'none';
      body.max_completion_tokens = CHAT_MAX_OUTPUT_TOKENS;
    } else {
      body.temperature = 0.75;
      body.max_tokens = COMPAT_MAX_TOKENS;
    }
  } else if (firstPartyReasoning) {
    body.max_completion_tokens = CHAT_MAX_OUTPUT_TOKENS;
  } else {
    body.temperature = 0.75;
    body.max_tokens = COMPAT_MAX_TOKENS;
  }
  return body;
}

/** Convert Chat Completions function tools to Responses API function tools. */
export function toResponsesTools(openaiTools: any[]): any[] {
  return (openaiTools || []).map((t) => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
    strict: false,
  }));
}

/** Responses API body. Pure (exported for tests). */
export function buildResponsesBody(apiModel: string, messages: any[], withTools: boolean): Record<string, any> {
  const body: Record<string, any> = {
    model: apiModel,
    input: messages,
    store: false,
  };
  if (withTools) {
    body.tools = toResponsesTools(OPENAI_TOOLS);
    // gpt-6-astra has no `none` level; medium is the documented default balance.
    body.reasoning = { effort: 'medium' };
    // Room for reasoning tokens; speech is still hard-truncated downstream.
    body.max_output_tokens = RESPONSES_TOOL_MAX_OUTPUT_TOKENS;
  } else {
    body.max_output_tokens = RESPONSES_TEXT_MAX_OUTPUT_TOKENS;
  }
  return body;
}

/** Parse a /v1/responses payload into { speechText, functionCalls }. Pure. */
export function parseResponsesOutput(data: any): { speechText: string; functionCalls: any[] } {
  let speechText = '';
  const functionCalls: any[] = [];
  for (const item of data?.output || []) {
    if (item?.type === 'message') {
      for (const c of item.content || []) {
        if ((c?.type === 'output_text') && typeof c.text === 'string') speechText += c.text + ' ';
      }
    } else if (item?.type === 'function_call' && item.name) {
      try {
        functionCalls.push({
          name: item.name,
          args: typeof item.arguments === 'string' ? JSON.parse(item.arguments || '{}') : (item.arguments || {}),
        });
      } catch (e) {
        console.warn('Failed to parse Responses function call args:', e);
      }
    }
  }
  return { speechText: speechText.trim(), functionCalls };
}

async function postJson(url: string, key: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: openAIAuthHeaders(key),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error (${res.status}): ${errorText}`);
  }
  return res.json();
}

/**
 * Tool-calling path for models that require /v1/responses (gpt-6-astra).
 * Text-only follow-ups reuse the same endpoint (Chat Completions without
 * tools is allowed for Astra, but Responses keeps a single code path).
 */
async function handleOpenAIResponsesCall(
  model: string,
  key: string,
  message: string,
  context: any,
  history: any[] = []
) {
  const apiModel = resolveApiModelIdServer(model);
  const input = [
    { role: 'system', content: buildSystemPrompt(context) },
    ...(history || []).slice(-6).map((h: any) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  const data = await postJson('https://api.openai.com/v1/responses', key, buildResponsesBody(apiModel, input, true));
  let { speechText, functionCalls } = parseResponsesOutput(data);

  if (!speechText.trim() && functionCalls.length > 0) {
    try {
      const summaryData = await postJson(
        'https://api.openai.com/v1/responses',
        key,
        buildResponsesBody(apiModel, [
          { role: 'system', content: buildSystemPrompt(context) },
          { role: 'user', content: `You just executed these actions for the user's prompt "${message}": ${JSON.stringify(functionCalls)}. In exactly 1-2 short spoken sentences (under 45 words, no lists, no markdown), tell the user what you crafted or modified.` },
        ], false)
      );
      const parsed = parseResponsesOutput(summaryData);
      if (parsed.speechText) speechText = parsed.speechText;
    } catch {}
  }

  return { speechText: speechText.trim(), functionCalls };
}

export async function handleOpenAICompatibleCall(
  endpointUrl: string,
  model: string,
  key: string,
  message: string,
  context: any,
  history: any[] = []
) {
  const apiModel = resolveApiModelIdServer(model);

  // gpt-6-astra: function tools are Responses-only (Chat Completions 400s).
  if (isFirstPartyOpenAI(endpointUrl) && openAIToolsNeedResponses(apiModel)) {
    return handleOpenAIResponsesCall(apiModel, key, message, context, history);
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(context) },
    ...(history || []).slice(-6).map((h: any) => ({ role: h.role, content: h.content })),
    { role: "user", content: message }
  ];

  const data = await postJson(endpointUrl, key, buildChatCompletionsBody(endpointUrl, apiModel, messages, true));

  const choice = data.choices?.[0]?.message;
  let speechText = choice?.content || "";
  const functionCalls: any[] = [];

  if (choice?.tool_calls) {
    for (const tool of choice.tool_calls) {
      if (tool.function) {
        try {
          functionCalls.push({
            name: tool.function.name,
            args: typeof tool.function.arguments === 'string' ? JSON.parse(tool.function.arguments) : tool.function.arguments
          });
        } catch (e) {
          console.warn("Failed to parse tool call args:", e);
        }
      }
    }
  }

  // If text is missing with tool calls, generate spontaneous voice text
  if (!speechText.trim() && functionCalls.length > 0) {
    try {
      const sData = await postJson(endpointUrl, key, buildChatCompletionsBody(endpointUrl, apiModel, [
        { role: "system", content: buildSystemPrompt(context) },
        { role: "user", content: `You just executed these actions for the user's prompt "${message}": ${JSON.stringify(functionCalls)}. In exactly 1-2 short spoken sentences (under 45 words, no lists, no markdown), tell the user what you crafted or modified.` }
      ], false));
      speechText = sData.choices?.[0]?.message?.content || "";
    } catch {}
  }

  return { speechText: speechText.trim(), functionCalls };
}

/** Claude Messages body. Pure (exported for tests). max_tokens is required by Anthropic. */
export function buildClaudeBody(apiModel: string, systemText: string, messages: any[]): Record<string, any> {
  return {
    model: apiModel,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: systemText,
    messages,
    tools: CLAUDE_TOOLS,
    temperature: 0.75,
  };
}

async function handleClaudeCall(model: string, key: string, message: string, context: any, history: any[] = []) {
  const apiModel = resolveApiModelIdServer(model);
  const messages = [
    ...(history || []).slice(-6).map((h: any) => ({ role: h.role, content: h.content })),
    { role: "user", content: message }
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify(buildClaudeBody(apiModel, buildSystemPrompt(context), messages))
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Claude API Error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  let speechText = "";
  const functionCalls: any[] = [];

  if (data.content && Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'text') {
        speechText += block.text + " ";
      } else if (block.type === 'tool_use') {
        functionCalls.push({
          name: block.name,
          args: block.input
        });
      }
    }
  }

  return { speechText: speechText.trim(), functionCalls };
}

/**
 * Express error-handling middleware (4 args) for oversized JSON bodies.
 * body-parser raises `{ type: 'entity.too.large', status: 413 }` beyond the
 * configured `express.json({ limit })`. Responds with JSON (including a
 * speakable `speechText`) so API clients never receive an HTML error page.
 * Exported for unit tests.
 */
export function requestTooLargeHandler(err: any, _req: any, res: any, next: any): void {
  const isTooLarge = err && (err.type === 'entity.too.large' || err.status === 413);
  if (!isTooLarge) {
    next(err);
    return;
  }
  console.warn(`Rejected oversized request body (${err.length || 'unknown'} bytes, limit exceeded).`);
  res.status(413).json({
    error: 'Request entity too large',
    speechText: 'That request was too large to process. Please try a shorter message, or start a new voice session to reset the conversation.',
    functionCalls: [],
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Default express.json() caps bodies at 100kb, which trips
  // PayloadTooLargeError once voice-agent context carries diagnostics
  // snapshots, long memory-fact lists, history, agentic WGSL payloads, or audio.
  app.use(express.json({ limit: '25mb' }));

  // API health
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Gemini Audio Transcription Endpoint



  app.post("/api/tts", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "No text provided" });
      }

      console.log(`[TTS] Generating audio using advanced AI voice engine, text: ${text.substring(0, 30)}...`);
      
      const { EdgeTTS } = await import('edge-tts-universal');
      // Use AriaNeural for highly natural female conversational voice
      const tts = new EdgeTTS(text, 'en-US-AriaNeural');
      const audioRes = await tts.synthesize();
      
      const arrayBuffer = await audioRes.audio.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(buffer);
    } catch (err) {
      console.error("[TTS Error]:", err);
      res.status(500).json({ error: err?.message || "Synthesis failed" });
    }
  });

  // Keep existing /api/transcribe
  app.post("/api/transcribe",
 async (req, res) => {
    try {
      const { audio, mimeType = "audio/webm", apiKey } = req.body || {};
      if (!audio || typeof audio !== 'string') {
        return res.status(400).json({ error: "Audio data is required", transcript: "" });
      }

      let base64Data = audio;
      let detectedMimeType = mimeType || 'audio/webm';

      // Clean Data URL prefix if present (e.g. data:audio/webm;codecs=opus;base64,...)
      if (base64Data.includes(',')) {
        const parts = base64Data.split(',');
        const header = parts[0];
        base64Data = parts.slice(1).join(',');
        const mimeMatch = header.match(/data:(.*?);base64/);
        if (mimeMatch && mimeMatch[1]) {
          detectedMimeType = mimeMatch[1];
        }
      }

      // Gemini expects clean standard MIME format without parameters like ';codecs=...'
      const cleanMimeType = detectedMimeType.split(';')[0].trim() || 'audio/webm';

      const key = apiKey || process.env.GEMINI_API_KEY;
      const genAI = key ? new GoogleGenAI({ apiKey: key }) : defaultGemini;

      const contents = [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: cleanMimeType,
              }
            },
            {
              text: "Transcribe the spoken words from this audio clip verbatim. Output ONLY the raw transcribed text with no explanations, no introduction, no markdown, and no quotes. If silent, inaudible, or noise only, output nothing."
            }
          ]
        }
      ];

      const execution = await executeGeminiWithQuotaFallback(
        "gemini-3.8-flash",
        async (activeModel) => {
          return await genAI.models.generateContent({
            model: activeModel,
            contents,
            config: {
              systemInstruction: "You are a raw audio transcription engine. You must transcribe the user's audio verbatim. Output EXACTLY and ONLY what is spoken. If no words are clearly spoken, or if it is just silence or background noise, you MUST output the exact string 'SILENCE_DETECTED'. Do not hallucinate, do not respond to questions.",
              temperature: 0.0,
            }
          });
        },
        'audio transcription'
      );
      let transcript = (execution.result.text || "").trim();

      // Strip any extra quotes or backticks if generated
      transcript = transcript.replace(/^["'`]+|["'`]+$/g, '').trim();
      
      // Filter out silence token and typical hallucinations
      if (transcript.includes("SILENCE_DETECTED") || 
          transcript.includes("it appears that for") || 
          transcript.toLowerCase().includes("transcribe the spoken words") ||
          transcript.toLowerCase().includes("output only the raw transcribed text") ||
          transcript.toLowerCase().includes("please subscribe") ||
          transcript.toLowerCase().includes("thanks for watching")) {
        transcript = "";
      }

      res.json({ transcript, modelUsed: execution.modelUsed, fallbackOccurred: execution.fallbackOccurred });
    } catch (err: any) {
      console.error("Gemini audio transcription error:", err?.message || err);
      res.status(500).json({ error: err?.message || "Transcription failed", transcript: "" });
    }
  });

  // Agentic Multi-Model Voice Endpoint
  app.post("/api/voice-agent", async (req, res) => {
    try {
      const { message, model: rawModel = "gemini-3.8-flash", apiKey, context, history = [] } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      // Normalize historic / alias ids to exact provider API ids (verified Sept 2026).
      const model = resolveApiModelIdServer(rawModel);
      if (model !== rawModel) {
        console.log(`Voice Agent model normalized: ${rawModel} -> ${model}`);
      }

      console.log(`Voice Agent [Model: ${model}] prompt:`, message);

      let result: {
        speechText: string;
        functionCalls: any[];
        modelUsed?: string;
        fallbackOccurred?: boolean;
        fallbackNotice?: string;
      };

      // Provider Dispatcher based on verified model identifiers
      if (model.startsWith("gemini-")) {
        result = await handleGeminiCall(model, apiKey, message, context, history);
      } else if (model.startsWith("gpt-")) {
        const key = apiKey || process.env.OPENAI_API_KEY;
        if (!key) {
          return res.json({
            speechText: "Please enter your OpenAI API key in the settings menu to connect ChatGPT.",
            functionCalls: []
          });
        }
        result = await handleOpenAICompatibleCall("https://api.openai.com/v1/chat/completions", model, key, message, context, history);
      } else if (model.startsWith("grok-")) {
        const key = apiKey || process.env.XAI_API_KEY;
        if (!key) {
          return res.json({
            speechText: "Please enter your xAI API key in the settings menu to connect Grok.",
            functionCalls: []
          });
        }
        result = await handleOpenAICompatibleCall("https://api.x.ai/v1/chat/completions", model, key, message, context, history);
      } else if (model.startsWith("claude-")) {
        const key = apiKey || process.env.ANTHROPIC_API_KEY;
        if (!key) {
          return res.json({
            speechText: "Please enter your Anthropic API key in the settings menu to connect Claude.",
            functionCalls: []
          });
        }
        result = await handleClaudeCall(model, key, message, context, history);
      } else {
        // Fallback to default Gemini (should be unreachable after resolveApiModelIdServer
        // validation above; logged so silent Gemini routing is always observable).
        console.warn(`No provider matched model "${model}" — falling back to gemini-3.8-flash.`);
        result = await handleGeminiCall("gemini-3.8-flash", apiKey, message, context, history);
      }

      let { speechText, functionCalls } = result;

      // SERVER-SIDE WGSL SAFETY GATE: validate any shader payloads the LLM
      // produced BEFORE the client ever compiles them. Rejected payloads are
      // stripped so a bad shader can never reach the GPU (prevents device loss).
      const safeCalls: any[] = [];
      const rejectionNotes: string[] = [];
      for (const call of functionCalls || []) {
        if (call?.name === 'updateSceneShader') {
          const sdfCheck = validateCustomWGSLServer(call.args?.customSDF ?? '', 'snippet');
          const matCheck = validateCustomWGSLServer(call.args?.customMats ?? 'else if (mat == 100u) {}', 'snippet');
          if (!sdfCheck.ok || !matCheck.ok) {
            rejectionNotes.push(`updateSceneShader rejected: ${[...sdfCheck.errors, ...matCheck.errors].join('; ')}`);
            continue;
          }
          safeCalls.push(call);
        } else if (call?.name === 'compileCustomComputePipeline') {
          const compCheck = validateCustomWGSLServer(call.args?.computeWGSL ?? '', 'compute');
          const blitCheck = call.args?.blitWGSL
            ? validateCustomWGSLServer(call.args.blitWGSL, 'blit')
            : { ok: true, errors: [] as string[] };
          if (!compCheck.ok || !blitCheck.ok) {
            rejectionNotes.push(`compileCustomComputePipeline rejected: ${[...compCheck.errors, ...blitCheck.errors].join('; ')}`);
            continue;
          }
          safeCalls.push(call);
        } else {
          safeCalls.push(call);
        }
      }
      functionCalls = safeCalls;
      if (rejectionNotes.length > 0) {
        console.warn('WGSL safety gate rejections:', rejectionNotes);
        speechText = `${speechText} Note: I blocked an unsafe shader update (${rejectionNotes[0].slice(0, 160)}). The last good visuals are still running.`.trim();
      }

      // Hard brevity guarantee (all providers): strip list markup and truncate
      // past MAX_SPEECH_CHARS at a sentence boundary so speech stays short,
      // informal, and speakable even if a model ignores the prompt + token caps.
      speechText = enforceConciseSpeech(speechText);

      if (!speechText) {
        speechText = "I've updated the 3D scene according to your vision.";
      }

      res.json({
        speechText,
        functionCalls,
        modelUsed: result.modelUsed || model,
        fallbackOccurred: !!result.fallbackOccurred,
        fallbackNotice: result.fallbackNotice
      });
    } catch (err: any) {
      console.error("Voice Agent error:", err);
      res.status(500).json({ 
        error: "Failed to process voice command",
        speechText: err.message ? `Error: ${err.message.slice(0, 120)}` : "Sorry, I had trouble processing that request. Please try again!"
      });
    }
  });

  // Cross-Session Memory Summarizer Endpoint
  app.post("/api/summarize-session", async (req, res) => {
    const { history = [], currentMemory = null, model: rawSummaryModel = "gemini-3.8-flash", apiKey } = req.body || {};
    try {
      if (!history || history.length === 0) {
        return res.json({ 
          summary: currentMemory?.summary || "Explored the 3D raytraced world.",
          facts: currentMemory?.facts || [],
          items: []
        });
      }

      const genAI = apiKey ? new GoogleGenAI({ apiKey }) : defaultGemini;
      const prompt = `You are the memory consolidation subsystem for the "Happy Home" WebGPU 3D raytracer AI director.
Analyze this recently concluded session between the user and the AI director.

PREVIOUS USER MEMORY PROFILE:
${JSON.stringify(currentMemory || { summary: "None yet", facts: [] }, null, 2)}

SESSION TRANSCRIPT:
${history.map((h: any) => `${h.role.toUpperCase()}: ${h.content}`).join('\n')}

INSTRUCTIONS:
1. Synthesize an updated, highly coherent 2-3 sentence overview ('summary') describing the user's artistic personality, favorite lighting/moods, preferred shapes/objects, camera angles, and creative habits.
2. Compile a list of key bullet facts ('facts') capturing concrete preferences (e.g. "Prefers twilight and golden hour lighting", "Likes floating cyan crystals along the walkway", "Prefers high godray volumetric intensity").
3. Extract granular memory items ('items') categorized as:
   - "preference" (e.g. favorite color, lighting, or preset)
   - "creative_style" (e.g. minimal, lush, neon, tranquil)
   - "fact" (e.g. named the cottage, mentioned a specific project)
   - "custom_instruction" (e.g. wants short explanations, specific terminology)

OUTPUT FORMAT: Strict JSON only.
{
  "summary": "Updated concise multi-session overview text",
  "facts": ["Fact 1", "Fact 2", "Fact 3"],
  "items": [
    { "category": "preference", "text": "Prefers sunset and golden hour solar angles" },
    { "category": "creative_style", "text": "Likes placing glowing warm lanterns along the front path" }
  ]
}`;

      const summaryModelRaw = resolveApiModelIdServer(rawSummaryModel);
      const summaryModel = summaryModelRaw.startsWith("gemini-") ? summaryModelRaw : "gemini-3.8-flash";
      const execution = await executeGeminiWithQuotaFallback(
        summaryModel,
        async (activeModel) => {
          return await genAI.models.generateContent({
            model: activeModel,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              responseMimeType: "application/json"
            }
          });
        },
        'session summarization'
      );

      const parsed = JSON.parse(execution.result.text || "{}");
      res.json({
        summary: parsed.summary || currentMemory?.summary || "Enjoys crafting photorealistic 3D raytraced scenes.",
        facts: parsed.facts || currentMemory?.facts || [],
        items: parsed.items || [],
        modelUsed: execution.modelUsed,
        fallbackOccurred: execution.fallbackOccurred
      });
    } catch (err: any) {
      console.error("Session summarizer error:", err);
      res.status(500).json({ 
        error: "Failed to summarize session",
        summary: currentMemory?.summary || "Explored the 3D raytraced world.",
        facts: currentMemory?.facts || [],
        items: []
      });
    }
  });

  // Central error handler for API routes. Must be registered after the routes
  // (Express skips regular middleware once err is set) and before the Vite /
  // static fallthrough. Converts PayloadTooLargeError into a JSON 413 the
  // voice client can speak, instead of an HTML error page that surfaces as a
  // generic failure.
  app.use(requestTooLargeHandler);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Only auto-start when executed directly (`tsx server.ts` in dev,
// `node dist/server.cjs` in prod). Importing the module (tests) must not
// bind the port.
const invokedDirectly = !!process.argv[1] && /server\.(cjs|js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  startServer();
}
