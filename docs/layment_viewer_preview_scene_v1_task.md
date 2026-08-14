# Task for layment-viewer — finish Geometry-based 3D Preview Scene

Status: ready to start
Producer baseline: `layment-designer` dev at/after 2026-08-14
Contract: `preview_scene_v1.md`

## Outcome

Make `PreviewSceneV1` the canonical product-preview input in `rusDad/layment-viewer`. Render a layment with independent pocket depths directly from prepared geometry supplied by Designer. Keep SVG input only as an explicit debug/legacy mode.

## Inputs and boundary

The product launcher opens:

```text
/svg3d/?payloadKey=<encoded localStorage key>
```

The stored JSON is the strict `PreviewSceneV1` defined in `preview_scene_v1.md`. It uses millimetres and `origin-bottom-left` coordinates.

Viewer must not:

- resolve `variantId` or catalog/storage paths;
- load or interpret Geometry V3;
- know Fabric anchors or editor coordinate conversions;
- reinterpret manufacturing rotations;
- use SVG classification as the product scene geometry;
- apply one global pocket depth to all pockets.

## Required implementation

1. Add a strict `PreviewSceneV1` parser at the input boundary. Reject unknown version/units/coordinate system, malformed rings/corners, non-finite values, non-positive dimensions/radii/depths and pockets deeper than the layment thickness.
2. Route `version === 1 && coordinateSystem === "origin-bottom-left"` scene objects to a dedicated scene renderer before all legacy SVG aliases.
3. Convert circles to sufficiently tessellated polygon rings for boolean operations. Keep the exact DTO circle representation at the boundary.
4. Normalize pocket footprints for `polygon-clipping` without changing scene placement. Support contour rings, rotated rect corners and circle polygons.
5. Build unique depth levels and solid regions for each Z interval. At a layer whose lower boundary is depth `d`, subtract the union of every pocket with `depthMm >= d` from the layment footprint.
6. Generate extrusion meshes for the resulting multipolygons, including holes and islands. Adjacent depth intervals must meet without visible gaps or z-fighting.
7. Preserve existing layment material colors, lighting, camera controls and text presentation. Interpret scene text coordinates/angle in the declared bottom-left frame; do not apply the legacy SVG/top-left transform.
8. Keep raw SVG upload and legacy Preview Payload V2 aliases behind an explicit debug/legacy input path. They must not be selected for `PreviewSceneV1`.
9. Remove the product-scene dependency on global `POCKET_DEPTH` and SVG pocket union/classification.

## Boolean layer semantics

For sorted unique positive depths `d1 < d2 < ... < dn`:

```text
solid footprint at interval reaching depth di =
  layment rectangle
  - union(all pocket footprints with depthMm >= di)
```

Build the top surface and vertical/step/bottom faces so that:

- a shallow pocket stops subtracting below its own depth;
- a deeper overlapping pocket continues downward;
- a shallower pocket fully inside a deeper pocket creates the correct step;
- nested polygon holes remain islands where boolean topology says they are solid;
- identical-depth overlapping pockets behave as a single unioned cut.

Do not decide topology using draw order.

## Mandatory fixtures

Add deterministic scene JSON fixtures and visual/regression coverage for:

1. one contour at default depth;
2. two disjoint pockets at different depths;
3. overlapping shallow and deep pockets;
4. nested pocket producing an island/step;
5. rotated asymmetric contour (orientation must match supplied ring exactly);
6. rect and circle primitives at different depths;
7. identical-depth overlapping pockets;
8. text in the bottom-left coordinate frame.

For fixtures 2–7, assert mesh/layer topology in tests in addition to screenshots where practical. At minimum assert unique depth intervals, boolean region count/holes and generated mesh bounds.

## Acceptance checklist

- Product `PreviewSceneV1` opens through the existing `payloadKey` launcher.
- Changing Designer contour `depthOverrideMm` visibly changes only that contour pocket depth.
- Changing primitive `pocketDepthMm` visibly changes only that primitive depth.
- A rotated asymmetric contour matches the received ring without mirror or extra rotation.
- Overlap, nesting, islands and identical-depth unions render correctly.
- No product renderer code references Geometry V3, `variantId`, Fabric or manufacturing angle conversion.
- No product renderer code reads pocket geometry from SVG.
- Legacy/debug SVG upload still works independently.
- Parser and renderer tests pass in the target Linux/Ubuntu-like runtime.
- Viewer current documentation describes `PreviewSceneV1` as canonical and SVG as debug/legacy.

## Integration verification

Run both services over real HTTP/static hosting (never `file://`):

1. Start Designer backend/frontend and Viewer under the same deployment base-path policy used by the product.
2. Create a layout containing a rotated asymmetric contour, a depth override, a rect and a circle with different depths.
3. Click product 3D preview.
4. Confirm the network request is `POST /api/preview/scene` and contains no SVG/PNG.
5. Inspect the stored payload and confirm `version: 1`, `origin-bottom-left`, no catalog/path fields and distinct depths.
6. Confirm the Viewer uses the scene renderer and all geometry/orientation/depth acceptance checks pass.

## Out of scope

- Designer API or DTO redesign;
- STL generation on Designer backend;
- Viewer-side manufacturing validation;
- runtime DXF parsing;
- changing quote, order, NC or DXF semantics;
- replacing localStorage handoff before real payload-size measurements justify it.
