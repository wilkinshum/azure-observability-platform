// ── State ────────────────────────────────────────────────────────────────────
let currentPage = 0;
const PAGE_SIZE = 50;
let chartTypes = null;
let chartLocations = null;
let chartSubscriptions = null;

// ── Chart colors ─────────────────────────────────────────────────────────────
const COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#c084fc", "#e879f9",
  "#f472b6", "#fb7185", "#f87171", "#fb923c", "#fbbf24",
  "#a3e635", "#4ade80", "#34d399", "#2dd4bf", "#22d3ee",
  "#38bdf8", "#60a5fa", "#818cf8", "#a78bfa", "#c084fc",
];

// ── Navigation ───────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-links a").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const view = link.dataset.view;
    document.querySelectorAll(".nav-links a").forEach((l) => l.classList.remove("active"));
    link.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${view}`).classList.add("active");

    if (view === "resources") loadResources();
    if (view === "relationships") loadRelationships();
    if (view === "network-flows") loadNetworkFlows();
  });
});

// ── Overview ─────────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const res = await fetch("/api/summary");
    const data = await res.json();

    document.getElementById("total-resources").textContent = data.totalResources.toLocaleString();
    document.getElementById("total-types").textContent = data.byType.length;
    document.getElementById("total-locations").textContent = data.byLocation.length;
    document.getElementById("total-subscriptions").textContent = data.bySubscription.length;
    document.getElementById("last-scan").textContent = `Last updated: ${new Date().toLocaleString()}`;

    renderTypeChart(data.byType.slice(0, 10));
    renderLocationChart(data.byLocation);
    renderSubscriptionChart(data.bySubscription);
  } catch (err) {
    console.error("Failed to load overview:", err);
  }
}

function renderTypeChart(data) {
  const ctx = document.getElementById("chart-types").getContext("2d");
  if (chartTypes) chartTypes.destroy();
  chartTypes = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: data.map((d) => shortType(d.type)),
      datasets: [{
        data: data.map((d) => d.count),
        backgroundColor: COLORS.slice(0, data.length),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "right", labels: { color: "#8b8fa3", font: { size: 11 } } },
      },
    },
  });
}

function renderLocationChart(data) {
  const ctx = document.getElementById("chart-locations").getContext("2d");
  if (chartLocations) chartLocations.destroy();
  chartLocations = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => d.location || "global"),
      datasets: [{
        label: "Resources",
        data: data.map((d) => d.count),
        backgroundColor: "#6366f1",
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b8fa3", font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: "#8b8fa3" }, grid: { color: "#2d3044" } },
      },
    },
  });
}

function renderSubscriptionChart(data) {
  const ctx = document.getElementById("chart-subscriptions").getContext("2d");
  if (chartSubscriptions) chartSubscriptions.destroy();
  chartSubscriptions = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => d.name || d.subscriptionId.slice(0, 12) + "..."),
      datasets: [{
        label: "Resources",
        data: data.map((d) => d.count),
        backgroundColor: "#8b5cf6",
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b8fa3" }, grid: { color: "#2d3044" } },
        y: { ticks: { color: "#8b8fa3", font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

// ── Resources View ───────────────────────────────────────────────────────────
async function loadResources() {
  const type = document.getElementById("filter-type").value;
  const location = document.getElementById("filter-location").value;
  const search = document.getElementById("search-input").value;

  const params = new URLSearchParams({
    limit: PAGE_SIZE,
    offset: currentPage * PAGE_SIZE,
  });
  if (type) params.set("type", type);
  if (location) params.set("location", location);
  if (search) params.set("search", search);

  try {
    const res = await fetch(`/api/resources?${params}`);
    const data = await res.json();
    renderResourcesTable(data);
    document.getElementById("page-info").textContent = `Page ${currentPage + 1}`;
    document.getElementById("btn-prev").disabled = currentPage === 0;
    document.getElementById("btn-next").disabled = data.length < PAGE_SIZE;
  } catch (err) {
    console.error("Failed to load resources:", err);
  }
}

function renderResourcesTable(resources) {
  const tbody = document.getElementById("resources-body");
  if (resources.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No resources found</td></tr>';
    return;
  }
  tbody.innerHTML = resources.map((r) => `
    <tr data-id="${r.resourceId}" onclick="showResourceDetail(this)">
      <td><strong>${esc(r.name)}</strong></td>
      <td>${shortType(r.type)}</td>
      <td>${esc(r.location)}</td>
      <td>${esc(r.resourceGroup)}</td>
      <td title="${esc(r.subscriptionId)}">${r.subscriptionId.slice(0, 8)}...</td>
      <td>${renderTags(r.tags)}</td>
    </tr>
  `).join("");
}

function renderTags(tags) {
  if (!tags || Object.keys(tags).length === 0) return '<span class="tag">none</span>';
  return Object.entries(tags)
    .slice(0, 3)
    .map(([k, v]) => `<span class="tag">${esc(k)}=${esc(v)}</span>`)
    .join(" ");
}

async function showResourceDetail(row) {
  const id = row.dataset.id;
  try {
    const res = await fetch(`/api/resources/${encodeURIComponent(id)}`);
    const data = await res.json();
    document.getElementById("modal-title").textContent = data.name || "Resource";
    document.getElementById("modal-body").textContent = JSON.stringify(data, null, 2);
    document.getElementById("resource-modal").classList.remove("hidden");
  } catch (err) {
    console.error("Failed to load resource detail:", err);
  }
}

document.getElementById("modal-close").addEventListener("click", () => {
  document.getElementById("resource-modal").classList.add("hidden");
});

document.getElementById("resource-modal").addEventListener("click", (e) => {
  if (e.target.classList.contains("modal")) {
    document.getElementById("resource-modal").classList.add("hidden");
  }
});

// ── Relationships View ───────────────────────────────────────────────────────
async function loadRelationships() {
  try {
    const res = await fetch("/api/relationships");
    const data = await res.json();
    const tbody = document.getElementById("relationships-body");
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading">No relationships found</td></tr>';
      return;
    }
    tbody.innerHTML = data.map((r) => `
      <tr>
        <td><span class="tag">${esc(r.relationshipType)}</span></td>
        <td title="${esc(r.sourceId)}">${lastSegment(r.sourceId)}</td>
        <td title="${esc(r.targetId)}">${lastSegment(r.targetId)}</td>
        <td>${JSON.stringify(r.metadata || {}).slice(0, 60)}</td>
        <td>${r.discoveredAt ? new Date(r.discoveredAt).toLocaleDateString() : "—"}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Failed to load relationships:", err);
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────
async function loadFilters() {
  try {
    const [types, locations] = await Promise.all([
      fetch("/api/types").then((r) => r.json()),
      fetch("/api/locations").then((r) => r.json()),
    ]);

    const typeSelect = document.getElementById("filter-type");
    types.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = shortType(t);
      typeSelect.appendChild(opt);
    });

    const locSelect = document.getElementById("filter-location");
    locations.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l || "global";
      locSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("Failed to load filters:", err);
  }
}

