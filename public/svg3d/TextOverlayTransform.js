export function resolveTextOverlayTransform({
  xMm,
  yMm,
  widthMm,
  heightMm,
  baselineXFromLeftMm,
  baselineYFromTopMm,
  angleDeg,
  outerHeightMm
}) {
  const angleRad = Number.isFinite(angleDeg) ? (angleDeg * Math.PI) / 180 : 0;
  const halfWidthMm = widthMm / 2;
  const halfHeightMm = heightMm / 2;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  // Preview payload text coordinates are the left-baseline insertion point.
  // PlaneGeometry is centered, so rotate the baseline-to-center vector before placement.
  const centerFromBaselineX = halfWidthMm - baselineXFromLeftMm;
  const centerFromBaselineY = halfHeightMm - baselineYFromTopMm;
  const centerOffsetX = centerFromBaselineX * cos - centerFromBaselineY * sin;
  const centerOffsetY = centerFromBaselineX * sin + centerFromBaselineY * cos;

  return {
    x: xMm + centerOffsetX,
    y: outerHeightMm - yMm - centerOffsetY,
    rotationZRad: -angleRad
  };
}
