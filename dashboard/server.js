const express = require("express");
const path = require("path");
const { CosmosClient } = require("@azure/cosmos");
const { DefaultAzureCredential, ManagedIdentityCredential, ChainedTokenCredential } = require("@azure/identity");

const app = express();
const PORT = process.env.PORT || 3000;

// Credential chain: Managed Identity → Default (CLI fallback)
const credential = process.env.AZURE_CLIENT_ID
  ? new ChainedTokenCredential(
      new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID),
      new DefaultAzureCredential()
    )
  : new DefaultAzureCredential();

const cosmosClient = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT || "https://azobs-dev-cosmos.documents.azure.com:443/",
  aadCredentials: credential,
});

const database = cosmosClient.database(process.env.COSMOS_DATABASE || "observability");
const resourcesContainer = database.container("resources");
const relationshipsContainer = database.container("relationships");

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// ── API Routes ───────────────────────────────────────────────────────────────

// Summary stats
app.get("/api/summary", async (req, res) => {
  try {
    const [totalRes, typeRes, locationRes, subRes] = await Promise.all([
      resourcesContainer.items.query("SELECT VALUE COUNT(1) FROM c").fetchAll(),
      resourcesContainer.items.query(
        "SELECT c.type, COUNT(1) as count FROM c GROUP BY c.type ORDER BY COUNT(1) DESC"
      ).fetchAll(),
      resourcesContainer.items.query(
        "SELECT c.location, COUNT(1) as count FROM c GROUP BY c.location ORDER BY COUNT(1) DESC"
      ).fetchAll(),
      resourcesContainer.items.query(
        "SELECT c.subscriptionId, COUNT(1) as count FROM c GROUP BY c.subscriptionId"
      ).fetchAll(),
    ]);

    res.json({
      totalResources: totalRes.resources[0] || 0,
      byType: typeRes.resources,
      byLocation: locationRes.resources,
      bySubscription: subRes.resources,
    });
  } catch (err) {
    console.error("Summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// List resources with optional filters
app.get("/api/resources", async (req, res) => {
  try {
    const { type, location, subscription, search, limit = 100, offset = 0 } = req.query;
    let query = "SELECT * FROM c WHERE 1=1";
    const params = [];

    if (type) {
      query += " AND c.type = @type";
      params.push({ name: "@type", value: type.toLowerCase() });
    }
    if (location) {
      query += " AND c.location = @location";
      params.push({ name: "@location", value: location });
    }
    if (subscription) {
      query += " AND c.subscriptionId = @sub";
      params.push({ name: "@sub", value: subscription });
    }
    if (search) {
      query += " AND CONTAINS(LOWER(c.name), @search)";
      params.push({ name: "@search", value: search.toLowerCase() });
    }

    query += " ORDER BY c.type ASC, c.name ASC OFFSET @offset LIMIT @limit";
    params.push({ name: "@offset", value: parseInt(offset) });
    params.push({ name: "@limit", value: parseInt(limit) });

    const { resources } = await resourcesContainer.items.query({
      query, parameters: params,
    }).fetchAll();

    res.json(resources);
  } catch (err) {
    console.error("Resources error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get a single resource
app.get("/api/resources/:id", async (req, res) => {
  try {
    const { resources } = await resourcesContainer.items.query({
      query: "SELECT * FROM c WHERE c.resourceId = @id",
      parameters: [{ name: "@id", value: req.params.id }],
    }).fetchAll();

    if (resources.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(resources[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Relationships for a resource
app.get("/api/relationships", async (req, res) => {
  try {
    const { resourceId } = req.query;
    const query = resourceId
      ? "SELECT * FROM c WHERE c.sourceId = @id OR c.targetId = @id"
      : "SELECT * FROM c";
    const params = resourceId ? [{ name: "@id", value: resourceId }] : [];

    const { resources } = await relationshipsContainer.items.query({
      query, parameters: params,
    }).fetchAll();

    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resource types for filter dropdown
app.get("/api/types", async (req, res) => {
  try {
    const { resources } = await resourcesContainer.items.query(
      "SELECT DISTINCT VALUE c.type FROM c ORDER BY c.type ASC"
    ).fetchAll();
    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Locations for filter dropdown
app.get("/api/locations", async (req, res) => {
  try {
    const { resources } = await resourcesContainer.items.query(
      "SELECT DISTINCT VALUE c.location FROM c ORDER BY c.location ASC"
    ).fetchAll();
    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
