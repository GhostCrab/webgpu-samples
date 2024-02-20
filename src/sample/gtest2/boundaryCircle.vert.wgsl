struct MVPUniform {
  modelViewProjectionMatrix: mat4x4<f32>
};

struct Params {
  totalTime: f32,
  deltaTime: f32,
  constrainRadius: f32,
  unused2: f32,
  constrainCenter: vec4<f32>
};

@group(0) @binding(0) var<uniform> mvp : MVPUniform;
@group(0) @binding(1) var<uniform> params : Params;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) fragUV : vec2<f32>,
}

@vertex
fn vertex_main(
  @builtin(instance_index) instanceIdx : u32,
  @location(0) position : vec4<f32>,
  @location(1) uv : vec2<f32>
) -> VertexOutput {
  var scaleMatrix = mat4x4<f32>(
    params.constrainRadius, 0, 0, 0,
    0, params.constrainRadius, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  );

  var offsetPos = (scaleMatrix * position);

  return VertexOutput(mvp.modelViewProjectionMatrix * offsetPos, uv);
}

fn inverse_lerp(a: f32, b: f32, v: f32) -> f32 {
  return (v - a) / (b - a);
}

@fragment
fn fragment_main(
    @location(0) fragUV : vec2<f32>
  ) -> @location(0) vec4f {
  var recenter = fragUV - 0.5;
  var len = sqrt((recenter.x * recenter.x) + (recenter.y * recenter.y));
  if (len > 0.5) {
    return vec4(0);
  }

  // const c2 = vec4(1, 1, 1, 0);
  // var realign = saturate(inverse_lerp(0.4, 1, len * 2));
  // var out = mix(color, c2, realign); 

  return vec4(0.2, 0.2, 0.2, 1);
}