# Browser NC inspector and editor — target design

## Status

Target design for development of the NC subsystem currently implemented in the separate `Layment Viewer` service.

Recommended location in the main project documentation:

```text
docs/design/nc_browser_editor.md
```

The implementation remains in the `Layment Viewer` repository. Its repository-specific current map and PR roadmap should remain there. This document records the product role, semantic model, safety boundaries and intended integration with the wider manufacturing service.

### Accepted design decisions

The editor is built around two project-specific simplifications:

1. The imported NC file is normalized once into a canonical editable NC document.
2. After an edit, parsing/execution resumes from the earliest affected line and continues only until the cached execution state converges with the previous revision.

The target is deliberately not a universal editor for arbitrary G-code dialects.

---

## 1. Purpose

The existing NC viewer is already a useful browser-based G-code diagnostic tool.

It can:

- load and parse an NC file;
- render `G0/G1/G2/G3` motions;
- preserve source-line provenance for rendered paths;
- locate the source line from a hovered rendered segment;
- perform the reverse operation and focus rendered geometry from source selection;
- display source and parsed details;
- use several color strategies based on motion and other parsed parameters;
- display modal information, bounds, warnings and toolpath statistics.

The target is to extend this viewer into a **lightweight browser NC inspector and editor** suitable for practical production corrections.

The intended value is not to replace CAM software. It is to provide a fast, accessible and transparent tool for:

- diagnosing generated or imported G-code;
- correcting small, well-understood defects;
- deleting unnecessary commands;
- changing numeric parameters;
- selecting meaningful groups of commands;
- applying controlled batch transformations;
- previewing the exact result before saving or using it in production.

---

## 2. Product position

The target product is:

```text
NC viewer
  + canonical source normalizer
  + source-aware inspector
  + constrained token editor
  + semantic batch operations
  + incremental execution/re-render
  + export of an explicitly reviewed candidate NC
```

It is not:

- a general CAM system;
- a CNC postprocessor for arbitrary machines;
- a full IDE for every G-code dialect;
- a geometry reconstruction and toolpath planning system;
- an authority that can prove a toolpath is safe to execute.

The editor may detect many structural and semantic problems, but the operator remains responsible for machine-specific verification.

---

## 3. Core pipeline

The rendered Three.js toolpath is a projection of a canonical editable NC document.

It must never become the editable source of truth.

The complete import flow is:

```text
raw source NC
  -> tokenize and parse raw dialect
  -> execute source modal state
  -> normalize into canonical project NC
  -> build execution cache and semantic segments
  -> diagnostics and indexes
  -> Three.js projection
```

The original source and the canonical working document are different artifacts:

```text
RawNcDocument
  immutable original input

CanonicalNcDocument
  normalized editable working copy
```

An edit follows this loop:

```text
editor command
  -> mutate canonical line/token model
  -> re-tokenize changed lines
  -> re-execute from first affected line
  -> continue until execution cache converges
  -> update affected semantic segments/indexes
  -> update preview and diagnostics
```

Do not directly move, delete or modify Three.js segments and then attempt to reconstruct G-code from the scene.

Do not repeatedly normalize the document after every edit. Normalization is a deterministic import boundary. The editor operates on the already canonical document.

---

## 4. Canonical NC profile

The editable document uses a deliberately narrow project dialect matching the actual production workflow.

### 4.1 Fixed coordinate semantics

The canonical document uses:

```text
units: mm
plane: XY
positioning: fixed absolute coordinates
```

Runtime switching between `G90` and `G91` is not part of the editable dialect.

The current equipment profile does not require general support for positioning-mode switching. Import must therefore either:

- normalize a verified supported input into fixed absolute coordinates; or
- reject the file as unsupported.

The canonical working document must not contain unresolved positioning-mode switches.

Likewise, the editable profile should not carry runtime unit or plane ambiguity. Input must be normalized to the project profile before editing.

### 4.2 Explicit motion blocks

Every canonical motion line must be self-contained.

A normalized linear block contains at least:

```text
G0|G1 X... Y... Z... F...
```

A normalized arc block contains:

```text
G2|G3 X... Y... Z... <canonical arc definition> F...
```

The normalizer materializes values that were implicit in the raw source:

- modal motion code;
- omitted `X`, `Y`, and `Z`;
- effective feed;
- normalized numeric format;
- canonical arc data;
- any other project-owned motion field required to execute the block independently.

Example:

