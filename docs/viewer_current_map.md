# Layment Viewer — текущая карта проекта

## Назначение

Краткий справочник по фактическому состоянию `layment-viewer`: структура, ответственность файлов, основные потоки и действующие контракты.

Viewer является вспомогательным presentation/diagnostics service. Он строит product preview и диагностирует NC, но не владеет заказами, pricing, каталогом, производственной генерацией или authoritative manufacturing validation.

---

## 1. Состав системы

```text
Node / Express
  server.js
    ├─ static public/
    ├─ SVG -> normalized geometry JSON       debug/legacy
    └─ STL upload/storage/download

Browser shared runtime
  public/core/*

Product PreviewScene
  public/app.js
    -> PreviewSceneViewer.js
       -> PreviewSceneModel.mjs
       -> polygon-clipping
       -> Three.js layered extrusion

SVG debug/legacy
  public/app.js -> SvgViewer.js -> /svg3d-api/upload-svg

STL
  public/stl/app.js -> /svg3d-api/upload-stl
  public/app.js?stl=<id> -> StlViewer.js -> /svg3d-api/stl/<id>

NC tools
  public/nc/app.js
    -> NcPreview.js
       -> import/*
       -> document/*
       -> execution/*
       -> scene/UI/picking/selection
```

Canonical product preview consumes prepared `PreviewSceneV1`; SVG classification is not its geometry source.

NC-подсистема разделена на четыре уровня:

```text
raw source
  -> canonical document
  -> execution cache
  -> analysis/render projection
```

Редактирование выполняется только над canonical document. После команды execution cache пересчитывается начиная с первой затронутой строки.

---

## 2. Runtime entrypoints

| URL | Entry point | Роль |
|---|---|---|
| `/` или `/svg3d/` | `public/index.html` → `public/app.js` | SVG debug tool |
| `/?payloadKey=<key>` | `public/app.js` → `PreviewSceneViewer.js` | канонический одноразовый `PreviewSceneV1` из `localStorage` |
| `/?debug=1&payloadKey=<key>` | `public/app.js` → `SvgViewer.js` | явный legacy SVG payload для диагностики |
| `/?stl=<id>` | `public/app.js` → `StlViewer.js` | preview сохранённого STL |
| `/?debug=1` | `public/app.js` | принудительный debug mode |
| `/stl/` | `public/stl/index.html` → `public/stl/app.js` | загрузка STL и получение ссылки |
| `/nc/` | `public/nc/index.html` → `public/nc/app.js` | локальный NC viewer/editor |

При прямом запуске `node server.js` сервер слушает порт `3000`.

---

## 3. Основные потоки

### Product PreviewSceneV1 → 3D

```text
Designer frontend
  -> POST /api/preview/scene
  -> strict PreviewSceneV1
  -> localStorage[payloadKey]
  -> opens Viewer ?payloadKey=<key>
  -> PreviewSceneViewer parses scene
  -> PreviewSceneModel builds multi-depth solid regions
  -> browser builds layered Three.js model
  -> removes localStorage key
```

`PreviewSceneV1` уже содержит размещённые contour rings, rectangle corners, circles, independent pocket depths, layment dimensions/material and texts in `origin-bottom-left` millimetres. Viewer не делает Geometry V3 lookup, не знает `variantId`/Fabric anchors и не переинтерпретирует manufacturing rotation.

Для каждого depth interval Viewer вычитает union всех pockets, глубина которых достигает нижней границы interval. Boolean topology, а не draw order, определяет overlap, nesting, holes и islands.

Контракт handoff same-origin и one-shot: после чтения ключ удаляется, поэтому refresh URL сам по себе preview не восстанавливает.

### SVG file → 3D — debug/legacy

```text
SVG file or explicit debug payload
  -> SvgViewer
  -> POST /svg3d-api/upload-svg
  -> server.js parses shapes/transforms/curves
  -> outer + holes + topRegions
  -> browser builds layered Three.js model
```

Server возвращает 2D geometry JSON, а не mesh. Этот pipeline остаётся диагностическим/legacy и не является source geometry canonical product preview.

### STL

```text
/stl/ upload
  -> POST /svg3d-api/upload-stl
  -> uploads/stl/<id>.stl
  -> URL ?stl=<id>

root viewer ?stl=<id>
  -> GET /svg3d-api/stl/<id>
  -> STLLoader
  -> split top/base triangles
  -> Three.js model
```

### NC

