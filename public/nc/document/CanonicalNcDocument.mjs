export const CANONICAL_NC_PROFILE = Object.freeze({
  units: 'mm',
  plane: 'XY',
  positioning: 'absolute',
  arcCenter: 'absolute-xy-center',
  numericPrecision: 6,
  lineEnding: 'lf',
  terminalNewline: true
});

export function createCanonicalNcDocument({ rawDocument, lines, diagnostics = [] }) {
  const rawLineToCanonicalLineIds = new Map();
  const frozenLines = lines.map((line, index) => {
    const frozen = Object.isFrozen(line) && line.currentIndex === index ? line : Object.freeze({ ...line, currentIndex: index });
    for (const rawLineNumber of frozen.sourceOrigin?.rawLineNumbers || []) {
      const ids = rawLineToCanonicalLineIds.get(rawLineNumber) || [];
      ids.push(frozen.lineId);
      rawLineToCanonicalLineIds.set(rawLineNumber, ids);
    }
    return frozen;
  });
  return Object.freeze({
    kind: 'CanonicalNcDocument',
    documentId: `canonical-${rawDocument.documentId}`,
    sourceDocumentId: rawDocument.documentId,
    rawDocument,
    revision: 0,
    dirty: false,
    profile: CANONICAL_NC_PROFILE,
    lines: Object.freeze(frozenLines),
    diagnostics: Object.freeze(diagnostics.slice()),
    rawLineToCanonicalLineIds
  });
}

export function createCanonicalLineId(rawDocument, rawLineNumber, occurrence = 0) {
  return `cnc-${rawDocument.originalHash.slice(0, 12)}-r${rawLineNumber}-n${occurrence}`;
}

export function serializeCanonicalNcDocument(document) {
  return `${document.lines.map(serializeCanonicalLine).join('\n')}\n`;
}

export function serializeCanonicalLine(line) {
  if (line.kind === 'motion') {
    const canonicalParts = [
      line.motion,
      `X${formatCanonicalNumber(line.end.x)}`,
      `Y${formatCanonicalNumber(line.end.y)}`,
      `Z${formatCanonicalNumber(line.end.z)}`
    ];
    if (line.arc) {
      canonicalParts.push(`I${formatCanonicalNumber(line.arc.center.x - line.start.x)}`);
      canonicalParts.push(`J${formatCanonicalNumber(line.arc.center.y - line.start.y)}`);
    }
    canonicalParts.push(`F${formatCanonicalNumber(line.feed)}`);
    if (!line.block?.tokens?.length) return canonicalParts.join(' ');
    return serializePreservedMotionBlock(line, canonicalParts);
  }
  if (line.kind === 'opaque' && line.block?.tokens?.length) return serializePreservedOpaqueBlock(line);
  return line.text ?? '';
}

const CANONICAL_FIELD_LETTERS = new Set(['X', 'Y', 'Z', 'I', 'J', 'R', 'F']);
const CONSUMED_MODAL_G_CODES = new Set(['G17', 'G20', 'G21', 'G90', 'G91', 'G90.1', 'G91.1']);
const MOTION_G_CODES = new Set(['G0', 'G1', 'G2', 'G3']);

function serializePreservedMotionBlock(line, canonicalParts) {
  const comments = [];
  const before = [];
  const after = [];
  let sawMotionField = false;
  for (const token of line.block.tokens) {
    if (token.type === 'comment') { comments.push(token.raw); continue; }
    if (token.type !== 'word') continue;
    const word = normalizeTokenWord(token);
    if (!word) continue;
    if (word.letter === 'G' && (CONSUMED_MODAL_G_CODES.has(word.code) || MOTION_G_CODES.has(word.code))) { sawMotionField = true; continue; }
    if (CANONICAL_FIELD_LETTERS.has(word.letter)) { sawMotionField = true; continue; }
    (sawMotionField ? after : before).push(token.raw.toUpperCase());
  }
  return [...before, ...canonicalParts, ...after, ...comments].filter(Boolean).join(' ');
}

function serializePreservedOpaqueBlock(line) {
  const parts = [];
  for (const token of line.block.tokens) {
    if (token.type === 'comment') { parts.push(token.raw); continue; }
    if (token.type !== 'word') continue;
    const word = normalizeTokenWord(token);
    if (word?.letter === 'G' && CONSUMED_MODAL_G_CODES.has(word.code)) continue;
    parts.push(token.raw.toUpperCase());
  }
  return parts.join(' ');
}

function normalizeTokenWord(token) {
  const match = /^([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/i.exec(String(token.raw).trim());
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const value = Number(match[2]);
  let code = null;
  if (letter === 'G') code = `G${Number.isInteger(value) ? Math.trunc(value) : value}`;
  return { letter, value, code };
}

export function formatCanonicalNumber(value, precision = CANONICAL_NC_PROFILE.numericPrecision) {
  if (!Number.isFinite(value)) return 'NaN';
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) || Math.abs(rounded) < 10 ** -precision ? '0' : String(rounded);
}
