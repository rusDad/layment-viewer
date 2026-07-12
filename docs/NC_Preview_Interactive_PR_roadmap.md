# NC Preview Interactive Inspection — PR roadmap

## Scope

Добавить в debug NC preview:

1. hover по траектории;
2. click-selection сегмента;
3. вывод исходной строки NC и технологических параметров;
4. переход от траектории к строке NC;
5. обратный переход от строки NC к траектории;
6. цветовые режимы по motion/tool/depth/feed.

Не менять:

* backend;
* генерацию NC;
* manufacturing semantics;
* customer-facing SVG/STL preview;
* интерпретацию координат G-code.

---

## PR-NC1 — Source mapping в parser contract

### Цель

Сохранить устойчивую связь:

```text
исходная строка NC
    ↕
логический toolpath segment
    ↕
отрезки polyline, отрисованные в Three.js
```

### Расширить результат parser

Каждый логический сегмент должен содержать примерно такие данные:

```js
{
  id,
  motion,
  points,

  sourceLineIndex,
  sourceLineNumber,
  sourceText,

  start,
  end,

  feed,
  tool,
  spindle
}
```

Также `parseNcToToolpath()` должен вернуть исходный документ:

```js
{
  lines: [
    {
      index,
      number,
      text,
      segmentIds
    }
  ],
  segments: [...]
}
```

### Важные правила

* `sourceLineNumber` — пользовательская нумерация от `1`.
* `sourceLineIndex` — внутренний индекс от `0`.
* Строка с modal motion без явного `G1/G2/...` всё равно должна быть связана со своим движением.
* Строки без движения остаются в `lines`, но имеют пустой `segmentIds`.
* Одна команда `G2/G3` остаётся **одним логическим сегментом**, даже если дуга аппроксимирована десятками render-отрезков.
* `feed`, `tool` и `spindle` фиксируются как modal snapshot на момент выполнения команды.

### Тесты

Добавить parser-тесты для:

* `G0/G1`;
* modal motion;
* `G2/G3`;
* одной дуги → нескольких render-отрезков → одной source line;
* modal feed/tool/spindle;
* пустых, служебных и неподдерживаемых строк.

---

## PR-NC2 — Render segment index и picking infrastructure

### Цель

Сохранить batching по типам движения, но вернуть возможность определить, какой именно участок был выбран.

Сейчас позиции агрегируются в четыре общих массива `G0/G1/G2/G3`, после чего создаётся по одному `LineSegments` на motion. Это экономно, но требует параллельного render-index. 

### Добавить render mapping

Для каждой пары вершин хранить ссылку:

```js
{
  logicalSegmentId,
  sourceLineNumber,
  polylinePartIndex
}
```

Пример внутреннего результата:

```js
{
  object: THREE.LineSegments,
  renderSegmentRefs: [
    { segmentId: 14, partIndex: 0 },
    { segmentId: 14, partIndex: 1 },
    { segmentId: 15, partIndex: 0 }
  ]
}
```

### Picking

Добавить отдельный `NcPickingController`:

```text
pointer coordinates
    ↓
THREE.Raycaster
    ↓
LineSegments intersection
    ↓
renderSegmentRefs
    ↓
logical segmentId
```

### Ограничения

* Не создавать отдельный Three.js object на каждый короткий отрезок: на больших NC это даст слишком много объектов.
* Не хранить source text в `userData` каждого отрезка. Хранить только индексы/идентификаторы.
* Настроить `raycaster.params.Line.threshold`.
* Threshold вынести в одну константу и проверить на разных масштабах модели.

### Риск

`LineBasicMaterial.linewidth` в обычном WebGL практически не помогает увеличить clickable width. Picking должен опираться на `Raycaster` threshold, а не на визуальную толщину линии.

---

## PR-NC3 — Hover preview и inspector

### Цель

При наведении показывать информацию о команде без создания persistent selection.

### Состояние

Разделить:

```js
hoveredSegmentId
selectedSegmentId
```

Hover не должен сбрасывать выбранный ранее сегмент.

### Поведение

При наведении:

* определить логический segment;
* подсветить всю команду, а не только один аппроксимированный отрезок дуги;
* показать compact inspector:

```text
Line 428
G1 X34.2 Y18.7 Z-12.5 F900

Motion: G1
From: X... Y... Z...
To: X... Y... Z...
Feed: 900 mm/min
Tool: T3
Spindle: 12000
```

### Highlight

Не менять material общего `LineSegments`, поскольку он используется множеством сегментов.

Добавить отдельный overlay:

```text
base toolpath
hover highlight
selection highlight
```

Highlight строится только для текущего logical segment.

### Interaction rules

* во время OrbitControls drag hover временно отключается;
* при уходе курсора с canvas hover очищается;
* pointermove обрабатывается через `requestAnimationFrame`, а не запускает raycast на каждый DOM event.

---

## PR-NC4 — Persistent click-selection и NC source panel

### Цель

Клик по траектории фиксирует выбранную команду и показывает её в списке NC.

### Поведение

По клику:

* установить `selectedSegmentId`;
* сохранить highlight после ухода курсора;
* открыть/обновить source panel;
* прокрутить список к соответствующей строке;
* выделить строку;
* показать подробные metadata.

Пустой клик очищает selection.

### Важный interaction edge case