```text
browser File.text()
  -> RawNcDocument
  -> canonical normalization
  -> CanonicalNcDocument
  -> ExecutionCache
  -> ProgramAnalysis/toolpath
  -> NcScene
```

Edit flow:

```text
UI command
  -> CanonicalNcEditor
  -> candidate document, revision + 1
  -> incremental execution recalculation
  -> edit impact + history
  -> selection reconciliation
  -> redraw
```

NC-файл не отправляется на Node server.

---

## 4. Внешние контракты

### 4.1 Viewer query

```text
payloadKey: string   localStorage key для PreviewSceneV1; с debug=1 — legacy SVG payload
stl: string          server-side STL id
debug: "1"          принудительный debug mode
```

Route priority: `stl` → STL preview; затем `payloadKey` → product `PreviewSceneV1`, если `debug != 1`; explicit `debug=1&payloadKey=...` → legacy SVG renderer; иначе SVG debug tool.

Внутреннее имя route enum `SVG_PREVIEW` историческое; renderer selection в `public/app.js` является фактическим runtime boundary.

### 4.2 Product payload в localStorage — `PreviewSceneV1`

Canonical product payload определён в `docs/preview_scene_v1.md`.

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
  contours[] { ring, depthMm }
  rects[]    { corners, depthMm }
  circles[]  { center, radius, depthMm }

texts[]:
  text, x, y, angle, fontSizeMm
```

`PreviewSceneModel.mjs` строго отклоняет unknown/missing fields, неверные version/units/frame, non-finite или non-positive dimensions/depths/radii, malformed rings/corners и pocket depth больше толщины ложемента.

Product renderer не читает SVG из этого payload и не использует `/svg3d-api/upload-svg`.

Legacy SVG payload aliases (`svg`, `svgText`, `content`, nested payload/metadata wrappers и raw SVG string) остаются только за explicit debug path.

### 4.3 `POST /svg3d-api/upload-svg` — debug/legacy

Request:

```text
multipart/form-data
file: SVG
```

Success:

```text
{
  ok: true,
  errors: [],
  meta: { bbox, outerArea, holesCount },
  geometry: {
    outer: Point[],
    holes: Point[][],
    topRegions: Array<{ outer: Point[], holes: Point[][] }>,
    extrusion: { baseDepth: 35, pocketDepth: 20 }
  }
}
```

Failure: `HTTP 400`, `{ ok:false, errors:string[] }`.

Поддерживаются `path`, `polygon`, `rect`, `circle`, `ellipse` и nested transforms. Curves/arcs flatten примерно с шагом `0.5 mm`.

### 4.4 STL API

```text
POST /svg3d-api/upload-stl
multipart field: file
extension: .stl
limit: 20 MB
```

```text
success: { ok:true, id:string, url:"?stl=<id>" }
GET /svg3d-api/stl/<id> -> model/stl
error: { ok:false, errors:string[] }
```

### 4.5 Canonical NC profile

```text
units: mm
plane: XY
positioning: absolute
arc center: absolute XY internally
motions: G0/G1/G2/G3
numeric precision: 6
line ending: LF
terminal newline: yes
```

Motion serialization:

```text
Gx X... Y... Z... [I... J...] F...
```

Canonical output не является formatting-preserving round-trip исходного файла.

### 4.6 Основные NC models

```text
RawNcDocument
  original text/hash/line ending/raw lines/source mapping

CanonicalNcDocument
  revision/dirty/profile/canonical lines/diagnostics/raw provenance

Canonical line
  motion: motion/start/end/feed/arc/sourceOrigin
  comment|opaque: preserved text/sourceOrigin

ExecutionCache
  entries/segments/diagnostics/finalState
  line <-> segment indexes

ProgramAnalysis
  lines/segments/bbox/stats/warnings/feed range/render sampling
```

---

## 5. Карта файлов

## Root

### `.gitignore`

Исключает только `node_modules/`. Runtime `uploads/` не исключён.

### `.gitkeep`

Пустой placeholder без runtime-роли.

### `package.json`

Node package metadata, entrypoint `server.js`, команды `dev/start/test`, server-side зависимости. Standard `npm test` включает PreviewScene, routing, Shared UI и NC regression suites.

### `server.js`

Node/Express composition root и server-side SVG/STL pipeline.

Ответственность:

- static mounts `/` и `/svg3d`;
- SVG/STL endpoints;
- SVG XML/path/transform parsing;
- curve flattening;
- outer/hole classification;
- pocket union и `topRegions` для debug SVG path;
- STL filesystem storage;
- exports geometry helpers для tests.

`PreviewSceneV1` product geometry не проходит через server-side SVG parser.

Вход: multipart SVG/STL, `uploads/stl/`, optional `UNION_DEBUG=1`.

Выход: static files, geometry JSON, STL id/files.

Риск: HTTP, storage и SVG geometry algorithms находятся в одном крупном module.

---

## `public/` — root viewer

### `public/index.html`

DOM root PreviewScene/SVG/STL preview page. Содержит debug SVG upload panel, links на STL/NC tools, preview status и `#canvas-root`.

