# Layment Viewer

Вспомогательный web-сервис для 3D-предпросмотра ложементов и отладки производственных файлов.

Viewer поддерживает четыре независимых сценария:

1. canonical product preview из backend-prepared `PreviewSceneV1`;
2. SVG → 3D как explicit debug/legacy workflow;
3. загрузку, сохранение и просмотр STL-модели по уникальной ссылке;
4. debug-визуализацию и browser editing траектории `.nc` поверх габаритного объёма ложемента.

Viewer не является источником истины для производственной геометрии, G-code или заказа. Его назначение — визуальная проверка, демонстрация и диагностика.

## Возможности

### PreviewSceneV1 → product 3D preview

Layment Designer подготавливает geometry-based `PreviewSceneV1` через общий manufacturing-scene boundary и передаёт его Viewer через one-shot same-origin `localStorage` payload.

Viewer:

- строго валидирует version/units/coordinate system и DTO shape;
- принимает уже размещённые contour rings, rectangle corners и circles;
- поддерживает независимую глубину каждого pocket;
- строит multi-depth boolean layers через `polygon-clipping`;
- корректно обрабатывает overlap, nesting, holes/islands и identical-depth union;
- строит Three.js extrusion meshes и отображает materials/texts;
- не загружает Geometry V3 и не знает `variantId`, Fabric anchors или manufacturing rotations.

Product preview не реконструирует geometry из SVG и не использует один global pocket depth.

Полный DTO описан в `docs/preview_scene_v1.md`.

### SVG → 3D — debug/legacy

SVG pipeline сохранён как отдельный диагностический инструмент. SVG передаётся на backend endpoint, где:

- разбираются поддерживаемые SVG-примитивы и `path`;
- применяются SVG transforms;
- определяется внешний контур ложемента;
- внутренние контуры классифицируются как карманы;
- пересекающиеся карманы объединяются;
- вычисляются верхние области с учётом вложенных островков;
- формируется нормализованная geometry-модель для Three.js.

Frontend строит многослойную модель ложемента через `ExtrudeGeometry`, применяет материалы, освещение, тени и автоматически позиционирует камеру.

SVG можно открыть:

- вручную через debug UI;
- через explicit legacy `?debug=1&payloadKey=...` payload.

Этот pipeline не является canonical product-preview geometry path.

### STL upload и preview

Debug UI позволяет загрузить `.stl` размером до 20 MB.

Backend:

- проверяет расширение и непустое содержимое;
- генерирует уникальный идентификатор;
- сохраняет исходный STL без геометрических преобразований;
- возвращает ссылку вида `?stl=<id>`.

Viewer загружает STL по идентификатору, строит normals и разделяет геометрию на базовую и верхнюю поверхности для раздельного отображения материалов.

Ссылка работает, пока соответствующий файл существует в `uploads/stl/`.

Текущее файловое хранилище является локальным runtime storage. В сервисе пока нет:

- retention/cleanup policy;
- авторизации доступа к STL;
- квот по общему объёму;
- metadata database;
- deduplication;
- гарантии долгосрочного хранения.

### NC toolpath preview

NC preview работает локально в браузере и предназначен только для диагностики.

Пользователь передаёт:

- `.nc`, `.gcode` или `.tap`;
- ширину ложемента;
- высоту ложемента;
- толщину ложемента.

Viewer:

- разбирает поддерживаемые движения G0/G1/G2/G3;
- строит линии траектории по типам движения;
- отображает их поверх полупрозрачного габаритного box;
- показывает статистику, source/selection/edit diagnostics;
- поддерживает canonical browser editing и normalized NC download;
- позволяет менять presentation settings без изменения manufacturing authority.

NC preview/editor не выполняет production-authoritative CAM validation и не подтверждает безопасность или корректность управляющей программы для станка.

## Режимы UI

### Debug mode

Открывается без preview query-параметров:

```text
http://localhost:3000/
```

или принудительно:

```text
http://localhost:3000/?debug=1
```

В debug mode доступны SVG tooling, ссылки на STL/NC tools, диагностическая информация, axes helper и debug-style сцена.

### Preview mode: PreviewSceneV1

```text
http://localhost:3000/?payloadKey=<localStorage-key>
```

Viewer читает строгий geometry-based `PreviewSceneV1` из `localStorage`, строит независимые по глубине карманы и затем удаляет использованный ключ. Геометрия задаётся в миллиметрах в системе `origin-bottom-left`; SVG в product preview не используется.

Legacy SVG payload можно открыть только явно в debug-режиме:

```text
http://localhost:3000/?debug=1&payloadKey=<localStorage-key>
```

Legacy JSON payload имеет основные поля:

```json
{
  "svg": "<svg>...</svg>",
  "baseMaterialColor": "green",
  "laymentThicknessMm": 35,
  "texts": []
}
```

Вместо `svg` также принимаются совместимые поля `svgText`, `content`, `payload.svg` и `payload.svgText`.

