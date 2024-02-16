struct MVPUniform {
  modelViewProjectionMatrix: mat4x4<f32>
};

struct Params {
  totalTime: f32,
  deltaTime: f32,
  unused1: f32,
  unused2: f32
};

//     0     1     2         3         4       5       6       7  8  9
// f32 xpos, ypos, prevXPos, prevYPos, accelX, accelY, radius, r, g, b
struct StorageBuf {
  verletObjects : array<f32, 100000 * 10>
}

@group(0) @binding(0) var<uniform> mvp : MVPUniform;
@group(0) @binding(1) var<uniform> params : Params;
@group(0) @binding(2) var<storage, read> storageBuf : StorageBuf;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) fragUV : vec2<f32>,
  @location(2) @interpolate(flat) cull : u32,
}

@vertex
fn vertex_main(
  @builtin(instance_index) instanceIdx : u32,
  @location(0) position : vec4f,
  @location(1) uv : vec2f,
) -> VertexOutput {
  // return VertexOutput(storageBuf.modelViewProjectionMatrix * position, uv);
  if (storageBuf.verletObjects[(instanceIdx * 10) + 7] == 0 && storageBuf.verletObjects[(instanceIdx * 10) + 8] == 0 && storageBuf.verletObjects[(instanceIdx * 10) + 9] == 0)
  {return VertexOutput(vec4f(0), vec4f(0), vec2f(0), 1);}

  var posOffset = vec4f(storageBuf.verletObjects[(instanceIdx * 10)], storageBuf.verletObjects[(instanceIdx * 10) + 1], 0, 0);
  var color = vec4f(storageBuf.verletObjects[(instanceIdx * 10) + 7], storageBuf.verletObjects[(instanceIdx * 10) + 8], storageBuf.verletObjects[(instanceIdx * 10) + 9], 1);

  var rotMatrix = mat4x4<f32>(
    cos(params.totalTime), -sin(params.totalTime), 0, 0,
    sin(params.totalTime), cos(params.totalTime), 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  );

  var scaleMatrix = mat4x4<f32>(
    storageBuf.verletObjects[(instanceIdx * 10) + 6], 0, 0, 0,
    0, storageBuf.verletObjects[(instanceIdx * 10) + 6], 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  );

  var offsetPos = (scaleMatrix * position) + posOffset;

  return VertexOutput(mvp.modelViewProjectionMatrix * offsetPos, color, uv, 0);
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