```text
raw:
G1 X10 Y20 Z-5 F600
X30
X50

canonical:
G1 X10 Y20 Z-5 F600
G1 X30 Y20 Z-5 F600
G1 X50 Y20 Z-5 F600
```

This removes most downstream modal dependency from routine editing and selection.

### 4.3 Arc representation

The importer/parser may accept the arc forms currently supported by the viewer, but the canonical document should use one project-owned arc representation.

Recommended semantic IR:

```text
motion: G2 | G3
start:  X/Y/Z
end:    X/Y/Z
center: absolute center X/Y in the active XY plane
feed
```

The serializer then emits the machine-compatible canonical syntax, normally deterministic `I/J` values derived from the semantic center.

This separation is preferable to making later transforms depend directly on whichever `R`, `I/J`, or center mode happened to occur in the raw source.

The exact emitted arc syntax must be fixed by the viewer repository and protected with golden tests.

### 4.4 Non-motion lines

Comments and supported machine commands may remain as separate canonical lines.

A line that only changes a modal value in the raw source may remain for provenance, but subsequent canonical motion lines must already contain the effective value they need.

Unsupported macros, variables, loops, subprograms or machine-specific commands must be:

- rejected; or
- preserved as explicit opaque lines that block affected semantic operations.

They must never be silently dropped.

---

## 5. Raw-to-canonical normalization

Normalization happens once when a file is opened or explicitly re-imported.

It must be deterministic and testable.

### 5.1 Normalization responsibilities

The normalizer:

1. Parses the raw NC file.
2. Executes the supported raw modal semantics.
3. Converts coordinates to millimetres where explicitly supported.
4. Converts motion positions to fixed absolute coordinates.
5. Materializes explicit motion type, `X`, `Y`, `Z`, and feed.
6. Converts arcs to the canonical semantic representation.
7. Emits deterministic canonical line text.
8. Preserves comments and supported non-motion commands.
9. Creates raw-source to canonical-line provenance.
10. Rejects unsupported ambiguity instead of guessing.

### 5.2 Original/canonical provenance

A raw source block may map to one or more canonical lines.

Each canonical line should retain:

```text
sourceOrigin
  originalLineNumber
  originalSourceRange
  normalizationKind
```

The UI should be able to display:

- original source;
- canonical working document;
- mapping between them.

Editing occurs only in the canonical document.

### 5.3 Deterministic formatting

Canonical motion serialization should use one stable policy:

```text
token order is fixed
decimal point is "."
maximum fractional precision is fixed
trailing zeros are trimmed
negative zero becomes zero
line ending policy is explicit
terminal newline policy is explicit
```

The original formatting remains available in `RawNcDocument`, but it is not preserved in canonical motion blocks.

This is intentional: predictability and editability are more valuable than retaining incidental CAM formatting.

---

## 6. Document model

Introduce explicit document models independent of DOM and Three.js.

### 6.1 Raw document

```text
RawNcDocument
  documentId
  originalText
  originalHash
  originalLineEnding
  rawLines[]
```

`RawNcDocument` is immutable after import.

### 6.2 Canonical editable document

```text
CanonicalNcDocument
  documentId
  sourceDocumentId
  lines[]
  revision
  dirty
  serializationProfile
```

```text
CanonicalNcLine
  lineId
  currentIndex
  kind
  rawText
  tokens[]
  sourceOrigin
  parseStatus
```

```text
NcToken
  tokenId
  kind
  letter
  rawValue
  numericValue
  sourceRange
```

Requirements:

- `lineId` remains stable while the canonical line survives edits;
- array index and displayed line number are not identities;
- deleting or inserting lines does not reassign surviving IDs;
- comments should be retained where possible;
- canonical line text and token model must remain round-trippable;
- the original raw document remains available for reset and comparison.

Stable IDs are required because source positions change after insertion or deletion, while selection, history and rendered provenance must remain coherent.

---

## 7. Execution cache and semantic representation

The executor produces a renderer-independent semantic result.

### 7.1 Per-line execution cache

```text
NcExecutedLineCache
  lineId
  canonicalIndex
  inputState
  outputState
  normalizedCommand
  producedSegments[]
  diagnostics[]
  executionHash
```

The state should contain only semantics that can affect later lines, for example:

```text
current position
effective feed
supported machine state
other project-owned execution state
```

Because canonical motion lines explicitly contain their motion coordinates and feed, downstream dependency is intentionally small.

