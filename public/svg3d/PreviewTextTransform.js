export function resolvePreviewTextTransform({
  xMm,
  yMm,
  widthMm,
  heightMm,
  baselineXFromLeftMm,
  baselineYFromTopMm,
  angleDeg
}) {
  const angleRad = Number.isFinite(angleDeg) ? (angleDeg * Math.PI) / 180 : 0;
  const halfWidthMm = widthMm / 2;
  const halfHeightMm = heightMm / 2;
  const localBaselineX = baselineXFromLeftMm - halfWidthMm;
  const localBaselineY = halfHeightMm - baselineYFromTopMm;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotatedBaselineX = localBaselineX * cos - localBaselineY * sin;
  const rotatedBaselineY = localBaselineX * sin + localBaselineY * cos;

  return {
    x: xMm - rotatedBaselineX,
    y: yMm - rotatedBaselineY,
    rotationZRad: angleRad
  };
}