Подключает Three.js `0.185.0` через jsDelivr import map, browser `polygon-clipping` и `app.js`.

### `public/app.js`

Composition root root-page.

- разбирает query;
- выбирает `PreviewSceneViewer`, `SvgViewer` или `StlViewer`;
- обычный `payloadKey` направляет в `PreviewSceneViewer`;
- `debug=1&payloadKey=...` направляет legacy payload в `SvgViewer`;
- создаёт scene/ViewerBase;
- предоставляет status callbacks;
- владеет общей очисткой `state.modelGroup`.

### `public/routing.js`

Чистая query/route policy: `ViewerMode`, `ViewerRoute`, parsing `payloadKey/stl/debug`, STL preview URL builder.

Fetch и DOM не выполняет. Историческое route имя `SVG_PREVIEW` само по себе не определяет renderer; product/debug split выполняется composition root.

### `public/style.css`

Общие стили root, PreviewScene/SVG preview, STL page и NC tools. Бизнес-логики нет; зависит от HTML ids/classes и runtime mode classes.

---

## `public/core/`

### `public/core/SceneFactory.js`

Создаёт scene, camera, WebGL renderer, OrbitControls, lights, shadow plane и axes.

Preview profile: светлый фон, ACES tone mapping, shadows. Debug profile: тёмный фон, axes, без shadows.

### `public/core/ViewerBase.js`

Общий viewer lifecycle:

- resize;
- animation loop;
- controls update;
- camera fitting;
- shadow sizing;
- disposal.

Экспортирует `disposeMaterial()` с очисткой textures.

---

## `public/svg3d/`

### `public/svg3d/PreviewSceneModel.mjs`

Strict `PreviewSceneV1` parser и pure boolean-layer builder.

- проверяет exact DTO boundary, dimensions/depths/frame;
- tessellates circles только для boolean operations;
- нормализует contour/rect/circle footprints;
- собирает unique pocket depths;
- на каждом Z interval вычитает union всех active cuts из layment footprint;
- сохраняет polygon holes/islands из `polygon-clipping` topology.

Не зависит от Three.js, DOM, Geometry V3 или catalog identity.

### `public/svg3d/PreviewSceneViewer.js`

Canonical product PreviewScene renderer.

- читает one-shot scene JSON из `localStorage`;
- вызывает strict parser/layer builder;
- extrudes resulting multipolygons по depth intervals;
- разделяет top skin/base materials;
- рендерит texts в manufacturing bottom-left frame;
- добавляет model group в shared Three.js scene;
- удаляет payload после consumption.

### `public/svg3d/PreviewTextTransform.js`

Pure manufacturing-frame text transform. Сохраняет supplied left-baseline anchor при rotation и не использует legacy top-left SVG mapping.

### `public/svg3d/SvgViewer.js`

Browser controller SVG→3D для manual debug upload и explicit legacy payload.

- manual upload и upload SVG text;
- legacy payload aliases при `debug=1`;
- вызов SVG endpoint;
- visual settings normalization;
- построение top/pocket/base EVA layers из SVG-derived geometry;
- text overlays через CanvasTexture;
- resource cleanup.

Вход: debug SVG geometry response и legacy preview metadata.

Выход: Three.js `state.modelGroup`.

Legacy текстовый transport использует top-left `x/y`; перед Three.js placement Y преобразуется через высоту outer contour. Эти semantics не относятся к `PreviewSceneV1`.

---

## `public/stl/`

### `public/stl/index.html`

Standalone upload page: file input, status и generated preview link. WebGL scene не создаёт.

### `public/stl/app.js`

Тонкий DOM shell upload page: привязывает upload button, отображает ошибки/ID и собирает root URL `?stl=<id>`.

### `public/stl/StlViewer.js`

Содержит upload и rendering flows.

Upload mode вызывает `/upload-stl`. Preview mode загружает STL по id, парсит через `STLLoader`, разделяет triangles на top/base materials и добавляет модель в scene.

