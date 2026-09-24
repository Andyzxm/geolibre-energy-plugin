/**
 * The dataset catalog: its schema, its bundled default, and how an override is
 * loaded.
 *
 * The catalog ships inside the bundle rather than being fetched from a website.
 * A registry plugin that phones home for its own configuration would break the
 * moment that host moved, and it would add a cross-origin request every user
 * has to trust. Deployments that want their own list point the plugin at one
 * with `?energyCatalog=<url>`.
 */
import bundled from "../data/catalog.json";

export type GeoenergyDatasetKind = "arcgis-feature" | "geojson" | "overpass" | "cog" | "xyz";

const KINDS: readonly GeoenergyDatasetKind[] = [
  "arcgis-feature",
  "geojson",
  "overpass",
  "cog",
  "xyz",
];

export interface GeoenergyDataset {
  id: string;
  title: string;
  description?: string;
  kind: GeoenergyDatasetKind;
  url: string;
  source?: string;
  infoUrl?: string;
  tags?: string[];
  bounds?: [number, number, number, number];
  /** Per-request feature cap for `arcgis-feature`. */
  maxFeatures?: number;
  vintage?: string;
  /** Overpass QL statements, with `{{bbox}}` where the view's bounds belong. */
  query?: string;
}

export interface GeoenergyGroup {
  id: string;
  label: string;
  description?: string;
  /** CSS color for the group's heading dot and card rule. */
  accent?: string;
  datasets: GeoenergyDataset[];
}

export interface GeoenergyCatalog {
  version: number;
  title?: string;
  /** Offered as a one-click "starting layers" action, never loaded unasked. */
  defaultLayers?: string[];
  groups: GeoenergyGroup[];
}

/**
 * Narrow an unknown document to a catalog, dropping what does not belong.
 *
 * An override URL is a deployment's own file and can be stale or hand-edited,
 * so entries of a kind this build cannot load are filtered out rather than
 * left to fail on click. Two kinds from the Geoenergy fork are deliberately
 * absent: GeoParquet and PMTiles load through host internals that an external
 * plugin cannot reach.
 */
export function normalizeCatalog(value: unknown): GeoenergyCatalog {
  const doc = value as Partial<GeoenergyCatalog> | null;
  if (!doc || !Array.isArray(doc.groups)) {
    throw new Error("The catalog is missing a `groups` array.");
  }
  const groups: GeoenergyGroup[] = [];
  for (const group of doc.groups) {
    if (!group || typeof group.id !== "string" || typeof group.label !== "string") continue;
    const datasets = (group.datasets ?? []).filter(
      (dataset): dataset is GeoenergyDataset =>
        Boolean(dataset) &&
        typeof dataset.id === "string" &&
        typeof dataset.title === "string" &&
        typeof dataset.url === "string" &&
        KINDS.includes(dataset.kind),
    );
    if (datasets.length) groups.push({ ...group, datasets });
  }
  return {
    version: typeof doc.version === "number" ? doc.version : 1,
    title: doc.title,
    defaultLayers: Array.isArray(doc.defaultLayers) ? doc.defaultLayers : [],
    groups,
  };
}

/** The catalog compiled into this bundle. */
export function bundledCatalog(): GeoenergyCatalog {
  return normalizeCatalog(bundled);
}

/** Fetch and validate a catalog served elsewhere. */
export async function fetchCatalog(url: string, signal: AbortSignal): Promise<GeoenergyCatalog> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
  const text = await response.text();
  // A misconfigured host answers 200 with its index.html for an unknown path,
  // which would otherwise surface as a bare JSON SyntaxError.
  if (/^\s*</.test(text)) throw new Error("The catalog URL returned HTML instead of JSON.");
  return normalizeCatalog(JSON.parse(text));
}

/** Every dataset in the catalog, by id. */
export function indexDatasets(catalog: GeoenergyCatalog): Map<string, GeoenergyDataset> {
  return new Map(
    catalog.groups.flatMap((group) => group.datasets.map((dataset) => [dataset.id, dataset])),
  );
}
