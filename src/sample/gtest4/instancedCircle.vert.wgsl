@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) fragUV: vec2<f32>,
  @location(2) @interpolate(flat) cull: u32,
}

@vertex
fn vertex_main(
  @builtin(instance_index) instanceIdx: u32,
  @location(0) position: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) i_pos: vec4<f32>,
  @location(3) i_prevPos: vec4<f32>,
  @location(4) i_accel: vec4<f32>,
  @location(5) i_color_and_radius: vec4<f32>
) -> VertexOutput {
  // return VertexOutput(storageBuf.modelViewProjectionMatrix * position, uv);
  if (i_color_and_radius.w == 0)
  {return VertexOutput(vec4f(0), vec4f(0), vec2f(0), 1);}

  var posOffset = vec4f(i_pos.xy, 0, 0);
  var color = vec4f(i_color_and_radius.xyz, 1);

  var scaleMatrix = mat4x4<f32>(
    i_color_and_radius.w, 0, 0, 0,
    0, i_color_and_radius.w, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  );

  var offsetPos = (scaleMatrix * position) + posOffset;

  return VertexOutput(mvp * offsetPos, color, uv, 0);
}

fn inverse_lerp(a: f32, b: f32, v: f32) -> f32 {
  return (v - a) / (b - a);
}

@fragment
fn fragment_main(
    @location(0) color : vec4<f32>,
    @location(1) fragUV : vec2<f32>,
    @location(2) @interpolate(flat) cull : u32
  ) -> @location(0) vec4f {
  if (cull == 1) {discard;};

  var recenter = fragUV - 0.5;
  var len = sqrt((recenter.x * recenter.x) + (recenter.y * recenter.y));
  // if (len > 0.5) {
  //   discard;
  // }

  const c2 = vec4(1, 1, 1, 0);
  var realign = saturate(inverse_lerp(0.4, 1, len * 2));
  var out = mix(color, c2, realign); 

  return out;
}