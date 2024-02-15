struct Uniforms {
  modelViewProjectionMatrix : mat4x4<f32>,
  totalTime : f32,
  unused1: f32,
  unused2: f32,
  unused3: f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexOutput {
  @builtin(position) Position : vec4f,
  @location(0) fragUV : vec2f,
}

@vertex
fn vertex_main(
  @location(0) position : vec4f,
  @location(1) uv : vec2f
) -> VertexOutput {
  // return VertexOutput(uniforms.modelViewProjectionMatrix * position, uv);

  var rotMatrix = mat4x4<f32>(
    cos(uniforms.totalTime), -sin(uniforms.totalTime), 0, 0,
    sin(uniforms.totalTime), cos(uniforms.totalTime), 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  );

  var scaleMatrix = mat4x4<f32>(
    45.5, 0, 0, 0,
    0, 45.5, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  );

  return VertexOutput(uniforms.modelViewProjectionMatrix * (scaleMatrix * position), uv);
}

fn inverse_lerp(a: f32, b: f32, v: f32) -> f32 {
  return (v - a) / (b - a);
}

@fragment
fn fragment_main(@location(0) fragUV: vec2f) -> @location(0) vec4f {
  var recenter = fragUV - 0.5;
  var len = sqrt((recenter.x * recenter.x) + (recenter.y * recenter.y));
  if (len > 0.5) {
    discard;
  }

  const c1 = vec3(1, 0, 0);
  const c2 = vec3(0, 0, 1);
  var realign = saturate(inverse_lerp(0.7, 1, len * 2));
  var out = mix(c1, c2, realign); 

  return vec4(out, 1.0);
}