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


// -- Network Flows View -------------------------------------------------------
let chartProtocols = null;
let chartPorts = null;
let ipMap = {};
let azureIps = {};
let allFlows = [];

const PORT_NAMES = {
  "22": "SSH", "25": "SMTP", "53": "DNS", "80": "HTTP", "110": "POP3",
  "123": "NTP", "143": "IMAP", "443": "HTTPS", "445": "SMB", "587": "SMTP/TLS",
  "993": "IMAPS", "995": "POP3S", "1433": "SQL Server", "1521": "Oracle DB",
  "3306": "MySQL", "3389": "RDP", "5432": "PostgreSQL", "5671": "AMQP/TLS",
  "5672": "AMQP", "5985": "WinRM/HTTP", "5986": "WinRM/HTTPS", "6379": "Redis",
  "6443": "K8s API", "8080": "HTTP Alt", "8443": "HTTPS Alt", "8444": "HTTPS Alt",
  "9090": "Prometheus", "9200": "Elasticsearch", "9418": "Git", "10250": "Kubelet",
  "27017": "MongoDB", "30000": "NodePort", "30001": "NodePort", "32526": "Azure LB Health",
};

function portLabel(port) {
  const name = PORT_NAMES[port];
  return name ? `${name} (${port})` : `Port ${port}`;
}

function isPrivateIp(ip) {
  if (!ip) return false;
  return ip.startsWith("10.") || ip.startsWith("172.16.") || ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") || ip.startsWith("172.19.") || ip.startsWith("172.2") ||
    ip.startsWith("172.3") || ip.startsWith("192.168.") || ip === "127.0.0.1";
}

