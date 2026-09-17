import {
  formatCanonicalNumber,
  serializeCanonicalLine,
  serializeMotionBlock
} from '../document/CanonicalNcDocument.mjs';
import { getArcSweep } from '../nc-parser.mjs';

const ARC_MOTIONS = new Set(['G2', 'G3']);
const GEOMETRY_EPSILON = 1e-6;

export class MachineNcSerializationError extends Error {
  constructor(code, message, line = null, canonicalIndex = -1) {
    super(message);
    this.name = 'MachineNcSerializationError';
    this.code = code;
    this.lineId = line?.lineId ?? null;
    this.canonicalIndex = canonicalIndex;
  }
}

export function serializeMachineNcDocument(document) {
  return `${document.lines.map((line, index) => serializeMachineNcLine(line, index)).join('\n')}\n`;
}

export function serializeMachineNcLine(line, canonicalIndex = -1) {
  if (line?.kind !== 'motion' || !ARC_MOTIONS.has(line.motion)) {
    return serializeCanonicalLine(line);
  }

  const { start, end } = line;
  const center = line.arc?.center;
  if (![start?.x, start?.y, end?.x, end?.y, end?.z, center?.x, center?.y, line.feed].every(Number.isFinite)) {
    throw machineError('invalid-machine-arc', 'Machine R export requires finite arc geometry and motion values.', line, canonicalIndex);
  }
  if (samePoint(start, end)) {
    throw machineError('full-circle-r-unsupported', 'A full-circle arc cannot be represented unambiguously by this machine R profile.', line, canonicalIndex);
  }

  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const endRadius = Math.hypot(end.x - center.x, end.y - center.y);
  if (radius <= GEOMETRY_EPSILON || Math.abs(radius - endRadius) > Math.max(0.5, radius * 0.02, GEOMETRY_EPSILON)) {
    throw machineError('invalid-machine-arc', 'Machine R export requires matching non-zero start/end radii.', line, canonicalIndex);
  }

  const sweep = Math.abs(getArcSweep(
    Math.atan2(start.y - center.y, start.x - center.x),
    Math.atan2(end.y - center.y, end.x - center.x),
    line.motion,
    false
  ));
  const signedRadius = sweep > Math.PI + GEOMETRY_EPSILON ? -radius : radius;
  const parts = [
    line.motion,
    `X${formatCanonicalNumber(end.x)}`,
    `Y${formatCanonicalNumber(end.y)}`,
    `Z${formatCanonicalNumber(end.z)}`,
    `R${formatCanonicalNumber(signedRadius)}`,
    `F${formatCanonicalNumber(line.feed)}`
  ];
  return line.block?.tokens?.length ? serializeMotionBlock(line, parts) : parts.join(' ');
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) <= GEOMETRY_EPSILON && Math.abs(a.y - b.y) <= GEOMETRY_EPSILON;
}

function machineError(code, message, line, canonicalIndex) {
  return new MachineNcSerializationError(code, message, line, canonicalIndex);
}
