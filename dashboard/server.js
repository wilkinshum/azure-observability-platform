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

// Subscription ID → friendly name mapping
const SUBSCRIPTION_NAMES = {
  "ca2f7910-fe8b-4198-a355-2e888e6455c4": "Identity",
  "af59af90-87a6-4519-b506-0dea13c007e0": "LZ-Online",
  "53fb5cd8-a542-46e0-8209-79d690e48482": "Security",
  "b7587242-8c5e-43be-88ca-a1a2e26bf9fa": "Connect",
  "b79a44dc-2b5e-4cee-8960-2f6ebd62e32c": "Sub-4",
  "4819b19b-6d0a-47e1-8595-7f9c1d3250c1": "Management",
  "f627598e-05c5-4093-8667-5730c4026ea3": "Sub-1",
  "26c850af-9b58-4518-ad16-038ba91e6a6c": "Connectivity",
  "832c2234-b1ac-4faf-af30-9525e7ac4a9b": "Sub-10",
  "c1ab0c6c-e322-418b-abb5-4bc161b97429": "LZ-Corp",
};
const resourcesContainer = database.container("resources");
const relationshipsContainer = database.container("relationships");
const networkFlowsContainer = database.container("network-flows");

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// ── API Routes ───────────────────────────────────────────────────────────────

