import { mat4, vec2, vec3, vec4, Vec4 } from 'wgpu-matrix';
import { makeSample, SampleInit } from '../../components/SampleLayout';

import boundaryCircleVertWGSL from './boundaryCircle.vert.wgsl';
import instancedCircleVertWGSL from './instancedCircle.vert.wgsl';
import updateVerletWGSL from './updateVerlet.wgsl';
import binSumWGSL from './binSum.wgsl';
import binPrefixSumWGSL from './binPrefixSum.wgsl';
import binReindexWGSL from './binReindex.wgsl';

import { ArcballCamera, WASDCamera, cameraSourceInfo } from './camera';
import { createInputHandler, inputSourceInfo } from './input';
import { HSVtoRGB, lerp } from './utility';
import { Quad } from './quad';

const init: SampleInit = async ({ canvas, pageState, gui, stats }) => {
  canvas.oncontextmenu = function (e) {
      e.preventDefault();
  };
  
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

  const computePipelineMain = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({
        code: updateVerletWGSL,
      }),
      entryPoint: 'main',
    },
  });

  const computePipelineBinSum = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({
        code: binSumWGSL,
      }),
      entryPoint: 'main',
    },
  });

  const computePipelineBinPrefixSum = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({
        code: binPrefixSumWGSL,
      }),
      entryPoint: 'main',
    },
  });

  const computePipelineBinReindex = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({
        code: binReindexWGSL,
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

  const boundaryRenderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({
        code: boundaryCircleVertWGSL,
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
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({
        code: boundaryCircleVertWGSL,
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

  const verletObjectRadius = 1;
  const numVerletObjects = 650000;
  // 0, 1, 2, 3,    4, 5, 6, 7,        8, 9, 10, 11,    12, 13, 14, 15,
  // vec4<f32> pos, vec4<f32> prevPos, vec4<f32> accel, vec4<f32> rgbR
  const verletObjectNumFloats = 16;
  const verletObjectsData = new Float32Array(verletObjectNumFloats * numVerletObjects);
  const verletObjectsSize = Float32Array.BYTES_PER_ELEMENT * verletObjectNumFloats * numVerletObjects;
  const verletObjectsOffset = 0;

  for (let i = 0; i < numVerletObjects * verletObjectNumFloats; ) {
    const xpos = (Math.random() * canvas.width) - (canvas.width / 2);
    const ypos = (Math.random() * canvas.height) - (canvas.height / 2);
    verletObjectsData[i] = xpos;
    verletObjectsData[i+1] = ypos;
    verletObjectsData[i+4] = xpos;
    verletObjectsData[i+5] = ypos;

    const rgb = HSVtoRGB(0, lerp(0.6, 0.9, Math.random()), 1);

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

  function updateVerletObjects() {
    for (let i = 0; i < 2; ++i) {
      device.queue.writeBuffer(
        voBuffers[i],
        verletObjectsOffset,
        verletObjectsData
      );
    }
  }

  const binParamsArrayLength = 4;
  const binSquareSize = verletObjectRadius * 2;
  const binGridWidth = Math.ceil(canvas.width / binSquareSize);
  const binGridHeight = Math.ceil(canvas.height / binSquareSize);
  const binGridSquareCount = binGridWidth * binGridHeight;
  const binParams = new Uint32Array([
    binSquareSize,     // bin square size
    binGridWidth,      // grid width
    binGridHeight,     // grid height
    binGridSquareCount // number of grid squares
  ]);
  const binParamsBufferSize = binParamsArrayLength * Uint32Array.BYTES_PER_ELEMENT;
  const binParamsBuffer = device.createBuffer({
    size: binParamsBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const mvpMatBufferSize = Float32Array.BYTES_PER_ELEMENT * 16;
  const mvpMatBuffer = device.createBuffer({
    size: mvpMatBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // f32 deltaTime, f32 totalTime, f32 constrainRadius, f32 unused, vec4<f32> constrainCenter, vec4<f32> clickPoint
  const simParamsArrayLength = 12;
  const simParams = new Float32Array(simParamsArrayLength);
  const simParamsBufferSize = simParamsArrayLength * Float32Array.BYTES_PER_ELEMENT;
  const simParamsBuffer = device.createBuffer({
    size: simParamsBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  simParams[2] = (canvas.height / 2) - 20;
  // simParams[4] = (canvas.width / 2);
  // simParams[5] = (canvas.height / 2);

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
      size: voBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(voBuffers[i].getMappedRange()).set(verletObjectsData);
    voBuffers[i].unmap();
  }

  const binBufferSize = verletObjectsSize;
  const binBuffer = device.createBuffer({
    size: binBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });

  const binSumBufferSize = binGridSquareCount;
  const binSumBuffer = device.createBuffer({
    size: binSumBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });

  const binPrefixSumBufferSize = binGridSquareCount;
  const binPrefixSumBuffer = device.createBuffer({
    size: binPrefixSumBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });

  const binIndexTrackerBufferSize = binGridSquareCount;
  const binIndexTrackerBuffer = device.createBuffer({
      size: binIndexTrackerBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });

  const binReindexBufferSize = verletObjectsSize;
  const binReindexBuffer = device.createBuffer({
    size: binReindexBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  
  // updateVerletObjects();

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
          buffer: simParamsBuffer,
        },
      }
    ],
  });

  const boundaryCircleBindGroup = device.createBindGroup({
    layout: boundaryRenderPipeline.getBindGroupLayout(0),
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
          buffer: simParamsBuffer,
        },
      }
    ],
  });

  const binSumBindGroup: GPUBindGroup = device.createBindGroup({
    layout: computePipelineBinSum.getBindGroupLayout(0),
    entries: [{
        binding: 0,
        resource: {
          buffer: voBuffers[0],
          offset: 0,
          size: voBufferSize,
        },
      }, {
        binding: 1,
        resource: {
          buffer: binParamsBuffer,
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
      },
    ],
  });

  const binPrefixSumBindGroup: GPUBindGroup = device.createBindGroup({
    layout: computePipelineBinPrefixSum.getBindGroupLayout(0),
    entries: [{
        binding: 0,
        resource: {
          buffer: binParamsBuffer,
        },
      }, {
        binding: 1,
        resource: {
          buffer: binSumBuffer,
          offset: 0,
          size: binSumBufferSize,
        },
      }, {
        binding: 2,
        resource: {
          buffer: binPrefixSumBuffer,
          offset: 0,
          size: binPrefixSumBufferSize,
        },
      }, {
        binding: 3,
        resource: {
          buffer: binIndexTrackerBuffer,
          offset: 0,
          size: binIndexTrackerBufferSize,
        },
      }, 
    ],
  });

  const binReindexBindGroup: GPUBindGroup = device.createBindGroup({
    layout: computePipelineBinReindex.getBindGroupLayout(0),
    entries: [{
        binding: 0,
        resource: {
          buffer: voBuffers[0],
          offset: 0,
          size: voBufferSize,
        },
      }, {
        binding: 1,
        resource: {
          buffer: binBuffer,
          offset: 0,
          size: binBufferSize,
        },
      }, {
        binding: 2,
        resource: {
          buffer: binIndexTrackerBuffer,
          offset: 0,
          size: binIndexTrackerBufferSize,
        },
      }, {
        binding: 3,
        resource: {
          buffer: binReindexBuffer,
          offset: 0,
          size: binReindexBufferSize,
        },
      },
    ],
  });

  const computeBindGroups: GPUBindGroup[] = new Array(2);
  for (let i = 0; i < 2; ++i) {
    computeBindGroups[i] = device.createBindGroup({
      layout: computePipelineMain.getBindGroupLayout(0),
      entries: [{
          binding: 0,
          resource: {
            buffer: simParamsBuffer,
          },
        }, {
          binding: 1,
          resource: {
            buffer: voBuffers[i],
            offset: 0,
            size: voBufferSize,
          },
        }, {
          binding: 2,
          resource: {
            buffer: voBuffers[(i + 1) % 2],
            offset: 0,
            size: voBufferSize,
          },
        }, {
          binding: 3,
          resource: {
            buffer: binParamsBuffer,
          },
        }, {
          binding: 4,
          resource: {
            buffer: binBuffer,
            offset: 0,
            size: binBufferSize,
          },
        }, {
          binding: 5,
          resource: {
            buffer: binPrefixSumBuffer,
            offset: 0,
            size: binPrefixSumBufferSize,
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
  let t = 0;
  function frame() {
    stats.begin();

    const now = Date.now();
    const deltaTime = Math.min((now - lastFrameMS) / 1000, 1 / 60);
    const totalTime = (now - startFrameMS) / 1000;
    
    const input = inputHandler();
    if (input.analog.left) {
      addVerletObject(input.analog.clickX, input.analog.clickY);
    }

    let clickPointX = 0;
    let clickPointY = 0;
    if (input.analog.right) {
      clickPointX = input.analog.clickX - (canvas.width / 2);
      clickPointY = input.analog.clickY - (canvas.height / 2);
    }

    updateSimParams(totalTime, deltaTime, clickPointX, clickPointY);

    // accelerateVerletObjects(deltaTime);
    // updateVerletObjects();

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
    
    const timesteps = 12;
    const subDeltaTime = deltaTime / timesteps;
    for (let step = 0; step <= timesteps; ++step) {
      const subTotalTime = totalTime - (subDeltaTime * (timesteps - (step + 1)));
      updateSimParams(subTotalTime, subDeltaTime, clickPointX, clickPointY);

      {
        const passEncoder = commandEncoder.beginComputePass(computePassDescriptor);
        passEncoder.setPipeline(computePipelineBinSum);
        passEncoder.setBindGroup(0, binSumBindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(binGridSquareCount / 64));
        passEncoder.end();
      }
      {
        const passEncoder = commandEncoder.beginComputePass(computePassDescriptor);
        passEncoder.setPipeline(computePipelineBinPrefixSum);
        passEncoder.setBindGroup(0, binPrefixSumBindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(binGridSquareCount / 64));
        passEncoder.end();
      }
      {
        const passEncoder = commandEncoder.beginComputePass(computePassDescriptor);
        passEncoder.setPipeline(computePipelineBinReindex);
        passEncoder.setBindGroup(0, binReindexBindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(numVerletObjects / 64));
        passEncoder.end();
      }
      {
        const passEncoder = commandEncoder.beginComputePass(computePassDescriptor);
        passEncoder.setPipeline(computePipelineMain);
        passEncoder.setBindGroup(0, computeBindGroups[(t + step) % 2]);
        passEncoder.dispatchWorkgroups(Math.ceil(numVerletObjects / 64));
        passEncoder.end();
      }
    }
    {
      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      // particles
      passEncoder.setPipeline(renderPipeline);
      passEncoder.setBindGroup(0, bufferBindGroup);
      passEncoder.setVertexBuffer(0, quad.verticesBuffer);
      passEncoder.setVertexBuffer(1, voBuffers[(t + 1) % 2]);
      passEncoder.draw(quad.vertexCount, numVerletObjects, 0, 0);
      // end particles
      // constrain circle
      // passEncoder.setPipeline(boundaryRenderPipeline);
      // passEncoder.setBindGroup(0, boundaryCircleBindGroup);
      // passEncoder.setVertexBuffer(0, quad.verticesBuffer);
      // passEncoder.draw(quad.vertexCount);
      // end constrain circle
      passEncoder.end();
    }

    device.queue.submit([commandEncoder.finish()]);

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
        name: './boundaryCircle.vert.wgsl',
        contents: boundaryCircleVertWGSL,
        editable: true,
      }, {
        name: './updateVerlet.wgsl',
        contents: updateVerletWGSL,
        editable: true,
      }, {
        name: './binSum.wgsl',
        contents: binSumWGSL,
        editable: true,
      },
      {
        name: './binPrefixSum.wgsl',
        contents: binPrefixSumWGSL,
        editable: true,
      },
      {
        name: './binReindex.wgsl',
        contents: binReindexWGSL,
        editable: true,
      },
    ],
    filename: __filename,
  });

export default GTest;
