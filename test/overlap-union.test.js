const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { parseSvgToContours, validateAndClassifyContours } = require('../server');

const overlapSvg = fs.readFileSync(path.join(__dirname, '../fixtures/overlap-pockets.svg'), 'utf8');

const parseErrors = [];
const parsed = parseSvgToContours(overlapSvg, parseErrors);
assert.deepStrictEqual(parseErrors, [], `parse errors: ${parseErrors.join('; ')}`);

const validationErrors = [];
const geometry = validateAndClassifyContours(parsed.contours, validationErrors);
assert.deepStrictEqual(validationErrors, [], `validation errors: ${validationErrors.join('; ')}`);

assert.ok(Array.isArray(geometry.holes), 'holes must be an array');
assert.strictEqual(geometry.holes.length, 1, 'overlapping pockets must be merged into a single hole loop');
assert.ok(geometry.holes[0].length >= 4, 'merged hole loop must contain at least 4 points');

console.log('OK: overlapping pockets are merged into one resulting hole loop.');
