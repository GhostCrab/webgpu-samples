struct VerletObject {
  pos: vec4<f32>,
  prevPos: vec4<f32>,
  accel: vec4<f32>,
  colorAndRadius: vec4<f32>,
}

struct BinParams {
  size: i32,
  x: i32,
  y: i32,
  count: i32,
}

@group(0) @binding(0) var<storage, read>       verletObjectsIn: array<VerletObject>;
@group(0) @binding(1) var<uniform>             binParams: BinParams;
@group(0) @binding(2) var<storage, read>       binBuf: array<i32>;
@group(0) @binding(3) var<storage, read_write> binSumBuf: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = u32(GlobalInvocationID.x);

  if (index < u32(binParams.count)) {
    atomicStore(&binSumBuf[index], 0u);
  }

  storageBarrier();

  if (index < arrayLength(&verletObjectsIn)) {
    atomicAdd(&binSumBuf[binBuf[index]], 1u);
  }
}