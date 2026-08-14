# PreviewSceneV1 — current product preview contract

Status: active Designer producer contract
Date: 2026-08-14

## Ownership and flow

```text
EditorDocument
  -> PreviewSceneRequestV1 (EditorFrame)
  -> POST /api/preview/scene
  -> prepare_manufacturing_scene()
  -> ManufacturingOrder (OrderManufacturingFrame)
  -> PreviewSceneV1
  -> temporary localStorage handoff
  -> layment-viewer
```

Designer backend owns Geometry V3 lookup, catalog/manufacturing readiness, coordinate conversion, placement, effective depth and manufacturing validation. Viewer owns boolean presentation geometry, triangulation, extrusion, materials, lighting and camera.

The scene contains no SVG, PNG, `variantId`, Geometry V3 source vertices, hashes, NC fragment data, pricing, catalog paths or storage URLs.

## Endpoint

```text
POST /api/preview/scene
Content-Type: application/json
```

The endpoint has no pricing, persistence or production-file side effects.

## PreviewSceneRequestV1

The request is a strict semantic layout in EditorFrame (`origin-top-left`):

```text
orderMeta:
  width: number
  height: number
  units: "mm"
  coordinateSystem: "origin-top-left"
  coordinateSemanticsVersion: 2
  baseMaterialColor: "green" | "blue"
  laymentThicknessMm: 35 | 65

contours[]:
  id: variantId lookup identity
  x, y: rotating aCoords.bl anchor
  angle: supported 15-degree editor angle
  scaleOverride: null | 1
  depthOverrideMm: integer

primitives[]:
  rect: type, x, y, width, height, angle, pocketDepthMm
  circle: type, x, y, radius, pocketDepthMm

texts[]:
  text, x, y, angle, fontSizeMm
```

Customer data, workspace snapshots, SVG/PNG artifacts and Geometry V3 are forbidden.

## PreviewSceneV1 response

The strict response is in OrderManufacturingFrame (`origin-bottom-left`):

```json
{
  "version": 1,
  "units": "mm",
  "coordinateSystem": "origin-bottom-left",
  "layment": {
    "width": 565,
    "height": 375,
    "thicknessMm": 35,
    "baseMaterialColor": "green"
  },
  "pockets": {
    "contours": [
      { "ring": [[10, 20], [40, 20], [35, 50]], "depthMm": 23 }
    ],
    "rects": [
      { "corners": [[60, 20], [90, 20], [90, 40], [60, 40]], "depthMm": 12 }
    ],
    "circles": [
      { "center": [120, 60], "radius": 15, "depthMm": 18 }
    ]
  },
  "texts": [
    { "text": "A-1", "x": 20, "y": 30, "angle": 330, "fontSizeMm": 7 }
  ]
}
```

Semantics:

- contour `ring` is the placed `ManufacturingContour.validation_ring`;
- contour `depthMm` is `-ManufacturingContour.effective_min_z_mm`;
- rect `corners` are already rotated and placed manufacturing corners;
- circle `center` is already placed in manufacturing coordinates;
- primitive depth is the prepared `pocket_depth_mm`;
- text coordinates and angles are manufacturing-frame values;
- every pocket depth has already passed the shared bottom-reserve validation.

Array order preserves semantic source order within each pocket kind. A Viewer must not infer identity from array position.

## Errors

Transport errors return HTTP 422. Stable preparation errors are reused where available, including missing/invalid canonical Geometry V3 and invalid manufacturing scene placement. Pricing metadata is neither loaded nor required.

## Canonical sources

```text
backend/application/orders/schemas.py
backend/application/orders/prepare_order.py
backend/application/orders/preview_scene.py
backend/api/public/preview.py
frontend/src/shared/types.ts
frontend/src/editor/core/exportBuilders.ts
frontend/src/shell/orderApi.ts
```

The localStorage key and `/svg3d/?payloadKey=...` URL are a temporary handoff mechanism, not fields or guarantees of `PreviewSceneV1`.
