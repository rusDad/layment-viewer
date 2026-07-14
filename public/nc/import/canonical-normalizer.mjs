import {
  applyModalWords,
  buildArcSegments,
  buildLinearSegment,
  getUnitScale,
  mapLastWordsByLetter,
  normalizeGCode,
  parseNcProgram,
  stripGcodeComments,
  resolveRadiusArcCenter,
  resolveTargetPosition
} from '../nc-parser.mjs';
import { createRawNcDocument } from '../document/RawNcDocument.mjs';
import { createCanonicalLineId, createCanonicalNcDocument, serializeCanonicalNcDocument } from '../document/CanonicalNcDocument.mjs';
import { executeCanonicalDocument } from '../execution/NcCanonicalExecution.mjs';
import { analyzeNcExecutionCache } from '../execution/NcProgramAnalysis.mjs';

const MOTIONS = new Set(['G0', 'G1', 'G2', 'G3']);
const LINEAR = new Set(['G0', 'G1']);
const ARC = new Set(['G2', 'G3']);
const PRESERVED_G_CODES = new Set(['G17', 'G20', 'G21', 'G90', 'G91', 'G90.1', 'G91.1']);
const PRESERVED_M_CODES = new Set(['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M30']);

export function importNcToCanonicalDocument(text, options = {}) {
  const rawDocument = createRawNcDocument(text, { filename: options.filename });
  return normalizeRawNcDocument(rawDocument, options);
}

export function normalizeRawNcDocument(rawDocument, options = {}) {
  const program = parseNcProgram(rawDocument.originalText);
  if (program.length > 1 && program[program.length - 1].text === '') program.pop();
  const canonicalLines = [];
  const diagnostics = [];
  let currentPosition = { x: 0, y: 0, z: 0 };
  let modalState = {
    motion: null,
    positioning: 'absolute',
    units: 'mm',
    plane: 'XY',
    arcCenterMode: 'incremental',
    feed: null,
    tool: null,
    spindle: null
  };

  for (const item of program) {
    const words = item.words;
    const rawLineNumber = item.lineNumber;
    const occurrence = canonicalLines.length;
    if (hasMalformedNumericWord(item.text) || words.some((word) => !Number.isFinite(word.value))) {
      diagnostics.push(diagnostic('non-finite-coordinate', rawLineNumber, 'Non-finite numeric input is not supported.'));
      continue;
    }

    const wordsByLetter = mapLastWordsByLetter(words);
    const gCodes = words.filter((word) => word.letter === 'G').map((word) => normalizeGCode(word.value));
    const mCodes = words.filter((word) => word.letter === 'M').map((word) => `M${Math.trunc(word.value)}`);
    const blocking = findBlockingCode(gCodes, wordsByLetter);
    if (blocking) {
      diagnostics.push(blocking(rawLineNumber));
      continue;
    }

    const modalResult = applyModalWords(words, modalState);
    modalState = modalResult.modalState;
    if (modalState.plane !== 'XY') {
      diagnostics.push(diagnostic('unsupported-plane', rawLineNumber, 'Only G17 XY plane is supported by the canonical NC profile.'));
      continue;
    }

    const hasMotionData = ['X', 'Y', 'Z', 'I', 'J', 'R'].some((letter) => wordsByLetter.has(letter));
    const motion = modalResult.unsupportedGCodes.length === 0
      ? modalResult.lineMotion || (hasMotionData ? modalState.motion : null)
      : null;

    if (MOTIONS.has(motion) && hasMotionData) {
      if (modalState.feed == null && motion !== 'G0') {
        diagnostics.push(diagnostic('normalization-invariant', rawLineNumber, 'Canonical feed F is required before feed motion.'));
        continue;
      }
      const nextPosition = resolveTargetPosition(currentPosition, wordsByLetter, modalState);
      if (!finitePoint(nextPosition)) {
        diagnostics.push(diagnostic('non-finite-coordinate', rawLineNumber, 'Motion target contains a non-finite coordinate.'));
        continue;
      }
      const feed = modalState.feed ?? 0;
      let arc = null;
      if (ARC.has(motion)) {
        const arcResult = resolveCanonicalArc(currentPosition, nextPosition, wordsByLetter, motion, modalState, rawLineNumber);
        if (arcResult.diagnostic) {
          diagnostics.push(arcResult.diagnostic);
          continue;
        }
        arc = arcResult.arc;
      }
      canonicalLines.push({
        lineId: createCanonicalLineId(rawDocument, rawLineNumber, occurrence),
        kind: 'motion',
        motion,
        start: { ...currentPosition },
        end: { ...nextPosition },
        feed,
        arc,
        text: null,
        sourceOrigin: origin(rawLineNumber, 'materialized-motion'),
        parseStatus: 'ok'
      });
      currentPosition = nextPosition;
      continue;
    }

    currentPosition = currentPosition;
    if (isCanonicalProfileModalOnly(words, gCodes)) {
      continue;
    }

    if (isCommentOrBlank(item.text) || isPreservableNonMotion(words, gCodes, mCodes)) {
      canonicalLines.push({
        lineId: createCanonicalLineId(rawDocument, rawLineNumber, occurrence),
        kind: isCommentOrBlank(item.text) ? 'comment' : 'opaque',
        text: item.text,
        sourceOrigin: origin(rawLineNumber, isCommentOrBlank(item.text) ? 'preserved-comment' : 'preserved-opaque'),
        parseStatus: 'ok'
      });
    } else if (words.length > 0) {
      diagnostics.push(diagnostic('unsupported-motion-affecting-command', rawLineNumber, 'Unsupported command may affect NC semantics and was not normalized.'));
    }
  }

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, rawDocument, diagnostics };
  }
  const canonicalDocument = createCanonicalNcDocument({ rawDocument, lines: canonicalLines, diagnostics });
  const canonicalText = serializeCanonicalNcDocument(canonicalDocument);
  const executionCache = executeCanonicalDocument(canonicalDocument);
  const canonicalToolpath = analyzeNcExecutionCache(executionCache, canonicalDocument, options);
  canonicalToolpath.canonicalDocument = canonicalDocument;
  canonicalToolpath.rawDocument = rawDocument;
  canonicalToolpath.canonicalText = canonicalText;
  canonicalToolpath.executionCache = executionCache;
  return { ok: true, rawDocument, canonicalDocument, canonicalText, executionCache, toolpath: canonicalToolpath, diagnostics };
}