### 7.2 Program analysis

```text
NcProgramAnalysis
  revision
  executedLines[]
  segments[]
  diagnostics[]
  statistics
  bbox
```

```text
NcToolpathSegment
  segmentId
  sourceLineId
  motion
  start
  end
  arcData
  feed
  effectiveZ
  executionOrder
```

The ownership boundary is mandatory:

```text
normalizer/parser/executor -> semantic result
renderer -> consumes semantic result
editor commands -> mutate CanonicalNcDocument
```

The parser/executor must not depend on DOM or Three.js.

The renderer must not parse raw G-code.

---

## 8. Incremental execution

A committed edit must not reparse and re-execute the entire document by default.

### 8.1 First affected line

For each editor command, compute:

```text
firstAffectedIndex
```

Examples:

- token update -> edited line index;
- line deletion -> first deleted line index;
- insertion -> inserted line index;
- batch edit -> minimum index of all affected lines;
- undo/redo -> earliest changed line in restored transaction.

Only changed or inserted textual lines need tokenization.

### 8.2 Re-execution from cached prefix

Execution starts from the cached `outputState` of the preceding unchanged line.

```text
state =
  initialState, if firstAffectedIndex == 0
  previousLine.outputState, otherwise
```

Then execute the candidate lines in source order.

### 8.3 Stop at convergence

For each recalculated line, compare the new result with the result from the previous revision.

Re-execution may stop when an unchanged surviving line reaches the same semantic result:

```text
new inputState == old inputState
new outputState == old outputState
new producedSegments == old producedSegments
new diagnostics == old diagnostics
```

After convergence, the remaining cached suffix is still valid.

In the canonical profile, convergence usually occurs quickly.

Example:

```text
100: G1 X10 Y20 Z-5 F600
101: G1 X30 Y20 Z-5 F600
102: G1 X50 Y20 Z-5 F600
```

Changing line `101` affects:

- the segment produced by `101`;
- the start point of segment `102`.

Line `102` still has its own explicit endpoint and feed. After it executes, the output state usually returns to the previous cached state, so lines after `102` remain valid.

### 8.4 Deletion behavior

Deleting a motion line usually affects:

- the deleted line;
- the next executable motion, whose start point changes.

Execution continues until the cached state converges.

Deleting a non-motion state command may affect a longer suffix. The same convergence algorithm handles it without special cases.

### 8.5 Cache comparison

Comparison must be semantic and deterministic.

Do not depend on object identity.

Recommended checks:

```text
normalized numeric state
stable segment serialization/hash
diagnostic codes and affected IDs
```

Floating-point comparisons use the project epsilon appropriate to NC geometry.

### 8.6 Rendering update

The semantic layer should replace only affected executed-line/segment records.

For the first implementation, two renderer strategies are acceptable:

1. rebuild the combined Three.js buffer from the cached segment list;
2. update only affected render chunks.

The first is simpler and may already be fast enough because parsing/execution remains incremental. If rendering becomes measurable, split geometry into stable chunks by line range.

The architecture must not require a full semantic reparse merely because the renderer initially rebuilds a GPU buffer.

---

## 9. Provenance and bidirectional navigation

The existing source/path linkage should become a first-class index rather than renderer-specific metadata.

Required indexes:

```text
lineId -> executed line
lineId -> produced segment IDs
segmentId -> source lineId
canonical index -> lineId
raw source line -> canonical line IDs
```

Interaction behavior:

- hover a rendered segment -> show effective command and canonical line;
- click a rendered segment -> select its canonical source line;
- select a canonical line -> highlight all produced segments;
- select several canonical lines -> highlight the union of produced segments;
- reveal the original raw source block when requested;
- after edits -> restore selection by stable `lineId` where possible;
- if a selected line was deleted -> remove it from selection explicitly.

A rendered arc may contain many sampled display vertices but still maps to one semantic segment and one canonical line.

Selection must not be attached to individual sampled vertices.

---

## 10. Editing levels

The editor should support distinct editing levels.

They must not be merged into one unrestricted textarea workflow.

### 10.1 Structured token editing

Primary V1 mechanism.

For a selected canonical line, display supported tokens and semantic fields:

```text
G
X
Y
Z
I
J
F
supported M fields
```

The operator may:

- change a numeric value;
- change a supported motion code;
- edit a supported machine parameter;
- edit comments.

The UI sends typed commands such as:

