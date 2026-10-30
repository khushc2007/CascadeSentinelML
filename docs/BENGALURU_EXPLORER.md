# Bengaluru Grid Explorer — data audit, design and limitations

A geographic mode of the original Grid Doomsday Finder (`app/`), chosen from the network menu under **Geographic exploration**
(`#bengaluru` opens it directly). It is a map of **publicly mapped** electrical infrastructure. It is not an IEEE benchmark, it is not
connected to the cascade engine, and nothing in it can be simulated.

## Sources investigated (2026-10-27)
| Source | What it offers | Used? | Why |
|---|---|---|---|
| OpenStreetMap (`power=substation`, `plant`, `line`, `minor_line`, `cable`) via the Overpass API | Geometry, voltage / operator / name tags where mappers added them; licence ODbL 1.0 | **Yes**, queried from the user's browser at runtime | Only source found with coordinates and a clear licence. Coverage depends on volunteer mapping. |
| OpenStreetMap raster tiles (`tile.openstreetmap.org`) | Basemap | **Yes**, dimmed, adjustable, can be switched off | Attribution shown; light interactive use per the OSM tile usage policy. |
| BESCOM / KPTCL "Bengaluru Electrical Substations" (opencity.in, CSV, 280 rows, March 2019, source KPTCL statistics page) | Name, zone, district, taluk, voltage class, commissioning date | **No** | No coordinates; the dataset page states "No License Provided". Listed under "Not available" in the layer panel. |
| OpenInfraMap | Rendered map of OSM power data | No (it is a rendering of the same OSM data) | — |
| KPTCL SLDC publications, other government datasets | Statistics, reports | Not used | No machine-readable geometry found in this session. |

This session's workspace has **no direct internet access**: Overpass, the tile server, opencity.in and OpenInfraMap were all
unreachable from the shell, and the browser in the test environment has no route to them either. The explorer was therefore built and
tested against a **synthetic test fixture** (`tests/fixtures/overpass_synthetic_fixture.json`, names start with `TEST`) and intercepted
tiles. **No real Bengaluru data has been loaded or inspected here**, and coverage figures for Bengaluru are not known from this work.

## Data rules (enforced in `app/js/geo/osm.js`, tested in `app/test/geo.test.mjs`)
- Every record keeps its source element id, its OpenStreetMap URL, the licence, the endpoint, the retrieval time and the OSM snapshot
  time (`osm3s.timestamp_osm_base`). All source tags are kept unchanged and shown in the asset inspector.
- Voltages come only from the `voltage` tag (`"220000;66000"` → 220 / 66 kV); class = the highest tagged voltage; untagged stays
  "voltage not tagged".
- No connectivity is inferred. A line whose end coincides with a substation marker is still not linked to it; records have no
  connectivity fields (tested).
- Status labels are derived only from what a record carries: "Public mapped data (OpenStreetMap)", "Voltage tagged by the mapper" /
  "Voltage not tagged", "Unverified connectivity", "Not cross-checked against KPTCL/BESCOM records", "Incomplete record: no name",
  "Approximate marker position". "Official source" and "independently verified" are never assigned: no loaded source establishes them.
- Display names follow the OSM tag (`power=line` is shown as "Power line (power=line)", not as a verified transmission asset).

## Interaction
Pan, zoom, rotate and tilt (MapLibre GL 4.7.1, vendored under `app/vendor/maplibre`, BSD-3-Clause; no API key), Overview, Tilt 50°,
North up, Full screen (where the browser allows it), search by name / ref / operator / OSM id, layers per feature kind, substation
outlines, names (HTML labels, de-overlapped, at most 40), query extent, basemap on/off and prominence, filters by voltage class, operator
and named-only, clustering of point assets with counts, an asset inspector with tags, provenance and limitations, a coverage panel, and
"Load a file…" for an Overpass JSON or GeoJSON export. The last successful query is cached per browser (IndexedDB); "Query again"
refreshes it and "Clear cache" removes it.

## Failure behaviour
- Overpass unreachable / HTTP error / timeout (150 s): both endpoints are tried; the panel lists each endpoint's error; nothing is
  shown in place of the missing data; the map, file import and the rest of the application keep working.
- Leaving the mode while a query runs cancels it without an error and retries on return.
- Tiles unavailable: a warning in the layer panel; infrastructure layers still draw on a dark background.
- Map library or WebGL unavailable: a message; search and the asset list still work.
- On a published (sandboxed) copy of the page, external requests are blocked by the host, so only "Load a file…" can supply data there.

## Not available (shown as such)
Distribution transformers, poles and towers (not queried); administrative boundaries; terrain; any data-confidence overlay; the
KPTCL/BESCOM list (no coordinates, no licence). Ratings, impedances and connectivity are not available from OSM, so the explorer never
offers a simulation.

## Performance (SwiftShader software WebGL, 2 vCPU, no GPU)
Synthetic load of 600 substations and 4 000 line ways loaded from a file: parse + first render 0.24 s; a filter change takes 41 ms on
the main thread and the map settles about 0.8 s later; search 0.08 s.
