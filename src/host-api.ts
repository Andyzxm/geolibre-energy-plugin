/**
 * The slice of GeoLibre's plugin API this plugin uses.
 *
 * GeoLibre ships the full contract in `@geolibre/plugins`, but an external
 * plugin is a standalone bundle and cannot import from the host, so the members
 * used here are mirrored by hand. Keep them in sync with the host's
 * `docs/plugin-api.md`: a signature that drifts fails at runtime, not at build.
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";

export type GeoLibreRightPanelDock =
  | "left-of-layers"
  | "right-of-layers"
  | "left-of-style"
  | "right-of-style"
  | "replace-style"
  | "replace-layers";

export interface GeoLibreRightPanelRegistration {
  id: string;
  title: string | (() => string);
  dock?: GeoLibreRightPanelDock;
  icon?: string;
  defaultWidth?: number;
  /** Fill the panel body with your own DOM. May return a cleanup function. */
  render: (container: HTMLElement) => void | (() => void);
  onOpen?: () => void;
  onCollapse?: () => void;
  onClose?: () => void;
}

export interface GeoLibreTileLayerOptions {
  tileSize?: number;
  attribution?: string;
  bounds?: [number, number, number, number];
  minzoom?: number;
  maxzoom?: number;
  scheme?: "xyz" | "tms";
  visible?: boolean;
  opacity?: number;
  beforeLayerId?: string;
}

export interface GeoLibreCogLayerOptions {
  engine?: string;
  bands?: string;
  colormap?: string;
  rescaleMin?: number;
  rescaleMax?: number;
  opacity?: number;
  visible?: boolean;
}

export interface GeoLibreAppAPI {
  /** Add a GeoJSON FeatureCollection as a styleable, queryable layer. */
  addGeoJsonLayer: (name: string, data: FeatureCollection, sourcePath?: string) => string;
  addTileLayer?: (name: string, url: string, options?: GeoLibreTileLayerOptions) => string;
  addCogLayer?: (
    name: string,
    url: string,
    options?: GeoLibreCogLayerOptions,
  ) => Promise<string>;
  fitBounds?: (bounds: [number, number, number, number]) => void;
  /** `[west, south, east, north]` in degrees, on either renderer. */
  getViewBounds?: () => [number, number, number, number] | null;
  getSelectedFeatures?: () => Feature<Geometry | null>[];
  registerRightPanel?: (panel: GeoLibreRightPanelRegistration) => () => void;
  unregisterRightPanel?: (id: string) => void;
  openRightPanel?: (id: string) => boolean;
  closeRightPanel?: (id: string) => void;
  translate?: (
    key: string,
    defaultValue: string,
    params?: Record<string, string | number>,
  ) => string;
}

export interface GeoLibrePlugin {
  id: string;
  name: string;
  version: string;
  engines?: ("maplibre" | "cesium")[];
  /** At least one name is required for handleUrlParameters to be called. */
  urlParameterNames?: string[];
  activate: (app: GeoLibreAppAPI) => boolean | void;
  deactivate: (app: GeoLibreAppAPI) => void;
  handleUrlParameters?: (
    app: GeoLibreAppAPI,
    params: URLSearchParams,
  ) => void | Promise<void>;
  getProjectState?: () => unknown;
  applyProjectState?: (app: GeoLibreAppAPI, state: unknown) => boolean | void;
}
