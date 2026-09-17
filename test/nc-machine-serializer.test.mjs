import assert from 'node:assert/strict';
import { importNcToCanonicalDocument } from '../public/nc/import/canonical-normalizer.mjs';
import { serializeCanonicalNcDocument } from '../public/nc/document/CanonicalNcDocument.mjs';
import { applyUpdateCanonicalNumericFieldCommand } from '../public/nc/document/CanonicalNcEditor.mjs';
import { applySemanticTranslationCommand, buildSemanticTranslationPlan } from '../public/nc/document/NcSemanticTranslation.mjs';
import { serializeMachineNcDocument, serializeMachineNcLine, MachineNcSerializationError } from '../public/nc/output/MachineNcSerializer.mjs';

function mustImport(text) {
  const result = importNcToCanonicalDocument(text, { filename: 'machine.nc' });
  assert.equal(result.ok, true, result.diagnostics?.map((item) => item.message).join('\n'));
  return result;
}

function exportArc(motion, end, centerWords) {
  const imported = mustImport(`G0 X1 Y0 Z0\n${motion} X${end.x} Y${end.y} ${centerWords} F100\n`);
  const text = serializeMachineNcDocument(imported.canonicalDocument);
  return { imported, text, arcLine: text.trim().split('\n')[1] };
}

for (const fixture of [
  ['G2', { x: 0, y: -1 }, 'I-1 J0', 'R1'],
  ['G3', { x: 0, y: 1 }, 'I-1 J0', 'R1'],
  ['G2', { x: 0, y: 1 }, 'I-1 J0', 'R-1'],
  ['G3', { x: 0, y: -1 }, 'I-1 J0', 'R-1']
]) {
  const [motion, end, center, expectedRadius] = fixture;
  const { arcLine } = exportArc(motion, end, center);
  assert.match(arcLine, new RegExp(`^${motion} .* ${expectedRadius} F100$`));
  assert.doesNotMatch(arcLine, /(?:^| )[IJ][+-]?\d/);
}

for (const motion of ['G2', 'G3']) {
  const { arcLine } = exportArc(motion, { x: -1, y: 0 }, 'I-1 J0');
  assert.match(arcLine, / R1 F100$/, `${motion} 180-degree arcs deterministically use positive R`);
}

for (const sourceArc of ['G3 X0 Y1 R1 F100', 'G3 X0 Y1 I-1 J0 F100']) {
  const source = mustImport(`G0 X1 Y0 Z0\n${sourceArc}\n`);
  const machineText = serializeMachineNcDocument(source.canonicalDocument);
  const roundTrip = mustImport(machineText);
  const before = source.executionCache.segments.find((segment) => segment.arc).arc;
  const after = roundTrip.executionCache.segments.find((segment) => segment.arc).arc;
  assert.ok(Math.abs(before.radius - after.radius) <= 1e-6);
  assert.ok(Math.abs(before.sweep - after.sweep) <= 1e-6);
  assert.equal(after.direction, before.direction);
  assert.doesNotMatch(machineText.split('\n')[1], /(?:^| )[IJ][+-]?\d/);
}

const preserved = mustImport('N10 T2 M6 S12000 G0 X1 Y0 Z0 F0\nN20 G3 X0 Y1 I-1 J0 F250 M3 (keep me) ; also keep\n');
assert.match(serializeMachineNcDocument(preserved.canonicalDocument), /N20 G3 X0 Y1 Z0 R1 F250 M3 \(keep me\) ; also keep/);

const translatedSource = mustImport('G0 X1 Y0 Z0\nG3 X0 Y1 I-1 J0 F100\n');
const translatedIds = translatedSource.canonicalDocument.lines.map((line) => line.lineId);
const translationPlan = buildSemanticTranslationPlan({ document: translatedSource.canonicalDocument, previousCache: translatedSource.executionCache, lineIds: translatedIds, dxMm: 10, dyMm: -4 });
const translated = applySemanticTranslationCommand({ document: translatedSource.canonicalDocument, previousCache: translatedSource.executionCache, initialCanonicalText: translatedSource.canonicalText, plan: translationPlan });
assert.equal(translated.ok, true);
assert.match(serializeMachineNcDocument(translated.document), /G3 X10 Y-3 Z0 R1 F100/);

const editable = mustImport('G0 X0 Y0 Z0\nG2 X2 Y0 I1 J0 F100\n');
const edited = applyUpdateCanonicalNumericFieldCommand({ document: editable.canonicalDocument, previousCache: editable.executionCache, initialCanonicalText: editable.canonicalText, lineId: editable.canonicalDocument.lines[1].lineId, field: 'arcCenterY', value: 1 });
assert.equal(edited.ok, true);
assert.match(serializeMachineNcDocument(edited.document), /G2 X2 Y0 Z0 R-1\.414214 F100/);

const fullCircle = mustImport('G0 X1 Y0 Z0\nG2 X1 Y0 I-1 J0 F100\n');
assert.throws(
  () => serializeMachineNcDocument(fullCircle.canonicalDocument),
  (error) => error instanceof MachineNcSerializationError && error.code === 'full-circle-r-unsupported' && error.canonicalIndex === 1
);

const linear = mustImport('N1 G0 X1 Y2 Z3\nN2 G1 X4 Y5 Z6 F70 ; linear\n');
assert.equal(serializeMachineNcDocument(linear.canonicalDocument), serializeCanonicalNcDocument(linear.canonicalDocument));
assert.equal(serializeMachineNcLine(linear.canonicalDocument.lines[1]), 'N2 G1 X4 Y5 Z6 F70 ; linear');

assert.match(serializeCanonicalNcDocument(preserved.canonicalDocument), /G3 X0 Y1 Z0 I-1 J0 F250/, 'internal canonical serializer remains I/J based');

console.log('OK: NC machine R serializer regression passed.');