### Preview mode: STL

```text
http://localhost:3000/?stl=<id>
```

Viewer запрашивает сохранённый STL у backend и открывает customer-facing preview UI без debug-панели.

## HTTP API

Canonical `PreviewSceneV1` product preview не требует Viewer HTTP geometry endpoint: scene обрабатывается в browser runtime.

### POST `/svg3d-api/upload-svg`

Debug/legacy endpoint. Принимает `multipart/form-data`:

```text
file=<svg file>
```

Возвращает нормализованную geometry-модель и metadata для SVG debug renderer.

Пример:

```bash
curl -F file=@sample.svg http://localhost:3000/svg3d-api/upload-svg
```

### POST `/svg3d-api/upload-stl`

Принимает `multipart/form-data`:

```text
file=<stl file>
```

Ограничения:

- только `.stl`;
- файл не должен быть пустым;
- максимальный размер — 20 MB.

Успешный ответ:

```json
{
  "ok": true,
  "id": "<generated-id>",
  "url": "?stl=<generated-id>"
}
```

### GET `/svg3d-api/stl/:id`

Возвращает ранее сохранённый STL.

Допустимый `id` содержит только латинские буквы, цифры, `_` и `-`.

## Локальный запуск

Требования:

- Node.js;
- npm;
- современный браузер с WebGL 2.

Установка:

```bash
npm install
```

Запуск:

```bash
npm run dev
```

Сервис откроется на:

```text
http://localhost:3000
```

Также статика доступна под `/svg3d/`.

## Тесты

```bash
npm test
```

Текущий test suite проверяет в том числе:

- strict `PreviewSceneV1` parsing;
- multi-depth topology, overlap/nesting, asymmetric orientation и text anchoring;
- объединение пересекающихся SVG-карманов;
- построение top regions и вложенных островков;
- routing product/debug preview modes;
- NC parser/canonical/execution/editor regressions.

Изменение PreviewScene boolean semantics, SVG classification/polygon union или NC parsing должно сопровождаться focused regression coverage.

## Структура

```text
public/
  app.js                         root composition / renderer selection
  routing.js
  core/                          shared Three.js lifecycle
  svg3d/
    PreviewSceneModel.mjs        strict DTO + multi-depth boolean layers
    PreviewSceneViewer.js        canonical product renderer
    PreviewTextTransform.js
    SvgViewer.js                 debug/legacy SVG renderer
  stl/                           STL upload/preview
  nc/                            NC browser viewer/editor
  index.html
  style.css

test/
  preview-scene.test.mjs
  routing.test.mjs
  overlap-union.test.js
  top-regions.test.js
  nc-*.test.mjs

fixtures/preview-scene/           deterministic PreviewScene fixtures
uploads/stl/                      runtime STL storage; создаётся автоматически

server.js                         Express/static, SVG debug processing, STL persistence
package.json
README.md
AGENTS.md
```

## Three.js

Three.js и addons должны использовать одну и ту же зафиксированную revision.

Текущая целевая revision:

```text
three@0.185.0 / r185
```

Не использовать плавающий `latest`. Обновление Three.js выполнять единым набором:

- core;
- `OrbitControls`;
- `STLLoader`;
- `BufferGeometryUtils`;
- другие используемые addons.

После обновления вручную проверить PreviewScene product preview, SVG debug preview, STL и NC preview, camera fit, mouse controls, материалы, освещение и тени.

## Ограничения и статус

Viewer остаётся вспомогательным сервисом проекта Layment Designer.

Он не должен:

- заменять backend manufacturing validation;
- интерпретировать preview как доказательство корректности G-code;
- становиться владельцем order semantics;
- загружать/переинтерпретировать Geometry V3 ради product preview;
- менять исходные STL или NC данные ради визуального удобства;
- вводить скрытые unit conversion или геометрический scale.

Текущий product handoff через `localStorage[payloadKey]` one-shot и same-origin. Его можно заменить только при конкретной необходимости, сохранив `PreviewSceneV1` как контракт.

## Standalone Shared UI distribution

NC Tools загружает зафиксированную Shared UI distribution из `public/ui/`. Эти assets входят в Viewer, поэтому обычные `npm install` и `npm run dev` не требуют запущенного Layment Designer, соседнего checkout или сетевого CSS runtime. Файлы `public/ui/*.css` — generated vendor artifacts; их канонический редактируемый источник находится в `rusDad/layment-designer/frontend/public/ui`.

Для обновления из локального checkout Designer сначала переключите его на требуемый immutable commit, затем выполните:

```bash
npm run shared-ui:sync -- --source ../layment-designer
npm run shared-ui:verify
npm test
```

Sync записывает точные CSS bytes и детерминированный `public/ui/source.json` с source commit, SHA-256 и размером каждого файла. Не редактируйте bundled CSS вручную. Обновление меняет pinned commit вместе с bundle и provenance; rollback выполняется обычным revert или повторной синхронизацией предыдущего pinned commit.
