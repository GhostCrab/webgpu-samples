import { mat4, vec2, vec3, vec4, Vec4 } from 'wgpu-matrix';
import { makeSample, SampleInit } from '../../components/SampleLayout';

import instancedCircleVertWGSL from './instancedCircle.vert.wgsl';

import { ArcballCamera, WASDCamera, cameraSourceInfo } from './camera';
import { createInputHandler, inputSourceInfo } from './input';

const init: SampleInit = async ({ canvas, pageState, gui, stats }) => {
  // The input handler
  const inputHandler = createInputHandler(window, canvas);

  // The camera types
  const initialCameraPosition = vec3.create(0, 0, 1);
  const cameras = {
    arcball: new ArcballCamera({ position: initialCameraPosition }),
    WASD: new WASDCamera({ position: initialCameraPosition }),
  };

  // GUI parameters
  const params: { type: 'arcball' | 'WASD' } = {
    type: 'arcball',
  };

  // Callback handler for camera mode
  let oldCameraType = params.type;
  gui.add(params, 'type', ['arcball', 'WASD']).onChange(() => {
    // Copy the camera matrix from old to new
    const newCameraType = params.type;
    cameras[newCameraType].matrix = cameras[oldCameraType].matrix;
    oldCameraType = newCameraType;
  });
  
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  if (!pageState.active) return;
  const context = canvas.getContext('webgpu') as GPUCanvasContext;

  const devicePixelRatio = window.devicePixelRatio;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'premultiplied',
  });

  const quadVertexSize = 4 * 6;
  const quadPositionOffset = 0;
  const quadUVOffset = 4 * 4;
  const quadVertexCount = 6;

  const quadVertexArray = new Float32Array([
      // float4 position, float4 color, float2 uv,
    -1,  1, 0,  1,   0, 0,
    -1, -1, 0,  1,   0, 1,
     1,  1, 0,  1,   1, 0,

     1,  1, 0,  1,   1, 0,
    -1, -1, 0,  1,   0, 1,
     1, -1, 0,  1,   1, 1,
  ]);

  // Create a vertex buffer from the cube data.
  const verticesBuffer = device.createBuffer({
    size: quadVertexArray.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(verticesBuffer.getMappedRange()).set(quadVertexArray);
  verticesBuffer.unmap();

  const sampleCount = 4;
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({
        code: instancedCircleVertWGSL,
      }),
      entryPoint: 'vertex_main',
      buffers: [
        {
          arrayStride: quadVertexSize,
          attributes: [
            {
              // position
              shaderLocation: 0,
              offset: quadPositionOffset,
              format: 'float32x4',
            },
            {
              // uv
              shaderLocation: 1,
              offset: quadUVOffset,
              format: 'float32x2',
            },
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({
        code: instancedCircleVertWGSL,
      }),
      entryPoint: 'fragment_main',
      targets: [
        {
          format: presentationFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'zero',
              dstFactor: 'one',
              operation: 'add',
            },
          }
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
    depthStencil: {
      depthWriteEnabled: false,
      depthCompare: 'less',
      format: 'depth24plus',
    },
    multisample: {
      count: sampleCount,
    },
    
  });

  const texture = device.createTexture({
    size: [canvas.width, canvas.height],
    sampleCount,
    format: presentationFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    sampleCount,
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const numObjects = 20000;
  const posOffsets = new Array<Vec4>(numObjects);
  const posOffsetData = new Float32Array(4 * numObjects);
  const posOffsetsSize = Float32Array.BYTES_PER_ELEMENT * 4 * numObjects;
  const posOffsetsOffset = 0;

  for (let i = 0; i < numObjects; i++) {
    posOffsets[i] = vec4.create(
      (Math.random() * canvas.width) - (canvas.width / 2),
      (Math.random() * canvas.height) - (canvas.height / 2),
      0, 0
    )
  }

  function updatePosOffsets() {
    for (let i = 0; i < numObjects; i++) {
      posOffsetData.set(posOffsets[i], i*4);
    }
    device.queue.writeBuffer(
      storageBuffer,
      posOffsetsOffset,
      posOffsetData
    );
  }

  const modelViewMatrixSize = Float32Array.BYTES_PER_ELEMENT * 16;
  const modelViewMatrixOffset = posOffsetsOffset + posOffsetsSize;

  const simParams = {
    totalTime: 0,
    unused1: 0,
    unused2: 0,
    unused3: 0,
  };
  const simParamsSize = 4 * Float32Array.BYTES_PER_ELEMENT;
  const simParamsOffset = (modelViewMatrixOffset + modelViewMatrixSize);

  const storageBufferSize = posOffsetsSize + modelViewMatrixSize + simParamsSize;
  const storageBuffer = device.createBuffer({
    size: storageBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  function updateSimParams(totalTime: number) {
    simParams.totalTime = totalTime;
    device.queue.writeBuffer(
      storageBuffer,
      simParamsOffset,
      new Float32Array([
        simParams.totalTime,
      ])
    );
  }

  updateSimParams(0);
  updatePosOffsets();

  const uniformBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: storageBuffer,
        },
      }
    ],
  });

  const aspect = canvas.width / canvas.height;
  const projectionMatrix = mat4.perspective(
    (2 * Math.PI) / 5,
    aspect,
    1,
    100.0
  );
  const orthoMatrix = mat4.ortho(
    -canvas.width / 2,
    canvas.width / 2,
    canvas.height / 2,
    -canvas.height / 2,
    1.05, -1
  );
  const modelViewProjectionMatrix = mat4.create();

  function getModelViewProjectionMatrix(deltaTime: number) {
    const camera = cameras[params.type];
    const viewMatrix = camera.update(deltaTime, inputHandler());
    mat4.multiply(orthoMatrix, viewMatrix, modelViewProjectionMatrix);
    return modelViewProjectionMatrix as Float32Array;
  }

  const modelViewProjection = getModelViewProjectionMatrix(0);
  device.queue.writeBuffer(
    storageBuffer,
    modelViewMatrixOffset,
    modelViewProjection.buffer,
    modelViewProjection.byteOffset,
    modelViewProjection.byteLength
  );

  let startFrameMS = Date.now();
  let lastFrameMS = Date.now();

  function frame() {
    stats.begin();

    const now = Date.now();
    const deltaTime = (now - lastFrameMS) / 1000;
    const totalTime = (now - startFrameMS) / 1000;
    lastFrameMS = now;

    updateSimParams(totalTime);

    // Sample is no longer the active page.
    if (!pageState.active) return;

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: texture.createView(),
          resolveTarget: context.getCurrentTexture().createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
  
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    };
    
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, uniformBindGroup);
    passEncoder.setVertexBuffer(0, verticesBuffer);
    passEncoder.draw(quadVertexCount, numObjects, 0, 0);
    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);

    stats.end()

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
};

const GTest: () => JSX.Element = () =>
  makeSample({
    name: 'GTest',
    description: 'Graphics Rendering Test.',
    gui: true,
    stats: true,
    init,
    sources: [
      {
        name: __filename.substring(__dirname.length + 1),
        contents: __SOURCE__,
      },
      {
        name: 'instancedCircle.vert.wgsl',
        contents: instancedCircleVertWGSL,
        editable: true,
      },
    ],
    filename: __filename,
  });

export default GTest;