```text
UpdateNumericToken(lineId, tokenId, value)
UpdateMotion(lineId, motion)
```

not renderer mutations.

After a committed change:

1. update the canonical line;
2. tokenize that line;
3. re-execute from its index;
4. stop at convergence;
5. update diagnostics and preview.

### 10.2 Canonical raw-line editing

Optional advanced mode.

The operator edits the complete canonical line text.

After commit:

1. replace canonical line text;
2. tokenize only that line;
3. execute from that line;
4. continue until convergence;
5. reject the edit if the canonical profile is violated.

This mode edits canonical NC, not the immutable raw imported file.

### 10.3 Line deletion

Support:

```text
DeleteLines(lineIds[])
```

Deletion affects the canonical working candidate only.

The system must:

- execute from the first deleted index;
- report introduced errors and warnings;
- show changed bounds/statistics;
- show the affected execution range;
- allow undo.

Deleting a line with no rendered segment can still be significant because it may contain feed, spindle or machine commands.

The UI must not imply that “no visible path” means “safe to delete”.

### 10.4 Line insertion and duplication

Not required for the first editing increment, but the document model must support them.

Likely commands:

```text
InsertLineBefore(anchorLineId, canonicalText)
InsertLineAfter(anchorLineId, canonicalText)
DuplicateLines(lineIds[])
```

Inserted lines must conform to the canonical profile.

---

## 11. Selection model

Selection belongs to the NC editor state, not to Three.js.

```text
NcSelection
  orderedLineIds[]
  anchorLineId
  focusLineId
  origin
```

Supported selection sources:

```text
canonical-source-list
rendered-segment
line-range
query-result
command-result
```

Required V1 behaviors:

- single line selection;
- `Ctrl/Cmd` toggle;
- `Shift` contiguous range;
- select all;
- clear selection;
- reveal selected canonical source;
- reveal original raw source;
- focus selected geometry;
- persistent highlight after camera movement;
- selection summary.

Selection summary should include:

- line count;
- produced segment count;
- canonical source range;
- original source range where available;
- motion distribution;
- X/Y/Z bounds;
- minimum/maximum effective Z;
- feeds;
- warnings contained in selection.

Selection order normally follows current canonical source order.

---

## 12. Query-based selection

A high-value capability is selecting lines by semantic predicates.

Because the canonical motion blocks contain explicit motion values, many queries become straightforward and local.

Examples:

```text
motion is G0
motion is G1
Z < -12
feed > 800
line produces an arc
line changes Z relative to previous endpoint
line contains an unsupported command
line has a warning
segment intersects a spatial region
canonical line number is between A and B
original source line is between A and B
```

Query evaluation should use canonical parsed values and executed segment semantics rather than substring matching.

Example:

```text
Select all motions below Z = -10 mm
```

evaluates explicit canonical/semantic Z values, not raw source text.

Recommended model:

```text
SelectionQuery
  predicates[]
  combination: all | any
  scope: document | currentSelection
```

Initial UI may expose a small form rather than a free-form query language.

A future text query syntax is optional and must compile into the same typed predicate model.

---

## 13. Batch operations

Batch operations operate on the stable canonical selection.

Every operation should produce a previewable edit plan before mutation.

```text
NcEditPlan
  affectedLineIds[]
  firstAffectedIndex
  canonicalChanges[]
  semanticChanges[]
  expectedExecutionRange
  warnings[]
  blockers[]
```

The operator reviews the plan and applies it as one undoable transaction.

### 13.1 Batch numeric adjustment

Examples:

```text
add 5 to selected F values
replace selected Z values with -8
clamp feed to a maximum
round selected numeric values to 3 decimals
```

Because motion blocks are normalized, selected motion lines already contain explicit values.

No special modal-value propagation is required for ordinary numeric edits.

Execution still resumes from the earliest changed line so that segment start points and non-motion state remain correct.

### 13.2 Geometric translation

Desired operation:

```text
Translate selected toolpath by:
  dx
  dy
  dz
```

For canonical absolute motion lines, translation is primarily a local coordinate operation:

```text
X := X + dx
Y := Y + dy
Z := Z + dz
```

For arcs:

- translate the endpoint;
- translate the semantic absolute center by the same `dx/dy`;
- serialize canonical `I/J` from the translated semantic arc;
- keep radius and direction unchanged.

The transform implementation should operate on semantic motion records, not string replacement.

Recommended process:

