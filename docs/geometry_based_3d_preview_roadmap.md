# Roadmap — Geometry-based 3D Preview Scene

Status: Designer complete; Viewer implementation pending
Date: 2026-08-12

Implementation update: 2026-08-14

- P1 shared backend preparation boundary: complete in `layment-designer`;
- P2 Preview Scene API: complete in `layment-designer`;
- P3 frontend preview integration: complete in `layment-designer`;
- P4 Viewer renderer: pending in `layment-viewer`;
- P5 Designer product cutover: complete; Viewer legacy/debug separation pending;
- implementation-ready Viewer handoff: `../contracts/layment_viewer_preview_scene_v1_task.md`.

## Goal

Replace the current product 3D preview path based on exported layout SVG with a backend-built preview scene derived from canonical order geometry.

The product preview must use:

- canonical Geometry V3 for contour footprints;
- actual editor placement and rotation;
- effective contour pocket depth;
- primitive pocket depth;
- layment dimensions, thickness and material color;
- text placements.

SVG remains available only as a legacy/debug input in `layment-viewer`.

## Architectural boundary

Target flow:

```text
EditorDocument
  -> PreviewSceneRequest
  -> Layment Designer backend
  -> shared EditorFrame -> ManufacturingOrder preparation
  -> PreviewSceneV1
  -> Product Shell
  -> Layment Viewer
  -> multi-depth boolean geometry
  -> Three.js mesh
```

Rules:

- frontend does not load or interpret Geometry V3;
- Viewer does not resolve `variantId`, catalog paths, Fabric anchors or NC metadata;
- backend is the only owner of Geometry V3 lookup and EditorFrame -> manufacturing placement;
- preview scene generation must reuse the existing manufacturing mapping instead of implementing a second coordinate/rotation path;
- Viewer owns presentation geometry: boolean layer construction, triangulation and extrusion.

## PreviewSceneV1

Introduce a dedicated transport DTO independent from order persistence and SVG export.

Suggested shape:

```text
version: 1
units: "mm"
coordinateSystem: "origin-bottom-left"

layment:
  width
  height
  thicknessMm
  baseMaterialColor

pockets:
  contour:
    ring: [[x, y], ...]
    depthMm

  rect:
    corners: [[x, y], ...]
    depthMm

  circle:
    center: [x, y]
    radius
    depthMm

texts:
  text
  x
  y
  angle
  fontSizeMm
```

The DTO must contain only data required to render the preview.

For contours:

```text
ring = placed ManufacturingContour.validation_ring
depthMm = -ManufacturingContour.effective_min_z_mm
```

Do not expose Geometry V3 source vertices, prepared rotations, hashes, catalog filesystem layout or NC semantics to Viewer.

---

# Stage P1 — Shared backend preparation boundary

## Scope

Extract the geometry/readiness/mapping part of the existing order preparation into a reusable application function.

Target ownership:

```text
prepare_manufacturing_scene(...)
  -> transport validation
  -> entity/range limits
  -> catalog/artifact readiness
  -> Geometry V3 lookup
  -> EditorFrame -> ManufacturingOrder
  -> manufacturing validation
  -> ManufacturingOrder
```

Then:

```text
prepare_order_candidate(...)
  -> prepare_manufacturing_scene(...)
  -> pricing
  -> quote identity
```

Preview generation uses the same preparation boundary but does not invoke pricing or order persistence.

## Acceptance

- quote/create behavior remains unchanged;
- preview and quote use the same contour placement semantics;
- no second Geometry V3 placement implementation exists;
- regression tests prove identical ManufacturingOrder geometry for equal layout input.

---

# Stage P2 — Preview Scene API

## Scope

Add a public endpoint, for example:

```text
POST /api/preview/scene
```

Request should contain the editor semantic layout required for preparation:

```text
orderMeta/layout metadata
contours[]
primitives[]
texts[]
```

It should not contain SVG or PNG artifacts.

