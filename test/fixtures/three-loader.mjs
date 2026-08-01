const emptyThreeUrl = new URL('./empty-three.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: emptyThreeUrl, shortCircuit: true };
  return nextResolve(specifier, context);
}