1. Resolve selected canonical lines into semantic motions.
2. Build transformed motion records.
3. Generate canonical token changes.
4. Execute incrementally from the earliest changed line.
5. Verify that the resulting affected segments match the requested translation within tolerance.
6. Reject the operation if verification fails.

The canonical profile removes the need to support arbitrary `G91`, unit switches or plane switches in this operation.

### 13.3 Selection-boundary behavior

A selected section is still connected to unselected movements before and after it.

Translating the selected endpoints may create changed connector segments at the boundaries.

The edit preview must show:

- first changed incoming segment;
- transformed selected segments;
- first changed outgoing segment;
- any rapid/cutting transition introduced at the boundary.

The operator must see the actual resulting geometry, not only the selected lines in isolation.

### 13.4 Depth adjustment

Useful controlled operations include:

```text
add dz to selected Z
set selected Z to value
select Z below threshold and shift
```

Because every canonical motion line contains explicit `Z`, the operation is deterministic.

Separate operations should remain separate:

- shift selected Z values;
- set selected Z values;
- modify only plunge lines;
- modify only cutting motions;
- modify a contiguous machining block.

Do not hide these distinctions behind one ambiguous “change depth” command.

### 13.5 Feed adjustment

Examples:

```text
set selected feed
add to selected feed
multiply selected feed
clamp selected feed
```

Canonical motion lines contain explicit feed, so the effect is limited to selected lines unless the operator deliberately selects a larger range.

### 13.6 Deletion by rule

Examples:

```text
delete selected lines
delete all G0 moves outside work bounds
delete comments matching a pattern
```

Deletion must show the candidate geometry and incremental impact range before export.

---

## 14. Supported-dialect policy

The viewer may inspect more raw constructs than the canonical editor accepts.

Define separate capability levels:

```text
raw parsed
normalizable
canonical editable
rendered
safe for batch transform
exportable without blocker
```

Example:

```text
unknown machine command:
  raw preserved: yes
  normalizable: as opaque line only
  rendered: no
  token editable: limited
  geometric transform: no
```

The first production canonical profile should explicitly define the actual project subset, for example:

```text
comments
G0/G1/G2/G3
fixed XY plane
fixed millimetre units
fixed absolute coordinates
explicit X/Y/Z on every motion line
explicit feed on every motion line
one canonical arc representation
supported machine commands preserved explicitly
```

Runtime `G90/G91` switching is outside the canonical editable profile.

Machine-specific macros, variables, loops, subprograms and canned cycles must be rejected or preserved as blockers. They must not be transformed approximately.

---

## 15. Serialization

The editor exports the canonical working document.

This is intentionally different from preserving the exact raw CAM formatting.

### 15.1 Canonical serialization policy

For motion lines:

```text
fixed token order
explicit motion code
explicit X/Y/Z
explicit feed
canonical arc tokens
deterministic numeric formatting
```

For comments and supported opaque lines:

- preserve text where possible;
- retain relative source order;
- never silently remove an unsupported command.

### 15.2 Original source retention

The original input remains available as:

```text
original source
original hash
original filename
original/canonical mapping
```

The UI should allow:

- compare original and canonical;
- reset the session;
- download original;
- download canonical candidate.

### 15.3 Re-normalization

Re-normalization is not an automatic edit operation.

If the raw source is replaced, create a new canonical document/session or explicitly reset the working document.

Do not re-normalize an already edited canonical file behind the operator’s back.

---

## 16. Validation and diagnostics

Every canonical revision should produce diagnostics.

Suggested levels:

```text
error
blocking-warning
warning
info
```

### Errors

- malformed canonical numeric token;
- missing mandatory coordinate/feed token;
- impossible arc;
- non-finite coordinate;
- canonical line violates the project profile;
- line cannot be executed coherently.

### Import blockers

- raw file cannot be normalized deterministically;
- unsupported positioning/unit/plane behavior;
- unsupported macro or subprogram affects motion;
- arc form cannot be converted to the canonical representation;
- source contains ambiguous machine semantics.

### Batch-operation blockers

- selected line is opaque/non-transformable;
- selected arc cannot be serialized in the canonical machine dialect;
- transformed geometry verification fails;
- operation would generate a non-finite or invalid coordinate.

### Warnings

