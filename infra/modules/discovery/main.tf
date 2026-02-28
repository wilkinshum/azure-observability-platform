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

resource "azurerm_cosmosdb_account" "main" {
  name                = "${var.prefix}-${var.environment}-cosmos"
  location            = var.location
  resource_group_name = var.rg_name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

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

    included_path { path = "/type/?" }
    included_path { path = "/location/?" }
    included_path { path = "/resourceGroup/?" }
    included_path { path = "/tags/*" }
    included_path { path = "/discoveredAt/?" }

    excluded_path { path = "/properties/*" }
    excluded_path { path = "/\"_etag\"/?" }
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
