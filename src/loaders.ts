/**
 * Turn one catalog entry into a map layer, using only GeoLibre's public API.
 */
import type { FeatureCollection } from "geojson";
import { fetchArcGISFeatures } from "./arcgis";
import type { GeoenergyDataset } from "./catalog";
import type { GeoLibreAppAPI } from "./host-api";

const OVERPASS_TIMEOUT_MS = 90_000;
/** Roughly a large state. Past this the public instances refuse or time out. */
const MAX_OVERPASS_SPAN_DEG = 12;
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Clamp a map extent to coordinates a service will accept. */
function clampBounds(
  bounds: [number, number, number, number],
): [number, number, number, number] {
  // At low zoom the map reports longitudes past the antimeridian (a whole-globe
  // view can read -204), which servers reject outright.
  return [
    Math.max(-180, Math.min(180, bounds[0])),
    Math.max(-90, Math.min(90, bounds[1])),
    Math.max(-180, Math.min(180, bounds[2])),
    Math.max(-90, Math.min(90, bounds[3])),
  ];
}

async function loadOverpass(app: GeoLibreAppAPI, dataset: GeoenergyDataset): Promise<void> {
  const view = app.getViewBounds?.();
  if (!view) throw new Error("The map extent is not available yet.");
  const [west, south, east, north] = clampBounds(view);
  if (east - west > MAX_OVERPASS_SPAN_DEG || north - south > MAX_OVERPASS_SPAN_DEG) {
    throw new Error(
      "Zoom in to a state or metro area first. OpenStreetMap queries are bounded " +
        "to the visible map, and a view this wide is more than its public servers " +
        "will answer.",
    );
  }
  const bbox = `${south},${west},${north},${east}`;
  const body = `[out:json][timeout:60];(${(dataset.query ?? "").replaceAll("{{bbox}}", bbox)});out center tags;`;

  const endpoints = [dataset.url, ...OVERPASS_MIRRORS.filter((url) => url !== dataset.url)];
  let response: Response | null = null;
  let lastStatus = 0;
  for (const endpoint of endpoints) {
    try {
      const attempt = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: body }),
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (attempt.ok) {
        response = attempt;
        break;
      }
      lastStatus = attempt.status;
    } catch {
      // A timeout or refusal is worth trying the mirror for; if every endpoint
      // fails the error below reports it.
    }
  }
  if (!response) {
    throw new Error(
      lastStatus === 429 || lastStatus === 504
        ? "OpenStreetMap's query servers are busy. Try again in a moment."
        : "Could not reach OpenStreetMap's query service.",
    );
  }

  const payload = (await response.json()) as { elements?: OverpassElement[] };
  const features = (payload.elements ?? [])
    .map((element) => {
      // A node carries its own position; a way or relation comes back with
      // `out center`, which is the only geometry this layer needs.
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      if (lat === undefined || lon === undefined) return null;
      return {
        type: "Feature" as const,
        id: `${element.type}/${element.id}`,
        geometry: { type: "Point" as const, coordinates: [lon, lat] },
        properties: { osm_id: `${element.type}/${element.id}`, ...(element.tags ?? {}) },
      };
    })
    .filter((feature) => feature !== null);
  if (!features.length) {
    throw new Error("Nothing of that kind is mapped in this view.");
  }
  app.addGeoJsonLayer(dataset.title, { type: "FeatureCollection", features }, dataset.url);
}

export interface LoadOptions {
  signal?: AbortSignal;
  /** Reports features loaded so far, for the paging kinds. */
  onProgress?: (loaded: number) => void;
}

/**
 * Add one dataset to the map.
 *
 * @param app - The host API handed to the plugin on activation.
 * @param dataset - The catalog entry to load.
 * @param options - Abort signal and progress callback.
 */
export async function addDataset(
  app: GeoLibreAppAPI,
  dataset: GeoenergyDataset,
  options: LoadOptions = {},
): Promise<void> {
  switch (dataset.kind) {
    case "arcgis-feature": {
      const data = await fetchArcGISFeatures(dataset.url, {
        bounds: app.getViewBounds?.() ? clampBounds(app.getViewBounds()!) : null,
        maxFeatures: dataset.maxFeatures,
        signal: options.signal,
        onPage: options.onProgress,
      });
      if (!data.features.length) {
        throw new Error("The service returned no features for this view.");
      }
      app.addGeoJsonLayer(dataset.title, data, dataset.url);
      return;
    }
    case "geojson": {
      const response = await fetch(dataset.url, { signal: options.signal });
      if (!response.ok) throw new Error(`GeoJSON request failed (${response.status}).`);
      const data = (await response.json()) as FeatureCollection;
      if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
        throw new Error("The URL is not a GeoJSON FeatureCollection.");
      }
      app.addGeoJsonLayer(dataset.title, data, dataset.url);
      if (dataset.bounds) app.fitBounds?.(dataset.bounds);
      return;
    }
    case "overpass":
      return loadOverpass(app, dataset);
    case "cog": {
      if (!app.addCogLayer) throw new Error("This host cannot add raster layers.");
      await app.addCogLayer(dataset.title, dataset.url);
      return;
    }
    case "xyz": {
      const id = app.addTileLayer?.(dataset.title, dataset.url, {
        ...(dataset.source ? { attribution: dataset.source } : {}),
        ...(dataset.bounds ? { bounds: dataset.bounds } : {}),
      });
      if (!id) throw new Error("This host cannot add tile layers.");
      if (dataset.bounds) app.fitBounds?.(dataset.bounds);
      return;
    }
    default: {
      // Exhaustive: a kind added to the union without a branch fails the build.
      const unreachable: never = dataset.kind;
      throw new Error(`Unsupported dataset kind: ${String(unreachable)}`);
    }
  }
}