- bounds changed;
- minimum Z became deeper;
- rapid move now occurs below configured safe Z;
- feed exceeds configured limit;
- toolpath leaves configured work envelope;
- connector segment changed outside the explicit selection;
- candidate has fewer/more cutting segments;
- selected line has no rendered segment;
- incremental execution propagated farther than expected.

Diagnostics must retain `lineId` and, where relevant, `segmentId` and original-source location.

---

## 17. Diff and impact analysis

Before exporting an edited file, show more than a raw text diff.

Required comparisons:

```text
canonical source diff
original vs canonical normalization summary
segment count diff
G0/G1/G2/G3 count diff
bbox before/after
minimum and maximum Z before/after
feed range before/after
warning/error diff
incremental affected range
```

For geometric operations, overlay:

```text
previous candidate toolpath
new candidate toolpath
```

with distinct styles.

This is one of the main safety and usability advantages over editing NC in a generic text editor.

---

## 18. Undo, redo and revision history

All edits must be command-based and undoable.

Illustrative commands:

```text
UpdateToken
ReplaceCanonicalLineText
DeleteLines
InsertLines
ApplyBatchTokenEdit
ApplySemanticTranslation
ApplyDepthAdjustment
ApplyFeedAdjustment
```

Recommended state:

```text
NcEditorSession
  rawDocument
  canonicalDocument
  executionCache
  analysis
  selection
  undoStack
  redoStack
  savedRevision
```

Each command records:

```text
changed line IDs
earliest affected index
before/after canonical lines
before/after diagnostics summary
```

One batch operation is one undo unit.

Undo/redo restores:

- canonical document content;
- execution cache through the same incremental mechanism;
- selection where possible;
- preview;
- diagnostics.

The original uploaded file always remains available for reset or comparison.

---

## 19. Save and export policy

The browser editor should default to non-destructive output.

Primary actions:

```text
Download normalized candidate
Save candidate as new server artifact
Replace existing artifact
```

`Replace existing artifact` must not be the first implementation and must require integration with the owner service.

For local/manual files, downloading the normalized edited copy is sufficient.

For catalog or order artifacts:

- the owner backend controls storage paths and authorization;
- replacement must be an explicit application command;
- original artifact and revision/provenance should be retained;
- generated order artifacts should normally be immutable;
- a corrected production file should be stored as a new revision rather than silently overwriting the historical order result.

Suggested provenance:

```text
raw source hash
initial canonical hash
edited canonical hash
normalizer/parser version
edit timestamp
operator
edit operations summary
origin artifact reference
```

---

## 20. Integration with the Layment service

The NC editor is a separate specialized service, but it can become part of several production workflows.

### 20.1 Catalog artifact preparation

From the admin artifact preparation workbench:

```text
staged raw NC
  -> open in NC inspector/editor
  -> normalize
  -> review or correct canonical NC
  -> return candidate NC
  -> continue variant artifact validation/commit
```

The candidate must return through an explicit API or artifact reference. Do not rely on browser-local hidden state.

### 20.2 Order diagnostics

From an admin order page:

```text
open generated order NC in inspector
```

Useful for:

- diagnosing unexpected moves;
- checking source fragments;
- inspecting depth and feed;
- comparing generated revisions.

### 20.3 Production correction

A production operator may create a corrected NC revision.

This must be represented as:

```text
original generated artifact
  -> normalization/correction session
  -> reviewed canonical candidate
  -> new production revision
```

not as an invisible mutation of the original order file.

### 20.4 Generation regression debugging

The tool can compare two NC files semantically:

- canonicalized source;
- bounds;
- segment counts;
- motion type;
- line provenance;
- minimum Z;
- changed paths.

Normalization makes semantic comparison more useful because incidental modal omission and formatting differences are removed.

---

## 21. Architecture boundaries in the viewer repository

Recommended target modules:

```text
public/nc/
  import/
    tokenizeRawNc.js
    parseRawNcProgram.js
    executeRawNcProgram.js
    normalizeNcProgram.js
    ncProfile.js

  document/
    RawNcDocument.js
    CanonicalNcDocument.js
    ncCanonicalSerialization.js
    ncDocumentCommands.js
    ncHistory.js

  execution/
    executeCanonicalLine.js
    NcExecutionCache.js
    recalculateUntilConvergence.js
    ncExecutionTypes.js

  analysis/
    ncIndexes.js
    ncDiagnostics.js
    ncSelectionQueries.js
    ncDiff.js

  transforms/
    tokenTransforms.js
    geometricTranslation.js
    depthTransforms.js
    feedTransforms.js
    verifyTransformGeometry.js

  rendering/
    NcToolpathRenderer.js
    NcPicking.js
    ncColorStrategies.js

  ui/
    NcSourcePanel.js
    NcInspectorPanel.js
    NcSelectionPanel.js
    NcEditPanel.js
    NcNormalizationPanel.js

  NcWorkspace.js
```

