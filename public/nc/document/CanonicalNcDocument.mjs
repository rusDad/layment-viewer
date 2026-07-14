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
    const parts = [
      line.motion,
      `X${formatCanonicalNumber(line.end.x)}`,
      `Y${formatCanonicalNumber(line.end.y)}`,
      `Z${formatCanonicalNumber(line.end.z)}`
    ];
    if (line.arc) {
      parts.push(`I${formatCanonicalNumber(line.arc.center.x - line.start.x)}`);
      parts.push(`J${formatCanonicalNumber(line.arc.center.y - line.start.y)}`);
    }
    parts.push(`F${formatCanonicalNumber(line.feed)}`);
    return parts.join(' ');
  }
  return line.text ?? '';
}

export function formatCanonicalNumber(value, precision = CANONICAL_NC_PROFILE.numericPrecision) {
  if (!Number.isFinite(value)) return 'NaN';
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) || Math.abs(rounded) < 10 ** -precision ? '0' : String(rounded);
}