Backend maps the prepared `ManufacturingOrder` into `PreviewSceneV1`.

## Error policy

Reuse stable preparation/readiness validation where applicable.

Preview must fail cleanly when:

- a variant is missing or not manufacturing-ready;
- Geometry V3 is unavailable or invalid;
- placement/depth values are invalid.

Preview must not fail because pricing metadata is unavailable.

## Acceptance

- response contains no SVG;
- response contains no catalog/storage paths;
- contour rings are already positioned in one scene coordinate system;
- effective depth reflects `depthOverrideMm`;
- rect/circle depth reflects `pocketDepthMm`.

---

# Stage P3 — Frontend preview integration

## Scope

Replace `build3dPreviewPayload()` / SVG-based product preview orchestration with a backend scene request.

Recommended first iteration:

```text
EditorFacade builds preview-layout request
  -> Shell calls POST /api/preview/scene
  -> receives PreviewSceneV1
  -> stores PreviewSceneV1 under current temporary localStorage payload key
  -> opens /svg3d/?payloadKey=...
```

Keep the current launcher mechanism initially to minimize integration scope.

Do not make localStorage part of the stable PreviewScene contract.

## Acceptance

- product preview no longer exports SVG to construct geometry;
- preview works with contour depth overrides and primitive depths;
- existing validation/submit semantics are not changed;
- no Geometry V3 data is added to `EditorAddContourInput`.

---

# Stage P4 — Viewer PreviewSceneV1 renderer

## Scope

Add a new Viewer input path for `PreviewSceneV1`.

Viewer should:

1. validate the scene DTO;
2. group pocket footprints by depth;
3. compute solid regions for each Z interval;
4. build Three.js extrusion meshes;
5. render texts and existing materials/lighting.

For depth levels `d1 < d2 < ...`:

```text
solid(layer z) =
  layment footprint
  - union(all pockets whose depth reaches below that layer)
```

This must support:

- contours of different depths;
- rect/circle primitives of different depths;
- overlapping pockets;
- nested regions / islands;
- identical-depth pockets;
- pockets fully contained in deeper or shallower pockets.

Reuse the Viewer `polygon-clipping` dependency where practical.

## Acceptance

Visual fixtures must cover at least:

1. one contour at default depth;
2. two disjoint pockets at different depths;
3. overlapping shallow/deep pockets;
4. nested pocket producing an island/step;
5. rotated asymmetric contour;
6. rect and circle primitives with different depths.

No Viewer code may resolve Geometry V3, `variantId`, Fabric anchors or manufacturing rotations.

---

# Stage P5 — Cutover and cleanup

## Scope

Make `PreviewSceneV1` the canonical product-preview path.

Keep SVG -> 3D only for:

- Viewer debug upload;
- explicit legacy diagnostics if still useful.

Remove product-preview dependence on:

- layout SVG geometry classification;
- global Viewer `POCKET_DEPTH`;
- SVG-derived pocket union as the source of product scene geometry.

Update contracts/current documentation synchronously with the runtime cutover.

## Acceptance

- Designer product UI always uses PreviewSceneV1;
- changing contour `depthOverrideMm` visibly changes preview depth;
- changing primitive `pocketDepthMm` visibly changes preview depth;
- asymmetric rotated contour matches editor/manufacturing orientation;
- existing SVG debug mode remains usable independently.

---

# Deferred / follow-up

## Preview handoff transport

Current localStorage handoff can remain for the first cutover.

Measure real PreviewScene payload sizes after implementation. If scene size approaches browser storage limits, replace only the handoff mechanism, for example with a short-lived backend preview resource/token.

This must not change `PreviewSceneV1`.

## Explicit non-goals

This workstream does not:

- generate STL on the Designer backend;
- make Viewer a manufacturing validator;
- expose Geometry V3 publicly for Viewer consumption;
- change order transport or pricing semantics;
- change CNC/DXF generation;
- reconstruct exact geometry from SVG;
- introduce runtime DXF parsing in frontend or Viewer.