Exact names may differ, but dependency direction should remain:

```text
raw import -> normalizer -> canonical document
canonical document -> execution cache -> analysis -> rendering

UI -> workspace commands/queries
rendering -> no document mutation
```

`NcPreview` should evolve into an orchestration/workspace boundary rather than absorb import, normalization, editing, selection, rendering and DOM responsibilities.

Do not introduce a frontend framework solely for this feature. The current native-module structure can support it.

---

## 22. Performance model

The performance model is based on cached prefix execution and convergence.

### 22.1 Import cost

Opening a file performs one complete pass:

```text
raw tokenize/parse
raw modal execution
canonical normalization
initial canonical execution cache
initial render
```

This is the only mandatory full-document parse/normalization pass.

### 22.2 Edit cost

A committed edit performs:

```text
tokenize changed lines
execute from first affected index
stop at convergence
replace affected segments
update diagnostics/indexes
update render data
```

For normalized motion lines, most edits should converge after one or two following executable lines.

### 22.3 Query and selection cost

Selection and hover use indexes and canonical values.

They must not repeatedly parse source text.

### 22.4 Rendering strategy

Start with the simplest renderer that satisfies interaction performance:

- semantic cache is updated incrementally;
- renderer may rebuild one combined buffer from cached segments.

If profiling shows that GPU buffer rebuild is material, introduce stable line-range chunks:

```text
chunk 0: canonical lines 0–511
chunk 1: canonical lines 512–1023
...
```

Then rebuild only affected chunks.

Do not introduce incremental parser complexity beyond the convergence cache described here.

### 22.5 Guardrails

Keep explicit limits for:

- maximum file bytes;
- maximum raw lines;
- maximum canonical lines after normalization;
- maximum generated segments/render points;
- maximum diagnostics;
- maximum batch-operation selection;
- cancellation/version token for stale asynchronous work.

---

## 23. Safety boundary

This tool improves inspection and controlled correction. It does not guarantee machine safety.

Before a corrected file is used in production, the workflow should support checks such as:

```text
canonical profile validity
work envelope
minimum/maximum Z
safe rapid Z
feed limits
unsupported/opaque commands
spindle/tool commands according to machine profile
arc validity
candidate/original diff review
```

Machine profiles may later provide configurable limits.

The UI must use precise language:

```text
normalized successfully
canonical document is valid
no configured blockers found
candidate differs from source
```

Avoid claims such as:

```text
safe to run
manufacturing verified
```

unless a separate authoritative validation system exists.

---

## 24. Recommended implementation sequence

### NC-E1 — Raw import and canonical normalization

- define the project NC profile;
- introduce immutable `RawNcDocument`;
- parse/execute the supported raw input;
- normalize motion lines to explicit absolute `G/X/Y/Z/F`;
- normalize arcs to one semantic representation;
- generate deterministic canonical text;
- preserve raw-to-canonical provenance;
- add golden normalization tests.

### NC-E2 — Canonical execution cache

- introduce stable `CanonicalNcLine` IDs;
- execute canonical lines independently of DOM/Three.js;
- cache input/output state and produced segments per line;
- implement recalculation from an arbitrary line;
- stop at semantic convergence;
- preserve current hover and reverse navigation behavior.

### NC-E3 — Single-line token editing

- structured inspector for canonical tokens;
- numeric token update;
- re-tokenize only changed line;
- incremental execution until convergence;
- diagnostics;
- dirty state;
- download normalized candidate;
- serializer regression tests.

### NC-E4 — Delete lines and history

- single/multiple line deletion;
- `Ctrl/Cmd` and `Shift` selection;
- undo/redo;
- affected-range and semantic diff summary;
- previous/new candidate overlay;
- explicit reset to initial canonical document.

### NC-E5 — Query-based selection

- typed predicates for motion, Z, feed, warnings and line ranges;
- query canonical or semantic values;
- apply query to document or current selection;
- selection summary and focus.

### NC-E6 — Batch numeric operations

