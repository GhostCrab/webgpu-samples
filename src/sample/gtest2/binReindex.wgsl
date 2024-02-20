struct VerletObject {
  pos: vec4<f32>,
  prevPos: vec4<f32>,
  accel: vec4<f32>,
  colorAndRadius: vec4<f32>,
}

@group(0) @binding(0) var<storage, read>       verletObjectsIn: array<VerletObject>;
@group(0) @binding(1) var<storage, read>       binBuf: array<i32>;
@group(0) @binding(2) var<storage, read_write> binIndexTrackerBuf: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> binReindexBuf: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = u32(GlobalInvocationID.x);

  if (index >= arrayLength(&verletObjectsIn)) {
    return;
  }

  var bin = binBuf[index];

  var lastIndex = atomicAdd(&binIndexTrackerBuf[bin], 1);
  binReindexBuf[lastIndex] = index;
}