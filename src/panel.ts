/**
 * The Energy Data panel: raw DOM inside the host's right-panel container.
 *
 * Styling comes from `styles.css`, scoped under `.geoenergy-panel` and written
 * against the host's design tokens (`hsl(var(--foreground))` and friends), so
 * the panel follows GeoLibre's theme and accent instead of imposing its own.
 */
import { addDataset } from "./loaders";
import { indexDatasets, type GeoenergyCatalog, type GeoenergyDataset } from "./catalog";
import type { GeoLibreAppAPI } from "./host-api";

/** Where each analysis tool lives, so the panel teaches the host app. */
const ANALYSIS: { label: string; where: string }[] = [
  { label: "Filter and query by attribute", where: "Layers panel, the layer's menu" },
  { label: "Buffer, clip, intersect, dissolve", where: "Processing, Vector" },
  { label: "Zonal and summary statistics", where: "Processing, Statistics" },
  { label: "Read values under the cursor", where: "click any feature on the map" },
  { label: "Compare two layers", where: "Plugins, Layer Swipe" },
  { label: "Export what you built", where: "Project, Export" },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function matches(dataset: GeoenergyDataset, query: string): boolean {
  if (!query) return true;
  const haystack = [dataset.title, dataset.description ?? "", (dataset.tags ?? []).join(" ")]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/**
 * Render the panel into a container.
 *
 * @param container - The host-provided panel body.
 * @param app - The host API.
 * @param catalog - The catalog to render.
 * @returns A cleanup function that aborts in-flight loads and empties the container.
 */
export function renderPanel(
  container: HTMLElement,
  app: GeoLibreAppAPI,
  catalog: GeoenergyCatalog,
): () => void {
  const controller = new AbortController();
  const root = el("div", "geoenergy-panel");

  root.append(
    el(
      "p",
      "geoenergy-hint",
      "Curated U.S. energy datasets. Adding one puts an ordinary map layer on the map, " +
        "so the host's styling, attribute table and analysis tools all apply to it.",
    ),
  );

  const status = el("div", "geoenergy-status", "");
  const setStatus = (text: string) => {
    status.textContent = text;
  };

  const byId = indexDatasets(catalog);
  const starting = (catalog.defaultLayers ?? [])
    .map((id) => byId.get(id))
    .filter((dataset): dataset is GeoenergyDataset => dataset !== undefined);

  // Offered rather than automatic: a plugin the user just installed should not
  // start downloading national datasets on its own.
  if (starting.length) {
    const start = el(
      "button",
      "geoenergy-start",
      `Load starting layers (${starting.length})`,
    ) as HTMLButtonElement;
    start.type = "button";
    start.addEventListener("click", () => {
      start.disabled = true;
      void (async () => {
        for (const dataset of starting) {
          setStatus(`Adding ${dataset.title}…`);
          try {
            await addDataset(app, dataset, { signal: controller.signal });
          } catch (error) {
            console.warn(`[Geoenergy] Could not load ${dataset.id}.`, error);
          }
        }
        setStatus("Starting layers loaded.");
        start.disabled = false;
      })();
    });
    root.append(start);
  }

  const search = el("input", "geoenergy-search") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Search datasets";
  root.append(search);
  root.append(status);

  const list = el("div", "geoenergy-list");
  root.append(list);

  const buildCard = (dataset: GeoenergyDataset, accent?: string): HTMLElement => {
    const card = el("div", "geoenergy-card");
    if (accent) card.style.borderInlineStartColor = accent;

    card.append(el("div", "geoenergy-card-title", dataset.title));

    const meta = el("div", "geoenergy-card-meta");
    if (dataset.source) meta.append(el("span", "geoenergy-badge", dataset.source));
    if (dataset.vintage) meta.append(el("span", "geoenergy-vintage", dataset.vintage));
    if (meta.childElementCount) card.append(meta);

    if (dataset.description) {
      card.append(el("p", "geoenergy-card-desc", dataset.description));
    }

    const actions = el("div", "geoenergy-actions");
    const add = el("button", "geoenergy-add", "Add to map") as HTMLButtonElement;
    add.type = "button";
    add.addEventListener("click", () => {
      add.disabled = true;
      setStatus(`Adding ${dataset.title}…`);
      void addDataset(app, dataset, {
        signal: controller.signal,
        onProgress: (loaded) => setStatus(`Adding ${dataset.title}… ${loaded} features`),
      })
        .then(() => setStatus(`Added ${dataset.title}.`))
        .catch((error: unknown) => {
          console.error(`[Geoenergy] Could not add ${dataset.id}.`, error);
          // The loaders throw messages written for a user ("zoom in first"),
          // so showing the message beats a generic failure line.
          setStatus(error instanceof Error ? error.message : `Could not add ${dataset.title}.`);
        })
        .finally(() => {
          add.disabled = false;
        });
    });
    actions.append(add);

    if (dataset.infoUrl) {
      const link = el("a", "geoenergy-link", "Source") as HTMLAnchorElement;
      link.href = dataset.infoUrl;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      actions.append(link);
    }
    card.append(actions);
    return card;
  };

  const render = () => {
    const query = search.value.trim();
    list.replaceChildren();
    let shown = 0;
    let total = 0;
    for (const group of catalog.groups) {
      total += group.datasets.length;
      const hits = group.datasets.filter((dataset) => matches(dataset, query));
      if (!hits.length) continue;
      shown += hits.length;
      const heading = el("div", "geoenergy-group");
      if (group.accent) {
        const dot = el("span", "geoenergy-dot");
        dot.style.background = group.accent;
        heading.append(dot);
      }
      heading.append(el("span", undefined, group.label));
      list.append(heading);
      for (const dataset of hits) list.append(buildCard(dataset, group.accent));
    }
    if (!total) setStatus("The catalog has no datasets.");
    else if (!shown) setStatus("No datasets match that search.");
    else setStatus(`Showing ${shown} of ${total} datasets.`);
  };

  const onInput = () => render();
  search.addEventListener("input", onInput);
  render();

  const analysis = el("div", "geoenergy-analysis");
  analysis.append(el("div", "geoenergy-group", "What you can do with a layer"));
  for (const entry of ANALYSIS) {
    const row = el("div", "geoenergy-analysis-row");
    row.append(el("span", "geoenergy-analysis-label", entry.label));
    row.append(el("span", "geoenergy-analysis-where", entry.where));
    analysis.append(row);
  }
  root.append(analysis);

  container.append(root);

  return () => {
    controller.abort();
    search.removeEventListener("input", onInput);
    container.replaceChildren();
  };
}
