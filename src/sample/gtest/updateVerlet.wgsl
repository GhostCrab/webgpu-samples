//     0     1     2         3         4       5       6       7  8  9
// f32 xpos, ypos, prevXPos, prevYPos, accelX, accelY, radius, r, g, b

struct StorageBuf {
  verletObjects : array<f32, 100000 * 10>,
  modelViewProjectionMatrix : mat4x4<f32>,
  totalTime : f32,
  deltaTime: f32,
  unused2: f32,
  unused3: f32,
}

@group(0) @binding(0) var<storage, read_write> storageBuf : StorageBuf;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = GlobalInvocationID.x;
  var objIndexStart = index * 10;

  var pos = vec2(
    storageBuf.verletObjects[objIndexStart + 0], 
    storageBuf.verletObjects[objIndexStart + 1]
  );

  storageBuf.verletObjects[objIndexStart + 1] += (storageBuf.deltaTime / 2000);
}