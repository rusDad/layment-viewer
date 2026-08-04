# Layment Viewer

Вспомогательный web-сервис для 3D-предпросмотра ложементов и отладки производственных файлов.

Viewer поддерживает три независимых сценария:

1. построение 3D-модели ложемента из SVG;
2. загрузку, сохранение и просмотр STL-модели по уникальной ссылке;
3. debug-визуализацию траектории `.nc` поверх габаритного объёма ложемента.

Viewer не является источником истины для производственной геометрии, G-code или заказа. Его назначение — визуальная проверка, демонстрация и диагностика.

## Возможности

### SVG → 3D

SVG передаётся на backend endpoint, где:

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
- через интеграционный `localStorage` payload и query-параметр `payloadKey`.

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
- показывает статистику сегментов, bounding box, modal state и warnings;
- позволяет менять цвета G0/G1/G2/G3 и прозрачность box.

NC preview не выполняет CAM-валидацию и не подтверждает безопасность или корректность управляющей программы для станка.

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

В debug mode доступны:

- SVG upload;
- STL upload;
- NC preview;
- диагностическая информация;
- axes helper и debug-style сцена.

### Preview mode: SVG payload

```text
http://localhost:3000/?payloadKey=<localStorage-key>
```

Viewer читает payload из `localStorage`, строит SVG preview и затем удаляет использованный ключ.

Поддерживается raw SVG string или JSON payload. Основные поля:

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

### POST `/svg3d-api/upload-svg`

Принимает `multipart/form-data`:

```text
file=<svg file>
```

Возвращает нормализованную geometry-модель и metadata для построения 3D preview.

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

Текущий test suite должен проверять как минимум:

- объединение пересекающихся SVG-карманов;
- построение top regions и вложенных островков;
- NC parser и его modal/geometry cases.

Любое изменение SVG classification, polygon union, top-region logic или NC parsing должно сопровождаться regression test.

## Структура

```text
public/
  app.js              Three.js scene, UI modes, SVG/STL/NC rendering
  nc-parser.mjs       pure NC parsing and toolpath model
  index.html
  style.css

test/
  overlap-union.test.js
  top-regions.test.js
  nc-parser.test.mjs

uploads/
  stl/                runtime STL storage; создаётся автоматически

server.js             Express API, SVG geometry processing, STL persistence
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

После обновления вручную проверить SVG, STL и NC preview, camera fit, mouse controls, материалы, освещение и тени.

## Ограничения и статус

Viewer остаётся вспомогательным сервисом проекта Layment Designer.

Он не должен:

- заменять backend manufacturing validation;
- интерпретировать preview как доказательство корректности G-code;
- становиться владельцем order semantics;
- менять исходные STL или NC данные ради визуального удобства;
- вводить скрытые unit conversion или геометрический scale.

## Standalone Shared UI distribution

NC Tools загружает зафиксированную Shared UI distribution из `public/ui/`. Эти assets входят в Viewer, поэтому обычные `npm install` и `npm run dev` не требуют запущенного Layment Designer, соседнего checkout или сетевого CSS runtime. Файлы `public/ui/*.css` — generated vendor artifacts; их канонический редактируемый источник находится в `rusDad/layment-designer/frontend/public/ui`.

Для обновления из локального checkout Designer сначала переключите его на требуемый immutable commit, затем выполните:

```bash
npm run shared-ui:sync -- --source ../layment-designer
npm run shared-ui:verify
npm test
```

Sync записывает точные CSS bytes и детерминированный `public/ui/source.json` с source commit, SHA-256 и размером каждого файла. Не редактируйте bundled CSS вручную. Обновление меняет pinned commit вместе с bundle и provenance; rollback выполняется обычным revert или повторной синхронизацией предыдущего pinned commit.
