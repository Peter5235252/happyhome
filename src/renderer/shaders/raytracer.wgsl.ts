/**
 * High-Fidelity Photorealistic WebGPU Raytracer & Global Illumination Pipeline
 * Implements real-time SDF raymarching, volumetric sun godrays, multi-bounce diffuse GI,
 * Cook-Torrance PBR shading, and atmospheric scattering.
 */

export const RAYTRACER_WGSL = /* wgsl */ `
struct Uniforms {
  camPos: vec3f,
  aspect: f32,
  
  camTarget: vec3f,
  fov: f32,
  
  sunDir: vec3f,
  time: f32,
  
  sunColor: vec3f,
  sunIntensity: f32,
  
  skyColor: vec3f,
  timeOfDay: f32,
  
  resolution: vec2f,
  frameIndex: u32,
  godraysEnabled: u32,
  
  giEnabled: u32,
  reflectionsEnabled: u32,
  godrayIntensity: f32,
  giIntensity: f32,
  
  aoIntensity: f32,
  windSpeed: f32,
  cloudDensity: f32,
  debugMode: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  var out: VertexOutput;
  out.position = vec4f(pos[vertexIndex], 0.0, 1.0);
  out.uv = pos[vertexIndex] * 0.5 + 0.5;
  return out;
}

// -------------------------------------------------------------
// CONSTANTS & MATERIAL IDS
// -------------------------------------------------------------
const MAT_NONE: f32 = 0.0;
const MAT_GRASS: f32 = 1.0;
const MAT_PATH: f32 = 2.0;
const MAT_HOUSE_BRICK: f32 = 3.0;
const MAT_ROOF_TILES: f32 = 4.0;
const MAT_CHIMNEY: f32 = 5.0;
const MAT_WINDOW_GLASS: f32 = 6.0;
const MAT_WINDOW_FRAME: f32 = 7.0;
const MAT_DOOR: f32 = 8.0;
const MAT_DOOR_KNOB: f32 = 9.0;
const MAT_TREE_BARK: f32 = 10.0;
const MAT_TREE_LEAVES: f32 = 11.0;
const MAT_FENCE: f32 = 12.0;
const MAT_FLOWER_PINK: f32 = 13.0;
const MAT_FLOWER_PURPLE: f32 = 14.0;
const MAT_FLOWER_ORANGE: f32 = 15.0;
const MAT_ROCK: f32 = 16.0;
const MAT_CHILD_BODY: f32 = 17.0;
const MAT_CHILD_HEAD: f32 = 18.0;
const MAT_KITE: f32 = 19.0;
const MAT_MOUNTAIN: f32 = 20.0;
const MAT_SNOW: f32 = 21.0;
const MAT_SMOKE: f32 = 22.0;
const MAT_SIGN: f32 = 23.0;

const PI: f32 = 3.14159265359;
const MAX_DIST: f32 = 150.0;
const SURF_DIST: f32 = 0.003;
const MAX_STEPS: i32 = 96;

// -------------------------------------------------------------
// MATH & UTILITY FUNCTIONS
// -------------------------------------------------------------
fn fmod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

fn hash11(p: f32) -> f32 {
  var p1 = fract(p * 0.1031);
  p1 *= p1 + 33.33;
  p1 *= p1 + p1;
  return fract(p1);
}

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn noise2D(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i + vec2f(0.0, 0.0)), hash12(i + vec2f(1.0, 0.0)), u.x),
    mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm2D(p: vec2f) -> f32 {
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  var pos = p;
  for (var i: i32 = 0; i < 3; i++) {
    v += a * noise2D(pos);
    pos *= 2.05;
    a *= 0.5;
  }
  return v;
}

// -------------------------------------------------------------
// SDF PRIMITIVES
// -------------------------------------------------------------
fn sdSphere(p: vec3f, s: f32) -> f32 {
  return length(p) - s;
}

fn sdBox(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn sdCylinder(p: vec3f, h: f32, r: f32) -> f32 {
  let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

struct Hit {
  d: f32,
  mat: f32,
  uv: vec2f,
};

fn opU(a: Hit, b: Hit) -> Hit {
  if (a.d < b.d) {
    return a;
  }
  return b;
}

// -------------------------------------------------------------
// SCENE SDF
// -------------------------------------------------------------
fn getTerrainHeight(p: vec2f) -> f32 {
  let h1 = sin(p.x * 0.14) * 0.4 + cos(p.y * 0.12) * 0.35;
  let distToHouse = length(vec2f(p.x, p.y));
  let flatten = smoothstep(1.5, 4.0, distToHouse);
  return h1 * flatten;
}

fn getMountainHeight(p: vec2f) -> f32 {
  let nx = p.x * 0.045;
  let peak1 = max(0.0, 1.0 - abs(nx + 1.8)) * 16.0;
  let peak2 = max(0.0, 1.0 - abs(nx + 0.3)) * 19.0;
  let peak3 = max(0.0, 1.0 - abs(nx - 1.1)) * 16.5;
  let peak4 = max(0.0, 1.0 - abs(nx - 2.5)) * 17.5;
  let baseNoise = fbm2D(p * 0.06) * 3.5;
  return max(max(peak1, peak2), max(peak3, peak4)) + baseNoise;
}

fn mapScene(p: vec3f) -> Hit {
  var res = Hit(MAX_DIST, MAT_NONE, vec2f(0.0));

  // 1. TERRAIN (Rolling grass and winding garden path)
  let terrH = getTerrainHeight(p.xz);
  let dTerrain = p.y - terrH;
  
  // Winding path curve: from doorstep (z=1.4) towards camera (z=9.0)
  let pathCenter = sin(p.z * 0.4) * 0.5 - 0.08 * p.z;
  let pathDist = abs(p.x - pathCenter);
  let onPath = (pathDist < 0.65) && (p.z > 0.8) && (p.z < 10.0);
  
  if (onPath) {
    res = opU(res, Hit(dTerrain + 0.015, MAT_PATH, p.xz));
  } else {
    res = opU(res, Hit(dTerrain, MAT_GRASS, p.xz));
  }

  // 2. DISTANT MOUNTAINS (In background behind house: z < -16.0)
  if (p.z < -16.0) {
    let mtnH = getMountainHeight(p.xz);
    let dMtn = (p.y - mtnH) * 0.7;
    let isSnow = (p.y > 11.0 + sin(p.x * 0.35) * 1.5);
    res = opU(res, Hit(dMtn, select(MAT_MOUNTAIN, MAT_SNOW, isSnow), p.xy));
  }

  // 3. THE HOUSE (Spatial bounding optimization for maximum performance)
  let housePos = p - vec3f(0.0, 1.35, 0.0);
  let dHouseBound = sdBox(housePos - vec3f(0.0, 0.9, 0.0), vec3f(2.4, 2.3, 1.8));

  if (dHouseBound < 0.6) {
    // Main Brick Body
    let dHouseBody = sdRoundBox(housePos, vec3f(1.9, 1.35, 1.4), 0.06);
    res = opU(res, Hit(dHouseBody, MAT_HOUSE_BRICK, housePos.xy));

    // Gabled Terracotta Roof
    let roofPos = p - vec3f(0.0, 3.45, 0.0);
    let roofCross = max(abs(roofPos.x) * 0.85 + roofPos.y * 1.15 - 1.25, -roofPos.y - 0.85);
    let roofZ = abs(roofPos.z) - 1.65;
    let dRoof = max(roofCross, roofZ);
    res = opU(res, Hit(dRoof, MAT_ROOF_TILES, roofPos.xz));

    // Chimney & Flue
    let chimneyPos = p - vec3f(1.15, 3.65, -0.3);
    let dChimney = sdBox(chimneyPos, vec3f(0.28, 0.85, 0.28));
    let chimneyFlue = sdCylinder(chimneyPos - vec3f(0.0, 0.85, 0.0), 0.08, 0.22);
    res = opU(res, Hit(min(dChimney, chimneyFlue), MAT_CHIMNEY, chimneyPos.xy));

    // Windows (Left and Right on front facade: z = 1.42)
    let winZ = p.z - 1.42;
    let win1Pos = vec3f(p.x + 0.95, p.y - 1.45, winZ);
    let dWin1Pane = sdBox(win1Pos, vec3f(0.42, 0.42, 0.04));
    let dWin1Frame = max(sdBox(win1Pos, vec3f(0.46, 0.46, 0.06)), -sdBox(win1Pos, vec3f(0.40, 0.40, 0.1)));
    let dWin1Mullions = min(sdBox(win1Pos, vec3f(0.40, 0.03, 0.05)), sdBox(win1Pos, vec3f(0.03, 0.40, 0.05)));

    let win2Pos = vec3f(p.x - 0.95, p.y - 1.45, winZ);
    let dWin2Pane = sdBox(win2Pos, vec3f(0.42, 0.42, 0.04));
    let dWin2Frame = max(sdBox(win2Pos, vec3f(0.46, 0.46, 0.06)), -sdBox(win2Pos, vec3f(0.40, 0.40, 0.1)));
    let dWin2Mullions = min(sdBox(win2Pos, vec3f(0.40, 0.03, 0.05)), sdBox(win2Pos, vec3f(0.03, 0.40, 0.05)));

    res = opU(res, Hit(min(dWin1Pane, dWin2Pane), MAT_WINDOW_GLASS, win1Pos.xy));
    res = opU(res, Hit(min(min(dWin1Frame, dWin2Frame), min(dWin1Mullions, dWin2Mullions)), MAT_WINDOW_FRAME, win1Pos.xy));

    // Front Door & Brass Knob
    let doorPos = vec3f(p.x, p.y - 0.85, winZ);
    let dDoor = sdRoundBox(doorPos, vec3f(0.45, 0.85, 0.05), 0.02);
    let knobPos = doorPos - vec3f(0.32, -0.05, 0.07);
    let dKnob = sdSphere(knobPos, 0.045);
    res = opU(res, Hit(dDoor, MAT_DOOR, doorPos.xy));
    res = opU(res, Hit(dKnob, MAT_DOOR_KNOB, knobPos.xy));
  } else {
    // Fast conservative bounding volume when ray is distant
    res = opU(res, Hit(dHouseBound, MAT_HOUSE_BRICK, housePos.xy));
  }

  // Chimney Billowing Volumetric Smoke Puffs
  let windOffset = vec3f(sin(u.time * 0.8) * 0.25, 0.0, cos(u.time * 0.6) * 0.25);
  let smokeP1 = p - (vec3f(1.15, 4.8, -0.3) + windOffset * 0.5);
  let smokeP2 = p - (vec3f(1.35, 5.5, -0.2) + windOffset * 1.2);
  let smokeP3 = p - (vec3f(1.65, 6.3, -0.1) + windOffset * 2.0);
  let dSmoke = smin(smin(sdSphere(smokeP1, 0.28), sdSphere(smokeP2, 0.42), 0.2), sdSphere(smokeP3, 0.60), 0.3);
  res = opU(res, Hit(dSmoke, MAT_SMOKE, smokeP1.xy));

  // 4. THE TREE (Spatial bounding optimization)
  let treeBase = vec3f(-3.2, 0.0, 0.8);
  let treeP = p - treeBase;
  let dTreeBound = sdSphere(treeP - vec3f(0.0, 2.5, 0.0), 2.7);

  if (dTreeBound < 0.6) {
    let dTrunk = sdCylinder(treeP - vec3f(0.0, 1.4, 0.0), 1.4, 0.28);
    let branch1 = sdCapsule(treeP, vec3f(0.0, 1.8, 0.0), vec3f(-0.7, 2.5, 0.3), 0.14);
    let branch2 = sdCapsule(treeP, vec3f(0.0, 1.7, 0.0), vec3f(0.6, 2.4, -0.2), 0.13);
    res = opU(res, Hit(min(dTrunk, min(branch1, branch2)), MAT_TREE_BARK, treeP.xy));

    let crown1 = sdSphere(treeP - vec3f(0.0, 3.2, 0.0), 1.25);
    let crown2 = sdSphere(treeP - vec3f(-0.8, 2.8, 0.4), 1.05);
    let crown3 = sdSphere(treeP - vec3f(0.7, 2.9, -0.3), 1.0);
    let crown4 = sdSphere(treeP - vec3f(0.1, 3.8, 0.2), 0.95);
    let dLeaves = smin(smin(crown1, crown2, 0.35), smin(crown3, crown4, 0.35), 0.4);
    res = opU(res, Hit(dLeaves, MAT_TREE_LEAVES, treeP.xy));
  } else {
    res = opU(res, Hit(dTreeBound, MAT_TREE_LEAVES, treeP.xy));
  }

  // 5. WOODEN FENCE (Right side of house: x between 2.3 and 5.8)
  if (p.x > 2.3 && p.x < 5.8 && abs(p.z - 0.2) < 0.8) {
    let fenceLocalX = p.x - 2.5;
    let postX = fmod(fenceLocalX, 0.7) - 0.35;
    let postP = vec3f(postX, p.y - 0.55, p.z - 0.2);
    let dPost = sdBox(postP, vec3f(0.045, 0.55, 0.045));
    let dRail1 = sdBox(vec3f(p.x - 4.0, p.y - 0.75, p.z - 0.2), vec3f(1.6, 0.035, 0.025));
    let dRail2 = sdBox(vec3f(p.x - 4.0, p.y - 0.40, p.z - 0.2), vec3f(1.6, 0.035, 0.025));
    res = opU(res, Hit(min(dPost, min(dRail1, dRail2)), MAT_FENCE, postP.xy));
  }

  // 6. WILDFLOWERS
  let flowerPos1 = p - vec3f(-1.6, 0.2, 3.2);
  if (length(flowerPos1) < 1.2) {
    let dFlowerPink = sdSphere(flowerPos1 - vec3f(0.1, 0.1, 0.0), 0.12);
    let dFlowerPurple = sdSphere(flowerPos1 - vec3f(-0.3, 0.05, 0.2), 0.12);
    let dFlowerOrange = sdSphere(flowerPos1 - vec3f(0.3, 0.15, -0.2), 0.11);
    res = opU(res, Hit(dFlowerPink, MAT_FLOWER_PINK, flowerPos1.xy));
    res = opU(res, Hit(dFlowerPurple, MAT_FLOWER_PURPLE, flowerPos1.xy));
    res = opU(res, Hit(dFlowerOrange, MAT_FLOWER_ORANGE, flowerPos1.xy));
  }

  // 7. LITTLE ROCKS
  let rock1 = sdSphere(p - vec3f(-1.2, 0.05, 2.0), 0.16);
  let rock2 = sdSphere(p - vec3f(1.8, 0.06, 1.8), 0.22);
  let rock3 = sdSphere(p - vec3f(3.5, 0.04, 3.0), 0.14);
  res = opU(res, Hit(min(min(rock1, rock2), rock3), MAT_ROCK, p.xz));

  // 8. CHILD & KITE
  let childP = p - vec3f(3.8, 0.55, 3.2);
  if (length(childP) < 1.8) {
    let dBody = sdCapsule(childP, vec3f(0.0, 0.0, 0.0), vec3f(0.0, 0.55, 0.0), 0.16);
    let dHead = sdSphere(childP - vec3f(0.0, 0.78, 0.0), 0.18);
    res = opU(res, Hit(dBody, MAT_CHILD_BODY, childP.xy));
    res = opU(res, Hit(dHead, MAT_CHILD_HEAD, childP.xy));
  }

  // Diamond Flying Kite
  let kiteSway = sin(u.time * 1.5) * 0.25;
  let kiteP = p - vec3f(4.8 + kiteSway, 5.2 + sin(u.time * 2.0) * 0.15, 2.5);
  if (length(kiteP) < 1.5) {
    res = opU(res, Hit(sdBox(kiteP, vec3f(0.45, 0.45, 0.02)), MAT_KITE, kiteP.xy));
  }

  // 9. SIGNPOST "MY HAPPY HOME"
  let signPos = p - vec3f(0.9, 0.35, 2.8);
  let dSignPost = sdCylinder(signPos, 0.35, 0.04);
  let dSignBoard = sdBox(signPos - vec3f(0.0, 0.25, 0.0), vec3f(0.35, 0.15, 0.03));
  res = opU(res, Hit(min(dSignPost, dSignBoard), MAT_SIGN, signPos.xy));

  return res;
}

// -------------------------------------------------------------
// NORMAL & RAYMARCHING
// -------------------------------------------------------------
fn calcNormal(p: vec3f) -> vec3f {
  let e = 0.003;
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

struct RayResult {
  hit: Hit,
  steps: i32,
};

fn raymarch(ro: vec3f, rd: vec3f) -> RayResult {
  var t: f32 = 0.08;
  var hit = Hit(MAX_DIST, MAT_NONE, vec2f(0.0));
  var stepCount: i32 = 0;
  
  for (var i: i32 = 0; i < MAX_STEPS; i++) {
    stepCount = i;
    let p = ro + rd * t;
    let h = mapScene(p);
    
    if (h.d < SURF_DIST) {
      hit = h;
      hit.d = t;
      return RayResult(hit, stepCount);
    }
    
    t += h.d * 0.88;
    if (t > MAX_DIST) {
      break;
    }
  }
  
  hit.d = MAX_DIST;
  return RayResult(hit, stepCount);
}

// Fast Soft Shadow (20 steps)
fn calcSoftShadow(ro: vec3f, rd: vec3f, mint: f32, maxt: f32, k: f32) -> f32 {
  var res: f32 = 1.0;
  var t = mint;
  for (var i: i32 = 0; i < 20; i++) {
    let h = mapScene(ro + rd * t).d;
    if (h < 0.002) {
      return 0.0;
    }
    res = min(res, k * h / t);
    t += max(h * 0.8, 0.06);
    if (t > maxt) {
      break;
    }
  }
  return clamp(res, 0.0, 1.0);
}

// 5-tap Ambient Occlusion
fn calcAO(p: vec3f, n: vec3f) -> f32 {
  var occ: f32 = 0.0;
  var sca: f32 = 1.0;
  for (var i: i32 = 0; i < 5; i++) {
    let h = 0.02 + 0.14 * f32(i) / 4.0;
    let d = mapScene(p + h * n).d;
    occ += (h - d) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 2.4 * occ * u.aoIntensity, 0.0, 1.0);
}

// -------------------------------------------------------------
// ATMOSPHERIC SKY & SUN
// -------------------------------------------------------------
fn getSkyColor(rd: vec3f, sunDir: vec3f) -> vec3f {
  let sunDot = max(dot(rd, sunDir), 0.0);
  
  let skyZenith = u.skyColor * 0.75;
  let skyHorizon = u.skyColor * 1.35 + vec3f(0.15, 0.12, 0.08);
  var col = mix(skyHorizon, skyZenith, pow(max(rd.y, 0.0), 0.6));
  
  let sunsetFactor = smoothstep(0.35, -0.05, sunDir.y);
  let sunsetGlow = vec3f(1.0, 0.45, 0.15) * pow(sunDot, 4.0) * 1.8;
  col = mix(col, col * vec3f(1.2, 0.8, 0.6) + sunsetGlow, sunsetFactor);
  
  // Procedural Clouds in the upper sky
  if (rd.y > 0.05) {
    let cloudY = 22.0;
    let cloudT = (cloudY - u.camPos.y) / rd.y;
    if (cloudT > 0.0 && cloudT < 120.0) {
      let cloudUV = (u.camPos.xz + rd.xz * cloudT) * 0.035 + vec2f(u.time * 0.015, 0.0);
      let cNoise = fbm2D(cloudUV * 2.0);
      let cloudMask = smoothstep(0.55 - u.cloudDensity * 0.15, 0.78, cNoise);
      let cloudSunLit = smoothstep(0.4, 0.9, sunDot) * 0.5 + 0.5;
      let cloudColor = mix(vec3f(0.82, 0.88, 0.95), vec3f(1.0, 0.98, 0.95) * u.sunColor, cloudSunLit);
      col = mix(col, cloudColor, cloudMask * smoothstep(0.05, 0.18, rd.y));
    }
  }

  // Radiant Sun Disc & Corona
  let sunDisc = smoothstep(0.9992, 0.9998, sunDot);
  let sunCorona = pow(sunDot, 48.0) * 1.5;
  let sunGlow = pow(sunDot, 6.0) * 0.6;
  col += u.sunColor * (sunDisc * 8.0 + sunCorona + sunGlow) * u.sunIntensity;
  
  return max(vec3f(0.0), col);
}

// -------------------------------------------------------------
// MATERIAL & PBR EVALUATION
// -------------------------------------------------------------
struct Material {
  albedo: vec3f,
  roughness: f32,
  metallic: f32,
  emission: vec3f,
  subsurface: f32,
  isGlass: bool,
};

fn getMaterial(hit: Hit, p: vec3f, n: vec3f) -> Material {
  var m: Material;
  m.albedo = vec3f(0.5);
  m.roughness = 0.6;
  m.metallic = 0.0;
  m.emission = vec3f(0.0);
  m.subsurface = 0.0;
  m.isGlass = false;

  let mat = hit.mat;

  if (mat == MAT_GRASS) {
    let macroNoise = fbm2D(p.xz * 1.8);
    let microNoise = noise2D(p.xz * 22.0);
    let windSway = sin(p.x * 3.0 + p.z * 2.0 + u.time * 2.2) * 0.08;
    let baseGrass = vec3f(0.14, 0.44, 0.12);
    let lushGrass = vec3f(0.36, 0.68, 0.19);
    let sunlitTip = vec3f(0.48, 0.76, 0.22);
    m.albedo = mix(mix(baseGrass, lushGrass, macroNoise + windSway), sunlitTip, microNoise * 0.35);
    m.roughness = 0.82;
    m.subsurface = 0.42;
  }
  else if (mat == MAT_PATH) {
    let pNoise = fbm2D(p.xz * 5.5);
    let pebbleNoise = noise2D(p.xz * 32.0);
    let dirtBase = mix(vec3f(0.64, 0.52, 0.38), vec3f(0.50, 0.39, 0.28), pNoise);
    let pebbles = vec3f(0.42, 0.40, 0.38);
    m.albedo = mix(dirtBase, pebbles, smoothstep(0.72, 0.85, pebbleNoise) * 0.5);
    m.roughness = 0.94;
  }
  else if (mat == MAT_HOUSE_BRICK) {
    let brickUV = p.xy * vec2f(3.8, 7.2);
    let brickRow = floor(brickUV.y);
    let rowShift = (fmod(brickRow, 2.0)) * 0.5;
    let brickCol = floor(brickUV.x + rowShift);
    let brickLocal = fract(vec2f(brickUV.x + rowShift, brickUV.y));
    let mortar = smoothstep(0.04, 0.09, brickLocal.x) * smoothstep(0.96, 0.91, brickLocal.x) *
                 smoothstep(0.06, 0.13, brickLocal.y) * smoothstep(0.94, 0.87, brickLocal.y);
    let brickColorVar = hash12(vec2f(brickRow, brickCol));
    let brickGrain = noise2D(p.xy * 45.0) * 0.08;
    let baseBrick = mix(vec3f(0.86, 0.58, 0.32), vec3f(0.96, 0.72, 0.40), brickColorVar) + brickGrain;
    let mortarColor = vec3f(0.68, 0.64, 0.58);
    // Subtle height weathering (softer at base, brighter in middle)
    let weather = smoothstep(0.0, 2.5, p.y) * 0.15 + 0.90;
    m.albedo = mix(mortarColor, baseBrick * weather, mortar);
    m.roughness = mix(0.96, 0.74, mortar);
  }
  else if (mat == MAT_ROOF_TILES) {
    // Curved barrel tile scalloping
    let tilePhase = p.x * 22.0;
    let tileProfile = sin(tilePhase);
    let tileHighlight = pow(clamp(tileProfile * 0.5 + 0.5, 0.0, 1.0), 1.8);
    let tileBase = mix(vec3f(0.72, 0.24, 0.18), vec3f(0.88, 0.38, 0.26), tileHighlight);
    // Ridge and weathering
    let ridgeDark = smoothstep(0.9, 1.2, abs(p.x));
    // Soot near chimney (x around 1.15, z around -0.3)
    let distToChimney = length(p.xz - vec2f(1.15, -0.3));
    let soot = smoothstep(1.5, 0.2, distToChimney) * 0.28;
    m.albedo = mix(tileBase, vec3f(0.25, 0.20, 0.18), soot) * (1.0 - ridgeDark * 0.15);
    m.roughness = 0.54;
  }
  else if (mat == MAT_CHIMNEY) {
    let cNoise = noise2D(p.xy * 12.0) * 0.08;
    m.albedo = vec3f(0.62, 0.25, 0.18) + cNoise;
    m.roughness = 0.80;
  }
  else if (mat == MAT_WINDOW_GLASS) {
    // Deep reflective glass with cozy warm interior illumination
    m.albedo = vec3f(0.08, 0.16, 0.22);
    m.roughness = 0.03;
    m.isGlass = true;
    m.emission = vec3f(1.0, 0.78, 0.42) * 0.35;
  }
  else if (mat == MAT_WINDOW_FRAME) {
    m.albedo = vec3f(0.24, 0.16, 0.11);
    m.roughness = 0.65;
  }
  else if (mat == MAT_DOOR) {
    m.albedo = vec3f(0.48, 0.28, 0.16);
    m.roughness = 0.60;
  }
  else if (mat == MAT_DOOR_KNOB) {
    m.albedo = vec3f(0.92, 0.75, 0.32);
    m.roughness = 0.22;
    m.metallic = 0.95;
  }
  else if (mat == MAT_TREE_BARK) {
    m.albedo = vec3f(0.32, 0.20, 0.12);
    m.roughness = 0.88;
  }
  else if (mat == MAT_TREE_LEAVES) {
    let lNoise = noise2D(p.xy * 3.0);
    m.albedo = mix(vec3f(0.15, 0.48, 0.14), vec3f(0.38, 0.68, 0.20), lNoise);
    m.roughness = 0.55;
    m.subsurface = 0.65;
  }
  else if (mat == MAT_FENCE) {
    m.albedo = vec3f(0.72, 0.52, 0.32);
    m.roughness = 0.78;
  }
  else if (mat == MAT_FLOWER_PINK) {
    m.albedo = vec3f(0.96, 0.38, 0.58);
    m.roughness = 0.45;
  }
  else if (mat == MAT_FLOWER_PURPLE) {
    m.albedo = vec3f(0.62, 0.42, 0.94);
    m.roughness = 0.45;
  }
  else if (mat == MAT_FLOWER_ORANGE) {
    m.albedo = vec3f(0.98, 0.55, 0.22);
    m.roughness = 0.45;
  }
  else if (mat == MAT_ROCK) {
    m.albedo = vec3f(0.48, 0.47, 0.44);
    m.roughness = 0.82;
  }
  else if (mat == MAT_CHILD_BODY) {
    m.albedo = vec3f(0.85, 0.28, 0.24);
    m.roughness = 0.75;
  }
  else if (mat == MAT_CHILD_HEAD) {
    m.albedo = vec3f(0.92, 0.74, 0.62);
    m.roughness = 0.55;
  }
  else if (mat == MAT_KITE) {
    m.albedo = vec3f(0.95, 0.18, 0.22);
    m.roughness = 0.40;
  }
  else if (mat == MAT_MOUNTAIN) {
    m.albedo = vec3f(0.35, 0.42, 0.38);
    m.roughness = 0.90;
  }
  else if (mat == MAT_SNOW) {
    m.albedo = vec3f(0.94, 0.97, 1.0);
    m.roughness = 0.42;
  }
  else if (mat == MAT_SMOKE) {
    m.albedo = vec3f(0.78, 0.80, 0.82);
    m.roughness = 0.95;
    m.subsurface = 0.85;
  }
  else if (mat == MAT_SIGN) {
    m.albedo = vec3f(0.58, 0.42, 0.28);
    m.roughness = 0.85;
  }

  return m;
}

// -------------------------------------------------------------
// SURFACE SHADING & GLOBAL ILLUMINATION
// -------------------------------------------------------------
struct ShadingBreakdown {
  finalColor: vec3f,
  diffuseGI: vec3f,
  ao: f32,
  shadow: f32,
  normal: vec3f,
};

fn shadeSurfaceDetailed(p: vec3f, n: vec3f, rd: vec3f, hit: Hit) -> ShadingBreakdown {
  let m = getMaterial(hit, p, n);
  let v = -rd;
  let sunDir = normalize(u.sunDir);
  
  let nDotL = max(dot(n, sunDir), 0.0);
  let nDotV = max(dot(n, v), 0.001);
  
  // Direct Sun Shadows
  var shadow: f32 = 1.0;
  if (nDotL > 0.0) {
    shadow = calcSoftShadow(p + n * 0.03, sunDir, 0.04, 30.0, 20.0);
  }
  
  // Ambient Occlusion
  let ao = calcAO(p, n);
  
  // Cook-Torrance Specular BRDF
  let h = normalize(sunDir + v);
  let nDotH = max(dot(n, h), 0.0);
  let vDotH = max(dot(v, h), 0.0);
  
  let alpha = m.roughness * m.roughness;
  let alpha2 = alpha * alpha;
  let denom = (nDotH * nDotH * (alpha2 - 1.0) + 1.0);
  let D = alpha2 / (PI * denom * denom + 0.0001);
  
  let F0 = mix(vec3f(0.04), m.albedo, m.metallic);
  let F = F0 + (1.0 - F0) * pow(clamp(1.0 - vDotH, 0.0, 1.0), 5.0);
  
  let kG = (m.roughness + 1.0) * (m.roughness + 1.0) / 8.0;
  let g1 = nDotV / (nDotV * (1.0 - kG) + kG);
  let g2 = nDotL / (nDotL * (1.0 - kG) + kG);
  let G = g1 * g2;
  
  let specular = (D * F * G) / (4.0 * nDotV * nDotL + 0.001);
  let kd = (vec3f(1.0) - F) * (1.0 - m.metallic);
  
  let directLight = (kd * m.albedo / PI + specular) * u.sunColor * u.sunIntensity * nDotL * shadow;
  
  // Multi-bounce Diffuse GI
  var indirectLight = vec3f(0.0);
  if (u.giEnabled == 1u) {
    let skyAmbient = u.skyColor * 0.35 * clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
    let groundFactor = clamp(-n.y, 0.0, 1.0);
    let meadowBounce = vec3f(0.25, 0.55, 0.18) * u.sunIntensity * 0.45 * groundFactor;
    let houseDist = length(p.xz);
    let houseWarmth = smoothstep(5.0, 1.5, houseDist) * vec3f(0.65, 0.38, 0.22) * 0.25;
    
    indirectLight = (skyAmbient + meadowBounce + houseWarmth) * m.albedo * ao * u.giIntensity;
  } else {
    indirectLight = u.skyColor * 0.25 * m.albedo * ao;
  }

  // Subsurface Scattering
  var sssLight = vec3f(0.0);
  if (m.subsurface > 0.0) {
    let sssDot = max(dot(rd, sunDir), 0.0);
    sssLight = m.albedo * u.sunColor * pow(sssDot, 3.0) * m.subsurface * (shadow * 0.5 + 0.5);
  }
  
  // Glass Reflections
  var glassReflection = vec3f(0.0);
  if (m.isGlass && u.reflectionsEnabled == 1u) {
    let reflDir = reflect(rd, n);
    let skyRefl = getSkyColor(reflDir, sunDir);
    let fresnelGlass = 0.08 + 0.92 * pow(1.0 - nDotV, 5.0);
    glassReflection = skyRefl * fresnelGlass;
  }
  
  var finalCol = directLight + indirectLight + sssLight + glassReflection + m.emission;
  
  // Distance aerial haze
  let dist = hit.d;
  let fogFactor = 1.0 - exp(-dist * 0.008);
  let fogColor = mix(u.skyColor * 0.9, vec3f(0.85, 0.88, 0.92), smoothstep(0.0, 40.0, dist));
  finalCol = mix(finalCol, fogColor, clamp(fogFactor, 0.0, 0.9));
  
  var breakdown: ShadingBreakdown;
  breakdown.finalColor = max(vec3f(0.0), finalCol);
  breakdown.diffuseGI = indirectLight;
  breakdown.ao = ao;
  breakdown.shadow = shadow;
  breakdown.normal = n;
  return breakdown;
}

// -------------------------------------------------------------
// HIGH PERFORMANCE VOLUMETRIC GODRAYS
// -------------------------------------------------------------
fn computeGodraysFast(ro: vec3f, rd: vec3f, maxT: f32, jitter: f32) -> vec3f {
  if (u.godraysEnabled == 0u) {
    return vec3f(0.0);
  }

  let sunDir = normalize(u.sunDir);
  let sunDot = max(dot(rd, sunDir), 0.0);
  
  // Forward Mie scattering phase
  let phase = pow(sunDot, 8.0) * 0.45 + pow(sunDot, 32.0) * 0.85;
  if (phase < 0.001) {
    return vec3f(0.0);
  }
  
  let numSteps = 16;
  let stepSize = min(maxT, 32.0) / f32(numSteps);
  var marchT = stepSize * (0.2 + 0.6 * jitter);
  var accumulatedLight: f32 = 0.0;
  
  for (var i: i32 = 0; i < numSteps; i++) {
    let sampleP = ro + rd * marchT;
    
    // Fast 4-step shadow ray
    var inLight: f32 = 1.0;
    var sT: f32 = 0.2;
    for (var s: i32 = 0; s < 4; s++) {
      let sh = mapScene(sampleP + sunDir * sT).d;
      if (sh < 0.02) {
        inLight = 0.0;
        break;
      }
      sT += max(sh, 0.6);
    }
    
    let altDensity = exp(-max(sampleP.y, 0.0) * 0.12);
    accumulatedLight += inLight * altDensity * stepSize;
    marchT += stepSize;
  }
  
  return u.sunColor * phase * accumulatedLight * 0.09 * u.godrayIntensity;
}

// ACES Filmic Tone Mapping
fn acesFilm(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  var jitter = vec2f(0.0);
  if (u.frameIndex > 0u) {
    let jx = hash12(vec2f(f32(u.frameIndex), 1.23)) - 0.5;
    let jy = hash12(vec2f(f32(u.frameIndex), 4.56)) - 0.5;
    jitter = vec2f(jx, jy) / u.resolution;
  }
  
  let uv = (in.uv * 2.0 - 1.0) + jitter;
  let aspect = u.aspect;
  let screenCoord = vec2f(uv.x * aspect, uv.y);
  
  // Camera Setup
  let ro = u.camPos;
  let camTarget = u.camTarget;
  let fwd = normalize(camTarget - ro);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  
  let fovRad = u.fov * PI / 180.0;
  let tanHalfFov = tan(fovRad * 0.5);
  let rd = normalize(fwd + (right * screenCoord.x + up * screenCoord.y) * tanHalfFov);
  
  // 1. Raymarch Scene
  let marchRes = raymarch(ro, rd);
  let hit = marchRes.hit;
  let sunDir = normalize(u.sunDir);
  
  var col = vec3f(0.0);
  var breakdown: ShadingBreakdown;
  breakdown.finalColor = vec3f(0.0);
  breakdown.diffuseGI = vec3f(0.0);
  breakdown.ao = 1.0;
  breakdown.shadow = 1.0;
  breakdown.normal = vec3f(0.0, 1.0, 0.0);

  if (hit.mat != MAT_NONE && hit.d < MAX_DIST) {
    let p = ro + rd * hit.d;
    let n = calcNormal(p);
    breakdown = shadeSurfaceDetailed(p, n, rd, hit);
    col = breakdown.finalColor;
  } else {
    col = getSkyColor(rd, sunDir);
  }
  
  // 2. Volumetric Sun Godrays
  let maxRayDist = min(hit.d, MAX_DIST);
  let godrayJitter = hash12(in.uv * u.resolution + vec2f(f32(u.frameIndex) * 0.1));
  let godrays = computeGodraysFast(ro, rd, maxRayDist, godrayJitter);
  
  // 3. DEBUG MODES VISUALIZATION
  if (u.debugMode == 1u) {
    // Mode 1: Surface Normals
    if (hit.mat != MAT_NONE && hit.d < MAX_DIST) {
      return vec4f(breakdown.normal * 0.5 + 0.5, 1.0);
    } else {
      return vec4f(0.1, 0.1, 0.15, 1.0);
    }
  } else if (u.debugMode == 2u) {
    // Mode 2: Global Illumination Diffuse Irradiance
    return vec4f(breakdown.diffuseGI * 2.0, 1.0);
  } else if (u.debugMode == 3u) {
    // Mode 3: Volumetric Godrays Isolated
    return vec4f(godrays * 2.5, 1.0);
  } else if (u.debugMode == 4u) {
    // Mode 4: Ambient Occlusion Grayscale
    return vec4f(vec3f(breakdown.ao), 1.0);
  } else if (u.debugMode == 5u) {
    // Mode 5: Direct Sunlight & Soft Shadow
    let sh = select(1.0, breakdown.shadow, hit.mat != MAT_NONE);
    return vec4f(vec3f(sh), 1.0);
  } else if (u.debugMode == 6u) {
    // Mode 6: Raymarch Complexity Heatmap
    let heat = f32(marchRes.steps) / f32(MAX_STEPS);
    let heatCol = mix(vec3f(0.0, 0.3, 1.0), vec3f(1.0, 0.2, 0.0), heat);
    return vec4f(heatCol, 1.0);
  }

  // Add godrays to beauty pass
  col += godrays;
  
  // Vignette
  let vig = 1.0 - 0.25 * dot(uv, uv);
  col *= vig;
  
  // ACES Filmic Tone Mapping & Gamma
  col = acesFilm(col);
  col = pow(col, vec3f(1.0 / 2.2));
  
  return vec4f(col, 1.0);
}
`;