Вход: file или STL id.

Выход: upload URL либо Three.js model.

---

## `public/nc/` — composition и presentation

### `public/nc/index.html`

DOM contract NC Tools: file/dimensions, color/opacity, edit/history actions, source panel, query panel, hover inspector и WebGL root.

### `public/nc/app.js`

Composition root NC page. Собирает DOM references, создаёт shared scene и запускает `NcPreview`.

NC semantics здесь не живут.

### `public/nc/NcPreview.js`

Главный application/session coordinator.

Владеет active document, cache, analysis, initial state, filename, dimensions, selection, edit impact и history.

Оркестрирует import, build, edit, delete, query selection, undo/redo/reset, incremental recalc и NC download.

### `public/nc/NcUi.js`

DOM presenter/controller:

- status/settings/legend;
- source and hover inspectors;
- structured numeric editor;
- virtualized source list;
- selection query builder;
- history/dirty/impact UI;
- keyboard commands.

Вызывает callbacks из `NcPreview`; canonical document напрямую не мутирует.

### `public/nc/NcScene.js`

Three.js projection NC:

- translucent layment box;
- colored toolpath batch;
- hover/selection highlights;
- previous-geometry impact overlay;
- focus and cleanup.

Visual mapping:

```text
NC (x, y, z) -> Three.js (width - x, z, y)
```

X-flip является presentation policy, а не изменением NC document.

### `public/nc/NcRenderIndex.js`

Преобразует logical segments в flat `positions/colors` buffers и `renderSegmentRefs` для обратного mapping render part → segment/source line.

### `public/nc/NcColorStrategies.js`

Стратегии раскраски `motion/tool/depth/feed`, palettes, ranges и legend read model.

### `public/nc/NcPickingMath.js`

Чистая screen-space математика picking: point-to-segment distance, NDC conversion, clip checks, closest hit, click-vs-drag state.

Thresholds: pick `6 px`, drag `5 px`.

### `public/nc/NcPickingController.js`

Canvas interaction adapter:

- pointer listeners;
- screen projection render segments;
- RAF-coalesced hover;
- click selection;
- suppress click after camera drag;
- re-pick on controls change.

Выход: logical segment ids.

### `public/nc/NcSelectionController.js`

Selection state по canonical `lineId`.

Поддерживает single, Ctrl/Cmd toggle, Shift range, select all и reconciliation после edits.

State:

```text
orderedLineIds, anchorLineId, focusLineId, origin
```

### `public/nc/NcSelectionQuery.mjs`

Чистый query engine массового выбора lines.

Scopes: document/current selection.

Predicates: line kind, motion, Z, feed, diagnostic, canonical range, source range. Комбинация: `all/any`.

### `public/nc/nc-parser.mjs`

Низкоуровневый G-code parser/helpers:

- comments/words;
- modal G17/G20/G21/G90/G91/G90.1/G91.1;
- F/T/S;
- positions and inch→mm;
- G0/G1;
- G2/G3 через I/J или R;
- arc sampling;
- legacy direct `parseNcToToolpath()`.

Limits exposed to UI: file `5 MB`, legacy render points `200000`.

---

## `public/nc/document/`

### `RawNcDocument.mjs`

Immutable исходный snapshot: original text, line ending, numbered raw lines, deterministic FNV-1a hash и source document id.

Не является editable model.

### `CanonicalNcDocument.mjs`

Owner canonical profile, document factory, stable `lineId`, source mapping и deterministic serializer.

Не выполняет execution или commands.

### `CanonicalNcEditor.mjs`

Command layer:

- line edit read model;
- edit `x/y/z/feed`;
- arc-center X/Y;
- `expectedRevision` guard;
- delete lines;
- dirty calculation;
- incremental execution update;
- download filename policy.

Comment/opaque lines read-only для structured numeric editing.

### `NcEditHistory.mjs`

Transaction undo/redo stack, default limit `100`. Хранит before/after workspace snapshots и управляет past/future.

### `NcEditImpact.mjs`

Сравнивает execution before/after и формирует summary: recalculation range, changed segments, bbox/Z/feed/diagnostics delta и previous segments для overlay.

---

## `public/nc/import/`

### `canonical-normalizer.mjs`

Primary import boundary:

```text
text -> RawNcDocument -> parsed modal program
     -> explicit canonical lines
     -> CanonicalNcDocument
     -> execution cache + analysis
```

Materializes G0–G3 в absolute mm form, canonicalizes arcs, сохраняет comments/allowlisted opaque commands и блокирует неподдерживаемые motion-affecting команды.