document.getElementById("btn-search").addEventListener("click", () => { currentPage = 0; loadResources(); });
document.getElementById("search-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { currentPage = 0; loadResources(); } });
document.getElementById("btn-prev").addEventListener("click", () => { currentPage = Math.max(0, currentPage - 1); loadResources(); });
document.getElementById("btn-next").addEventListener("click", () => { currentPage++; loadResources(); });

// ── Helpers ──────────────────────────────────────────────────────────────────
function shortType(type) {
  if (!type) return "unknown";
  const parts = type.split("/");
  return parts[parts.length - 1];
}

function lastSegment(id) {
  if (!id) return "—";
  const parts = id.split("/");
  return parts[parts.length - 1];
}

function esc(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Network Flows View ───────────────────────────────────────────────────────
let chartProtocols = null;
let chartPorts = null;
let ipMap = {};

async function loadNetworkFlows() {
  try {
    const [summaryRes, ipMapRes] = await Promise.all([
      fetch("/api/network-flows/summary").then(r => r.json()),
      fetch("/api/network-flows/ip-map").then(r => r.json()),
    ]);
    ipMap = ipMapRes;

    // Stats
    document.getElementById("total-flows").textContent = summaryRes.totalFlows.toLocaleString();

    const totalBytes = summaryRes.byProtocol.reduce((sum, p) => sum + (p.totalBytes || 0), 0);
    document.getElementById("total-flow-bytes").textContent = formatBytes(totalBytes);

    const tcp = summaryRes.byProtocol.find(p => p.protocol === "TCP");
    const udp = summaryRes.byProtocol.find(p => p.protocol === "UDP");
    document.getElementById("total-tcp").textContent = tcp ? tcp.count.toLocaleString() : "0";
    document.getElementById("total-udp").textContent = udp ? udp.count.toLocaleString() : "0";

    document.getElementById("flow-stats").textContent = `${Object.keys(ipMap).length} IPs mapped to resources`;

    // Protocol chart
    renderProtocolChart(summaryRes.byProtocol);

    // Top ports chart
    renderPortsChart(summaryRes.topPorts);

    // Top talkers table
    renderTopTalkers(summaryRes.topTalkers);

    // Topology
    loadTopology();
  } catch (err) {
    console.error("Failed to load network flows:", err);
  }
}

function renderProtocolChart(data) {
  const ctx = document.getElementById("chart-protocols").getContext("2d");
  if (chartProtocols) chartProtocols.destroy();
  chartProtocols = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: data.map(d => d.protocol),
      datasets: [{
        data: data.map(d => d.count),
        backgroundColor: ["#6366f1", "#f472b6", "#fbbf24", "#34d399"],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "right", labels: { color: "#8b8fa3" } } },
    },
  });
}

