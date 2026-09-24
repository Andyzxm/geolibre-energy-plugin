import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bundledCatalog, indexDatasets, normalizeCatalog } from "../src/catalog";
import { queryUrl } from "../src/arcgis";

describe("the bundled catalog", () => {
  const catalog = bundledCatalog();

  it("has datasets", () => {
    assert.ok(catalog.groups.length > 0);
    assert.ok(indexDatasets(catalog).size > 0);
  });

  it("only ships kinds this build can load", () => {
    const kinds = new Set(
      catalog.groups.flatMap((group) => group.datasets.map((dataset) => dataset.kind)),
    );
    // GeoParquet and PMTiles need host internals an external plugin cannot
    // reach, so an entry of either kind in the shipped catalog is a bug.
    assert.ok(!kinds.has("vector" as never));
    assert.ok(!kinds.has("pmtiles" as never));
  });

  it("uses absolute URLs", () => {
    for (const dataset of indexDatasets(catalog).values()) {
      // A relative URL would resolve against whatever site is hosting
      // GeoLibre, which is not this plugin.
      assert.ok(dataset.url.startsWith("http"), dataset.id);
    }
  });

  it("names starting layers that exist", () => {
    const byId = indexDatasets(catalog);
    for (const id of catalog.defaultLayers ?? []) {
      assert.ok(byId.has(id), id);
    }
  });

  it("bounds an overpass query to the view", () => {
    for (const dataset of indexDatasets(catalog).values()) {
      if (dataset.kind !== "overpass") continue;
      // An unbounded national query is how a public Overpass instance ends up
      // refusing the whole plugin.
      assert.ok((dataset.query ?? "").includes("{{bbox}}"), dataset.id);
    }
  });
});

describe("normalizeCatalog", () => {
  it("rejects a document with no groups", () => {
    assert.throws(() => normalizeCatalog({}), /groups/);
  });

  it("drops unsupported kinds and empty groups", () => {
    const result = normalizeCatalog({
      version: 1,
      groups: [
        {
          id: "a",
          label: "A",
          datasets: [
            { id: "ok", title: "OK", kind: "geojson", url: "https://example.com/a.geojson" },
            { id: "no", title: "No", kind: "pmtiles", url: "https://example.com/a.pmtiles" },
          ],
        },
        { id: "b", label: "B", datasets: [{ id: "x", title: "X", kind: "vector", url: "u" }] },
      ],
    });
    assert.equal(result.groups.length, 1);
    assert.deepEqual(result.groups[0].datasets.map((d) => d.id), ["ok"]);
  });
});

describe("queryUrl", () => {
  const layer = "https://example.com/arcgis/rest/services/Thing/FeatureServer/0";

  it("asks the service for GeoJSON in WGS84", () => {
    const url = new URL(queryUrl(layer, {}, 0, 1000));
    assert.ok(url.pathname.endsWith("/FeatureServer/0/query"));
    assert.equal(url.searchParams.get("f"), "geojson");
    assert.equal(url.searchParams.get("outSR"), "4326");
    assert.equal(url.searchParams.get("resultOffset"), "0");
    assert.equal(url.searchParams.get("resultRecordCount"), "1000");
  });

  it("adds an envelope filter only when bounds are given", () => {
    assert.equal(new URL(queryUrl(layer, {}, 0, 10)).searchParams.has("geometry"), false);
    const bounded = new URL(queryUrl(layer, { bounds: [-90, 30, -80, 40] }, 0, 10));
    assert.equal(bounded.searchParams.get("geometry"), "-90,30,-80,40");
    assert.equal(bounded.searchParams.get("geometryType"), "esriGeometryEnvelope");
  });

  it("tolerates a trailing slash on the layer URL", () => {
    assert.ok(queryUrl(`${layer}/`, {}, 0, 10).includes("/FeatureServer/0/query?"));
  });
});
