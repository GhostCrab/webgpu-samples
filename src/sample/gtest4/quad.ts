export class Quad {
  vertexSize = 4 * 6;
  vertexCount = 6;
  positionOffset = 0;
  uvOffset = 4 * 4;

  vertexArray = new Float32Array([
      // float4 position, float4 color, float2 uv,
    -1,  1, 0,  1,   0, 0,
    -1, -1, 0,  1,   0, 1,
     1,  1, 0,  1,   1, 0,

     1,  1, 0,  1,   1, 0,
    -1, -1, 0,  1,   0, 1,
     1, -1, 0,  1,   1, 1,
  ]);

  verticesBuffer: GPUBuffer;

  constructor(device: GPUDevice) {
    // Create a vertex buffer from the cube data.
    this.verticesBuffer = device.createBuffer({
      size: this.vertexArray.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.verticesBuffer.getMappedRange()).set(this.vertexArray);
    this.verticesBuffer.unmap();
  }
}