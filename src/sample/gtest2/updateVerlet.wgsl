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

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read_write> storageBuf : StorageBuf;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = GlobalInvocationID.x;
  var objIndexStart = index * 10;

  var pos = vec2(
    storageBuf.verletObjects[objIndexStart + 0], 
    storageBuf.verletObjects[objIndexStart + 1]
  );

  // storageBuf.verletObjects[objIndexStart + 1] += (params.deltaTime / 2000);
  storageBuf.verletObjects[objIndexStart + 1] += params.deltaTime + 10;
}