- set/add/multiply/clamp canonical numeric values;
- feed and Z operations;
- edit-plan preview;
- one transaction per operation;
- incremental execution from earliest affected line.

### NC-E7 — Geometric translation

- transform canonical absolute `G0/G1` records;
- boundary connector preview;
- semantic geometry verification;
- golden tests.

### NC-E8 — Arc-aware transforms

- transform canonical `G2/G3` endpoints and semantic centers;
- deterministic `I/J` serialization;
- arc geometry verification;
- expanded golden corpus.

### NC-E9 — Server revisions and production integration

- open catalog/order artifact by reference;
- save normalized candidate revision;
- provenance and authorization;
- immutable original order artifact;
- integration with admin artifact preparation and order diagnostics.

### NC-E10 — Semantic compare

- normalize and compare two NC revisions;
- canonical source and geometry diffs;
- changed-path overlay;
- regression/debug workflow.

---

## 25. High-value first milestone

The first production-useful milestone consists of:

```text
raw import and canonical normalization
stable canonical line identity
incremental execution cache
structured numeric token edit
line deletion
multi-line source selection
undo/redo
candidate download
before/after diagnostics
```

This converts the viewer from a read-only diagnostic tool into a practical correction tool without requiring a universal G-code editor.

Query selection and geometric batch operations can then be added on top of the canonical document without replacing the underlying model.

---

## 26. Final invariants

Every visible candidate toolpath must be reproducible from the current serialized canonical NC document.

The immutable raw source must remain available for provenance and comparison.

Every imported file must be normalized deterministically before editing.

Every canonical motion line must explicitly contain the project-owned motion coordinates and parameters required for local editing.

After an edit, execution begins at the earliest affected line and stops only when the cached semantic state converges.

Every semantic batch operation must verify that the resulting executed geometry matches its intended transformation within tolerance or refuse the operation.

The tool remains lightweight because its machine profile and canonical dialect are constrained, not because NC semantics are treated as plain text.

---

## Repository implementation note — NC-E1 raw import and canonical normalization

Status: **NC-E1 implemented in Layment Viewer**. The next planned NC editor step is **NC-E2 Canonical execution cache**; editing commands, undo/redo, batch operations and incremental cache invalidation remain out of scope for NC-E1.

The viewer import boundary now materializes two distinct artifacts:

```text
RawNcDocument
  immutable original source text, filename, content hash, line-ending policy and raw lines

CanonicalNcDocument
  deterministic read-only working document with stable lineId values, raw provenance and canonical serialization
```

The active NC preview is built from the canonical serialized document after import. The original raw source remains attached to the workspace for provenance, reset/compare flows and future source-mode switching.

### Canonical NC profile used by NC-E1

The implemented profile is intentionally narrow and project-specific:

- units are normalized to millimetres;
- active plane is XY / `G17`;
- motion coordinates are normalized to absolute coordinates;
- each canonical motion line serializes an explicit `G0`, `G1`, `G2` or `G3`;
- each canonical motion line serializes explicit `X`, `Y`, `Z` and effective `F`;
- arcs are represented internally as motion direction plus explicit start point, end point and absolute XY center;
- serialized canonical arcs emit deterministic relative `I`/`J` offsets computed from the absolute center and start point;
- numeric output uses `.` as decimal separator, fixed maximum precision, trimmed trailing zeros, `-0` normalized to `0`, and a terminal LF newline.

### Normalized, preserved and rejected constructs

NC-E1 normalizes the subset already executed deterministically by the viewer parser:

- `G0`/`G1` linear moves;
- `G2`/`G3` XY arcs using supported `I`/`J` center offsets, absolute centers (`G90.1`) or supported `R` radius arcs;
- modal motion commands omitted on following coordinate lines;
- omitted `X`, `Y` and `Z` values, using the effective executed position;
- modal feed values;
- explicit `G20` inch units and `G91` incremental coordinates when the existing parser can deterministically convert them to absolute millimetres at import time.

NC-E1 preserves comments and safe opaque non-motion service lines such as supported `M` commands, tool/spindle/feed-only service state, without giving them editable semantic behavior.

NC-E1 rejects unsupported or ambiguous constructs with structured diagnostics rather than silently dropping them, including unsupported planes, unsupported unit/positioning semantics, unsupported motion-affecting commands, invalid arcs, non-finite numeric words and canonical invariant violations.

Future editing work must operate on `CanonicalNcDocument`, not on the immutable original source and not on rendered Three.js geometry.
