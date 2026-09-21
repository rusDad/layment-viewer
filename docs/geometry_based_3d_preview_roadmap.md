# Geometry-based 3D Preview Scene

Status: implementation complete; one cross-service HTTP/browser gate remains.
Updated: 2026-09-17

## Completed implementation

P4 Viewer renderer and P5 product cutover are complete on `main`.

Implemented by PR #56, with the PreviewScene text-baseline correction in PR #57:

- strict `PreviewScene` parsing at the Viewer boundary;
- contour, rectangle and circle pockets with independent depths;
- deterministic multi-depth boolean layers using `polygon-clipping`;
- overlap, nesting, islands and identical-depth unions;
- Three.js extrusion meshes, material layers and manufacturing-frame text rendering;
- canonical product `?payloadKey=...` routing to `PreviewSceneViewer`;
- legacy SVG payload rendering only through explicit `debug=1` / manual SVG tooling;
- deterministic fixtures and regression coverage for depth topology, asymmetric orientation and text anchoring.

Viewer does not resolve `variantId`, Geometry V3, Fabric anchors or manufacturing rotations. Product-preview geometry is not reconstructed from SVG.

## Remaining release gate

Run the complete flow over real HTTP/static hosting using the deployed Designer/Viewer base-path policy:

1. build a Designer layout with a rotated asymmetric contour, contour depth override, rectangle and circle at different depths;
2. open product 3D preview;
3. confirm Designer calls `POST /api/preview/scene` and sends no SVG/PNG geometry;
4. confirm the stored payload is strict `PreviewScene` (`schemaVersion: 1`, `origin-bottom-left`, distinct depths, no catalog/storage fields);
5. confirm Viewer selects `PreviewSceneViewer` and renders orientation, overlap/nesting and independent depths correctly;
6. confirm explicit SVG debug mode remains usable independently.

`file://` is not evidence for this gate.

After this smoke is recorded, close this roadmap; no further P4/P5 implementation is planned.

## Deferred / non-goals

The current one-shot same-origin `localStorage` handoff may remain until measured scene sizes justify a transport change. Any later handoff replacement must preserve `PreviewScene`.

STL generation, Viewer-side manufacturing validation, public Geometry V3 exposure, pricing/order changes and runtime DXF parsing remain out of scope.