async function loadNetworkFlows() {
  try {
    const [summaryRes, ipMapRes, flowsRes, azureIpsRes] = await Promise.all([
      fetch("/api/network-flows/summary").then(r => r.json()),
      fetch("/api/network-flows/ip-map").then(r => r.json()),
      fetch("/api/network-flows?limit=500").then(r => r.json()),
      fetch("/api/network-flows/azure-ips").then(r => r.json()),
    ]);
    ipMap = ipMapRes;
    azureIps = azureIpsRes;
    allFlows = flowsRes;

    document.getElementById("total-flows").textContent = summaryRes.totalFlows.toLocaleString();
    const totalBytes = summaryRes.byProtocol.reduce((sum, p) => sum + (p.totalBytes || 0), 0);
    document.getElementById("total-flow-bytes").textContent = formatBytes(totalBytes);

    const internal = allFlows.filter(f => isPrivateIp(f.sourceIp) && isPrivateIp(f.destIp));
    const external = allFlows.filter(f => !isPrivateIp(f.sourceIp) || !isPrivateIp(f.destIp));
    document.getElementById("total-internal").textContent = internal.length.toLocaleString();
    document.getElementById("total-external").textContent = external.length.toLocaleString();

    const denied = allFlows.filter(f => (f.denied || 0) > 0);
    document.getElementById("total-denied-flows").textContent = denied.length.toLocaleString();

    const uniqueIps = new Set();
    allFlows.forEach(f => { uniqueIps.add(f.sourceIp); uniqueIps.add(f.destIp); });
    document.getElementById("total-unique-ips").textContent = uniqueIps.size.toLocaleString();

    const mappedCount = Object.keys(ipMap).length;
    document.getElementById("flow-stats").textContent =
      `${mappedCount} IPs mapped to Azure resources`;

    renderProtocolChart(summaryRes.byProtocol);
    renderPortsChart(summaryRes.topPorts);
    renderTopTalkers(summaryRes.topTalkers);
    renderDeniedTraffic(denied);
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
      datasets: [{ data: data.map(d => d.totalBytes || 0), backgroundColor: ["#6366f1", "#f472b6", "#fbbf24", "#34d399"], borderWidth: 0 }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "right", labels: { color: "#8b8fa3" } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatBytes(ctx.parsed)}` } },
      },
    },
  });
}

function renderPortsChart(data) {
  const ctx = document.getElementById("chart-ports").getContext("2d");
  if (chartPorts) chartPorts.destroy();
  chartPorts = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(d => portLabel(d.destPort)),
      datasets: [{
        label: "Traffic",
        data: data.map(d => d.totalBytes || 0),
        backgroundColor: data.map(d => {
          const p = d.destPort;
          if (p === "443" || p === "80") return "#4ade80";
          if (p === "22" || p === "3389") return "#fbbf24";
          if (p === "53") return "#38bdf8";
          if (p === "1433" || p === "5432" || p === "3306") return "#e879f9";
          return "#8b5cf6";
        }),
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => formatBytes(ctx.parsed.y) } } },
      scales: {
        x: { ticks: { color: "#8b8fa3", font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: "#8b8fa3", callback: v => formatBytes(v) }, grid: { color: "#2d3044" } },
      },
    },
  });
}

function renderTopTalkers(flows) {
  const tbody = document.getElementById("flows-body");
  if (!flows.length) { tbody.innerHTML = '<tr><td colspan="8" class="loading">No flows found</td></tr>'; return; }
  const sorted = [...flows].sort((a, b) => ((b.bytesS2D||0)+(b.bytesD2S||0)) - ((a.bytesS2D||0)+(a.bytesD2S||0)));
  tbody.innerHTML = sorted.map(f => {
    const total = (f.bytesS2D || 0) + (f.bytesD2S || 0);
    const hasDenied = (f.denied || 0) > 0;
    const isInternal = isPrivateIp(f.sourceIp) && isPrivateIp(f.destIp);
    const statusIcon = hasDenied ? '\u{1F6AB}' : '\u2705';
    const statusText = hasDenied ? `${f.denied} denied` : `${f.allowed || 0} allowed`;
    const dirTag = isInternal ? '<span class="tag tag-internal">Internal</span>' : '<span class="tag tag-external">External</span>';
    return `<tr class="${hasDenied ? 'row-denied' : ''}">
      <td title="${esc(f.sourceIp)}">${esc(resolveIpFull(f.sourceIp))}</td>
      <td title="${esc(f.destIp)}">${esc(resolveIpFull(f.destIp))}</td>
      <td>${esc(portLabel(f.destPort))}</td>
      <td><span class="tag">${esc(f.protocol)}</span> ${dirTag}</td>
      <td>${formatBytes(f.bytesS2D || 0)}</td>
      <td>${formatBytes(f.bytesD2S || 0)}</td>
      <td><strong>${formatBytes(total)}</strong></td>
      <td>${statusIcon} ${statusText}</td>
    </tr>`;
  }).join("");
}

function renderDeniedTraffic(denied) {
  const section = document.getElementById("denied-section");
  if (!denied.length) { section.style.display = "none"; return; }
  section.style.display = "block";
  const tbody = document.getElementById("denied-body");
  const sorted = [...denied].sort((a, b) => (b.denied||0) - (a.denied||0));
  tbody.innerHTML = sorted.map(f => `<tr>
    <td title="${esc(f.sourceIp)}">${esc(resolveIpFull(f.sourceIp))}</td>
    <td title="${esc(f.destIp)}">${esc(resolveIpFull(f.destIp))}</td>
    <td>${esc(portLabel(f.destPort))}</td>
    <td><span class="tag">${esc(f.protocol)}</span></td>
    <td style="color:#f87171;font-weight:600">${(f.denied||0).toLocaleString()}</td>
    <td>${(f.rules||[]).map(r => '<span class="tag">'+esc(r)+'</span>').join(" ")}</td>
  </tr>`).join("");
}

function resolveIp(ip) { return ip ? (ipMap[ip] || ip) : "\u2014"; }
function resolveIpFull(ip) {
  if (!ip) return "\u2014";
  const name = ipMap[ip];
  if (name) return `${name} (${ip})`;
  const azLabel = azureIps[ip];
  if (azLabel) return `${ip} [${azLabel}]`;
  return isPrivateIp(ip) ? `${ip} [private]` : `${ip} [public]`;
}
function isAzureIp(ip) { return !!azureIps[ip]; }

async function loadTopology() {
  const protocol = document.getElementById("flow-filter-protocol").value;
  const direction = document.getElementById("flow-filter-direction").value;
  const port = document.getElementById("flow-filter-port").value;
  const ipFilter = document.getElementById("flow-filter-ip").value.toLowerCase();
  const hideAzure = document.getElementById("flow-filter-hide-azure").checked;
  let filtered = [...allFlows];
  if (protocol) filtered = filtered.filter(f => f.protocol === protocol);
  if (port) filtered = filtered.filter(f => f.destPort === port);
  if (direction === "internal") filtered = filtered.filter(f => isPrivateIp(f.sourceIp) && isPrivateIp(f.destIp));
  if (direction === "external") filtered = filtered.filter(f => !isPrivateIp(f.sourceIp) || !isPrivateIp(f.destIp));
  if (direction === "denied") filtered = filtered.filter(f => (f.denied||0) > 0);
  if (hideAzure) filtered = filtered.filter(f => !isAzureIp(f.sourceIp) && !isAzureIp(f.destIp));
  if (ipFilter) {
    filtered = filtered.filter(f => {
      const s = (ipMap[f.sourceIp]||"").toLowerCase(), d = (ipMap[f.destIp]||"").toLowerCase();
      return f.sourceIp.includes(ipFilter) || f.destIp.includes(ipFilter) || s.includes(ipFilter) || d.includes(ipFilter);
    });
  }
  filtered.sort((a,b) => ((b.bytesS2D||0)+(b.bytesD2S||0)) - ((a.bytesS2D||0)+(a.bytesD2S||0)));
  filtered = filtered.slice(0, 100);
  renderTopology(filtered);
}

function renderTopology(flows) {
  const container = document.getElementById("topology-container");
  container.innerHTML = "";
  if (!flows.length) { container.innerHTML = '<div style="color:#8b8fa3;text-align:center;padding:40px">No flows match filters.</div>'; return; }
  const width = container.clientWidth, height = 600;
  const nodeSet = new Set(), links = [];
  flows.forEach(f => {
    nodeSet.add(f.sourceIp); nodeSet.add(f.destIp);
    links.push({ source: f.sourceIp, target: f.destIp, port: f.destPort, protocol: f.protocol,
      bytes: (f.bytesS2D||0)+(f.bytesD2S||0), allowed: f.allowed||0, denied: f.denied||0, portLabel: portLabel(f.destPort) });
  });
  const nodes = Array.from(nodeSet).map(ip => ({ id: ip, name: ipMap[ip]||null, hasName: !!ipMap[ip], isPrivate: isPrivateIp(ip), isAzure: isAzureIp(ip), azureLabel: azureIps[ip]||null }));
  const maxBytes = Math.max(...links.map(l => l.bytes), 1);
  const linkScale = d3.scaleLog().domain([1, maxBytes]).range([0.5, 8]).clamp(true);
  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("viewBox", [0,0,width,height]);
  const g = svg.append("g");
  svg.call(d3.zoom().scaleExtent([0.2, 5]).on("zoom", (e) => g.attr("transform", e.transform)));
  const defs = svg.append("defs");
  defs.append("marker").attr("id","arrow-normal").attr("viewBox","0 -5 10 10").attr("refX",22).attr("refY",0).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto").append("path").attr("d","M0,-4L10,0L0,4").attr("fill","#4b5078");
  defs.append("marker").attr("id","arrow-denied").attr("viewBox","0 -5 10 10").attr("refX",22).attr("refY",0).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto").append("path").attr("d","M0,-4L10,0L0,4").attr("fill","#f87171");
  const simulation = d3.forceSimulation(nodes).force("link", d3.forceLink(links).id(d=>d.id).distance(140)).force("charge", d3.forceManyBody().strength(-300)).force("center", d3.forceCenter(width/2, height/2)).force("collision", d3.forceCollide().radius(35));
  const link = g.append("g").selectAll("line").data(links).join("line").attr("stroke", d => d.denied>0 ? "#f87171" : "#4b5078").attr("stroke-width", d => linkScale(d.bytes||1)).attr("stroke-opacity", 0.6).attr("marker-end", d => d.denied>0 ? "url(#arrow-denied)" : "url(#arrow-normal)");
  link.append("title").text(d => `${resolveIpFull(d.source.id||d.source)} \u2192 ${resolveIpFull(d.target.id||d.target)}\nService: ${d.portLabel} (${d.protocol})\nTraffic: ${formatBytes(d.bytes)}\nAllowed: ${d.allowed} | Denied: ${d.denied}`);
  const node = g.append("g").selectAll("g").data(nodes).join("g").call(d3.drag().on("start",(e,d)=>{if(!e.active) simulation.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;}).on("drag",(e,d)=>{d.fx=e.x;d.fy=e.y;}).on("end",(e,d)=>{if(!e.active) simulation.alphaTarget(0);d.fx=null;d.fy=null;}));
  node.append("circle").attr("r", d => d.hasName ? 12 : 7).attr("fill", d => d.hasName ? "#6366f1" : d.isAzure ? "#0e4f92" : d.isPrivate ? "#374151" : "#92400e").attr("stroke", d => d.hasName ? "#818cf8" : d.isAzure ? "#38bdf8" : d.isPrivate ? "#6b7280" : "#d97706").attr("stroke-width", 2);
  node.append("text").text(d => d.name || (d.isAzure ? d.azureLabel : d.id)).attr("dx",16).attr("dy",4).attr("fill", d => d.hasName ? "#c4b5fd" : d.isAzure ? "#7dd3fc" : d.isPrivate ? "#9ca3af" : "#fbbf24").attr("font-size", d => d.hasName ? "12px" : "10px").attr("font-weight", d => d.hasName ? "600" : "400");
  node.append("title").text(d => (d.name ? `${d.name}\n${d.id}` : d.isAzure ? `${d.azureLabel}\n${d.id}` : d.id) + `\n${d.isPrivate ? "Private IP" : d.isAzure ? "Azure/Microsoft IP" : "Public IP"}`);
  simulation.on("tick", () => { link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y); node.attr("transform",d=>`translate(${d.x},${d.y})`); });
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024, sizes = ["B","KB","MB","GB","TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

document.getElementById("btn-flow-refresh")?.addEventListener("click", loadTopology);
document.getElementById("flow-filter-ip")?.addEventListener("keydown", (e) => { if (e.key === "Enter") loadTopology(); });

// -- Init ---------------------------------------------------------------------
loadOverview();
loadFilters();
