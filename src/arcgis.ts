/**
 * Read an ArcGIS FeatureServer layer as GeoJSON, without the host's internals.
 *
 * GeoLibre's own ArcGIS support lives in `@geolibre/plugins` and is not
 * reachable from an external bundle, so this asks the service for GeoJSON
 * directly (`f=geojson`) and pages through it. That is the same contract the
 * service offers any client; what is lost against the host's version is the
 * automatic reload on pan, so a dataset is fetched for the extent that was
 * visible when it was added. Adding it again after panning refreshes it.
 */
import type { Feature, FeatureCollection } from "geojson";

/** ArcGIS caps a page server-side too; this is only the ceiling we ask for. */
const PAGE_SIZE = 1000;
/** Guard against a service that keeps answering "there is more" forever. */
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 60_000;

interface ArcGISQueryResponse extends FeatureCollection {
  error?: { code: number; message: string };
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
}

export interface ArcGISQueryOptions {
  /** `[west, south, east, north]` to restrict the query to, when known. */
  bounds?: [number, number, number, number] | null;
  /** Stop after this many features. */
  maxFeatures?: number;
  signal?: AbortSignal;
  /** Called after each page, for progress reporting. */
  onPage?: (loaded: number) => void;
}

export function queryUrl(
  layerUrl: string,
  options: ArcGISQueryOptions,
  offset: number,
  pageSize: number,
): string {
  const url = new URL(`${layerUrl.replace(/\/+$/, "")}/query`);
  url.searchParams.set("f", "geojson");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(pageSize));
  if (options.bounds) {
    const [west, south, east, north] = options.bounds;
    url.searchParams.set("geometry", `${west},${south},${east},${north}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  }
  return url.toString();
}

/**
 * Download a layer as a FeatureCollection.
 *
 * @param layerUrl - A numbered FeatureServer layer, e.g. `.../FeatureServer/0`.
 * @param options - Extent, cap, abort signal and progress callback.
 * @throws When the service is unreachable, or answers with an ArcGIS error
 *   envelope (which arrives as HTTP 200, so status alone proves nothing).
 */
export async function fetchArcGISFeatures(
  layerUrl: string,
  options: ArcGISQueryOptions = {},
): Promise<FeatureCollection> {
  const cap = options.maxFeatures ?? Number.POSITIVE_INFINITY;
  const features: Feature[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const remaining = cap - features.length;
    if (remaining <= 0) break;
    const pageSize = Math.min(PAGE_SIZE, remaining);
    const response = await fetch(queryUrl(layerUrl, options, features.length, pageSize), {
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`The service returned HTTP ${response.status}.`);
    const payload = (await response.json()) as ArcGISQueryResponse;
    if (payload.error) {
      throw new Error(`ArcGIS error ${payload.error.code}: ${payload.error.message}`);
    }
    const batch = Array.isArray(payload.features) ? payload.features : [];
    features.push(...batch);
    options.onPage?.(features.length);

    // A short page is the last page. `exceededTransferLimit` says the service
    // truncated this page itself, so there is more to ask for even though the
    // page came back full.
    const more =
      payload.exceededTransferLimit === true ||
      payload.properties?.exceededTransferLimit === true ||
      batch.length === pageSize;
    if (!more || batch.length === 0) break;
  }

  return { type: "FeatureCollection", features };
}
