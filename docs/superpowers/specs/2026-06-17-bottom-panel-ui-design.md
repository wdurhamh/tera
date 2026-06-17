# Bottom Panel UI Redesign

**Date:** 2026-06-17
**Branch:** `ui-bottom-panel`
**Scope:** Frontend only (`webapp/static/index.html`, `webapp/static/app.js`). No backend/API changes.

## Goal

Replace the per-lake Leaflet popup (water info + observations table) with a docked
**bottom panel** that doubles as a browsable **results list** and a **detail view**.
Add usability improvements: collapsible panels, hover/click map↔list sync,
clear loading/empty states, and cleaner styling.

## Existing API (unchanged, reused as-is)

- `GET /api/lakes/count` → `{count}` (species, min_length, bbox params)
- `GET /api/lakes` → GeoJSON FeatureCollection of water bodies
- `GET /api/lakes/<id>/observations` → `[{date_string, species, count, length_max,
  length_avg, length_min, type, source, notes, id}]`
- `POST /api/lakes/<id>/new_observation`
- `GET /api/observations/<id>/remove`
- `POST /api/lakes/new_water`
- `GET /api/trails` → GeoJSON of trails

Water body properties include: `id`, `name`, `elevation`, `area`.

## Layout

- **Map** fills the viewport.
- **Filter card** (top-left): species input, min-length input, Apply, Reset.
  Wrapped in a collapsible card with a toggle (addresses `todo.txt`:
  "make filter box hideable").
- **Bottom panel**: docked across the bottom of the map, above map controls,
  with a chevron to collapse/expand. Has two mutually exclusive modes:
  - **List mode (default):** header ("N waters in view" / status) + a scrollable
    vertical list. Each row shows lake name, elevation, area. Rows are clickable
    and highlight the corresponding map feature on hover.
  - **Detail mode:** a "← Back" control returns to the list. Shows the water's
    name, elevation, area, a "Go to Weather" link, and the full observations table
    (add / edit / remove) — identical functionality to the former popup.

## Behavior / Data Flow

1. On `moveend` / Apply / Reset: fetch `/api/lakes/count`, then:
   - `count == 0` → clear markers, show empty message in panel list.
   - `count <= 100` → fetch `/api/lakes`, draw markers, populate the list.
   - `count > 100` → clear markers, show "zoom in / tighten filters" message;
     list shows the same guidance.
2. Clicking a **list row** or a **map feature** → switch panel to detail mode for
   that lake, fetch its observations, pan/zoom the map to it, and highlight its marker.
3. Hovering a list row → highlight its marker; mouse-out resets it (bidirectional sync).
4. Lake **popups are removed**; their content now lives in the panel.
5. **Trails keep their existing popups** (out of scope for this pass).

## Usability Improvements

- Collapsible filter card and bottom panel.
- Hover/click selection sync between list and map.
- Loading spinner / empty / zoom-in states surfaced in the panel.
- Cleaner, consistent styling: spacing, readable observations table, responsive widths.

## Components (in `app.js`)

- **Panel controller**: `showList()`, `showDetail(props)`, `setPanelStatus(msg)`,
  `togglePanel()`. Owns the two-mode DOM and the current selection.
- **List renderer**: builds rows from the loaded features; wires click + hover.
- **Detail renderer**: relocates `bowPopupContent` / `observationTableContent` logic
  into the panel; reused add/edit/remove handlers retarget the panel instead of a popup.
- **Map sync**: `highlightLake(id)`, `focusLake(id)`, lookups via existing
  `findLayerById`.
- **Loaders**: existing `checkAndLoadLakes` adapted to populate the list rather than
  only call `showMessage`.

## Dev / Test Mode

The live app requires a PostGIS database not available in this environment. Add a
`?mock=1` query-param dev mode that injects sample water bodies + observations
client-side (intercepting the fetch calls), so the panel, list, detail view, and
interactions can be verified in a browser without the database. Mock mode is inert
unless `?mock=1` is present; real API behavior is unchanged.

## Out of Scope

- Backend/API changes.
- Trail integration into the panel.
- Auth, persistence changes, mobile-specific layouts.
