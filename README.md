# Layment Viewer MVP

MVP веб-сервис: загружает SVG, валидирует контуры (1 внешний + внутренние карманы), объединяет пересекающиеся внутренние карманы в 2D и строит 2.5D модель в браузере через three.js.

## Ограничения MVP

- Единицы: `1 SVG unit = 1 mm`.
- Если есть `viewBox`, координаты нормализуются как `x - viewBox.minX`, `y - viewBox.minY`.
- Трансформации `transform` поддерживаются для `matrix(a b c d e f)` и `translate(x[, y])` с наследованием по дереву (`<g>` -> дочерние элементы).
- Неподдерживаемые трансформации (`rotate/scale/skew/...`) игнорируются с WARN в логах сервера.
- Проверка самопересечений базовая (отрезок-отрезок).
- Источники геометрии: `path`, `polygon`, `rect`, `circle`, `ellipse`.
- Кривые в `path` (`C/Q/A`) аппроксимируются полилинией с шагом ~0.5 мм.

## Глубины

- База: 35 мм вниз.
- Карманы: 20 мм вниз от верхней плоскости.

Реализация без CSG: сначала сервер выполняет planar union внутренних карманов в 2D, затем объединяются 2 экструзии:
1. Верхний слой `outer - holes` на 20 мм.
2. Нижний слой `outer` на 15 мм (35-20), смещён вниз.

## Структура

```text
.
├── package.json
├── README.md
├── server.js
└── public
    ├── app.js
    └── index.html
```

## Запуск

```bash
npm i
npm run dev
```

Открыть: `http://localhost:3000`

## API

`POST /svg3d-api/upload-svg` (multipart/form-data, поле `file`)

Ответ:

```json
{
  "ok": true,
  "errors": [],
  "meta": {
    "bbox": { "minX": 0, "minY": 0, "maxX": 100, "maxY": 80 },
    "outerArea": 8000,
    "holesCount": 1
  },
  "geometry": {
    "outer": [{"x":0,"y":0}],
    "holes": [[{"x":10,"y":10}]],
    "extrusion": { "baseDepth": 35, "pocketDepth": 20 }
  }
}
```

## Тестовые SVG (минимальные)

### 1) Outer прямоугольник + один hole (circle)

```svg
<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 0 L120 0 L120 80 L0 80 Z"/>
  <circle cx="60" cy="40" r="15"/>
</svg>
```

### 2) Outer + несколько holes

```svg
<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 0 L160 0 L160 100 L0 100 Z"/>
  <rect x="15" y="15" width="35" height="25"/>
  <rect x="60" y="20" width="30" height="50"/>
  <ellipse cx="125" cy="50" rx="18" ry="22"/>
</svg>
```

### 3) Невалидный (незамкнутый)

```svg
<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 0 L100 0 L100 50 L0 50"/>
</svg>
```




## Режимы viewer

- `http://localhost:3000/svg3d/` — **debug mode** (ручной upload SVG + техническая мета-информация).
- `http://localhost:3000/svg3d/?payloadKey=...` — **preview mode** (чистый customer-facing 3D preview без debug-панели).
- `debug=1` можно использовать для принудительного debug mode даже при наличии `payloadKey`.


## NC/G-code debug preview

В debug mode (`/svg3d/`) доступен дополнительный блок **NC toolpath preview**. Он работает полностью в браузере и не добавляет backend API: можно загрузить `.nc`/`.gcode` файл, задать габариты ложемента (`width`, `height`, `thickness` в мм), построить полупрозрачный box и увидеть toolpath поверх/внутри него. Цвета движений `G0`/`G1`/`G2`/`G3` и opacity box меняются через UI без повторной загрузки файла.

Поддерживаемый минимальный scope парсера:

- движения `G0`/`G00`, `G1`/`G01`, `G2`/`G02`, `G3`/`G03`;
- modal state: `G90`, `G91`, `G20`, `G21`, `G17`, `G90.1`, `G91.1`;
- modal motion: строки с координатами без G-кода используют предыдущее активное движение;
- дуги `G2`/`G3` поддержаны в плоскости `G17` через `I/J` и аппроксимируются polyline;
- `R`-arcs, неизвестные команды и некорректные строки не роняют viewer, а пропускаются/попадают в warnings;
- координаты считаются в mm, `G20` конвертирует inch → mm, если units не заданы — используется mm;
- защитные лимиты: файл до 5 MB и до 100000 rendered points.

Это не CAM-симулятор и не источник manufacturing semantics — только debug-визуализация backend-generated NC для быстрой проверки траекторий. Preview/customer-facing режимы (`/svg3d/?payloadKey=...`, `/svg3d/?stl=...`) не показывают NC controls.

## Autoload из localStorage (designer → viewer)

Viewer поддерживает автозагрузку SVG через query-параметр `payloadKey`:

1. Вкладка/скрипт designer кладёт payload в `localStorage`:

```js
localStorage.setItem('demo-payload', JSON.stringify({ svg: '<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L120 0 L120 80 L0 80 Z"/></svg>' }));
```

2. Открывается viewer:

```text
http://localhost:3000/svg3d/?payloadKey=demo-payload
```

3. Viewer автоматически:
   - читает payload из `localStorage`;
   - извлекает SVG (`svg` / `svgText` / строковый payload);
   - отправляет его на существующий `POST /svg3d-api/upload-svg` как `multipart/form-data` (поле `file`);
   - строит 3D-модель и удаляет использованный payload из `localStorage`.

## How to verify transforms

1. Запустить сервер:

```bash
npm run dev
```

2. Отправить SVG с `matrix + translate`:

```bash
curl -s -F file=@fixtures/sample.svg http://localhost:3000/svg3d-api/upload-svg | jq
```

3. Открыть UI `http://localhost:3000/svg3d/` и загрузить `fixtures/sample.svg`.
   Внутренние карманы должны совпадать с исходным SVG без смещений.

## Проверка overlap-case (регрессия)

Добавлен fixture `fixtures/overlap-pockets.svg`: внешний прямоугольник + 2 пересекающихся внутренних кармана (`rect` + `circle`).

Запуск проверки:

```bash
npm test
```

Ожидаемо: тест подтверждает, что сервер возвращает один merged hole-loop вместо двух пересекающихся.
