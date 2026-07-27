import assert from 'node:assert/strict';
import { parseNcQuery } from '../public/nc/NcQuery.mjs';

const page = 'https://viewer.example/svg3d/nc/';
const validDimensions = 'width=375&height=565&thickness=35';

for (const path of ['/admin/api/orders/id/artifacts/cnc.nc', '/dev/admin/api/orders/id/artifacts/cnc.nc']) {
  const result = parseNcQuery(`ncUrl=${encodeURIComponent(path)}&${validDimensions}`, page);
  assert.equal(result.ok, true);
  assert.equal(result.url, `https://viewer.example${path}`);
  assert.deepEqual(result.dimensions, { width: 375, height: 565, thickness: 35 });
}

assert.equal(parseNcQuery(`ncUrl=https%3A%2F%2Fviewer.example%2Fjob.nc&${validDimensions}`, page).ok, true);
assert.equal(parseNcQuery(`ncUrl=relative.nc&${validDimensions}`, page).url, 'https://viewer.example/svg3d/nc/relative.nc');
assert.match(parseNcQuery(`ncUrl=https%3A%2F%2Fevil.example%2Fjob.nc&${validDimensions}`, page).error, /origin/);

for (const dimension of ['width', 'height', 'thickness']) {
  for (const bad of ['', '0', '-1', 'NaN', 'Infinity']) {
    const values = { width: '375', height: '565', thickness: '35', [dimension]: bad };
    const result = parseNcQuery(`ncUrl=%2Fjob.nc&width=${values.width}&height=${values.height}&thickness=${values.thickness}`, page);
    assert.equal(result.ok, false, `${dimension}=${bad} must fail`);
  }
}
assert.equal(parseNcQuery('ncUrl=%2Fjob.nc&width=1&height=2', page).ok, false);
assert.equal(parseNcQuery(`ncUrl=%2Fjob.nc&${validDimensions}&filename=K-00042.nc`, page).filename, 'K-00042.nc');
assert.equal(parseNcQuery(`ncUrl=%2Forders%2Fcut.nc&${validDimensions}`, page).filename, 'cut.nc');
assert.deepEqual(parseNcQuery('', page), { mode: 'manual' });

console.log('NC query tests passed.');
