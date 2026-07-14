export const ViewerMode = {
  PREVIEW: 'preview',
  DEBUG: 'debug'
};

export const ViewerRoute = {
  SVG_TOOL: 'svg-tool',
  SVG_PREVIEW: 'svg-preview',
  STL_PREVIEW: 'stl-preview'
};

export function parseViewerQuery(search = '') {
  const params = new URLSearchParams(search);
  return {
    payloadKey: params.get('payloadKey')?.trim() || '',
    stl: params.get('stl')?.trim() || '',
    debug: params.get('debug')?.trim() || ''
  };
}

export function getViewerMode(parsedQuery) {
  if (parsedQuery.debug === '1') {
    return ViewerMode.DEBUG;
  }

  return parsedQuery.payloadKey || parsedQuery.stl ? ViewerMode.PREVIEW : ViewerMode.DEBUG;
}

export function isPreviewMode(mode) {
  return mode === ViewerMode.PREVIEW;
}

export function getViewerRoute(parsedQuery) {
  if (parsedQuery.stl) {
    return ViewerRoute.STL_PREVIEW;
  }

  if (parsedQuery.payloadKey) {
    return ViewerRoute.SVG_PREVIEW;
  }

  return ViewerRoute.SVG_TOOL;
}

export function buildStlPreviewUrlFromUploadId(stlId, currentHref = window.location.href) {
  const previewUrl = new URL('../', currentHref);
  previewUrl.search = '';
  previewUrl.hash = '';
  previewUrl.searchParams.set('stl', stlId);
  return previewUrl.toString();
}
