/**
 * WebGPU Raytracing & Global Illumination Render Pipeline
 * Manages GPU adapter, device, swap chain, uniform buffers, and render passes.
 * Includes comprehensive WebGPU debugging, error scope capture, and diagnostics.
 */

import { getComputeShaderWGSL, BLIT_SHADER_WGSL } from './shaders/raytracer.compute.wgsl.ts';
import { sanitizeInjectedWGSL, validateFullWGSL } from './shaders/wgslSafety.ts';
import { CameraState, PerformanceStats, RenderSettings, WebGPUDiagnostics } from './types';

export class WebGPURenderer {
  private canvas: HTMLCanvasElement;
  public adapter: GPUAdapter | null = null;
  public device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  
  // Compute & Blit Pipelines
  private computePipeline: GPUComputePipeline | null = null;
  private computeBindGroupLayout: GPUBindGroupLayout | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  
  private blitPipeline: GPURenderPipeline | null = null;
  private blitBindGroupLayout: GPUBindGroupLayout | null = null;
  private blitBindGroup: GPUBindGroup | null = null;
  private blitSampler: GPUSampler | null = null;
  
  // Offscreen HDR & TAA Textures
  private outputTexture: GPUTexture | null = null;
  private historyTexture: GPUTexture | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  
  private animationFrameId: number | null = null;
  private startTime: number = performance.now();
  private lastTime: number = performance.now();
  private frameCount: number = 0;
  private sampleIndex: number = 0;
  private fps: number = 60;
  private frameTimeMs: number = 16.6;

  // Previous camera state to detect movement for TAA
  private prevCamPos: [number, number, number] = [0, 0, 0];
  private prevCamTarget: [number, number, number] = [0, 0, 0];
  private prevFov: number = 46;
  private prevTimeOfDay: number = 0.35;
  
  private onStatsCallback?: (stats: PerformanceStats) => void;
  private isDestroyed: boolean = false;

  public diagnostics: WebGPUDiagnostics = {
    adapterName: 'Initializing Compute Raytracer...',
    vendor: 'Unknown',
    architecture: 'Unknown',
    limits: {},
    shaderStatus: 'compiling',
    shaderErrors: [],
    validationErrors: [],
  };

  // Camera State
  public camera: CameraState = {
    distance: 10.2,
    azimuth: -0.04,
    elevation: 1.48,
    target: [0.0, 1.6, 0.0],
    fov: 46,
  };

  // Render Settings
  public settings: RenderSettings = {
    timeOfDay: 0.35, // Bright cheerful daylight like SVG
    godraysEnabled: true,
    godrayIntensity: 1.2,
    giEnabled: true,
    giIntensity: 1.0,
    aoIntensity: 1.0,
    reflectionsEnabled: true,
    smokeSpeed: 1.0,
    windSpeed: 1.0,
    cloudDensity: 0.8,
    cameraPreset: 'svg_perspective',
    showOriginalSvg: false,
    debugMode: 0,
    resolutionScale: 1.0,
    audioEnabled: true,
  };

  public dynamicObjects: import("./types").DynamicObject[] = [];

  constructor(canvas: HTMLCanvasElement, onStats?: (stats: PerformanceStats) => void) {
    this.canvas = canvas;
    this.onStatsCallback = onStats;
  }

  /**
   * Initializes WebGPU Compute Shader Raytracer with zero fallback to WebGL.
   */
  public async init(): Promise<void> {
    if (!('gpu' in navigator) || !navigator.gpu) {
      throw new Error(
        'WebGPU is not supported in this browser. A WebGPU-compliant browser (Chrome 113+, Edge, or Firefox Nightly) and compatible GPU hardware are required.'
      );
    }

    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!this.adapter) {
      throw new Error(
        'Failed to obtain WebGPU adapter. Please ensure hardware acceleration is enabled in browser settings.'
      );
    }

    // Inspect Adapter Info
    const adapterInfo: any = (this.adapter as any).info || {};
    this.diagnostics.adapterName = adapterInfo.description || adapterInfo.device || 'WebGPU Compute Graphics Adapter';
    this.diagnostics.vendor = adapterInfo.vendor || 'Hardware Vendor';
    this.diagnostics.architecture = adapterInfo.architecture || 'WebGPU Compute Core';

    // Store key limits
    const limitsObj: Record<string, number | string> = {};
    const limitsToInspect = [
      'maxBufferSize',
      'maxComputeWorkgroupSizeX',
      'maxComputeWorkgroupSizeY',
      'maxComputeInvocationsPerWorkgroup',
      'maxUniformBufferBindingSize',
      'maxTextureDimension2D',
    ];
    for (const key of limitsToInspect) {
      if ((this.adapter.limits as any)[key] !== undefined) {
        limitsObj[key] = (this.adapter.limits as any)[key];
      }
    }
    this.diagnostics.limits = limitsObj;