Return:

```text
success: rawDocument, canonicalDocument, canonicalText, executionCache, toolpath
failure: rawDocument, diagnostics
```

---

## `public/nc/execution/`

### `NcCanonicalExecution.mjs`

Owner execution semantics/cache:

- state `{position, feed}`;
- line execution and validation;
- stable segments;
- arc checks;
- full execution;
- incremental recalculation and convergence;
- line↔segment indexes;
- semantic equality.

### `NcProgramAnalysis.mjs`

Строит UI/render read model из cache: lines, segments, bbox, stats, warnings, final state, feed range и sampled arc points.

---

## 6. Предпочтительные extension points

| Задача | Файл/слой |
|---|---|
| server route / upload | `server.js` |
| PreviewScene DTO / boolean layers | `PreviewSceneModel.mjs` |
| PreviewScene product rendering/text | `PreviewSceneViewer.js` / `PreviewTextTransform.js` |
| SVG debug parsing/boolean geometry | geometry functions в `server.js` |
| SVG debug model/material/text | `SvgViewer.js` |
| camera/light/runtime | `public/core/*` |
| query routing | `routing.js` + `public/app.js` composition |
| STL rendering | `StlViewer.js` |
| NC import rule | `canonical-normalizer.mjs` + parser helpers |
| canonical shape/serialization | `CanonicalNcDocument.mjs` |
| edit command | `CanonicalNcEditor.mjs` |
| execution/cache | `NcCanonicalExecution.mjs` |
| analysis/statistics | `NcProgramAnalysis.mjs` |
| session orchestration | `NcPreview.js` |
| NC rendering | `NcScene.js` / `NcRenderIndex.js` |
| NC DOM | `NcUi.js` / `nc/index.html` |
| picking | `NcPickingController.js` / `NcPickingMath.js` |
| selection | `NcSelectionController.js` / `NcSelectionQuery.mjs` |

Product PreviewScene geometry changes belong to the explicit scene parser/layer/renderer boundary, not the SVG server pipeline.

Document mutations не следует добавлять в `NcUi.js` или `NcScene.js`; они должны проходить через canonical editor и `NcPreview` orchestration.

---

## 7. Текущие риски

### Mixed server module

`server.js` объединяет transport, storage, SVG parser и polygon operations. Это главный structural hotspot для legacy/debug SVG and STL server work; canonical PreviewScene geometry does not depend on this parser.

### Main-thread NC import

Первичная normalization/execution происходит в browser main thread. Incremental cache ускоряет edits, но не initial import. Для крупных программ естественный следующий boundary — Web Worker.

### One-shot preview payload

`payloadKey` зависит от общей origin/localStorage и удаляется после чтения. Это не воспроизводимый artifact URL. Текущий contract допускает этот handoff до появления измеренной проблемы размера/жизненного цикла payload.

### STL storage lifecycle

Cleanup/TTL/quota/index для `uploads/stl/` отсутствуют.

### Upload limits

STL ограничен 20 MB; SVG memory upload не имеет явно заданного multer limit.

### CDN dependency

Three.js runtime загружается с jsDelivr; offline/self-contained запуск не гарантирован.

### Repository housekeeping

`uploads/` отсутствует в `.gitignore`.

### Coordinate transforms

PreviewScene product input уже находится в declared `origin-bottom-left` frame и не должен получать legacy SVG transforms. NC X-flip и SVG/Three.js axis transformations относятся только к соответствующей presentation path; их нельзя автоматически переносить в backend/CAM semantics.

---

## 8. Ownership summary

```text
server.js
  HTTP/static, debug SVG preprocessing response, STL storage

routing/app/core
  viewer mode, renderer selection, lifecycle, common Three.js environment

PreviewSceneModel / PreviewSceneViewer
  canonical product-preview presentation geometry

SvgViewer / StlViewer
  explicit legacy/debug SVG and STL presentation

NC document/import/execution
  NC semantics inside viewer

NcPreview
  NC editor session orchestration

NcUi / NcScene / picking
  presentation and interaction
```

Viewer может сформировать normalized/edited NC candidate, но такой файл должен пройти отдельную production-authoritative проверку до использования на станке.

---

## 9. Update policy

Обновлять карту при изменении entrypoints, endpoints, payload shape, PreviewScene contract, canonical NC profile, coordinate mapping, module ownership или состава runtime-файлов. Документ должен описывать текущее состояние, а не историю PR.