// Summary stats
app.get("/api/summary", async (req, res) => {
  try {
    const [totalRes, typeRes, locationRes, subRes] = await Promise.all([
      resourcesContainer.items.query("SELECT VALUE COUNT(1) FROM c").fetchAll(),
      resourcesContainer.items.query(
        "SELECT c.type, COUNT(1) as count FROM c GROUP BY c.type"
      ).fetchAll(),
      resourcesContainer.items.query(
        "SELECT c.location, COUNT(1) as count FROM c GROUP BY c.location"
      ).fetchAll(),
      resourcesContainer.items.query(
        "SELECT c.subscriptionId, COUNT(1) as count FROM c GROUP BY c.subscriptionId"
      ).fetchAll(),
    ]);

    res.json({
      totalResources: totalRes.resources[0] || 0,
      byType: typeRes.resources.sort((a, b) => b.count - a.count),
      byLocation: locationRes.resources.sort((a, b) => b.count - a.count),
      bySubscription: subRes.resources.map(s => ({
        ...s,
        name: SUBSCRIPTION_NAMES[s.subscriptionId] || s.subscriptionId,
      })),
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

    query += " ORDER BY c.name ASC OFFSET @offset LIMIT @limit";
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

// ── Network Flows API ────────────────────────────────────────────────────────

// Get network flows with optional filters
app.get("/api/network-flows", async (req, res) => {
  try {
    const { limit = 200, minBytes = 0, protocol, port } = req.query;
    let query = "SELECT * FROM c WHERE 1=1";
    const params = [];

    if (parseInt(minBytes) > 0) {
      query += " AND (c.bytesS2D + c.bytesD2S) >= @minBytes";
      params.push({ name: "@minBytes", value: parseInt(minBytes) });
    }
    if (protocol) {
      query += " AND c.protocol = @protocol";
      params.push({ name: "@protocol", value: protocol.toUpperCase() });
    }
    if (port) {
      query += " AND c.destPort = @port";
      params.push({ name: "@port", value: port });
    }

    query += " OFFSET 0 LIMIT @limit";
    params.push({ name: "@limit", value: parseInt(limit) });

    const { resources: flows } = await networkFlowsContainer.items.query({
      query, parameters: params,
    }).fetchAll();

    res.json(flows);
  } catch (err) {
    console.error("Network flows error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get network flow summary stats
app.get("/api/network-flows/summary", async (req, res) => {
  try {
    const [totalRes, allFlowsRes] = await Promise.all([
      networkFlowsContainer.items.query("SELECT VALUE COUNT(1) FROM c").fetchAll(),
      networkFlowsContainer.items.query(
        "SELECT c.sourceIp, c.destIp, c.destPort, c.protocol, c.bytesS2D, c.bytesD2S, c.allowed, c.denied FROM c"
      ).fetchAll(),
    ]);

    const flows = allFlowsRes.resources;

    // Aggregate by protocol
    const protoMap = {};
    flows.forEach(f => {
      const p = f.protocol || "OTHER";
      if (!protoMap[p]) protoMap[p] = { protocol: p, count: 0, totalBytes: 0 };
      protoMap[p].count++;
      protoMap[p].totalBytes += (f.bytesS2D || 0) + (f.bytesD2S || 0);
    });

    // Aggregate by port
    const portMap = {};
    flows.forEach(f => {
      const key = `${f.destPort}/${f.protocol}`;
      if (!portMap[key]) portMap[key] = { destPort: f.destPort, protocol: f.protocol, count: 0, totalBytes: 0 };
      portMap[key].count++;
      portMap[key].totalBytes += (f.bytesS2D || 0) + (f.bytesD2S || 0);
    });

    // Top talkers (sort by bytes desc)
    const topTalkers = flows
      .map(f => ({ ...f, totalBytes: (f.bytesS2D || 0) + (f.bytesD2S || 0) }))
      .sort((a, b) => b.totalBytes - a.totalBytes)
      .slice(0, 20);

    res.json({
      totalFlows: totalRes.resources[0] || 0,
      byProtocol: Object.values(protoMap),
      topPorts: Object.values(portMap).sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 10),
      topTalkers,
    });
  } catch (err) {
    console.error("Flow summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Build IP → resource name lookup from discovered NICs/IPs
app.get("/api/network-flows/ip-map", async (req, res) => {
  try {
    // Query resources that have IP configurations (NICs, Public IPs, VMs, etc.)
    const { resources } = await resourcesContainer.items.query(
      "SELECT c.name, c.resourceId, c.type, c.properties FROM c WHERE c.type IN ('microsoft.network/networkinterfaces', 'microsoft.network/publicipaddresses', 'microsoft.network/privateendpoints', 'microsoft.compute/virtualmachines', 'microsoft.network/loadbalancers', 'microsoft.network/applicationgateways', 'microsoft.network/azurefirewalls')"
    ).fetchAll();

    const ipMap = {};

    for (const r of resources) {
      const props = r.properties || {};

      // NICs → private IPs
      if (r.type === "microsoft.network/networkinterfaces") {
        const ipConfigs = props.ipConfigurations || [];
        for (const ipc of ipConfigs) {
          const ip = ipc?.properties?.privateIPAddress;
          if (ip) ipMap[ip] = r.name;
        }
      }

      // Public IPs
      if (r.type === "microsoft.network/publicipaddresses") {
        const ip = props.ipAddress;
        if (ip) ipMap[ip] = r.name;
      }

      // Private Endpoints
      if (r.type === "microsoft.network/privateendpoints") {
        const nicConfigs = props.networkInterfaces || [];
        // Also check customDnsConfigs for IPs
        const dnsConfigs = props.customDnsConfigs || [];
        for (const dc of dnsConfigs) {
          const ips = dc?.ipAddresses || [];
          for (const ip of ips) {
            if (ip) ipMap[ip] = r.name;
          }
        }
      }

      // Load Balancers → frontend IPs
      if (r.type === "microsoft.network/loadbalancers") {
        const feConfigs = props.frontendIPConfigurations || [];
        for (const fe of feConfigs) {
          const ip = fe?.properties?.privateIPAddress;
          if (ip) ipMap[ip] = r.name;
        }
      }

      // Azure Firewalls
      if (r.type === "microsoft.network/azurefirewalls") {
        const feConfigs = props.ipConfigurations || [];
        for (const fe of feConfigs) {
          const ip = fe?.properties?.privateIPAddress;
          if (ip) ipMap[ip] = r.name;
        }
      }
    }

    res.json(ipMap);
  } catch (err) {
    console.error("IP map error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
