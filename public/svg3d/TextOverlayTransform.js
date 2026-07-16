export function resolveTextOverlayTransform({
  xMm,
  yMm,
  widthMm,
  heightMm,
  angleDeg,
  outerHeightMm
}) {
  const angleRad = Number.isFinite(angleDeg) ? (angleDeg * Math.PI) / 180 : 0;
  const halfWidthMm = widthMm / 2;
  const halfHeightMm = heightMm / 2;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  // Editor text coordinates use the transformed top-left anchor (Fabric aCoords.tl).
  // PlaneGeometry is centered, so rotate the top-left-to-center vector before placement.
  const centerOffsetX = halfWidthMm * cos - halfHeightMm * sin;
  const centerOffsetY = halfWidthMm * sin + halfHeightMm * cos;

  return {
    x: xMm + centerOffsetX,
    y: outerHeightMm - yMm - centerOffsetY,
    rotationZRad: -angleRad
  };
}
