# Viewer Refactoring Roadmap

## Goal

Split the viewer into independent modules while keeping the project
simple. Each PR must leave the project fully functional and avoid mixing
architectural changes with feature work.

------------------------------------------------------------------------

## PR1 --- Extract viewer modules

### Goal

Separate the existing functionality by responsibility without changing
behavior.

### Tasks

-   Create top-level modules:
    -   `svg3d/`
    -   `stl/`
    -   `nc/`
-   Move the corresponding code out of `app.js`.
-   Reduce `app.js` to application bootstrap/orchestration only.
-   No UI, API or functional changes.

------------------------------------------------------------------------

## PR2 --- Split NC preview responsibilities

### Goal

Refactor the NC preview into internal components.

### Suggested structure

``` text
nc/
    NcPreview.js
    NcScene.js
    NcUi.js
    nc-parser.mjs
```

### Tasks

-   Separate orchestration, scene rendering and UI.
-   Keep the parser independent from the rendering layer.
-   Preserve existing behavior.

------------------------------------------------------------------------

## PR3 --- Extract shared Three.js infrastructure

### Goal

Remove duplicated Three.js setup.

### Suggested structure

``` text
core/
    ViewerBase.js
    SceneFactory.js
```

### Tasks

-   Move common renderer setup.
-   Move camera and lighting initialization.
-   Move OrbitControls setup.
-   Move resize handling.
-   Move animation loop.
-   Keep viewer-specific rendering inside each module.

------------------------------------------------------------------------

## PR4 --- Normalize viewer lifecycle

### Goal

Give every viewer the same public lifecycle.

Example:

``` text
constructor(...)
init()
dispose()
```

### Tasks

-   Unify initialization.
-   Unify cleanup.
-   Keep `app.js` responsible only for selecting and starting viewers.

------------------------------------------------------------------------

# Target structure

``` text
public/
    app.js

    core/
        ViewerBase.js
        SceneFactory.js

    svg3d/
        SvgViewer.js

    stl/
        StlViewer.js

    nc/
        NcPreview.js
        NcScene.js
        NcUi.js
        nc-parser.mjs
```

## Notes

-   Keep the architecture intentionally lightweight.
-   Avoid unnecessary abstractions, dependency injection or event buses.
-   Each viewer owns only its own rendering logic.
-   Shared infrastructure belongs in `core/`.