function renderPortsChart(data) {
  const ctx = document.getElementById("chart-ports").getContext("2d");
  if (chartPorts) chartPorts.destroy();
  chartPorts = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(d => `${d.destPort}/${d.protocol}`),
      datasets: [{
        label: "Traffic (bytes)",
        data: data.map(d => d.totalBytes || 0),
        backgroundColor: "#8b5cf6",
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b8fa3" }, grid: { display: false } },
        y: { ticks: { color: "#8b8fa3", callback: v => formatBytes(v) }, grid: { color: "#2d3044" } },
      },
    },
  });
}

function renderTopTalkers(flows) {
  const tbody = document.getElementById("flows-body");
  if (!flows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">No flows found</td></tr>';
    return;
  }
  tbody.innerHTML = flows.map(f => `
    <tr>
      <td title="${esc(f.sourceIp)}">${esc(resolveIp(f.sourceIp))}</td>
      <td title="${esc(f.destIp)}">${esc(resolveIp(f.destIp))}</td>
      <td>${esc(f.destPort)}</td>
      <td><span class="tag">${esc(f.protocol)}</span></td>
      <td>${formatBytes(f.bytesS2D || 0)}</td>
      <td>${formatBytes(f.bytesD2S || 0)}</td>
      <td style="color:#4ade80">${(f.allowed || 0).toLocaleString()}</td>
      <td style="color:${f.denied > 0 ? '#f87171' : '#8b8fa3'}">${(f.denied || 0).toLocaleString()}</td>
    </tr>
  `).join("");
}

function resolveIp(ip) {
  if (!ip) return "—";
  const name = ipMap[ip];
  return name ? `${name} (${ip})` : ip;
}

