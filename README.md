# Layment Viewer MVP

MVP веб-сервис: загружает SVG, валидирует контуры (1 внешний + внутренние карманы), строит 2.5D модель и показывает её в браузере через three.js.

## Ограничения MVP

- Единицы: `1 SVG unit = 1 mm`.
- Если есть `viewBox`, координаты нормализуются как `x - viewBox.minX`, `y - viewBox.minY`.
- Трансформации `transform` сейчас **не поддерживаются**.
- Проверка самопересечений базовая (отрезок-отрезок).
- Источники геометрии: `path`, `polygon`, `rect`, `circle`, `ellipse`.
- Кривые в `path` (`C/Q/A`) аппроксимируются полилинией с шагом ~0.5 мм.

## Глубины

- База: 35 мм вниз.
- Карманы: 20 мм вниз от верхней плоскости.

Реализация без CSG: объединяются 2 экструзии:
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

`POST /api/upload-svg` (multipart/form-data, поле `file`)

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
