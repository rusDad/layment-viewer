# AGENTS.md — Layment Viewer

## Role of this repository

This repository contains an auxiliary 3D preview and diagnostics service for Layment Designer.

It supports three separate workflows:

- SVG layout → generated 3D layment preview;
- uploaded STL → persistent preview by generated id;
- local NC file → debug visualization of G0/G1/G2/G3 over a layment bounding box.

The viewer is not the source of truth for manufacturing semantics, order state, pricing, CNC safety, or final geometry validation.

## Core boundaries

Keep these concerns separate:

```text
Parsing
  SVG / STL / NC input interpretation

Model building
  normalized geometry, regions, toolpath segments, material classification

Rendering
  Three.js scene, meshes, lines, lights, camera and controls

Transport/storage
  Express endpoints, multipart uploads, STL filesystem persistence
```

Do not continue growing `public/app.js` or `server.js` as undifferentiated orchestration modules.

New work should move toward small modules with explicit data boundaries. Do not introduce a generic abstraction that hides the materially different SVG, STL and NC semantics.

## Units and coordinate systems

- Geometry units are millimetres.
- Do not introduce hidden scale factors or implicit unit conversion.
- Viewport/camera zoom is visual only and must not modify model coordinates.
- Every source-to-Three.js coordinate transform must be explicit and centralized.
- Do not “fix” orientation by mutating source SVG, STL or NC data in-place.

### NC render mapping

The current NC preview uses this Three.js frame:

```text
Three X: layment width axis
Three Z: layment height axis
Three Y: vertical/depth axis, with the box spanning -thickness..0
```

The visual X inversion is applied only at render mapping:

```text
threeX = laymentWidth - ncX
threeY = ncZ
threeZ = ncY
```

This is a viewer convention. It must not change parsed G-code semantics or the source NC file.

Any change to this mapping requires:

- an explicit coordinate-system decision;
- visual comparison against known NC fixtures;
- regression tests for representative points and arcs.

## SVG pipeline invariants

The SVG pipeline currently performs product-specific geometry processing, not just generic SVG rendering.

Preserve these behaviours unless the task explicitly changes them:

- SVG transforms are applied;
- supported paths/primitives are flattened into usable contours;
- the layment outer contour is identified;
- internal contours are classified as pockets;
- overlapping pockets are unioned;
- top regions preserve valid nested islands;
- invalid or ambiguous geometry produces an explicit error;
- geometry remains deterministic for the same SVG input.

Do not replace the pipeline with direct `SVGLoader → ExtrudeGeometry` unless the input contract has first been changed to guarantee compound paths, holes, fill rules and pre-unioned pockets.

Changes to contour classification, union or top-region construction require regression tests.

## STL pipeline invariants

- Upload accepts only `.stl`.
- Maximum upload size remains 20 MB unless explicitly changed.
- Empty uploads are rejected.
- Stored filename is generated from a server-side id, never from the original filename.
- Request ids must match the safe-id allowlist before path resolution.
- Raw STL bytes are persisted without silent geometry rewriting.
- Preview-only normals/material classification may be derived after loading.
- A preview URL is valid only while its file exists in `uploads/stl/`.

Do not describe current filesystem storage as durable production object storage.

Changes involving public deployment must consider:

- retention and cleanup;
- total storage quotas;
- rate limiting;
- authentication/authorization;
- malware/content validation;
- backup policy;
- migration to external object storage.

Do not weaken path traversal protections or use user-provided filenames as storage paths.

## NC pipeline invariants

NC preview is diagnostic only.

It may:

- parse supported modal state;
- approximate supported G0/G1/G2/G3 motion;
- calculate toolpath bounds and statistics;
- show warnings for unsupported or ambiguous input;
- render motion groups using separate materials.

It must not:

- claim machine safety;
- replace backend NC validation;
- rewrite the uploaded program;
- silently accept unsupported commands as correctly interpreted;
- become a source of manufacturing coordinates.

Parser code should remain pure and independent of DOM and Three.js. Rendering consumes a parsed toolpath model.

Any change to modal handling, arcs, units, absolute/incremental positioning or coordinate mapping requires focused tests.

## UI modes

The mode contract is:

```text
No payload query         -> debug mode
?debug=1                 -> forced debug mode
?payloadKey=<key>        -> customer-facing SVG preview
?stl=<id>                -> customer-facing STL preview
```

Preview mode hides debug controls and uses preview lighting, shadows and presentation UI.

Do not let debug-only controls or diagnostic text leak into customer-facing preview mode.

`payloadKey` integration currently uses same-origin `localStorage` and removes the payload after consumption. Changing this is an integration-contract change and must be documented.

## API contracts

Preserve these routes unless an explicit API migration is requested:

```text
POST /svg3d-api/upload-svg
POST /svg3d-api/upload-stl
GET  /svg3d-api/stl/:id
```

Uploads use `multipart/form-data` with field name `file`.

Do not change route paths, response shapes or file limits as an incidental refactor.

## Three.js dependency policy

- Pin an explicit Three.js revision.
- Never use `latest`.
- Core and all addons must use exactly the same revision and CDN/package source.
- Update `OrbitControls`, loaders and utilities together with core.
- Prefer an import map or locally vendored dependency set over mixed absolute imports.
- Treat a Three.js bump as a rendering change, not a dependency-only change.

After an update, manually verify:

- SVG preview;
- STL preview;
- NC preview;
- initial `fitCamera`;
- orbit and wheel controls at browser zoom 80%, 90%, 100% and 125%;
- materials and color management;
- shadow quality and artifacts;
- object disposal and repeated reloads.

Current intended revision is `three@0.185.0` / r185.

## Resource lifecycle

When replacing a model or preview:

- remove old objects from the scene;
- dispose geometries;
- dispose materials;
- dispose generated textures where applicable;
- clear references to previous groups.

Do not leave repeated uploads accumulating GPU resources.

## Testing and verification

Before completing a change:

```bash
npm test
```

At minimum keep regression coverage for:

- overlapping SVG pocket union;
- top regions and nested islands;
- NC parser cases.

For renderer/UI changes, also perform manual browser smoke checks for all three workflows.

Opening files through `file://` is not a valid integration test. Use the running HTTP server.

## Scope discipline

Prefer small changes and explicit mechanisms.

Do not:

- move manufacturing policy into viewer code;
- couple the viewer directly to editor internals;
- invent a second canonical geometry model for the main product;
- combine SVG, STL and NC pipelines into one opaque “universal loader”;
- add framework or build-system complexity without a concrete need;
- perform broad architectural rewrites as part of a rendering fix.

When a change exposes a wider architectural problem, document it and separate it into a dedicated PR.

## Shared UI distribution

- `public/ui/*.css` are generated vendor artifacts and must not be edited manually.
- NC-specific corrections belong in Viewer-local CSS, scoped through `.nc-app`.
- Update Shared UI only through deterministic sync, provenance verification, and tests.
- Viewer startup and browser runtime must remain self-contained; a runtime dependency on the Layment Designer service or checkout is forbidden.
