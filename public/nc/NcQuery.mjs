export function parseNcQuery(search, pageUrl) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const ncUrl = params.get('ncUrl');
  if (!ncUrl) return { mode: 'manual' };

  let resolvedUrl;
  let page;
  try {
    page = new URL(pageUrl);
    resolvedUrl = new URL(ncUrl, page);
  } catch {
    return { mode: 'query', ok: false, error: 'Некорректный ncUrl.' };
  }
  if (resolvedUrl.origin !== page.origin) {
    return { mode: 'query', ok: false, error: 'NC URL должен принадлежать текущему origin.' };
  }

  const dimensions = {};
  for (const name of ['width', 'height', 'thickness']) {
    const raw = params.get(name);
    const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return { mode: 'query', ok: false, error: 'Для автоматической загрузки width, height и thickness должны быть явно заданы положительными числами.' };
    }
    dimensions[name] = value;
  }

  const requestedFilename = params.get('filename')?.trim();
  const basename = resolvedUrl.pathname.split('/').filter(Boolean).at(-1);
  return { mode: 'query', ok: true, url: resolvedUrl.href, dimensions, filename: requestedFilename || basename || 'order.nc' };
}