    this.device = await this.adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: Math.min(this.adapter.limits.maxBufferSize, 256 * 1024 * 1024),
      },
    });

    // Uncaptured validation error listener
    this.device.addEventListener('uncapturederror', (event: any) => {
      const msg = event?.error?.message || 'Uncaptured WebGPU Error';
      console.warn('WebGPU Uncaptured Error:', msg);
      this.diagnostics.validationErrors.push(msg);
      this.diagnostics.lastErrorTime = new Date().toLocaleTimeString();
    });

    this.device.lost.then((info) => {
      console.error(`WebGPU device was lost: ${info.message}`);
      this.diagnostics.validationErrors.push(`Device Lost: ${info.message}`);
    });

    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) {
      throw new Error('Failed to get WebGPU canvas context.');
    }
    this.context = ctx;

    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: canvasFormat,
      alphaMode: 'opaque',
    });

    // Uniform buffer: 32 floats * 4 bytes = 128 bytes
    this.uniformBuffer = this.device.createBuffer({
      label: 'RaytracerUniformBuffer',
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Compile Compute Shader Module with Diagnostics
    this.device.pushErrorScope('validation');

    const computeModule = this.device.createShaderModule({
      label: 'HappyHomeComputeShader',
      code: getComputeShaderWGSL(),
    });

    try {
      const compilationInfo = await computeModule.getCompilationInfo();
      const errors = compilationInfo.messages.filter((m) => m.type === 'error');
      const warnings = compilationInfo.messages.filter((m) => m.type === 'warning');

      if (errors.length > 0) {
        this.diagnostics.shaderStatus = 'error';
        this.diagnostics.shaderErrors = errors.map(
          (e) => `Line ${e.lineNum}:${e.linePos} - ${e.message}`
        );
        const errorDetails = this.diagnostics.shaderErrors.join('\n');
        throw new Error(`Compute WGSL Shader Compilation Error:\n${errorDetails}`);
      } else {
        this.diagnostics.shaderStatus = 'ok';
        this.diagnostics.shaderErrors = warnings.map(
          (w) => `[Warning] Line ${w.lineNum}:${w.linePos} - ${w.message}`
        );
      }
    } catch (err: any) {
      this.diagnostics.shaderStatus = 'error';
      throw err;
    }

    // Compile Blit Shader Module
    const blitModule = this.device.createShaderModule({
      label: 'HappyHomeBlitShader',
      code: BLIT_SHADER_WGSL,
    });

    // Compute Bind Group Layout
    this.computeBindGroupLayout = this.device.createBindGroupLayout({
      label: 'ComputeBindGroupLayout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' },
        },
      ],
    });

    const computePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.computeBindGroupLayout],
    });

    this.computePipeline = this.device.createComputePipeline({
      label: 'ComputeRaytracerPipeline',
      layout: computePipelineLayout,
      compute: {
        module: computeModule,
        entryPoint: 'main',
      },
    });

    // Blit Pipeline Layout
    this.blitSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.blitBindGroupLayout = this.device.createBindGroupLayout({
      label: 'BlitBindGroupLayout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });

    const blitPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.blitBindGroupLayout],
    });

    this.blitPipeline = this.device.createRenderPipeline({
      label: 'BlitRenderPipeline',
      layout: blitPipelineLayout,
      vertex: {
        module: blitModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: blitModule,
        entryPoint: 'fs_main',
        targets: [{ format: canvasFormat }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    const validationError = await this.device.popErrorScope();
    if (validationError) {
      console.error('WebGPU Pipeline Validation Error:', validationError.message);
      this.diagnostics.validationErrors.push(validationError.message);
      throw new Error(`WebGPU Validation Error: ${validationError.message}`);
    }

    // Create Initial Textures & Bind Groups
    this.recreateTextures(this.canvas.width || 800, this.canvas.height || 600);
    this.applyPreset('svg_perspective');
    this.startRenderLoop();
  }

  private recreateTextures(width: number, height: number): void {
    if (!this.device) return;

    const w = Math.max(1, width);
    const h = Math.max(1, height);

    if (this.outputTexture) {
      try { this.outputTexture.destroy(); } catch {}
      this.outputTexture = null;
    }
    if (this.historyTexture) {
      try { this.historyTexture.destroy(); } catch {}
      this.historyTexture = null;
    }

    this.outputTexture = this.device.createTexture({
      label: 'ComputeOutputTexture',
      size: [w, h, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });

    this.historyTexture = this.device.createTexture({
      label: 'TAAHistoryTexture',
      size: [w, h, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });

    this.updateBindGroups();
    this.sampleIndex = 0;
  }

  private updateBindGroups(): void {
    if (
      !this.device ||
      !this.computeBindGroupLayout ||
      !this.blitBindGroupLayout ||
      !this.uniformBuffer ||
      !this.outputTexture ||
      !this.historyTexture ||
      !this.blitSampler
    ) {
      return;
    }

    this.computeBindGroup = this.device.createBindGroup({
      label: 'ComputeRaytracerBindGroup',
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.historyTexture.createView() },
        { binding: 2, resource: this.outputTexture.createView() },
      ],
    });

    this.blitBindGroup = this.device.createBindGroup({
      label: 'BlitBindGroup',
      layout: this.blitBindGroupLayout,
      entries: [
        { binding: 0, resource: this.outputTexture.createView() },
        { binding: 1, resource: this.blitSampler },
      ],
    });
  }

  public setPreset(preset: 'svg_perspective' | 'cinematic' | 'meadow' | 'sunset' | 'aerial' | 'dramatic_low' | 'close_up' | string) {
    this.applyPreset(preset as any);
    this.sampleIndex = 0;
  }

  public setCameraPreset(preset: 'svg_perspective' | 'cinematic' | 'meadow' | 'sunset' | 'aerial' | 'dramatic_low' | 'close_up' | string) {
    this.setPreset(preset);
  }

  public setCamera(params: {
    azimuth?: number;
    elevation?: number;
    distance?: number;
    target?: [number, number, number];
    fov?: number;
    preset?: string;
  }) {
    if (params.preset) {
      this.applyPreset(params.preset as any);
    }
    if (params.azimuth !== undefined) this.camera.azimuth = params.azimuth;
    if (params.elevation !== undefined) this.camera.elevation = params.elevation;
    if (params.distance !== undefined) this.camera.distance = params.distance;
    if (params.target !== undefined) this.camera.target = params.target;
    if (params.fov !== undefined) this.camera.fov = params.fov;
    this.sampleIndex = 0;
  }

  public async setDynamicObjects(objects: import("./types").DynamicObject[]): Promise<void> {
    if (!this.device || !this.computeBindGroupLayout) return;

    let dynamicSDF = "";
    let dynamicMats = "";

    objects.forEach((obj, idx) => {
      const matId = 100 + idx;
      const pos = obj.position || [0, 1, 0];
      const size = obj.size || [0.5, 0.5, 0.5];
      const col = obj.color || [1.0, 0.8, 0.2];

      const pX = pos[0]?.toFixed(4) || "0.0";
      const pY = pos[1]?.toFixed(4) || "1.0";
      const pZ = pos[2]?.toFixed(4) || "0.0";

      const s0 = size[0]?.toFixed(4) || "0.5";
      const s1 = (size[1] ?? size[0])?.toFixed(4) || "0.5";
      const s2 = (size[2] ?? size[0])?.toFixed(4) || "0.5";

      const r = col[0]?.toFixed(4) || "1.0";
      const g = col[1]?.toFixed(4) || "0.8";
      const b = col[2]?.toFixed(4) || "0.2";

      const roughness = (obj.roughness ?? 0.25).toFixed(4);
      const metallic = (obj.metallic ?? 0.3).toFixed(4);
      const emissive = obj.emissive || (obj.shape === "lantern" ? [1.5, 1.2, 0.6] : [0.0, 0.0, 0.0]);
      const eR = (emissive[0] || 0.0).toFixed(4);
      const eG = (emissive[1] || 0.0).toFixed(4);
      const eB = (emissive[2] || 0.0).toFixed(4);

      const shape = (obj.shape || "sphere").toLowerCase();

      if (shape === "box") {
        dynamicSDF += `
  let dDynBox_${idx} = sdBox(p - vec3f(${pX}, ${pY}, ${pZ}), vec3f(${s0}, ${s1}, ${s2}));
  res = opU(res, Hit(dDynBox_${idx}, ${matId}u, p.xy));`;
      } else if (shape === "cylinder") {
        dynamicSDF += `
  let dDynCyl_${idx} = sdCylinder(p - vec3f(${pX}, ${pY}, ${pZ}), ${s0}, ${s1});
  res = opU(res, Hit(dDynCyl_${idx}, ${matId}u, p.xy));`;
      } else if (shape === "capsule") {
        dynamicSDF += `
  let dDynCap_${idx} = sdCapsule(p - vec3f(${pX}, ${pY}, ${pZ}), vec3f(0.0, -${s1}, 0.0), vec3f(0.0, ${s1}, 0.0), ${s0});
  res = opU(res, Hit(dDynCap_${idx}, ${matId}u, p.xy));`;
      } else if (shape === "torus") {
        dynamicSDF += `
  let dDynTor_${idx} = sdTorus(p - vec3f(${pX}, ${pY}, ${pZ}), vec2f(${s0}, ${s1}));
  res = opU(res, Hit(dDynTor_${idx}, ${matId}u, p.xy));`;
      } else if (shape === "cone") {
        dynamicSDF += `
  let dDynCone_${idx} = sdCone(p - vec3f(${pX}, ${pY}, ${pZ}), vec2f(0.8, 0.6), ${s0});
  res = opU(res, Hit(dDynCone_${idx}, ${matId}u, p.xy));`;
      } else if (shape === "crystal" || shape === "gem") {
        dynamicSDF += `
  let dDynOct_${idx} = sdOctahedron(p - vec3f(${pX}, ${pY}, ${pZ}), ${s0});
  res = opU(res, Hit(dDynOct_${idx}, ${matId}u, p.xy));`;
      } else if (shape === "lantern") {
        dynamicSDF += `
  let dDynLant_${idx} = sdRoundBox(p - vec3f(${pX}, ${pY}, ${pZ}), vec3f(${s0}, ${s1}, ${s0}), 0.05);
  res = opU(res, Hit(dDynLant_${idx}, ${matId}u, p.xy));`;
      } else {
        // Default to sphere
        dynamicSDF += `
  let dDynSph_${idx} = sdSphere(p - vec3f(${pX}, ${pY}, ${pZ}), ${s0});
  res = opU(res, Hit(dDynSph_${idx}, ${matId}u, p.xy));`;
      }

      dynamicMats += `
  else if (mat == ${matId}u) {
    m.albedo = vec3f(${r}, ${g}, ${b});
    m.roughness = ${roughness};
    m.metallic = ${metallic};
    m.emission = vec3f(${eR}, ${eG}, ${eB});
  }`;
    });

    try {
      // Sanitize AI-derived snippets BEFORE interpolation. This prevents a
      // single backtick / ${...} from unterminating the TS template literal
      // in raytracer.compute.wgsl.ts — the exact failure that produced
      // "vite:esbuild Unexpected export at 1220:0" on the /app/applet deploy
      // when a corrupted/duplicated file broke the transform.
      const safeSDF = sanitizeInjectedWGSL(dynamicSDF, 'dynamicSDF');
      const safeMats = sanitizeInjectedWGSL(dynamicMats, 'dynamicMats');
      const code = getComputeShaderWGSL(safeSDF, safeMats);
      const computeModule = this.device.createShaderModule({
        label: 'HappyHomeDynamicComputeShader',
        code,
      });

      const compilationInfo = await computeModule.getCompilationInfo();
      const shaderErrors = compilationInfo.messages.filter((m) => m.type === 'error');
      if (shaderErrors.length > 0) {
        const details = shaderErrors.map((e) => `Line ${e.lineNum}:${e.linePos} - ${e.message}`).join('\n');
        console.error(`Dynamic WGSL recompilation rejected:\n${details}`);
        this.diagnostics.shaderStatus = 'error';
        this.diagnostics.shaderErrors = shaderErrors.map((e) => `Line ${e.lineNum}:${e.linePos} - ${e.message}`);
        return;
      }

      const computePipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [this.computeBindGroupLayout],
      });

      this.computePipeline = this.device.createComputePipeline({
        label: 'DynamicComputeRaytracerPipeline',
        layout: computePipelineLayout,
        compute: {
          module: computeModule,
          entryPoint: 'main',
        },
      });

      this.diagnostics.shaderStatus = 'ok';
      this.sampleIndex = 0;
    } catch (err) {
      console.error("Failed to recompile compute shader with dynamic objects:", err);
    }
  }

  /**
   * FULL AGENTIC CONTROL — custom scene shader injection.
   * The AI director may supply raw WGSL for the SDF + material hooks.
   * Strictly WebGPU/WGSL-only; WebGL/GLSL is rejected before compilation.
   */
  public async setCustomSceneShader(customSDF: string, customMats: string): Promise<void> {
    if (!this.device || !this.computeBindGroupLayout) {
      throw new Error('Renderer not initialized.');
    }
    const safeSDF = sanitizeInjectedWGSL(customSDF || '', 'customSDF');
    const safeMats = sanitizeInjectedWGSL(customMats || '', 'customMats');
    const code = getComputeShaderWGSL(safeSDF, safeMats);

    const computeModule = this.device.createShaderModule({
      label: 'HappyHomeAgenticCustomShader',
      code,
    });
    const info = await computeModule.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length > 0) {
      const details = errors.map((e) => `Line ${e.lineNum}:${e.linePos} - ${e.message}`).join('\n');
      this.diagnostics.shaderStatus = 'error';
      this.diagnostics.shaderErrors = errors.map((e) => `Line ${e.lineNum}:${e.linePos} - ${e.message}`);
      throw new Error(`Custom WGSL rejected by WebGPU compiler:\n${details}`);
    }
    const layout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.computeBindGroupLayout],
    });
    this.computePipeline = this.device.createComputePipeline({
      label: 'AgenticCustomRaytracerPipeline',
      layout,
      compute: { module: computeModule, entryPoint: 'main' },
    });
    this.diagnostics.shaderStatus = 'ok';
    this.diagnostics.shaderErrors = [];
    this.sampleIndex = 0;
  }

  /**
   * FULL AGENTIC CONTROL — recompile the ENTIRE rendering pipeline from
   * scratch with AI-authored WGSL (compute + blit). The AI must ground every
   * construct in verified WebGPU/WGSL docs (W3C WGSL + WebGPU specs).
   * WebGL is never accepted. Validation runs BEFORE pipeline creation so a
   * bad shader can never hang the GPU: worst case is a clean rejection, not
   * device loss.
   */
  public async compileFullCustomPipeline(computeWGSL: string, blitWGSL?: string): Promise<void> {
    if (!this.device || !this.computeBindGroupLayout || !this.blitBindGroupLayout || !this.context) {
      throw new Error('Renderer not initialized.');
    }
    const computeCheck = validateFullWGSL(computeWGSL, 'compute');
    if (!computeCheck.ok) {
      this.diagnostics.shaderStatus = 'error';
      this.diagnostics.shaderErrors = computeCheck.errors;
      throw new Error(`Custom compute pipeline rejected:\n${computeCheck.errors.join('\n')}`);
    }
    if (blitWGSL) {
      const blitCheck = validateFullWGSL(blitWGSL, 'blit');
      if (!blitCheck.ok) {
        this.diagnostics.shaderStatus = 'error';
        this.diagnostics.shaderErrors = blitCheck.errors;
        throw new Error(`Custom blit pipeline rejected:\n${blitCheck.errors.join('\n')}`);
      }
    }
    for (const w of [...computeCheck.errors, ...computeCheck.warnings]) {
      console.warn('[WGSL safety]', w);
    }

    this.device.pushErrorScope('validation');
    const computeModule = this.device.createShaderModule({
      label: 'HappyHomeFullCustomCompute',
      code: computeWGSL,
    });
    const computeInfo = await computeModule.getCompilationInfo();
    const computeErrors = computeInfo.messages.filter((m) => m.type === 'error');
    if (computeErrors.length > 0) {
      const details = computeErrors.map((e) => `Line ${e.lineNum}:${e.linePos} - ${e.message}`).join('\n');
      await this.device.popErrorScope();
      this.diagnostics.shaderStatus = 'error';
      this.diagnostics.shaderErrors = computeErrors.map((e) => `Line ${e.lineNum}:${e.linePos} - ${e.message}`);
      throw new Error(`Custom compute WGSL failed WebGPU compilation:\n${details}`);
    }

    const computeLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.computeBindGroupLayout],
    });
    this.computePipeline = this.device.createComputePipeline({
      label: 'FullCustomComputePipeline',
      layout: computeLayout,
      compute: { module: computeModule, entryPoint: 'main' },
    });

    if (blitWGSL) {
      const blitModule = this.device.createShaderModule({
        label: 'HappyHomeFullCustomBlit',
        code: blitWGSL,
      });
      const blitInfo = await blitModule.getCompilationInfo();
      const blitErrors = blitInfo.messages.filter((m) => m.type === 'error');
      if (blitErrors.length > 0) {
        const details = blitErrors.map((e) => `Line ${e.lineNum}:${e.linePos} - ${e.message}`).join('\n');
        await this.device.popErrorScope();
        this.diagnostics.shaderStatus = 'error';
        this.diagnostics.shaderErrors = blitErrors.map((e) => `Line ${e.lineNum}:${e.linePos} - ${e.message}`);
        throw new Error(`Custom blit WGSL failed WebGPU compilation:\n${details}`);
      }
      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      const blitLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [this.blitBindGroupLayout],
      });
      this.blitPipeline = this.device.createRenderPipeline({
        label: 'FullCustomBlitPipeline',
        layout: blitLayout,
        vertex: { module: blitModule, entryPoint: 'vs_main' },
        fragment: { module: blitModule, entryPoint: 'fs_main', targets: [{ format: canvasFormat }] },
        primitive: { topology: 'triangle-list' },
      });
    }

    const scopeError = await this.device.popErrorScope();
    if (scopeError) {
      this.diagnostics.validationErrors.push(scopeError.message);
      throw new Error(`WebGPU validation rejected custom pipeline: ${scopeError.message}`);
    }
    this.diagnostics.shaderStatus = 'ok';
    this.diagnostics.shaderErrors = [];
    this.updateBindGroups();
    this.sampleIndex = 0;
  }

  /** Restore the verified built-in raytracer after agentic experiments. */
  public async restoreBuiltInPipeline(): Promise<void> {
    if (!this.device || !this.computeBindGroupLayout) return;
    const code = getComputeShaderWGSL('', '');
    const computeModule = this.device.createShaderModule({
      label: 'HappyHomeComputeShader',
      code,
    });
    const layout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.computeBindGroupLayout],
    });
    this.computePipeline = this.device.createComputePipeline({
      label: 'ComputeRaytracerPipeline',
      layout,
      compute: { module: computeModule, entryPoint: 'main' },
    });
    this.diagnostics.shaderStatus = 'ok';
    this.diagnostics.shaderErrors = [];
    this.sampleIndex = 0;
  }

  /** Snapshot of live GPU state for the AI director (full app observability). */
  public getDiagnosticsSnapshot() {
    return {
      adapterName: this.diagnostics.adapterName,
      vendor: this.diagnostics.vendor,
      architecture: this.diagnostics.architecture,
      limits: { ...this.diagnostics.limits },
      shaderStatus: this.diagnostics.shaderStatus,
      shaderErrors: [...this.diagnostics.shaderErrors],
      validationErrors: [...this.diagnostics.validationErrors],
      camera: { ...this.camera, target: [...this.camera.target] as [number, number, number] },
      settings: { ...this.settings },
      dynamicObjects: [...this.dynamicObjects],
      resolution: [this.canvas.width, this.canvas.height] as [number, number],
      sampleIndex: this.sampleIndex,
    };
  }

  private applyPreset(preset: 'svg_perspective' | 'cinematic' | 'meadow' | 'sunset' | 'aerial' | 'dramatic_low' | 'close_up' | string) {
    switch (preset) {
      case 'svg_perspective':
        this.camera = {
          distance: 10.2,
          azimuth: -0.04,
          elevation: 1.48,
          target: [0.0, 1.6, 0.0],
          fov: 46,
        };
        this.settings.timeOfDay = 0.35;
        break;
      case 'cinematic':
        this.camera = {
          distance: 6.8,
          azimuth: -0.45,
          elevation: 1.35,
          target: [-0.2, 1.5, 0.2],
          fov: 52,
        };
        this.settings.timeOfDay = 0.68;
        break;
      case 'meadow':
        this.camera = {
          distance: 8.5,
          azimuth: 0.65,
          elevation: 1.42,
          target: [1.2, 1.4, 1.0],
          fov: 50,
        };
        this.settings.timeOfDay = 0.40;
        break;
      case 'sunset':
        this.camera = {
          distance: 11.5,
          azimuth: 0.15,
          elevation: 1.50,
          target: [0.0, 1.6, 0.0],
          fov: 48,
        };
        this.settings.timeOfDay = 0.78;
        break;
      case 'aerial':
        this.camera = {
          distance: 14.0,
          azimuth: 0.0,
          elevation: 0.85,
          target: [0.0, 1.0, 0.0],
          fov: 55,
        };
        break;
      case 'dramatic_low':
        this.camera = {
          distance: 6.0,
          azimuth: -0.2,
          elevation: 1.75,
          target: [0.0, 1.8, 0.0],
          fov: 60,
        };
        break;
      case 'close_up':
        this.camera = {
          distance: 4.5,
          azimuth: 0.1,
          elevation: 1.45,
          target: [0.0, 1.4, 0.0],
          fov: 44,
        };
        break;
    }
  }

  public resize(width: number, height: number): void {
    const scale = this.settings.resolutionScale || 1.0;
    const scaledW = Math.max(1, Math.floor(width * scale));
    const scaledH = Math.max(1, Math.floor(height * scale));

    this.canvas.width = scaledW;
    this.canvas.height = scaledH;

    if (
      !this.outputTexture ||
      this.outputTexture.width !== scaledW ||
      this.outputTexture.height !== scaledH
    ) {
      this.recreateTextures(scaledW, scaledH);
    }
  }

  private calculateSunAndSky(timeOfDay: number) {
    const angle = (timeOfDay - 0.25) * Math.PI * 2.0;
    const sunElevation = Math.max(0.1, Math.sin(angle) * 0.85);
    const sunAzimuth = -Math.cos(angle) * 0.9 - 0.5;
    
    const sunDir: [number, number, number] = [
      Math.sin(sunAzimuth) * Math.cos(sunElevation),
      Math.sin(sunElevation),
      Math.cos(sunAzimuth) * Math.cos(sunElevation),
    ];

    let sunColor: [number, number, number];
    let skyColor: [number, number, number];
    let sunIntensity = 1.0;

    if (sunElevation < 0.25) {
      const t = sunElevation / 0.25;
      sunColor = [1.0, 0.55 + t * 0.25, 0.25 + t * 0.35];
      skyColor = [0.45 + (1 - t) * 0.25, 0.52 + (1 - t) * 0.1, 0.75 - (1 - t) * 0.25];
      sunIntensity = 1.35;
    } else {
      sunColor = [1.0, 0.96, 0.88];
      skyColor = [0.48, 0.74, 0.96];
      sunIntensity = 1.15;
    }

    return { sunDir, sunColor, sunIntensity, skyColor };
  }

  private updateUniforms(currentTime: number): void {
    if (!this.device || !this.uniformBuffer) return;

    const time = (currentTime - this.startTime) * 0.001;
    const aspect = this.canvas.width / this.canvas.height;
    
    const dist = this.camera.distance;
    const elev = this.camera.elevation;
    const azim = this.camera.azimuth;
    
    const camX = this.camera.target[0] + dist * Math.sin(elev) * Math.sin(azim);
    const camY = this.camera.target[1] + dist * Math.cos(elev);
    const camZ = this.camera.target[2] + dist * Math.sin(elev) * Math.cos(azim);

    // Detect camera or lighting movement for TAA
    const camMoved = (
      Math.abs(camX - this.prevCamPos[0]) > 0.0001 ||
      Math.abs(camY - this.prevCamPos[1]) > 0.0001 ||
      Math.abs(camZ - this.prevCamPos[2]) > 0.0001 ||
      Math.abs(this.camera.target[0] - this.prevCamTarget[0]) > 0.0001 ||
      Math.abs(this.camera.target[1] - this.prevCamTarget[1]) > 0.0001 ||
      Math.abs(this.camera.target[2] - this.prevCamTarget[2]) > 0.0001 ||
      Math.abs(this.camera.fov - this.prevFov) > 0.01 ||
      Math.abs(this.settings.timeOfDay - this.prevTimeOfDay) > 0.001
    );

    if (camMoved) {
      this.sampleIndex = 0;
      this.prevCamPos = [camX, camY, camZ];
      this.prevCamTarget = [...this.camera.target];
      this.prevFov = this.camera.fov;
      this.prevTimeOfDay = this.settings.timeOfDay;
    }

    const { sunDir, sunColor, sunIntensity, skyColor } = this.calculateSunAndSky(this.settings.timeOfDay);

    const data = new Float32Array(32);
    const u32 = new Uint32Array(data.buffer);

    // 0..3: resolution + aspect + time
    data[0] = this.canvas.width;
    data[1] = this.canvas.height;
    data[2] = aspect;
    data[3] = time;

    // 4..7: camPos + fov
    data[4] = camX;
    data[5] = camY;
    data[6] = camZ;
    data[7] = this.camera.fov;

    // 8..11: camTarget + timeOfDay
    data[8] = this.camera.target[0];
    data[9] = this.camera.target[1];
    data[10] = this.camera.target[2];
    data[11] = this.settings.timeOfDay;

    // 12..15: sunDir + sunIntensity
    data[12] = sunDir[0];
    data[13] = sunDir[1];
    data[14] = sunDir[2];
    data[15] = sunIntensity;

    // 16..19: skySunColor + godrayIntensity
    data[16] = sunColor[0];
    data[17] = sunColor[1];
    data[18] = sunColor[2];
    data[19] = this.settings.godrayIntensity;

    // 20..23: giIntensity + aoIntensity + frameIndex + sampleIndex
    data[20] = this.settings.giIntensity;
    data[21] = this.settings.aoIntensity;
    u32[22] = this.frameCount;
    u32[23] = this.sampleIndex;

    // 24..27: godraysEnabled + giEnabled + reflectionsEnabled + debugMode
    u32[24] = 1; // Enforced default: Godrays always active in compute pipeline
    u32[25] = 1; // Enforced default: Real-Time Diffuse GI always active in compute pipeline
    u32[26] = this.settings.reflectionsEnabled ? 1 : 0;
    u32[27] = this.settings.debugMode;

    // 28..31: camMoved + pad
    u32[28] = camMoved ? 1 : 0;
    data[29] = 0;
    data[30] = 0;
    data[31] = 0;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  /**
   * Render Loop - Strictly V-Sync synchronized to the user's display refresh rate
   */
  private render = (currentTime: number): void => {
    if (
      this.isDestroyed ||
      !this.device ||
      !this.context ||
      !this.computePipeline ||
      !this.computeBindGroup ||
      !this.blitPipeline ||
      !this.blitBindGroup ||
      !this.outputTexture ||
      !this.historyTexture
    ) {
      return;
    }

    this.frameCount++;
    const delta = currentTime - this.lastTime;
    if (delta >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / delta);
      this.frameTimeMs = Number((delta / this.frameCount).toFixed(1));
      this.frameCount = 0;
      this.lastTime = currentTime;

      if (this.onStatsCallback) {
        this.onStatsCallback({
          fps: this.fps,
          frameTimeMs: this.frameTimeMs,
          gpuName: this.diagnostics.adapterName,
          resolution: [this.canvas.width, this.canvas.height],
          sampleIndex: this.sampleIndex,
          diagnostics: { ...this.diagnostics },
        });
      }
    }

    try {
      // Ensure textures match current canvas size
      if (
        this.canvas.width !== this.outputTexture.width ||
        this.canvas.height !== this.outputTexture.height
      ) {
        this.recreateTextures(this.canvas.width, this.canvas.height);
      }

      this.updateUniforms(currentTime);

      const texW = this.outputTexture.width;
      const texH = this.outputTexture.height;

      const commandEncoder = this.device.createCommandEncoder({
        label: 'ComputeRaytracerEncoder',
      });

      // 1. Dispatch WebGPU Compute Shader
      const computePass = commandEncoder.beginComputePass({
        label: 'RaytracerComputePass',
      });
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.computeBindGroup);

      const workgroupsX = Math.ceil(texW / 8);
      const workgroupsY = Math.ceil(texH / 8);
      computePass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
      computePass.end();

      // 2. Blit Pass: Render Output to Canvas Swapchain with ACES Tonemapping
      const currentTexture = this.context.getCurrentTexture();
      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: currentTexture.createView(),
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      };

      const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
      renderPass.setPipeline(this.blitPipeline);
      renderPass.setBindGroup(0, this.blitBindGroup);
      renderPass.draw(3, 1, 0, 0);
      renderPass.end();

      // 3. Fast GPU copy of OutputTexture into HistoryTexture for TAA
      commandEncoder.copyTextureToTexture(
        { texture: this.outputTexture },
        { texture: this.historyTexture },
        [texW, texH, 1]
      );

      this.device.queue.submit([commandEncoder.finish()]);
      this.sampleIndex++;
    } catch {
      // If canvas is being reconfigured or destroyed, cleanly exit
      return;
    }

    if (!this.isDestroyed) {
      // Capped directly to user's monitor refresh rate via requestAnimationFrame
      this.animationFrameId = requestAnimationFrame(this.render);
    }
  };

  public startRenderLoop(): void {
    if (this.animationFrameId === null && !this.isDestroyed) {
      this.lastTime = performance.now();
      this.animationFrameId = requestAnimationFrame(this.render);
    }
  }

  public stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.stopRenderLoop();

    if (this.outputTexture) {
      try { this.outputTexture.destroy(); } catch {}
      this.outputTexture = null;
    }

    if (this.historyTexture) {
      try { this.historyTexture.destroy(); } catch {}
      this.historyTexture = null;
    }

    if (this.uniformBuffer) {
      try { this.uniformBuffer.destroy(); } catch {}
      this.uniformBuffer = null;
    }

    if (this.context) {
      try { this.context.unconfigure(); } catch {}
      this.context = null;
    }

    if (this.device) {
      try { this.device.destroy(); } catch {}
      this.device = null;
    }

    this.computePipeline = null;
    this.computeBindGroup = null;
    this.computeBindGroupLayout = null;
    this.blitPipeline = null;
    this.blitBindGroup = null;
    this.blitBindGroupLayout = null;
    this.blitSampler = null;
    this.adapter = null;
  }
}

