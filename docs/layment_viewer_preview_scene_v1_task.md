# Layment Viewer — PreviewSceneV1 handoff closeout

Status: completed
Completed: 2026-08-20

This handoff defined the Viewer-side implementation required to make `PreviewSceneV1` the canonical product-preview input from Layment Designer.

## Implemented outcome

PR #56 implemented the handoff:

- strict `PreviewSceneV1` boundary parsing;
- contour/rectangle/circle pocket support with independent depths;
- multi-depth boolean layer construction through `polygon-clipping`;
- Three.js extrusion of multipolygons with holes/islands;
- manufacturing-frame text rendering;
- canonical product routing from `?payloadKey=...` to `PreviewSceneViewer`;
- SVG payload rendering retained only as explicit debug/legacy behavior;
- deterministic fixture/regression coverage for overlap, nesting, identical-depth union, asymmetric orientation and mixed primitive depths.

PR #57 corrected PreviewScene text baseline anchoring and added focused regression coverage for rotated text.

The runtime therefore no longer uses SVG classification or one global pocket depth as the source of product-preview geometry. Viewer remains presentation-only and does not resolve Geometry V3, `variantId`, Fabric anchors or manufacturing rotations.

## Remaining verification

No implementation work remains in this handoff.

The only outstanding release verification is the cross-service Designer -> Viewer real-HTTP/browser smoke described in `geometry_based_3d_preview_roadmap.md`.

This document is retained only as a completion record and is not an active task specification.
