export const NC_SCREEN_PICK_RADIUS_PX = 6;
export const NC_CLICK_MOVEMENT_THRESHOLD_PX = 5;

export function distancePointToSegment2D(point, start, end) {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const wx = point.x - start.x;
  const wy = point.y - start.y;
  const lengthSq = vx * vx + vy * vy;

  if (lengthSq === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSq));
  const closestX = start.x + t * vx;
  const closestY = start.y + t * vy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

export function ndcToCssPixels(ndc, rect) {
  return {
    x: ((ndc.x + 1) / 2) * rect.width,
    y: ((1 - ndc.y) / 2) * rect.height
  };
}

export function isValidProjectedPoint(ndc) {
  return Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(ndc.z) && ndc.z >= -1 && ndc.z <= 1;
}

export function isSegmentCompletelyOutsideClip(start, end) {
  return (start.x < -1 && end.x < -1)
    || (start.x > 1 && end.x > 1)
    || (start.y < -1 && end.y < -1)
    || (start.y > 1 && end.y > 1);
}

export function chooseClosestScreenSegment(pointer, candidates, thresholdPx = NC_SCREEN_PICK_RADIUS_PX) {
  let closest = null;

  candidates.forEach((candidate) => {
    if (!candidate?.start || !candidate?.end) return;
    const distancePx = distancePointToSegment2D(pointer, candidate.start, candidate.end);
    if (distancePx > thresholdPx) return;
    if (!closest || distancePx < closest.distancePx) {
      closest = { ...candidate, distancePx };
    }
  });

  return closest;
}

export function createPointerInteractionState(thresholdPx = NC_CLICK_MOVEMENT_THRESHOLD_PX) {
  return {
    pointerId: null,
    startX: 0,
    startY: 0,
    didDrag: false,
    thresholdPx,
    begin(event) {
      this.pointerId = event.pointerId;
      this.startX = event.clientX;
      this.startY = event.clientY;
      this.didDrag = false;
    },
    move(event) {
      if (this.pointerId !== event.pointerId) return false;
      if (!this.didDrag && Math.hypot(event.clientX - this.startX, event.clientY - this.startY) > this.thresholdPx) {
        this.didDrag = true;
        return true;
      }
      return false;
    },
    isClick(event) {
      return this.pointerId === event.pointerId && !this.didDrag;
    },
    clear() {
      this.pointerId = null;
      this.didDrag = false;
    }
  };
}
