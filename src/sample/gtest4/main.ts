import { mat4, vec3 } from 'wgpu-matrix';
import { makeSample, SampleInit } from '../../components/SampleLayout';

import instancedCircleVertWGSL from './instancedCircle.vert.wgsl';
import updateVerletWGSL from './updateVerlet.wgsl';

import { ArcballCamera } from './camera';
import { createInputHandler } from './input';
import { HSVtoRGB, lerp } from './utility';
import { Quad } from './quad';

const init: SampleInit = async ({ canvas, pageState, gui, stats }) => {
  canvas.oncontextmenu = function (e) {
      e.preventDefault();
  };
  
  // The input handler
  const inputHandler = createInputHandler(window, canvas);
  const camera = new ArcballCamera({ position: vec3.create(0, 0, 1)});

  gui.hide();
  
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  if (!pageState.active) return;
  const context = canvas.getContext('webgpu') as GPUCanvasContext;

  const devicePixelRatio = window.devicePixelRatio;
  console.log(`pixel ratio: ${devicePixelRatio}`)
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'premultiplied',
  });

  const quad = new Quad(device);

  // compute pipeline setup
  const computeParamsBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding:  0, // params
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'uniform' },
    }, {
      binding:  1, // binParams
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'uniform' },
    }]
  });

  const computeBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding:  0, // verletObjectsIn
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'read-only-storage' },
    }, {
      binding:  1, // verletObjectsOut
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    }, {
      binding:  2, // bin
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    }, {
      binding:  3, // binSum
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    }, {
      binding:  4, // binPrefixSum
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    }, {
      binding:  5, // binIndexTracker
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    }, {
      binding:  6, // binReindex
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    }]
  });

  const computePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      computeParamsBindGroupLayout, // @group(0)
      computeBindGroupLayout,       // @group(1)
    ]
  });

  const computePipelineMain = device.createComputePipeline({
    layout: computePipelineLayout,
    compute: {
      module: device.createShaderModule({
        label: 'computePipeline Shader Module',
        code: updateVerletWGSL,
      }),
      entryPoint: 'main',
    },
  });

  const computePassDescriptor: GPUComputePassDescriptor = {};

  const renderBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0, // mvp
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'uniform' },
    }]
  });

  const renderPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      renderBindGroupLayout, // @group(0)
    ]
  });

  const sampleCount = 4;
  const renderPipeline = device.createRenderPipeline({
    layout: renderPipelineLayout,
    vertex: {
      module: device.createShaderModule({
        code: instancedCircleVertWGSL,
      }),
      entryPoint: 'vertex_main',
      buffers: [{
        // vertex buffer
        arrayStride: quad.vertexSize,
        stepMode: 'vertex',
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
        }, {
          // instanced particles buffer
          arrayStride: 16 * 4,
          stepMode: 'instance',
          attributes: [{
              // instance position
              shaderLocation: 2,
              offset: 0,
              format: 'float32x4',
            }, {
              // instance previous position
              shaderLocation: 3,
              offset: 4 * 4,
              format: 'float32x4',
            }, {
              // instance acceleration
              shaderLocation: 4,
              offset: 8 * 4,
              format: 'float32x4',
            }, {
              // instance rgb-Radius
              shaderLocation: 5,
              offset: 12 * 4,
              format: 'float32x4',
            },
          ],
        }
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
    label: 'render attachment',
    size: [canvas.width, canvas.height],
    sampleCount,
    format: presentationFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const depthTexture = device.createTexture({
    label: 'depth texture',
    size: [canvas.width, canvas.height],
    sampleCount,
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // buffer data creation
  const verletObjectRadius = 5;
  const numVerletObjects = 20;
  // 0, 1, 2, 3,    4, 5, 6, 7,        8, 9, 10, 11,    12, 13, 14, 15,
  // vec4<f32> pos, vec4<f32> prevPos, vec4<f32> accel, vec4<f32> rgbR
  const verletObjectNumFloats = 16;
  const verletObjectsData = new Float32Array(verletObjectNumFloats * numVerletObjects);
  const verletObjectsSize = Float32Array.BYTES_PER_ELEMENT * verletObjectNumFloats * numVerletObjects;

  for (let i = 0; i < numVerletObjects * verletObjectNumFloats; ) {
    const xpos = (Math.random() * canvas.width) - (canvas.width / 2);
    const ypos = (Math.random() * canvas.height) - (canvas.height / 2);
    verletObjectsData[i] = xpos;
    verletObjectsData[i+1] = ypos;
    verletObjectsData[i+4] = xpos;
    verletObjectsData[i+5] = ypos;

    const rgb = HSVtoRGB(.12, lerp(0.6, 0.9, Math.random()), 1);

    verletObjectsData[i+12] = rgb.r;
    verletObjectsData[i+13] = rgb.g;
    verletObjectsData[i+14] = rgb.b;

    verletObjectsData[i+15] = verletObjectRadius;
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

  const gridPixelDim = canvas.height;
  const binParamsArrayLength = 4;
  // const binSquareSize = Math.max(verletObjectRadius * 2, 20);
  // const binGridWidth = Math.ceil((gridPixelDim / binSquareSize) / 2) * 2;
  // const binGridHeight = Math.ceil((gridPixelDim / binSquareSize) / 2) * 2;
  // const binGridSquareCount = Math.ceil((binGridWidth * binGridHeight) / 4) * 4;
  const binGridWidth = 128;
  const binGridHeight = 128;
  const binSquareSize = Math.ceil(gridPixelDim / 128);
  const binGridSquareCount = 16384; // 128*128
  const binParams = new Uint32Array([
    binSquareSize,     // bin square size
    binGridWidth,      // grid width
    binGridHeight,     // grid height
    binGridSquareCount // number of grid squares
  ]);

  // buffer setup
  const mvpMatBufferSize = Float32Array.BYTES_PER_ELEMENT * 16;
  const mvpMatBuffer = device.createBuffer({
    label: 'mvp buffer',
    size: mvpMatBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const mvpBindGroup = device.createBindGroup({
    label: 'mvp bind group',
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: mvpMatBuffer },}],
  });

  // f32 deltaTime, f32 totalTime, f32 constrainRadius, f32 boxDim, vec4<f32> constrainCenter, vec4<f32> clickPoint
  const simParamsArrayLength = 20;
  const simParams = new Float32Array(simParamsArrayLength);
  const simParamsBufferSize = simParamsArrayLength * Float32Array.BYTES_PER_ELEMENT;
  const simParamsBuffer = device.createBuffer({
    label: 'sim params buffer',
    size: simParamsBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  simParams[2] = (canvas.height / 2) - 20;
  simParams[3] = gridPixelDim;

  function updateSimParams(totalTime: number, deltaTime: number, clickPointX = 0, clickPointY = 0) {
    simParams[0] = totalTime;
    simParams[1] = deltaTime;
    simParams[8] = clickPointX;
    simParams[9] = clickPointY;
    device.queue.writeBuffer(
      simParamsBuffer,
      0,
      simParams
    );
  }

  updateSimParams(0, 0);

  const voBufferSize = verletObjectsSize;
  const voBuffers: GPUBuffer[] = new Array(2);
  for (let i = 0; i < 2; ++i) {
    voBuffers[i] = device.createBuffer({
      label: `Vertex Object Buffer ${i}`,
      size: voBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(voBuffers[i].getMappedRange()).set(verletObjectsData);
    voBuffers[i].unmap();
  }

  const binParamsBufferSize = binParamsArrayLength * Uint32Array.BYTES_PER_ELEMENT;
  const binParamsBuffer = device.createBuffer({
    label: 'bin params buffer',
    size: binParamsBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(binParamsBuffer, 0, binParams);

  const binBufferSize = Int32Array.BYTES_PER_ELEMENT * numVerletObjects;
  const binBuffer = device.createBuffer({
    label: 'bin buffer',
    size: binBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });

  const binReadBuffer: GPUBuffer = device.createBuffer({
    label: 'bin read buffer',
    size: binBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  const binSumBufferSize = Uint32Array.BYTES_PER_ELEMENT * binGridSquareCount;
  const binSumBuffer = device.createBuffer({
    label: 'binSum buffer',
    size: binSumBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });

  const binSumReadBuffer: GPUBuffer = device.createBuffer({
    label: 'binSum read buffer',
    size: binSumBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  const binPrefixSumBufferSize = Int32Array.BYTES_PER_ELEMENT * binGridSquareCount;
  const binPrefixSumBuffer = device.createBuffer({
    label: 'binPrefixSum buffer',
    size: binPrefixSumBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });

  const binPrefixSumReadBuffer: GPUBuffer = device.createBuffer({
    label: 'binPrefixSum read buffer',
    size: binPrefixSumBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  const binIndexTrackerBufferSize = Int32Array.BYTES_PER_ELEMENT * binGridSquareCount;
  const binIndexTrackerBuffer = device.createBuffer({
    label: 'binIndexTracker buffer',
    size: binIndexTrackerBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });

  const binIndexTrackerReadBuffer: GPUBuffer = device.createBuffer({
    label: 'binIndexTracker read buffer',
    size: binIndexTrackerBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  const binReindexBufferSize = Uint32Array.BYTES_PER_ELEMENT * numVerletObjects;
  const binReindexBuffer = device.createBuffer({
    label: 'binReindex buffer',
    size: binReindexBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });

  const binReindexReadBuffer: GPUBuffer = device.createBuffer({
    label: 'binReindex read buffer',
    size: binReindexBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  const computeParameterBindGroup = device.createBindGroup({
    label: 'computeParameterBindGroup',
    layout: computePipelineMain.getBindGroupLayout(0),
    entries: [{
        binding: 0,
        resource: {
          buffer: simParamsBuffer,
        },
      }, {
        binding: 1,
        resource: {
          buffer: binParamsBuffer,
        },
      },
    ]
  });

  const computeBindGroups: GPUBindGroup[] = new Array(2);
  for (let i = 0; i < 2; ++i) {
    computeBindGroups[i] = device.createBindGroup({
      label: `computeBindGroups ${i}`,
      layout: computePipelineMain.getBindGroupLayout(1),
      entries: [{
          binding: 0,
          resource: {
            buffer: voBuffers[i],
            offset: 0,
            size: voBufferSize,
          },
        }, {
          binding: 1,
          resource: {
            buffer: voBuffers[(i + 1) % 2],
            offset: 0,
            size: voBufferSize,
          },
        }, {
          binding: 2,
          resource: {
            buffer: binBuffer,
            offset: 0,
            size: binBufferSize,
          },
        }, {
          binding: 3,
          resource: {
            buffer: binSumBuffer,
            offset: 0,
            size: binSumBufferSize,
          },
        }, {
          binding: 4,
          resource: {
            buffer: binPrefixSumBuffer,
            offset: 0,
            size: binPrefixSumBufferSize,
          },
        }, {
          binding: 5,
          resource: {
            buffer: binIndexTrackerBuffer,
            offset: 0,
            size: binIndexTrackerBufferSize,
          },
        }, {
          binding: 6,
          resource: {
            buffer: binReindexBuffer,
            offset: 0,
            size: binReindexBufferSize,
          },
        },
      ],
    });
  }

  const orthoMatrix = mat4.ortho(
    -canvas.width / 2,
    canvas.width / 2,
    canvas.height / 2,
    -canvas.height / 2,
    1.05, -1
  );
  const modelViewProjectionMatrix = mat4.create();

  function getModelViewProjectionMatrix(deltaTime: number) {
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
  let t = 0;
  async function frame() {
    stats.begin();

    const now = Date.now();
    const deltaTime = Math.min((now - lastFrameMS) / 1000, 1 / 60);
    const totalTime = (now - startFrameMS) / 1000;
    
    const input = inputHandler();
    if (input.analog.left) {
      addVerletObject(input.analog.clickX * devicePixelRatio, input.analog.clickY);
    }

    let clickPointX = 0;
    let clickPointY = 0;
    if (input.analog.right) {
      clickPointX = (input.analog.clickX * devicePixelRatio) - (canvas.width / 2);
      clickPointY = (input.analog.clickY * devicePixelRatio) - (canvas.height / 2);
    }

    updateSimParams(totalTime, deltaTime, clickPointX, clickPointY);

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
    
    

    updateSimParams(totalTime, deltaTime, clickPointX, clickPointY);

    const workgroupCount = Math.ceil(numVerletObjects / 64);
    {
      const commandEncoder = device.createCommandEncoder({label: 'compute encoder'});
      const passEncoder = commandEncoder.beginComputePass(computePassDescriptor);
      passEncoder.setBindGroup(0, computeParameterBindGroup);
      passEncoder.setBindGroup(1, computeBindGroups[t % 2]);
      
      passEncoder.setPipeline(computePipelineMain);
      passEncoder.dispatchWorkgroups(workgroupCount);
      passEncoder.end();
      device.queue.submit([commandEncoder.finish()]);
    }

    { //1
      const commandEncoder = device.createCommandEncoder({label: 'copy encoder'});
      commandEncoder.copyBufferToBuffer(binBuffer, 0, binReadBuffer, 0, binBufferSize);

      await binReadBuffer.mapAsync(GPUMapMode.READ, 0, binBufferSize);
      const copyArrayBuffer = binReadBuffer.getMappedRange();
      const data = copyArrayBuffer.slice(0);

      binReadBuffer.unmap();

      // console.log(new Int32Array(data));
      device.queue.submit([commandEncoder.finish()]);
    }

    {
      const commandEncoder = device.createCommandEncoder({label: 'render encoder'});
      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      passEncoder.setPipeline(renderPipeline);
      passEncoder.setBindGroup(0, mvpBindGroup);
      passEncoder.setVertexBuffer(0, quad.verticesBuffer);
      passEncoder.setVertexBuffer(1, voBuffers[(t + 1) % 2]);
      passEncoder.draw(quad.vertexCount, numVerletObjects, 0, 0);
      passEncoder.end();
      device.queue.submit([commandEncoder.finish()]);
    }



    stats.end()

    ++t;
    lastFrameMS = now;
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
      }
    ],
    filename: __filename,
  });

export default GTest;
