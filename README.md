# Azure Observability Platform

End-to-end Azure observability solution: automated resource discovery, data flow mapping, centralized log/metrics collection, and LLM-powered analysis.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Chat UI)                    │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│              LLM Orchestration Layer                     │
│         (Azure OpenAI + Function Calling)                │
│                                                          │
│   ┌──────────┐  ┌─────────────┐  ┌──────────────────┐  │
│   │ KQL Tool │  │ Cypher Tool │  │ Resource Graph    │  │
│   │          │  │             │  │ Tool              │  │
│   └────┬─────┘  └──────┬──────┘  └────────┬─────────┘  │
└────────┼───────────────┼──────────────────┼─────────────┘
         │               │                  │
         ▼               ▼                  ▼
   Log Analytics     Neo4j (AKS)     Azure Resource
   Workspace         Graph DB        Graph API
         ▲               ▲
         │               │
   ┌─────┴────┐   ┌──────┴───────┐
   │ Logs &   │   │ Flow Mapper  │
   │ Metrics  │   │ (NSG Flows → │
   │ Pipeline │   │  Graph)      │
   └──────────┘   └──────────────┘
         ▲               ▲
         │               │
   ┌─────┴───────────────┴──────┐
   │     Discovery Engine       │
   │  (Azure Resource Graph     │
   │   scheduled scans)         │
   └────────────────────────────┘
```

## Components

| Component | Description | Location |
|---|---|---|
| **Discovery Engine** | Scans all subscriptions via Azure Resource Graph, stores inventory | `discovery/` |
| **Flow Mapper** | Processes NSG/VNet flow logs into graph relationships | `flow-mapper/` |
| **Log Collection** | Azure Policy-driven diagnostic settings, centralized Log Analytics | `infra/modules/log-collection/` |
| **LLM Backend** | Azure OpenAI orchestrator with KQL, Cypher, and Resource Graph tools | `llm-backend/` |
| **Frontend** | Chat interface for natural language queries | `frontend/` |
| **Infrastructure** | Bicep modules for all Azure resources | `infra/` |

## Data Stores

| Store | Purpose | Technology |
|---|---|---|
| Resource Inventory | Flat resource records, tags, properties, snapshots | Azure Cosmos DB (NoSQL API) |
| Relationship Graph | Resource dependencies, network flows, data paths | Neo4j on AKS |
| Logs & Metrics | Centralized observability signals | Azure Log Analytics |
| Vector Store | RAG embeddings for runbooks, docs, past incidents | Azure AI Search |

## Phased Rollout

| Phase | Focus | Status |
|---|---|---|
| 1 | Discovery Engine + Central Log Analytics + Policies | 🔄 In Progress |
| 2 | Flow Mapping (NSG flow logs → graph DB) | ⏳ Planned |
| 3 | LLM Backend (NL→KQL, basic chat) | ⏳ Planned |
| 4 | Impact analysis, anomaly explanation, RAG | ⏳ Planned |

## Getting Started

### Prerequisites

- Azure subscription(s) with Reader access
- Azure CLI (`az`) authenticated
- Node.js 20+ / Python 3.11+
- Docker (for local Neo4j)

### Quick Start

```bash
# Clone
git clone https://github.com/wilkinshum/azure-observability-platform.git
cd azure-observability-platform

# Deploy infrastructure (Phase 1)
cd infra
terraform init
terraform plan -out=tfplan
terraform apply tfplan

# Run discovery
cd ../discovery/scanner
pip install -r requirements.txt
python scan.py
```

## License

MIT
