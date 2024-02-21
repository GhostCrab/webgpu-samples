struct BinParams {
  size: i32,
  x: i32,
  y: i32,
  count: i32,
}

@group(0) @binding(0) var<storage, read>       binSumBuf: array<u32>;
@group(0) @binding(1) var<storage, read_write> binPrefixSumBuf: array<i32>;
@group(0) @binding(2) var<storage, read_write> binIndexTrackerBuf: array<atomic<i32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = i32(GlobalInvocationID.x);

  // if (index >= binParams.count) {
  //   return;
  // }

  binPrefixSumBuf[index] = 0;

  for (var i = 0; i <= index; i++) {
    binPrefixSumBuf[index] += i32(binSumBuf[i]);
  }

  storageBarrier();

  atomicStore(&binIndexTrackerBuf[index], 0);
  if (index > 0) {
    atomicStore(&binIndexTrackerBuf[index], binPrefixSumBuf[index - 1]);
  }
}