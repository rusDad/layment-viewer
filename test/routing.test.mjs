import assert from 'node:assert/strict';
import { buildStlPreviewUrlFromUploadId, getViewerRoute, parseViewerQuery, ViewerRoute } from '../public/routing.js';

assert.equal(getViewerRoute(parseViewerQuery('')), ViewerRoute.SVG_TOOL);
assert.equal(getViewerRoute(parseViewerQuery('?payloadKey=abc')), ViewerRoute.SVG_PREVIEW);
assert.equal(getViewerRoute(parseViewerQuery('?stl=model-1')), ViewerRoute.STL_PREVIEW);
assert.equal(getViewerRoute(parseViewerQuery('?payloadKey=abc&stl=model-1')), ViewerRoute.STL_PREVIEW);

assert.equal(
  buildStlPreviewUrlFromUploadId('abc123', 'https://example.com/svg3d/stl/'),
  'https://example.com/svg3d/?stl=abc123'
);
assert.equal(
  buildStlPreviewUrlFromUploadId('abc123', 'https://example.com/arbitrary/prefix/stl/?x=1#hash'),
  'https://example.com/arbitrary/prefix/?stl=abc123'
);
