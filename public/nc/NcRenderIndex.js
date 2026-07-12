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

    for (let i = 1; i < segment.points.length; i += 1) {
      const from = mapPointToThree(segment.points[i - 1], dimensions);
      const to = mapPointToThree(segment.points[i], dimensions);
      batch.positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
      batch.renderSegmentRefs.push({
        logicalSegmentId: segment.id,
        segmentId: segment.id,
        sourceLineNumber: segment.sourceLineNumber,
        polylinePartIndex: i - 1,
        partIndex: i - 1
      });
    }
  });

  return batches;
}
