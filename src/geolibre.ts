/**
 * Energy Data: a curated catalog of U.S. energy datasets for GeoLibre.
 *
 * The plugin registers one right-side panel. Everything it adds to the map goes
 * through the host's public API, so each dataset becomes an ordinary GeoLibre
 * layer with the full styling, attribute and analysis surface.
 */
import { bundledCatalog, fetchCatalog, type GeoenergyCatalog } from "./catalog";
import { renderPanel } from "./panel";
import type { GeoLibreAppAPI, GeoLibrePlugin } from "./host-api";
import "./styles.css";

export const PLUGIN_ID = "geoenergy-catalog";
const CATALOG_PARAM = "energyCatalog";
const CATALOG_TIMEOUT_MS = 20_000;

let appRef: GeoLibreAppAPI | null = null;
let unregisterPanel: (() => void) | null = null;
let disposePanel: (() => void) | null = null;
let panelContainer: HTMLElement | null = null;
let catalog: GeoenergyCatalog = bundledCatalog();

function repaint(): void {
  if (!panelContainer || !appRef) return;
  disposePanel?.();
  disposePanel = renderPanel(panelContainer, appRef, catalog);
}

export const plugin: GeoLibrePlugin = {
  id: PLUGIN_ID,
  name: "Energy Data",
  version: "1.0.0",
  // The panel only writes to the host store, so it works on both renderers.
  engines: ["maplibre", "cesium"],
  urlParameterNames: [CATALOG_PARAM],

  activate(app) {
    appRef = app;
    unregisterPanel =
      app.registerRightPanel?.({
        id: PLUGIN_ID,
        title: "Energy Data",
        dock: "replace-style",
        defaultWidth: 380,
        render: (container) => {
          panelContainer = container;
          disposePanel = renderPanel(container, app, catalog);
          return () => {
            disposePanel?.();
            disposePanel = null;
            panelContainer = null;
          };
        },
      }) ?? null;
    app.openRightPanel?.(PLUGIN_ID);
  },

  deactivate(app) {
    disposePanel?.();
    disposePanel = null;
    panelContainer = null;
    app.closeRightPanel?.(PLUGIN_ID);
    unregisterPanel?.();
    unregisterPanel = null;
    appRef = null;
  },

  /**
   * `?energyCatalog=<url>` swaps in another catalog, so a deployment can point
   * this panel at its own dataset list without republishing the plugin. A
   * failure leaves the bundled catalog in place rather than emptying the panel.
   */
  async handleUrlParameters(_app, params) {
    const url = params.get(CATALOG_PARAM)?.trim();
    if (!url) return;
    try {
      catalog = await fetchCatalog(url, AbortSignal.timeout(CATALOG_TIMEOUT_MS));
      repaint();
    } catch (error) {
      console.error(`[Geoenergy] Could not load the catalog at ${url}.`, error);
    }
  },
};

export default plugin;