function resolveCanonicalArc(start, end, wordsByLetter, motion, modalState, lineNumber) {
  let center = null;
  const unitScale = getUnitScale(modalState.units);
  if (wordsByLetter.has('I') || wordsByLetter.has('J')) {
    const iValue = (wordsByLetter.get('I') ?? 0) * unitScale;
    const jValue = (wordsByLetter.get('J') ?? 0) * unitScale;
    center = modalState.arcCenterMode === 'absolute'
      ? { x: iValue, y: jValue }
      : { x: start.x + iValue, y: start.y + jValue };
  } else if (wordsByLetter.has('R')) {
    center = resolveRadiusArcCenter(start, end, wordsByLetter.get('R') * unitScale, motion);
  } else {
    return { diagnostic: diagnostic('invalid-arc', lineNumber, `${motion} requires I/J or R arc definition.`) };
  }
  const rendered = buildArcSegments(start, end, wordsByLetter, motion, modalState, lineNumber);
  if (!center || rendered.warning || !rendered.segment) {
    return { diagnostic: diagnostic('invalid-arc', lineNumber, rendered.warning || 'Invalid arc geometry.') };
  }
  return { arc: { center: { x: center.x, y: center.y }, start: { ...start }, end: { ...end }, direction: motion === 'G2' ? 'cw' : 'ccw' } };
}

function hasMalformedNumericWord(text) {
  return /(?:^|\s)[A-Z]\s*(?:NAN|INF(?:INITY)?)(?:\s|$)/i.test(stripGcodeComments(text));
}

function findBlockingCode(gCodes, wordsByLetter) {
  if (gCodes.includes('G18') || gCodes.includes('G19')) return (line) => diagnostic('unsupported-plane', line, 'Only G17 XY plane is supported.');
  const unsupportedUnit = gCodes.find((code) => code === 'G70' || code === 'G71');
  if (unsupportedUnit) return (line) => diagnostic('unsupported-unit-or-positioning', line, `${unsupportedUnit} unit semantics are not supported.`);
  const unsupportedPositioning = gCodes.find((code) => code === 'G90.2' || code === 'G91.2');
  if (unsupportedPositioning) return (line) => diagnostic('unsupported-unit-or-positioning', line, `${unsupportedPositioning} positioning semantics are not supported.`);
  const unsupportedG = gCodes.find((code) => !MOTIONS.has(code) && !PRESERVED_G_CODES.has(code));
  if (unsupportedG && ['X', 'Y', 'Z', 'I', 'J', 'R'].some((letter) => wordsByLetter.has(letter))) {
    return (line) => diagnostic('unsupported-motion-affecting-command', line, `${unsupportedG} with motion words is not supported.`);
  }
  return null;
}

function isCommentOrBlank(text) {
  const trimmed = String(text).trim();
  return trimmed === '' || trimmed.startsWith(';') || /^\(.*\)$/.test(trimmed);
}

function isCanonicalProfileModalOnly(words, gCodes) {
  return words.length > 0 && words.every((word) => {
    if (word.letter === 'G') return PRESERVED_G_CODES.has(normalizeGCode(word.value));
    return word.letter === 'F' || word.letter === 'T' || word.letter === 'S';
  }) && gCodes.length > 0;
}

function isPreservableNonMotion(words, gCodes, mCodes) {
  if (words.length === 0) return false;
  if (gCodes.some((code) => !PRESERVED_G_CODES.has(code) && !MOTIONS.has(code))) return false;
  if (mCodes.some((code) => !PRESERVED_M_CODES.has(code))) return false;
  return !words.some((word) => ['X', 'Y', 'Z', 'I', 'J', 'R'].includes(word.letter));
}

function origin(rawLineNumber, normalizationKind) {
  return Object.freeze({ rawLineNumbers: Object.freeze([rawLineNumber]), normalizationKind });
}

function diagnostic(code, lineNumber, message) {
  return Object.freeze({ severity: 'error', code, message, source: { lineNumber } });
}

function finitePoint(point) {
  return ['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis]));
}
