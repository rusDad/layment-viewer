import { sampleSegmentPoints } from './execution/NcProgramAnalysis.mjs';

export const NC_MOTIONS = ['G0', 'G1', 'G2', 'G3'];

export function createEmptyNcMotionBatches() {
  return Object.fromEntries(NC_MOTIONS.map((motion) => [motion, { positions: [], renderSegmentRefs: [] }]));
}

export function buildNcMotionRenderBatches(toolpath, dimensions, mapPointToThree) {
  const batches = createEmptyNcMotionBatches();

  toolpath.segments.forEach((segment) => {
    const batch = batches[segment.motion];
    if (!batch) {
      return;
    }

    appendSegmentToBatch(batch, segment, dimensions, mapPointToThree);
  });

  return batches;
}

export function buildNcColoredRenderBatch(toolpath, dimensions, mapPointToThree, colorContext, getSegmentColor) {
  const batch = { positions: [], colors: [], renderSegmentRefs: [] };

  toolpath.segments.forEach((segment) => {
    appendSegmentToBatch(batch, segment, dimensions, mapPointToThree, getSegmentColor(segment, colorContext));
  });

  return batch;
}

function appendSegmentToBatch(batch, segment, dimensions, mapPointToThree, color = null) {
  const points = Array.isArray(segment.points) ? segment.points : sampleSegmentPoints(segment);
  for (let i = 1; i < points.length; i += 1) {
    const from = mapPointToThree(points[i - 1], dimensions);
    const to = mapPointToThree(points[i], dimensions);
    batch.positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    if (color) {
      const rgb = hexToRgb(color);
      batch.colors.push(rgb.r, rgb.g, rgb.b, rgb.r, rgb.g, rgb.b);
    }
    batch.renderSegmentRefs.push({
      logicalSegmentId: segment.segmentId ?? segment.id,
      segmentId: segment.segmentId ?? segment.id,
      sourceLineNumber: segment.sourceLineNumber,
      polylinePartIndex: i - 1,
      partIndex: i - 1
    });
  }
}

function hexToRgb(hex) {
  const normalized = String(hex || '#ffffff').replace('#', '');
  const value = Number.parseInt(normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized, 16);
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}
