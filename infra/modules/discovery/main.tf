variable "location" {
  type = string
}

variable "rg_name" {
  type = string
}

variable "prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "tags" {
  type = map(string)
}

# User-Assigned Managed Identity for the discovery scanner
resource "azurerm_user_assigned_identity" "discovery" {
  name                = "${var.prefix}-${var.environment}-discovery-id"
  location            = var.location
  resource_group_name = var.rg_name
  tags                = merge(var.tags, { component = "discovery" })
}

# Cosmos DB Account with system-assigned identity
resource "azurerm_cosmosdb_account" "main" {
  name                          = "${var.prefix}-${var.environment}-cosmos"
  location                      = var.location
  resource_group_name           = var.rg_name
  offer_type                    = "Standard"
  kind                          = "GlobalDocumentDB"
  local_authentication_disabled = false # Keep keys as fallback, but prefer RBAC

  identity {
    type = "SystemAssigned"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = var.location
    failover_priority = 0
  }

  capabilities {
    name = "EnableServerless"
  }

  tags = merge(var.tags, { component = "discovery" })
}

# RBAC: Grant discovery managed identity "Cosmos DB Built-in Data Contributor" on the account
resource "azurerm_cosmosdb_sql_role_assignment" "discovery_data_contributor" {
  resource_group_name = var.rg_name
  account_name        = azurerm_cosmosdb_account.main.name
  # Cosmos DB Built-in Data Contributor role definition
  role_definition_id = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id       = azurerm_user_assigned_identity.discovery.principal_id
  scope              = azurerm_cosmosdb_account.main.id
}

resource "azurerm_cosmosdb_sql_database" "observability" {
  name                = "observability"
  resource_group_name = var.rg_name
  account_name        = azurerm_cosmosdb_account.main.name
}

resource "azurerm_cosmosdb_sql_container" "resources" {
  name                = "resources"
  resource_group_name = var.rg_name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.observability.name
  partition_key_paths = ["/subscriptionId"]

  indexing_policy {
    indexing_mode = "consistent"

    included_path { path = "/*" }

    excluded_path { path = "/properties/*" }
  }
}

resource "azurerm_cosmosdb_sql_container" "relationships" {
  name                = "relationships"
  resource_group_name = var.rg_name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.observability.name
  partition_key_paths = ["/sourceSubscriptionId"]
}

resource "azurerm_cosmosdb_sql_container" "snapshots" {
  name                = "snapshots"
  resource_group_name = var.rg_name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.observability.name
  partition_key_paths = ["/snapshotDate"]
}

output "cosmos_endpoint" {
  value = azurerm_cosmosdb_account.main.endpoint
}

output "cosmos_account_name" {
  value = azurerm_cosmosdb_account.main.name
}

output "database_name" {
  value = azurerm_cosmosdb_sql_database.observability.name
}

output "discovery_identity_id" {
  value = azurerm_user_assigned_identity.discovery.id
}

output "discovery_identity_client_id" {
  value = azurerm_user_assigned_identity.discovery.client_id
}

output "discovery_identity_principal_id" {
  value = azurerm_user_assigned_identity.discovery.principal_id
}