Не считать вращение камеры кликом по сегменту.

Нужно различать:

```text
pointerdown
pointer movement below threshold
pointerup
    → click

pointer movement above threshold
    → OrbitControls drag, selection не меняется
```

### Source panel

Не создавать DOM-элемент для каждой строки без ограничений. Текущий NC preview принимает файлы до 5 MB и ограничивает количество rendered points, поэтому исходный файл потенциально может содержать десятки тысяч строк. 

Рекомендуемый вариант:

* fixed-height rows;
* простая windowed rendering/virtualization;
* отображать видимую область плюс небольшой overscan;
* хранить исходные строки в массиве, а не в DOM.

---

## PR-NC5 — Reverse navigation: source line → toolpath

### Цель

Сделать связь двусторонней.

### Поведение

Клик по строке NC:

* получить связанные `segmentIds`;
* выбрать соответствующий logical segment;
* подсветить его в scene;
* показать metadata;
* при необходимости приблизить камеру к сегменту.

### Правила

* Строки без движения доступны в списке, но не selectable как geometry.
* Для строки без segment показать состояние `No rendered motion`.
* Если одна строка связана с несколькими render parts, выделяется вся команда.
* Автоматический camera-fit лучше сделать отдельной кнопкой `Focus`, а не выполнять при каждом клике: иначе навигация по коду будет постоянно дёргать камеру.

### Public API внутри NC-модуля

```js
selectSegment(segmentId)
selectSourceLine(lineNumber)
clearSelection()
focusSelectedSegment()
```

Scene и source panel должны вызывать один и тот же selection controller, а не синхронизировать друг друга напрямую.

---

## PR-NC6 — Color strategies и расширенные metadata

### Цель

Добавить переключаемые способы анализа toolpath.

### Режимы

```text
Motion
Tool
Depth
Feed
```

#### Motion

Текущий вариант:

* G0;
* G1;
* G2;
* G3.

#### Tool

* стабильный цвет на каждый `T`;
* отдельный цвет для unknown tool;
* legend со списком инструментов.

#### Depth

Для V1 использовать `segment.end.z`.

Показывать диапазон:

```text
Z min → Z max
```

Для plunge/helical движения tooltip дополнительно показывает:

```text
Z start → Z end
```

Не вводить gradient внутри одного сегмента в первой версии.

#### Feed

* цвет по нормализованному modal `F`;
* G0 показывать отдельным фиксированным цветом;
* одинаковый feed всегда получает одинаковый цвет в пределах загруженного файла;
* показать min/max и legend.

### Архитектура

```js
getSegmentColor(segment, context)
```

Стратегии не должны менять parser или scene lifecycle:

```text
motionColorStrategy
toolColorStrategy
depthColorStrategy
feedColorStrategy
```

Selection/hover highlight всегда рисуется поверх выбранной стратегии и не зависит от неё.

---

## PR-NC7 — Performance, cleanup и regression tests

### Цель

Зафиксировать функциональность и исключить накопление runtime-объектов.

### Проверить

* repeated file load;
* selection после повторной загрузки;
* disposal geometry/material highlight;
* удаление pointer listeners;
* source panel cleanup;
* OrbitControls interaction;
* большие линейные toolpaths;
* дуги с большим количеством аппроксимационных точек;
* сегменты, находящиеся близко друг к другу;
* пересекающиеся траектории на разных Z;
* camera zoom и стабильность picking.

### Acceptance scenarios

1. Hover по `G1` показывает правильную исходную строку.
2. Hover по части дуги `G2/G3` подсвечивает всю дугу и одну NC-команду.
3. Click фиксирует selection.
4. Click по исходной строке выделяет правильную траекторию.
5. Camera drag не вызывает случайный selection.
6. Смена color mode не сбрасывает selection.
7. Повторная загрузка NC не оставляет старых highlights или source lines.
8. Большой файл не создаёт десятки тысяч DOM nodes.
9. `npm test` продолжает запускать parser regression tests; текущий проект уже включает `nc-parser.test.mjs` в основной test script. 

# Целевая структура

```text
public/
  nc/
    NcPreview.js
    NcScene.js
    NcUi.js

    NcSelectionController.js
    NcPickingController.js
    NcSourcePanel.js
    NcColorStrategies.js

    nc-parser.mjs
```

Разделение ответственности:

```text
nc-parser
  source text → semantic toolpath + source mapping

NcScene
  toolpath → Three.js geometry + render index

NcPickingController
  pointer → segmentId

NcSelectionController
  hovered/selected state

NcSourcePanel
  source lines + reverse navigation

NcColorStrategies
  segment metadata → visual color

NcPreview
  orchestration
```

## Рекомендуемая очередь

```text
Viewer module split
    ↓
PR-NC1 source mapping
    ↓
PR-NC2 render index + raycast
    ↓
PR-NC3 hover inspector
    ↓
PR-NC4 click + source panel
    ↓
PR-NC5 reverse navigation
    ↓
PR-NC6 color modes
    ↓
PR-NC7 hardening
```

Главная граница здесь — **logical NC segment не должен совпадать с render segment**. Особенно это критично для `G2/G3`: одна строка NC создаёт polyline из множества отрезков, но для пользователя остаётся одной командой. Если зафиксировать это в PR-NC1, остальные возможности добавляются без повторной переработки parser/render contract.
