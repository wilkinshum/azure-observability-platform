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
      labels: data.map((d) => d.subscriptionId.slice(0, 12) + "..."),
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

// ── Init ─────────────────────────────────────────────────────────────────────
loadOverview();
loadFilters();
