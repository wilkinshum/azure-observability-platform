# Authentication Strategy

## Priority Order

All components in this platform follow the same authentication hierarchy:

| Priority | Method | When to Use |
|---|---|---|
| **1** | **Managed Identity (User-Assigned)** | Production — preferred for all Azure-hosted services |
| **2** | **Managed Identity (System-Assigned)** | When user-assigned isn't practical |
| **3** | **Service Principal (SPN)** | CI/CD pipelines, external systems |
| **4** | **Azure CLI** | Local development only |
| **5** | **Keys / Connection Strings** | Last resort — only when RBAC is not supported |

## Managed Identities

### Discovery Scanner
- **Identity:** `azobs-{env}-discovery-id` (User-Assigned)
- **Roles:**
  - `Reader` on subscription → Azure Resource Graph queries
  - `Cosmos DB Built-in Data Contributor` on Cosmos DB account → read/write resource data
  - `Log Analytics Reader` on workspace → query logs

### Future: LLM Backend
- Will get its own User-Assigned MI with:
  - `Cognitive Services OpenAI User` on Azure OpenAI
  - `Cosmos DB Built-in Data Reader` on Cosmos DB
  - `Log Analytics Reader` on workspace

## Environment Variables

When Managed Identity is not available (e.g., local dev, CI), set:

```bash
# Service Principal auth
export AZURE_TENANT_ID="<tenant-id>"
export AZURE_CLIENT_ID="<spn-client-id>"
export AZURE_CLIENT_SECRET="<spn-secret>"

# Or just use Azure CLI
az login
```

## Cosmos DB

- **RBAC is primary auth** — the discovery identity has `Cosmos DB Built-in Data Contributor`
- Keys remain enabled as fallback (`local_authentication_disabled = false`)
- Goal: disable keys once all components use RBAC

## Rules

1. **Never hardcode credentials** in code or config files
2. **Never commit keys** to git
3. **Prefer RBAC** over access keys wherever possible
4. **Use `DefaultAzureCredential`** in code — it automatically chains through MI → SPN → CLI
5. **One identity per component** — don't share identities across services
