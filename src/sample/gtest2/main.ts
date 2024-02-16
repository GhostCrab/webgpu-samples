import { mat4, vec2, vec3, vec4, Vec4 } from 'wgpu-matrix';
import { makeSample, SampleInit } from '../../components/SampleLayout';

import instancedCircleVertWGSL from './instancedCircle.vert.wgsl';
import updateVerletWGSL from './updateVerlet.wgsl';

import { ArcballCamera, WASDCamera, cameraSourceInfo } from './camera';
import { createInputHandler, inputSourceInfo } from './input';
import { HSVtoRGB, lerp } from './utility';
import { Quad } from './quad';

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
  gui.hide();
  // gui.add(params, 'type', ['arcball', 'WASD']).onChange(() => {
  //   // Copy the camera matrix from old to new
  //   const newCameraType = params.type;
  //   cameras[newCameraType].matrix = cameras[oldCameraType].matrix;
  //   oldCameraType = newCameraType;
  // });
  
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

  
  const quad = new Quad(device);

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({
        code: updateVerletWGSL,
      }),
      entryPoint: 'main',
    },
  });

  const computePassDescriptor: GPUComputePassDescriptor = {};

  const sampleCount = 4;
  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({
        code: instancedCircleVertWGSL,
      }),
      entryPoint: 'vertex_main',
      buffers: [{
        arrayStride: quad.vertexSize,
        attributes: [{
            // position
            shaderLocation: 0,
            offset: quad.positionOffset,
            format: 'float32x4',
          }, {
            // uv
            shaderLocation: 1,
            offset: quad.uvOffset,
            format: 'float32x2',
          },],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({
        code: instancedCircleVertWGSL,
      }),
      entryPoint: 'fragment_main',
      targets: [{
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

  const numVerletObjects = 100000;
  //     0     1     2         3         4       5       6       7  8  9
  // f32 xpos, ypos, prevXPos, prevYPos, accelX, accelY, radius, r, g, b
  const verletObjectNumFloats = 10;
  const verletObjectsData = new Float32Array(verletObjectNumFloats * numVerletObjects);
  const verletObjectsSize = Float32Array.BYTES_PER_ELEMENT * verletObjectNumFloats * numVerletObjects;
  const verletObjectsOffset = 0;

  for (let i = 0; i < 200 * verletObjectNumFloats; ) {
    const xpos = (Math.random() * canvas.width) - (canvas.width / 2);
    const ypos = (Math.random() * canvas.height) - (canvas.height / 2);
    verletObjectsData[i] = xpos;
    verletObjectsData[i+1] = ypos;
    verletObjectsData[i+2] = xpos;
    verletObjectsData[i+3] = ypos;

    verletObjectsData[i+6] = 3;

    const rgb = HSVtoRGB(0, lerp(0.2, 0.7, Math.random()), 1);

    verletObjectsData[i+7] = rgb.r;
    verletObjectsData[i+8] = rgb.g;
    verletObjectsData[i+9] = rgb.b;
    i += verletObjectNumFloats;
  }
  
  function addVerletObject(xpos: number, ypos: number) {
    const xposCentered = xpos - (canvas.width / 2);
    const yposCentered = ypos - (canvas.height / 2);
    console.log(`${xpos} ${ypos} ${canvas.width} ${canvas.height} ${xposCentered} ${yposCentered}`)
    for (let i = 0; i < numVerletObjects * verletObjectNumFloats; ) {
      if (verletObjectsData[i+7] == 0 && verletObjectsData[i+8] == 0 && verletObjectsData[i+9] == 0) {
        verletObjectsData[i] = xposCentered;
        verletObjectsData[i+1] = yposCentered;
        verletObjectsData[i+2] = xposCentered;
        verletObjectsData[i+3] = yposCentered;
    
        verletObjectsData[i+6] = 3;
    
        const rgb = HSVtoRGB(0, lerp(0.2, 0.7, Math.random()), 1);
    
        verletObjectsData[i+7] = rgb.r;
        verletObjectsData[i+8] = rgb.g;
        verletObjectsData[i+9] = rgb.b;

        return true;
      }

      i += verletObjectNumFloats;
    }

    return false;
  }

  function accelerateVerletObjects(dt: number) {
    for (let i = 0; i < numVerletObjects * verletObjectNumFloats; ) {
      if (verletObjectsData[i+7] != 0 && verletObjectsData[i+8] != 0 && verletObjectsData[i+9] != 0) {
        verletObjectsData[i+5] = -100 * (dt * dt);

        return true;
      }

      i += verletObjectNumFloats;
    }

    return false;
  }

  function updateVerletObjects() {
    device.queue.writeBuffer(
      storageBuffer,
      verletObjectsOffset,
      verletObjectsData
    );
  }

  const storageBufferSize = verletObjectsSize;
  const storageBuffer = device.createBuffer({
    size: storageBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const mvpMatBufferSize = Float32Array.BYTES_PER_ELEMENT * 16;
  const mvpMatBuffer = device.createBuffer({
    size: mvpMatBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const simParams = {
    totalTime: 0,
    deltaTime: 0,
    unused2: 0,
    unused3: 0,
  };
  const paramsBufferSize = 4 * Float32Array.BYTES_PER_ELEMENT;
  const paramsBuffer = device.createBuffer({
    size: paramsBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  function updateSimParams(totalTime: number, deltaTime: number) {
    simParams.totalTime = totalTime;
    simParams.deltaTime = deltaTime;
    device.queue.writeBuffer(
      paramsBuffer,
      0,
      new Float32Array([
        simParams.totalTime,
        simParams.deltaTime
      ])
    );
  }

  updateSimParams(0, 0);
  updateVerletObjects();

  const bufferBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: mvpMatBuffer,
        },
      },
      {
        binding: 1,
        resource: {
          buffer: paramsBuffer,
        },
      },
      {
        binding: 2,
        resource: {
          buffer: storageBuffer,
        },
      }
    ],
  });

  const computeBindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: paramsBuffer,
        },
      },
      {
        binding: 1,
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
    mvpMatBuffer,
    0,
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

    updateSimParams(totalTime, deltaTime);

    const input = inputHandler();
    if (input.analog.left) {
      addVerletObject(input.analog.clickX, input.analog.clickY);
    }

    accelerateVerletObjects(deltaTime);
    updateVerletObjects();

    // Sample is no longer the active page.
    if (!pageState.active) return;

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: texture.createView(),
          resolveTarget: context.getCurrentTexture().createView(),
          clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
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
    {
      const passEncoder = commandEncoder.beginComputePass(computePassDescriptor);
      passEncoder.setPipeline(computePipeline);
      passEncoder.setBindGroup(0, computeBindGroup);
      passEncoder.dispatchWorkgroups(Math.ceil(numVerletObjects / 64));
      passEncoder.end();
    }
    {
      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      passEncoder.setPipeline(renderPipeline);
      passEncoder.setBindGroup(0, bufferBindGroup);
      passEncoder.setVertexBuffer(0, quad.verticesBuffer);
      passEncoder.draw(quad.vertexCount, numVerletObjects, 0, 0);
      passEncoder.end();
      device.queue.submit([commandEncoder.finish()]);
    }

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
    sources: [{
        name: __filename.substring(__dirname.length + 1),
        contents: __SOURCE__,
      }, {
        name: './instancedCircle.vert.wgsl',
        contents: instancedCircleVertWGSL,
        editable: true,
      }, {
        name: './updateVerlet.wgsl',
        contents: updateVerletWGSL,
        editable: true,
      },
    ],
    filename: __filename,
  });

export default GTest;