async function loadTopology() {
  const protocol = document.getElementById("flow-filter-protocol").value;
  const minBytes = document.getElementById("flow-filter-min-bytes").value;
  const params = new URLSearchParams({ limit: 150 });
  if (protocol) params.set("protocol", protocol);
  if (minBytes) params.set("minBytes", minBytes);

  try {
    const flows = await fetch(`/api/network-flows?${params}`).then(r => r.json());
    renderTopology(flows);
  } catch (err) {
    console.error("Failed to load topology:", err);
  }
}

function renderTopology(flows) {
  const container = document.getElementById("topology-container");
  container.innerHTML = "";

  if (!flows.length) {
    container.innerHTML = '<div style="color:#8b8fa3;text-align:center;padding:40px">No flows to display</div>';
    return;
  }

  const width = container.clientWidth;
  const height = 600;

  // Build nodes and links
  const nodeSet = new Set();
  const links = [];

  flows.forEach(f => {
    nodeSet.add(f.sourceIp);
    nodeSet.add(f.destIp);
    links.push({
      source: f.sourceIp,
      target: f.destIp,
      port: f.destPort,
      protocol: f.protocol,
      bytes: (f.bytesS2D || 0) + (f.bytesD2S || 0),
      allowed: f.allowed || 0,
      denied: f.denied || 0,
    });
  });

  const nodes = Array.from(nodeSet).map(ip => ({
    id: ip,
    name: ipMap[ip] || null,
    hasName: !!ipMap[ip],
  }));

  // Scale link width by bytes
  const maxBytes = Math.max(...links.map(l => l.bytes), 1);
  const linkScale = d3.scaleLog().domain([1, maxBytes]).range([0.5, 6]).clamp(true);

  const svg = d3.select(container).append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height]);

  // Zoom
  const g = svg.append("g");
  svg.call(d3.zoom().scaleExtent([0.2, 5]).on("zoom", (e) => g.attr("transform", e.transform)));

  // Arrow markers
  svg.append("defs").append("marker")
    .attr("id", "arrowhead").attr("viewBox", "0 -5 10 10")
    .attr("refX", 20).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#4b5078");

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(120))
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(30));

  // Links
  const link = g.append("g").selectAll("line")
    .data(links).join("line")
    .attr("stroke", d => d.denied > 0 ? "#f87171" : "#4b5078")
    .attr("stroke-width", d => linkScale(d.bytes || 1))
    .attr("stroke-opacity", 0.6)
    .attr("marker-end", "url(#arrowhead)");

  // Link tooltips
  link.append("title").text(d =>
    `${resolveIp(d.source.id || d.source)} → ${resolveIp(d.target.id || d.target)}\n` +
    `Port: ${d.port}/${d.protocol}\n` +
    `Traffic: ${formatBytes(d.bytes)}\n` +
    `Allowed: ${d.allowed} | Denied: ${d.denied}`
  );

  // Nodes
  const node = g.append("g").selectAll("g")
    .data(nodes).join("g")
    .call(d3.drag()
      .on("start", (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  node.append("circle")
    .attr("r", d => d.hasName ? 10 : 6)
    .attr("fill", d => d.hasName ? "#6366f1" : "#4b5078")
    .attr("stroke", d => d.hasName ? "#818cf8" : "#5b6094")
    .attr("stroke-width", 2);

  // Labels — show resource name if resolved, otherwise IP
  node.append("text")
    .text(d => d.name || d.id)
    .attr("dx", 14).attr("dy", 4)
    .attr("fill", d => d.hasName ? "#c4b5fd" : "#8b8fa3")
    .attr("font-size", d => d.hasName ? "12px" : "10px")
    .attr("font-weight", d => d.hasName ? "600" : "400");

  // Node tooltips
  node.append("title").text(d =>
    d.name ? `${d.name}\n${d.id}` : d.id
  );

  simulation.on("tick", () => {
    link
      .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Flow filter events
document.getElementById("btn-flow-refresh")?.addEventListener("click", loadTopology);

// ── Init ─────────────────────────────────────────────────────────────────────
loadOverview();
loadFilters();
