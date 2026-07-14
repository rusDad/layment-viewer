export function createRawNcDocument(text, options = {}) {
  const originalText = typeof text === 'string' ? text : '';
  const lineEnding = detectLineEnding(originalText);
  const document = {
    kind: 'RawNcDocument',
    documentId: options.documentId || `raw-${stableContentHash(originalText).slice(0, 16)}`,
    filename: options.filename || null,
    originalText,
    originalHash: stableContentHash(originalText),
    originalLineEnding: lineEnding,
    rawLines: splitRawLines(originalText).map((line, index) => Object.freeze({
      index,
      number: index + 1,
      text: line,
      lineEnding: index < splitRawLines(originalText).length - 1 || originalText.endsWith('\n') || originalText.endsWith('\r') ? lineEnding : 'none'
    }))
  };
  document.rawLineToCanonicalLineIds = new Map();
  return deepFreezeRawDocument(document);
}

export function detectLineEnding(text) {
  if (text.includes('\r\n')) return 'crlf';
  if (text.includes('\r')) return 'cr';
  return 'lf';
}

export function splitRawLines(text) {
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function stableContentHash(text) {
  // Browser-compatible deterministic FNV-1a 64-bit hash. Not a security primitive.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(String(text));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

function deepFreezeRawDocument(document) {
  document.rawLines.forEach(Object.freeze);
  Object.freeze(document.rawLines);
  return Object.freeze(document);
}
