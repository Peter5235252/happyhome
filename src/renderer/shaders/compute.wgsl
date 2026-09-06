
struct Uniforms {
  resolution: vec2f,
  aspect: f32,
  time: f32,
  
  camPos: vec3f,
  fov: f32,
  
  camTarget: vec3f,
  timeOfDay: f32,
  
  sunDir: vec3f,
  sunIntensity: f32,
  
  skySunColor: vec3f,
  godrayIntensity: f32,
  
  giIntensity: f32,
  aoIntensity: f32,
  frameIndex: u32,
  sampleIndex: u32,
  
  godraysEnabled: u32,
  giEnabled: u32,
  reflectionsEnabled: u32,
  debugMode: u32,
  
  camMoved: u32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var historyTex: texture_2d<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d<rgba16float, write>;

const PI: f32 = 3.14159265359;
const MAX_DIST: f32 = 120.0;
const SURF_DIST: f32 = 0.0025;
const MAX_STEPS: i32 = 110;

// Material IDs
const MAT_NONE: u32 = 0u;
const MAT_GRASS: u32 = 1u;
const MAT_PATH: u32 = 2u;
const MAT_HOUSE_BRICK: u32 = 3u;
const MAT_ROOF_TILES: u32 = 4u;
const MAT_CHIMNEY: u32 = 5u;
const MAT_WINDOW_GLASS: u32 = 6u;
const MAT_WINDOW_FRAME: u32 = 7u;
const MAT_DOOR: u32 = 8u;
const MAT_DOOR_KNOB: u32 = 9u;
const MAT_TREE_BARK: u32 = 10u;
const MAT_TREE_LEAVES: u32 = 11u;
const MAT_FENCE: u32 = 12u;
const MAT_DISTANT_HILLS: u32 = 13u;

struct Hit {
  d: f32,
  mat: u32,
  uv: vec2f,
};

struct Material {
  albedo: vec3f,
  roughness: f32,
  metallic: f32,
  subsurface: f32,
  emission: vec3f,
  isGlass: bool,
};

struct ShadingBreakdown {
  finalColor: vec3f,
  diffuseGI: vec3f,
  godrays: vec3f,
  ao: f32,
  shadow: f32,
  normal: vec3f,
  steps: f32,
};

// Halton low-discrepancy sequence for TAA subpixel jitter
fn halton(index: u32, base: u32) -> f32 {
  var result: f32 = 0.0;
  var f: f32 = 1.0;
  var i = index;
  for (var step: u32 = 0u; step < 8u; step++) {
    if (i == 0u) { break; }
    f = f / f32(base);
    result = result + f * f32(i % base);
    i = i / base;
  }
  return result;
}

fn fmod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

// -------------------------------------------------------------
// ANALYTICAL SDF PRIMITIVES & OPERATORS
// -------------------------------------------------------------

fn sdSphere(p: vec3f, s: f32) -> f32 {
  return length(p) - s;
}

fn sdBox(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn sdCylinder(p: vec3f, h: f32, r: f32) -> f32 {
  let d = vec2f(length(p.xz) - r, abs(p.y) - h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
  let q = vec2f(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

fn sdCone(p: vec3f, c: vec2f, h: f32) -> f32 {
  let q = length(p.xz);
  return max(dot(c.xy, vec2f(q, p.y)), -h - p.y);
}

fn sdOctahedron(p: vec3f, s: f32) -> f32 {
  let p_abs = abs(p);
  return (p_abs.x + p_abs.y + p_abs.z - s) * 0.57735027;
}

// Exact Euclidean Triangular Gable Roof
fn sdGableRoof(p: vec3f, halfWidth: f32, halfHeight: f32, halfLength: f32) -> f32 {
  // Slope normal
  let n = normalize(vec2f(halfHeight, halfWidth));
  let dSlope = dot(vec2f(abs(p.x), p.y), n) - halfHeight * n.y;
  let dBottom = -p.y;
  let dDepth = abs(p.z) - halfLength;
  return max(max(dSlope, dBottom), dDepth);
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn opU(a: Hit, b: Hit) -> Hit {
  if (b.d < a.d) {
    return b;
  }
  return a;
}

// -------------------------------------------------------------
// NOISE & PROCEDURAL UTILITIES
// -------------------------------------------------------------
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn noise2D(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u_smooth = f * f * (3.0 - 2.0 * f);
  
  let a = hash12(i + vec2f(0.0, 0.0));
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));
  
  return mix(mix(a, b, u_smooth.x), mix(c, d, u_smooth.x), u_smooth.y);
}

fn fbm2D(p: vec2f) -> f32 {
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  var shift = vec2f(100.0);
  var q = p;
  for (var i: i32 = 0; i < 4; i++) {
    v = v + a * noise2D(q);
    q = q * 2.0 + shift;
    a = a * 0.5;
  }
  return v;
}

// -------------------------------------------------------------
// SCENE SIGNED DISTANCE FIELD (Exact & Continuous)
// -------------------------------------------------------------
fn mapScene(p: vec3f) -> Hit {
  var res = Hit(MAX_DIST, MAT_NONE, vec2f(0.0));

  // 1. TERRAIN & DISTANT HILLS
  // Distant alpine elevation smoothly blends in far away without any discontinuous cliffs
  let distFactor = smoothstep(-14.0, -75.0, p.z);
  let gentleHills = (sin(p.x * 0.07) * 4.2 + cos(p.z * 0.05 + 1.2) * 3.2 + sin(p.x * 0.14) * 1.8) * distFactor;
  let meadowSway = sin(p.x * 0.25) * 0.15 + cos(p.z * 0.20) * 0.12;
  let groundY = meadowSway + gentleHills;
  let dGround = (p.y - groundY) * 0.82;
  
  let isFarMtn = distFactor > 0.45;
  let terrainMat = select(MAT_GRASS, MAT_DISTANT_HILLS, isFarMtn);
  res = opU(res, Hit(dGround, terrainMat, p.xz));

  // Garden walkway path leading to the front door
  if (p.z > 0.0 && p.z < 18.0 && abs(p.x) < 4.5 && !isFarMtn) {
    let pathCurve = sin(p.z * 0.28) * 0.65;
    let pathWidth = 0.85 + p.z * 0.08;
    let dPath = abs(p.x - pathCurve) - pathWidth;
    if (dPath < 0.15) {
      let pathSDF = max(dGround - 0.015, dPath);
      res = opU(res, Hit(pathSDF, MAT_PATH, p.xz));
    }
  }

  // 2. THE HAPPY HOUSE
  // Main Brick Body
  let houseBodyPos = p - vec3f(0.0, 1.4, 0.0);
  let dHouseBody = sdRoundBox(houseBodyPos, vec3f(1.9, 1.4, 1.4), 0.05);
  res = opU(res, Hit(dHouseBody, MAT_HOUSE_BRICK, houseBodyPos.xy));

  // Exact Gable Roof (with slight eave overhang)
  let roofPos = p - vec3f(0.0, 2.8, 0.0);
  let dRoof = sdGableRoof(roofPos, 2.15, 1.45, 1.65);
  res = opU(res, Hit(dRoof, MAT_ROOF_TILES, roofPos.xz));

  // Chimney on the roof (Right side, towards rear)
  let chimneyPos = p - vec3f(1.15, 3.6, -0.3);
  let dChimney = sdBox(chimneyPos, vec3f(0.28, 0.9, 0.28));
  let chimneyFlue = sdCylinder(chimneyPos - vec3f(0.0, 0.9, 0.0), 0.08, 0.22);
  let dChimneyFinal = min(dChimney, chimneyFlue);
  res = opU(res, Hit(dChimneyFinal, MAT_CHIMNEY, chimneyPos.xy));

  // Front Windows (Facade at z = 1.40)
  let winZ = p.z - 1.40;
  let win1Pos = vec3f(p.x + 0.95, p.y - 1.45, winZ);
  let dWin1Pane = sdBox(win1Pos, vec3f(0.42, 0.42, 0.035));
  let dWin1Frame = max(sdBox(win1Pos, vec3f(0.46, 0.46, 0.05)), -sdBox(win1Pos, vec3f(0.40, 0.40, 0.1)));
  let dWin1Mullions = min(sdBox(win1Pos, vec3f(0.40, 0.025, 0.045)), sdBox(win1Pos, vec3f(0.025, 0.40, 0.045)));

  let win2Pos = vec3f(p.x - 0.95, p.y - 1.45, winZ);
  let dWin2Pane = sdBox(win2Pos, vec3f(0.42, 0.42, 0.035));
  let dWin2Frame = max(sdBox(win2Pos, vec3f(0.46, 0.46, 0.05)), -sdBox(win2Pos, vec3f(0.40, 0.40, 0.1)));
  let dWin2Mullions = min(sdBox(win2Pos, vec3f(0.40, 0.025, 0.045)), sdBox(win2Pos, vec3f(0.025, 0.40, 0.045)));

  res = opU(res, Hit(min(dWin1Pane, dWin2Pane), MAT_WINDOW_GLASS, win1Pos.xy));
  res = opU(res, Hit(min(min(dWin1Frame, dWin2Frame), min(dWin1Mullions, dWin2Mullions)), MAT_WINDOW_FRAME, win1Pos.xy));

  // Front Wooden Door & Brass Knob
  let doorPos = vec3f(p.x, p.y - 0.88, winZ);
  let dDoor = sdRoundBox(doorPos, vec3f(0.42, 0.88, 0.04), 0.02);
  let knobPos = doorPos - vec3f(0.30, -0.05, 0.06);
  let dKnob = sdSphere(knobPos, 0.04);
  res = opU(res, Hit(dDoor, MAT_DOOR, doorPos.xy));
  res = opU(res, Hit(dKnob, MAT_DOOR_KNOB, knobPos.xy));

  // 3. THE TREE (Left side of house: x = -3.4)
  let treeP = p - vec3f(-3.4, 0.0, 0.6);
  let dTrunk = sdCylinder(treeP - vec3f(0.0, 1.4, 0.0), 1.4, 0.26);
  let branch1 = sdCapsule(treeP, vec3f(0.0, 1.8, 0.0), vec3f(-0.7, 2.5, 0.3), 0.13);
  let branch2 = sdCapsule(treeP, vec3f(0.0, 1.7, 0.0), vec3f(0.6, 2.4, -0.2), 0.12);
  res = opU(res, Hit(min(dTrunk, min(branch1, branch2)), MAT_TREE_BARK, treeP.xy));

  let crown1 = sdSphere(treeP - vec3f(0.0, 3.2, 0.0), 1.25);
  let crown2 = sdSphere(treeP - vec3f(-0.7, 2.8, 0.3), 1.05);
  let crown3 = sdSphere(treeP - vec3f(0.6, 2.9, -0.3), 0.95);
  let crown4 = sdSphere(treeP - vec3f(0.1, 3.8, 0.1), 0.90);
  let dLeaves = smin(smin(crown1, crown2, 0.35), smin(crown3, crown4, 0.35), 0.35);
  res = opU(res, Hit(dLeaves, MAT_TREE_LEAVES, treeP.xy));

  // 4. GARDEN PICKET FENCE
  let postIdx = clamp(round((p.x - 2.2) / 0.55), 0.0, 6.0);
  let postX = 2.2 + postIdx * 0.55;
  let postP = vec3f(p.x - postX, p.y - 0.65, p.z - 0.2);
  let dPost = sdBox(postP, vec3f(0.045, 0.65, 0.045));
  
  let railP = p - vec3f(3.85, 0.0, 0.2);
  let rail1 = sdBox(railP - vec3f(0.0, 0.85, 0.0), vec3f(1.85, 0.035, 0.035));
  let rail2 = sdBox(railP - vec3f(0.0, 0.40, 0.0), vec3f(1.85, 0.035, 0.035));
  
  let dFence = min(dPost, min(rail1, rail2));
  res = opU(res, Hit(dFence, MAT_FENCE, vec2f(0.0)));

  //__HAPPYHOME_DYNAMIC_SDF__
  return res;
}

// Robust Surface Normal via Central Differences
fn calcNormal(p: vec3f) -> vec3f {
  let e = 0.0035;
  let d1 = mapScene(p + vec3f(e, 0.0, 0.0)).d;
  let d2 = mapScene(p - vec3f(e, 0.0, 0.0)).d;
  let d3 = mapScene(p + vec3f(0.0, e, 0.0)).d;
  let d4 = mapScene(p - vec3f(0.0, e, 0.0)).d;
  let d5 = mapScene(p + vec3f(0.0, 0.0, e)).d;
  let d6 = mapScene(p - vec3f(0.0, 0.0, e)).d;
  let v = vec3f(d1 - d2, d3 - d4, d5 - d6);
  let l = length(v);
  if (l < 0.00001) {
    return vec3f(0.0, 1.0, 0.0);
  }
  return v / l;
}

// Safe Raymarch Loop
struct MarchResult {
  hit: Hit,
  steps: i32,
};

fn raymarch(ro: vec3f, rd: vec3f) -> MarchResult {
  var t: f32 = 0.05;
  var hit = Hit(MAX_DIST, MAT_NONE, vec2f(0.0));
  var stepCount: i32 = 0;

  for (var i: i32 = 0; i < MAX_STEPS; i++) {
    stepCount = i;
    let p = ro + rd * t;
    let h = mapScene(p);

    if (h.d < SURF_DIST) {
      hit = Hit(t, h.mat, h.uv);
      break;
    }
    if (t > MAX_DIST) {
      break;
    }
    // Safe step size to prevent overstepping
    t = t + min(h.d * 0.88, 1.6);
  }

  return MarchResult(hit, stepCount);
}

// -------------------------------------------------------------
// ARTIFACT-FREE SHADOWS & AMBIENT OCCLUSION
// -------------------------------------------------------------

fn calcSoftShadow(ro: vec3f, rd: vec3f, mint: f32, maxt: f32, k: f32) -> f32 {
  var res: f32 = 1.0;
  var t = mint;
  
  for (var i: i32 = 0; i < 28; i++) {
    if (t >= maxt) { break; }
    let h = mapScene(ro + rd * t).d;
    if (h < 0.001) {
      return 0.0;
    }
    res = min(res, k * h / t);
    t = t + clamp(h, 0.04, 0.65);
  }
  return clamp(res, 0.0, 1.0);
}

fn calcAO(p: vec3f, n: vec3f) -> f32 {
  var occ: f32 = 0.0;
  var sca: f32 = 1.0;
  
  for (var i: i32 = 0; i < 5; i++) {
    let h = 0.05 + 0.18 * f32(i) / 4.0;
    let d = mapScene(p + h * n).d;
    occ = occ + max(h - d, 0.0) * sca;
    sca = sca * 0.72;
  }
  return clamp(1.0 - occ * 1.6 * u.aoIntensity, 0.0, 1.0);
}

// -------------------------------------------------------------
// MATERIAL SHADING & COLOR PALETTE
// -------------------------------------------------------------
fn getMaterial(p: vec3f, n: vec3f, hit: Hit) -> Material {
  var m: Material;
  m.albedo = vec3f(0.5);
  m.roughness = 0.6;
  m.metallic = 0.0;
  m.subsurface = 0.0;
  m.emission = vec3f(0.0);
  m.isGlass = false;

  let mat = hit.mat;

  if (mat == MAT_GRASS) {
    let macroNoise = fbm2D(p.xz * 1.5);
    let microNoise = noise2D(p.xz * 18.0);
    let baseGrass = vec3f(0.18, 0.48, 0.15);
    let lushGrass = vec3f(0.36, 0.66, 0.20);
    let tipHighlight = vec3f(0.48, 0.74, 0.24);
    m.albedo = mix(mix(baseGrass, lushGrass, macroNoise), tipHighlight, microNoise * 0.3);
    m.roughness = 0.85;
    m.subsurface = 0.40;
  }
  else if (mat == MAT_PATH) {
    let pNoise = fbm2D(p.xz * 4.5);
    let dirtBase = mix(vec3f(0.68, 0.54, 0.38), vec3f(0.52, 0.40, 0.28), pNoise);
    m.albedo = dirtBase;
    m.roughness = 0.92;
  }
  else if (mat == MAT_HOUSE_BRICK) {
    // English bond brick pattern
    let brickUV = p.xy * vec2f(3.6, 7.2);
    let brickRow = floor(brickUV.y);
    let rowShift = fmod(brickRow, 2.0) * 0.5;
    let brickCol = floor(brickUV.x + rowShift);
    let brickLocal = fract(vec2f(brickUV.x + rowShift, brickUV.y));

    let mortar = smoothstep(0.04, 0.08, brickLocal.x) * smoothstep(0.96, 0.92, brickLocal.x) *
                 smoothstep(0.06, 0.12, brickLocal.y) * smoothstep(0.94, 0.88, brickLocal.y);
    let brickColorVar = hash12(vec2f(brickRow, brickCol));
    let baseBrick = mix(vec3f(0.88, 0.60, 0.32), vec3f(0.96, 0.74, 0.42), brickColorVar);
    let mortarColor = vec3f(0.68, 0.64, 0.58);
    m.albedo = mix(mortarColor, baseBrick, mortar);
    m.roughness = mix(0.96, 0.72, mortar);
  }
  else if (mat == MAT_ROOF_TILES) {
    // Smooth terracotta gabled roof tiles with clean specular roll-off
    let tileShade = mix(vec3f(0.76, 0.28, 0.22), vec3f(0.88, 0.38, 0.28), hash12(floor(p.xz * 4.0)) * 0.2);
    m.albedo = tileShade;
    m.roughness = 0.52;
  }
  else if (mat == MAT_CHIMNEY) {
    m.albedo = vec3f(0.64, 0.26, 0.20);
    m.roughness = 0.82;
  }
  else if (mat == MAT_WINDOW_GLASS) {
    m.albedo = vec3f(0.06, 0.14, 0.20);
    m.roughness = 0.02;
    m.isGlass = true;
    m.emission = vec3f(1.0, 0.80, 0.45) * 0.45; // Cozy interior warm lighting
  }
  else if (mat == MAT_WINDOW_FRAME) {
    m.albedo = vec3f(0.25, 0.16, 0.11);
    m.roughness = 0.75;
  }
  else if (mat == MAT_DOOR) {
    m.albedo = vec3f(0.38, 0.24, 0.15);
    m.roughness = 0.65;
  }
  else if (mat == MAT_DOOR_KNOB) {
    m.albedo = vec3f(0.95, 0.78, 0.35);
    m.roughness = 0.15;
    m.metallic = 0.95;
  }
  else if (mat == MAT_TREE_BARK) {
    m.albedo = vec3f(0.32, 0.20, 0.12);
    m.roughness = 0.88;
  }
  else if (mat == MAT_TREE_LEAVES) {
    let lNoise = noise2D(p.xy * 6.0);
    m.albedo = mix(vec3f(0.18, 0.52, 0.16), vec3f(0.30, 0.64, 0.22), lNoise);
    m.roughness = 0.72;
    m.subsurface = 0.45;
  }
  else if (mat == MAT_FENCE) {
    m.albedo = vec3f(0.88, 0.85, 0.78);
    m.roughness = 0.68;
  }
  else if (mat == MAT_DISTANT_HILLS) {
    // Atmospheric soft sage teal matching #8ab6a1 in the original SVG
    m.albedo = vec3f(0.48, 0.66, 0.55);
    m.roughness = 0.90;
  }

  //__HAPPYHOME_DYNAMIC_MATS__
  return m;
}

// -------------------------------------------------------------
// ATMOSPHERIC SKY & SUN ENVIRONMENT
// -------------------------------------------------------------
fn getSkyColor(rd: vec3f, sunDir: vec3f) -> vec3f {
  let sunDot = max(dot(rd, sunDir), 0.0);
  
  // Sky gradient from horizon to zenith
  let zenith = vec3f(0.35, 0.68, 0.98);
  let horizon = vec3f(0.72, 0.88, 0.98);
  let groundSky = vec3f(0.42, 0.58, 0.48);
  
  var sky = mix(horizon, zenith, pow(max(rd.y, 0.0), 0.65));
  sky = mix(horizon, groundSky, pow(max(-rd.y, 0.0), 0.5));
  
  // Sun Disc & Glare
  let sunDisc = smoothstep(0.9982, 0.9992, sunDot);
  let sunGlow = pow(sunDot, 12.0) * 0.45 + pow(sunDot, 2.0) * 0.15;
  
  let sunColor = u.skySunColor;
  return sky + sunColor * (sunDisc * 2.5 + sunGlow);
}

// -------------------------------------------------------------
// VOLUMETRIC GODRAYS (Optimized Mie Forward Scattering)
// -------------------------------------------------------------
// High-performance coarse volumetric shadow check specifically for volumetric air
fn calcVolumetricShadow(ro: vec3f, rd: vec3f) -> f32 {
  var t: f32 = 0.25;
  var res: f32 = 1.0;
  // 6 coarse steps with large step increments and early bailout
  for (var i: i32 = 0; i < 6; i++) {
    let p = ro + rd * t;
    if (p.y < 0.0) {
      return 0.0;
    }
    let d = mapScene(p).d;
    if (d < 0.035) {
      return 0.0; // Early exit on solid occlusion
    }
    res = min(res, 5.5 * d / t);
    t = t + max(d, 0.4);
    if (t > 14.0) {
      break;
    }
  }
  return clamp(res, 0.0, 1.0);
}

fn computeGodrays(ro: vec3f, rd: vec3f, maxDist: f32, jitter: f32) -> vec3f {
  if (u.godraysEnabled == 0u) {
    return vec3f(0.0);
  }
  
  let sunDir = normalize(u.sunDir);
  let sunDot = max(dot(rd, sunDir), 0.0);
  // Forward Mie scattering phase function
  let phase = pow(sunDot, 12.0) * 0.45 + pow(sunDot, 36.0) * 0.85;
  if (phase < 0.0008) {
    return vec3f(0.0);
  }

  // Highly optimized 8-step volumetric raymarch with TAA subpixel jitter
  let numSteps = 8;
  let marchLimit = min(maxDist, 22.0);
  let stepSize = marchLimit / f32(numSteps);
  var marchT = stepSize * (0.15 + 0.7 * jitter);
  var lightAccum: f32 = 0.0;

  for (var i: i32 = 0; i < numSteps; i++) {
    let sampleP = ro + rd * marchT;
    if (sampleP.y > 0.05) {
      let shadowCheck = calcVolumetricShadow(sampleP, sunDir);
      let heightDensity = exp(-sampleP.y * 0.12);
      lightAccum = lightAccum + shadowCheck * heightDensity * stepSize;
    }
    marchT = marchT + stepSize;
  }

  return u.skySunColor * lightAccum * phase * 0.15 * u.godrayIntensity;
}

// -------------------------------------------------------------
// SURFACE SHADING & GLOBAL ILLUMINATION
// -------------------------------------------------------------
fn shadeSurfaceDetailed(ro: vec3f, p: vec3f, n: vec3f, rd: vec3f, hit: Hit, stepCount: i32) -> ShadingBreakdown {
  var b: ShadingBreakdown;
  b.normal = n;
  b.steps = f32(stepCount);

  let mat = getMaterial(p, n, hit);
  let sunDir = normalize(u.sunDir);
  let nDotL = max(dot(n, sunDir), 0.0);

  // Normal bias to prevent shadow acne on roof slopes
  let normalBias = n * max(0.035, 0.07 * (1.0 - nDotL));
  let shadowOrigin = p + normalBias;
  let shadow = calcSoftShadow(shadowOrigin, sunDir, 0.04, 25.0, 18.0);
  b.shadow = shadow;

  let ao = calcAO(p, n);
  b.ao = ao;

  // Direct Sun Illumination (Lambert + Cook-Torrance Specular)
  let v = -rd;
  let h = normalize(sunDir + v);
  let nDotH = max(dot(n, h), 0.0);
  let specPower = mix(128.0, 8.0, mat.roughness);
  let spec = pow(nDotH, specPower) * (1.0 - mat.roughness) * shadow;

  let directSun = u.skySunColor * (mat.albedo * nDotL * shadow + spec * 0.4);

  // Real-Time Diffuse Global Illumination
  var diffuseGI = vec3f(0.0);
  if (u.giEnabled != 0u) {
    // Sky Ambient Dome
    let skyDome = mix(vec3f(0.4, 0.55, 0.7), vec3f(0.65, 0.78, 0.9), n.y * 0.5 + 0.5);
    // Meadow Ground Bounce (Bounces vibrant green grass upward onto house and eaves)
    let groundBounce = vec3f(0.22, 0.45, 0.18) * max(-n.y, 0.0) * 0.7;
    // Brick Wall Radiosity Bounce (Bounces warm terracotta onto the ground)
    let distToHouse = length(p.xz);
    let houseWallBounce = vec3f(0.75, 0.45, 0.25) * smoothstep(4.0, 1.0, distToHouse) * max(dot(n, vec3f(0.0, 1.0, 0.0)), 0.0) * 0.35;
    
    diffuseGI = (skyDome + groundBounce + houseWallBounce) * mat.albedo * ao * 0.45 * u.giIntensity;
  }
  b.diffuseGI = diffuseGI;

  // Subsurface Scattering (Leaves & Grass backlighting glow)
  var sss = vec3f(0.0);
  if (mat.subsurface > 0.0) {
    let sssDot = max(dot(-rd, sunDir), 0.0);
    sss = u.skySunColor * mat.albedo * pow(sssDot, 3.0) * mat.subsurface * shadow * 0.6;
  }

  // Window Glass Sky & Environment Reflection
  var reflection = vec3f(0.0);
  if (mat.isGlass) {
    let reflDir = reflect(rd, n);
    let reflSky = getSkyColor(reflDir, sunDir);
    let fresnel = 0.08 + 0.92 * pow(1.0 - max(dot(v, n), 0.0), 5.0);
    reflection = reflSky * fresnel * 0.8;
  }

  // Atmospheric Aerial Perspective Fog (delicate and restrained, keeping the foreground & house crisp and clear)
  let fogDist = length(p - ro);
  let fogFactor = clamp(1.0 - exp(-max(fogDist - 30.0, 0.0) * 0.0018), 0.0, 0.20);
  let fogColor = mix(vec3f(0.74, 0.86, 0.95), u.skySunColor, pow(max(dot(rd, sunDir), 0.0), 3.0) * 0.25);

  let surfaceColor = directSun + diffuseGI + sss + mat.emission + reflection;
  b.finalColor = mix(surfaceColor, fogColor, fogFactor);

  return b;
}

// -------------------------------------------------------------
// COMPUTE SHADER ENTRY POINT
// -------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let coord = vec2i(global_id.xy);
  let res = vec2i(u.resolution);
  if (coord.x >= res.x || coord.y >= res.y) {
    return;
  }

  // Halton Subpixel Jitter for Temporal Anti-Aliasing
  var jitter = vec2f(0.0);
  if (u.camMoved == 0u) {
    let sampleIdx = u.sampleIndex % 16u;
    let jx = halton(sampleIdx + 1u, 2u) - 0.5;
    let jy = halton(sampleIdx + 1u, 3u) - 0.5;
    jitter = vec2f(jx, jy) / u.resolution;
  }

  let pixelUV = (vec2f(coord) + 0.5) / u.resolution;
  let ndc = (pixelUV * 2.0 - 1.0) + jitter;
  let screenCoord = vec2f(ndc.x * u.aspect, -ndc.y); // Match screen coordinates

  // Camera Setup
  let ro = u.camPos;
  let camTarget = u.camTarget;
  let fwd = normalize(camTarget - ro);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);

  let fovRad = u.fov * PI / 180.0;
  let tanHalfFov = tan(fovRad * 0.5);
  let rd = normalize(fwd + (right * screenCoord.x + up * screenCoord.y) * tanHalfFov);

  // Raymarch Scene
  let marchRes = raymarch(ro, rd);
  let hit = marchRes.hit;
  let sunDir = normalize(u.sunDir);

  var currentSample = vec3f(0.0);
  var breakdown: ShadingBreakdown;
  breakdown.finalColor = vec3f(0.0);
  breakdown.diffuseGI = vec3f(0.0);
  breakdown.ao = 1.0;
  breakdown.shadow = 1.0;
  breakdown.normal = vec3f(0.0, 1.0, 0.0);
  breakdown.steps = f32(marchRes.steps);

  if (hit.mat != MAT_NONE && hit.d < MAX_DIST) {
    let p = ro + rd * hit.d;
    let n = calcNormal(p);
    breakdown = shadeSurfaceDetailed(ro, p, n, rd, hit, marchRes.steps);
    currentSample = breakdown.finalColor;
  } else {
    currentSample = getSkyColor(rd, sunDir);
  }

  // Add Volumetric Sun Godrays
  let maxRayDist = min(hit.d, MAX_DIST);
  let godrayJitter = hash12(pixelUV * u.resolution + vec2f(f32(u.frameIndex) * 0.05));
  let godrays = computeGodrays(ro, rd, maxRayDist, godrayJitter);
  breakdown.godrays = godrays;

  if (u.debugMode == 0u) {
    currentSample = currentSample + godrays;
  } else if (u.debugMode == 1u) {
    currentSample = breakdown.normal * 0.5 + 0.5;
  } else if (u.debugMode == 2u) {
    currentSample = breakdown.diffuseGI;
  } else if (u.debugMode == 3u) {
    currentSample = breakdown.godrays * 2.0;
  } else if (u.debugMode == 4u) {
    currentSample = vec3f(breakdown.ao);
  } else if (u.debugMode == 5u) {
    currentSample = vec3f(breakdown.shadow);
  } else if (u.debugMode == 6u) {
    let complexity = clamp(breakdown.steps / f32(MAX_STEPS), 0.0, 1.0);
    currentSample = mix(vec3f(0.0, 0.3, 0.9), vec3f(1.0, 0.1, 0.0), complexity);
  }

  // Temporal Anti-Aliasing (TAA) Accumulation
  var accumulatedColor = currentSample;
  if (u.camMoved == 0u && u.sampleIndex > 0u) {
    let prevColor = textureLoad(historyTex, coord, 0).rgb;
    // Exponential moving average accumulation for clean, smooth anti-aliased image
    let alpha = max(1.0 / f32(u.sampleIndex + 1u), 0.08);
    accumulatedColor = mix(prevColor, currentSample, alpha);
  }

  textureStore(outputTex, coord, vec4f(accumulatedColor, 1.0));
}
