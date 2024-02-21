struct Params {
  totalTime: f32,
  deltaTime: f32,
  constrainRadius: f32,
  gridPixelDim: f32,
  constrainCenter: vec4<f32>,
  clickPoint: vec4<f32>,
};

struct VerletObject {
  pos: vec4<f32>,
  prevPos: vec4<f32>,
  accel: vec4<f32>,
  colorAndRadius: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;

@group(0) @binding(1) var<storage, read>       verletObjectsIn: array<VerletObject>;
@group(0) @binding(2) var<storage, read_write> verletObjectsOut: array<VerletObject>;

struct BinParams {
  size: i32,
  x: i32,
  y: i32,
  count: i32,
}

// spatial binning
@group(0) @binding(3) var<uniform> binParams: BinParams;
@group(0) @binding(4) var<storage, read_write> binBuf: array<i32>;
@group(0) @binding(5) var<storage, read_write> binPrefixSumBuf: array<i32>;
@group(0) @binding(6) var<storage, read_write> binReindexBuf: array<u32>;

fn oneToTwo(index: i32, gridWidth: i32) -> vec2<i32> {
  var row = index / gridWidth;
  var col = index % gridWidth;
  return vec2(row, col);
}

fn twoToOne(index: vec2<i32> , gridWidth: i32) -> i32 {
  var row = index.y;
  var col = index.x;
  return (row * gridWidth) + col;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = u32(GlobalInvocationID.x);

  if (index >= arrayLength(&verletObjectsIn)) {
    return;
  }

  if (verletObjectsIn[index].colorAndRadius.w == 0) {
    return;
  }

  var bin = binBuf[index];
  var useBins = true;
  var doCollide = false;

  var constrainPos = params.constrainCenter.xy;
  var constrainRadius = params.constrainRadius;

  var pos = verletObjectsIn[index].pos.xy;
  var prevPos = verletObjectsIn[index].prevPos.xy;

  var radius = verletObjectsIn[index].colorAndRadius.w;

  var accel = verletObjectsIn[index].accel.xy;

  // accelerate
  

  if (params.clickPoint.x != 0 && params.clickPoint.y != 0) {
    var _pos = params.clickPoint.xy;
    var posDiff = _pos - pos;
    var mag = length(posDiff);
    var invMag2 = 1 / (mag * mag);
    var posDiffNorm = posDiff / mag;
    accel += posDiffNorm * 3000;
  } else {
    accel += vec2(0, 270.0);
  }

  // collide
  var offset = vec2(0.0);
  if (useBins) {
    var binXY = oneToTwo(bin, binParams.x);
    var startBin = binXY;
    startBin.x -= 1;
    startBin.y -= 1;
    
    var currentBin = startBin;

    var surroundingBins = array<i32, 9>(
      bin - binParams.x - 1, bin - binParams.x, bin - binParams.x + 1,
      bin - 1,               bin,               bin + 1,
      bin + binParams.x - 1, bin + binParams.x, bin + binParams.x + 1,
    );
    
    for (var surroundingBinIndex = 0; surroundingBinIndex < 9; surroundingBinIndex++) {
      var neighborBinIndex = surroundingBins[surroundingBinIndex];
      if (neighborBinIndex <= 0 || neighborBinIndex >= binParams.count) {
        continue;
      }

      for (var i = binPrefixSumBuf[neighborBinIndex - 1]; i < binPrefixSumBuf[neighborBinIndex]; i++) {
        var otherIndex = binReindexBuf[i];
        if (otherIndex != index) {
          var _pos = verletObjectsIn[otherIndex].pos.xy;
          var _radius = verletObjectsIn[otherIndex].colorAndRadius.w;

          var v = pos - _pos;
          var dist2 = (v.x * v.x) + (v.y * v.y);
          var minDist = radius + _radius;
          if (dist2 < minDist * minDist) {
            var dist = sqrt(dist2);
            var n = v / dist;

            var massRatio = 0.5;
            var responseCoef = 0.65;
            var delta = 0.5 * responseCoef * (dist - minDist);
            offset += n * (massRatio * delta);
          }
        }
      }
    }

    // var use1 = binReindexBuf[0];
    // var use2 = binPrefixSumBuf[0];

    // var binXY = oneToTwo(bin, binParams.x);
    // var startBin = binXY;
    // startBin.x -= 1;
    // startBin.y -= 1;
    // var currentBin = startBin;

    // var surroundingBins = array<i32, 9>(
    //   bin - binParams.x - 1, bin - binParams.x, bin - binParams.x + 1,
    //   bin - 1,               bin,               bin + 1,
    //   bin + binParams.x - 1, bin + binParams.x, bin + binParams.x + 1,
    // );

    // for (var i = 0u; i < arrayLength(&verletObjectsIn); i++) {
    //   if (i == index) {
    //     continue;
    //   }

    //   if (binBuf[i] == surroundingBins[0] ||
    //       binBuf[i] == surroundingBins[1] ||
    //       binBuf[i] == surroundingBins[2] ||
    //       binBuf[i] == surroundingBins[3] ||
    //       binBuf[i] == surroundingBins[4] ||
    //       binBuf[i] == surroundingBins[5] ||
    //       binBuf[i] == surroundingBins[6] ||
    //       binBuf[i] == surroundingBins[7] ||
    //       binBuf[i] == surroundingBins[8]) {
    //     var _pos = verletObjectsIn[i].pos.xy;
    //     var _radius = verletObjectsIn[i].colorAndRadius.w;

    //     var v = pos - _pos;
    //     var dist2 = (v.x * v.x) + (v.y * v.y);
    //     var minDist = radius + _radius;
    //     if (dist2 < minDist * minDist) {
    //       var dist = sqrt(dist2);
    //       var n = v / dist;

    //       var massRatio = 0.5;
    //       var responseCoef = 0.65;
    //       var delta = 0.5 * responseCoef * (dist - minDist);
    //       offset += n * (massRatio * delta);
    //     }
    //   }
    // }
  } else if (doCollide) {
    for (var i = 0u; i < arrayLength(&verletObjectsIn); i++) {
      if (i == index || verletObjectsIn[i].colorAndRadius.w == 0) {
        continue;
      }

      var _pos = verletObjectsIn[i].pos.xy;
      var _radius = verletObjectsIn[i].colorAndRadius.w;

      var v = pos - _pos;
      var dist2 = (v.x * v.x) + (v.y * v.y);
      var minDist = radius + _radius;
      if (dist2 < minDist * minDist) {
        var dist = sqrt(dist2);
        var n = v / dist;

        var massRatio = 0.5;
        var responseCoef = 0.65;
        var delta = 0.5 * responseCoef * (dist - minDist);
        offset += n * (massRatio * delta);
      }
    }
  }

  pos -= offset;

  // constrain
  {
    var v = constrainPos - pos;
    var dist = length(v);
    if (dist > constrainRadius - radius) {
      var n = v / dist;
      pos = constrainPos - (n * (constrainRadius - radius));

      var prevVec = prevPos - pos;
      prevVec *= 0.9;
      prevPos = pos + prevVec;
    }
  }

  // update
  {
    var velocity = pos - prevPos;
    prevPos = pos;
    pos = pos + velocity + (accel * (params.deltaTime * params.deltaTime));
  }

  // load back
  {
    verletObjectsOut[index].pos = vec4(pos.xy, 0, 0);
    verletObjectsOut[index].prevPos = vec4(prevPos.xy, 0, 0);

    var binPosX = i32((pos.x + (params.gridPixelDim / 2.0)) / f32(binParams.size));
    var binPosY = i32((pos.y + (params.gridPixelDim / 2.0)) / f32(binParams.size));
    binBuf[index] = twoToOne(vec2<i32>(binPosX, binPosY), binParams.x);
  }
}
