
struct VertexOutput {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var out: VertexOutput;
  // Fullscreen triangle covering [-1, 1] NDC
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  out.pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(uv.x, 1.0 - uv.y);
  return out;
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var textureSampler: sampler;

// ACES Tone Mapping
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
  let rawColor = textureSample(sourceTexture, textureSampler, in.uv).rgb;
  
  // Exposure + ACES Tone Mapping + sRGB Gamma Correction
  let exposed = rawColor * 1.08;
  let tonemapped = acesFilm(exposed);
  let gammaCorrected = pow(tonemapped, vec3f(1.0 / 2.2));
  
  return vec4f(gammaCorrected, 1.0);
}
