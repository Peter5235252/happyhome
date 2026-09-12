/**
 * WebGPU Raytracer Types & Configurations
 */

export interface CameraState {
  distance: number;
  azimuth: number; // in radians
  elevation: number; // in radians
  target: [number, number, number];
  fov: number; // in degrees
}

export type DebugRenderMode = 
  | 0 // Full Beauty (PBR + GI + Godrays)
  | 1 // Surface Normals
  | 2 // Global Illumination (Indirect Color Bleed)
  | 3 // Volumetric Godrays In-Scattering
  | 4 // Ambient Occlusion
  | 5 // Direct Sun & Shadows
  | 6 // Raymarch Complexity / Step Count

export interface RenderSettings {
  timeOfDay: number; // 0.0 to 1.0 (0.2 = sunrise, 0.35 = daylight, 0.7 = golden hour, 0.85 = sunset)
  godraysEnabled: boolean;
  godrayIntensity: number;
  giEnabled: boolean;
  giIntensity: number;
  aoIntensity: number;
  reflectionsEnabled: boolean;
  smokeSpeed: number;
  windSpeed: number;
  cloudDensity: number;
  cameraPreset: 'home_perspective' | 'svg_perspective' | 'cinematic' | 'meadow' | 'sunset' | 'aerial' | 'dramatic_low' | 'close_up' | 'garden_bench' | 'roof_chimney' | 'kite_flight' | string;
  debugMode: DebugRenderMode;
  resolutionScale: number; // 0.5, 0.75, 1.0
  lodMode: 'auto' | 'ultra' | 'balanced' | 'performance';
  lodBias: number; // 0.5 to 2.0 (1.0 default)
  simulationSpeed: number; // 0.0 to 5.0 (1.0 default)
  showBaseCottage?: boolean; // Controls whether base cottage structure is rendered
  environmentStyle?: 'meadow' | 'courtyard' | 'desert' | 'water' | 'void' | 'alien' | string;
}

export interface WebGPUDiagnostics {
  adapterName: string;
  vendor: string;
  architecture: string;
  limits: Record<string, number | string>;
  shaderStatus: 'ok' | 'compiling' | 'error';
  shaderErrors: string[];
  validationErrors: string[];
  lastErrorTime?: string;
  customShaderActive?: boolean;
  customShaderLinesCount?: number;
  isWebGPUStrict?: boolean;
  hardwareSafetyStatus?: 'safe' | 'monitoring' | 'warning';
  lastShaderCompilationTime?: string;
}

export interface PerformanceStats {
  fps: number;
  frameTimeMs: number;
  gpuName: string;
  resolution: [number, number];
  sampleIndex: number;
  diagnostics: WebGPUDiagnostics;
}

export type DynamicShapeType = 
  | 'sphere'
  | 'box'
  | 'cylinder'
  | 'capsule'
  | 'torus'
  | 'cone'
  | 'crystal'
  | 'gem'
  | 'lantern'
  | 'pyramid'
  | 'prism'
  | 'arch'
  | 'pillar'
  | 'column'
  | 'fountain'
  | 'bench'
  | 'star'
  | 'flower'
  | 'custom_procedural'
  | string;

export interface DynamicObject {
  id?: string;
  label?: string;
  shape: DynamicShapeType;
  position: number[];
  size?: number[];
  color: number[];
  roughness?: number;
  metallic?: number;
  subsurface?: number;
  isGlass?: boolean;
  emissive?: number[];
  customFormula?: string; // Optional custom mathematical WGSL SDF expression
}
