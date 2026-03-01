terraform {
  required_providers {
    azurerm = {
      source                = "hashicorp/azurerm"
      configuration_aliases = [azurerm, azurerm.target_sub]
    }
  }
}

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

variable "discovery_identity_id" {
  type = string
}

variable "discovery_identity_principal_id" {
  type = string
}

variable "discovery_identity_client_id" {
  type = string
}

variable "cosmos_endpoint" {
  type = string
}

variable "cosmos_account_name" {
  type = string
}

variable "acr_login_server" {
  type = string
}

variable "acr_admin_username" {
  type = string
}

variable "acr_admin_password" {
  type      = string
  sensitive = true
}

variable "appinsights_connection_string" {
  type      = string
  sensitive = true
}

variable "target_subscription_id" {
  description = "Subscription ID containing VNets to enable flow logs on"
  type        = string
}

variable "target_vnet_ids" {
  description = "List of VNet resource IDs to enable flow logs on"
  type        = list(string)
}

variable "log_analytics_workspace_id" {
  type = string
}

variable "log_analytics_workspace_guid" {
  type = string
}

# ── Storage for VNet Flow Logs (MI auth only, no shared keys) ─────────────────
# NOTE: Storage account created via CLI, not Terraform, because AzureRM provider v4
# cannot manage storage accounts with shared_access_key_enabled=false (data plane check fails).
# MG-level policy enforces no shared key access.

data "azurerm_storage_account" "flowlogs" {
  name                = "${var.prefix}${var.environment}flowlogs"
  resource_group_name = var.rg_name
}

# Role assignment for MI blob reader also done via CLI (same reason).

# ── VNet Flow Logs (must be in same subscription as VNets) ────────────────────

resource "azurerm_network_watcher_flow_log" "vnet_flows" {
  provider = azurerm.target_sub
  count    = length(var.target_vnet_ids)

  name                 = "${var.prefix}-${var.environment}-flowlog-${count.index}"
  network_watcher_name = "NetworkWatcher_${var.location}"
  resource_group_name  = "NetworkWatcherRG"

  target_resource_id = var.target_vnet_ids[count.index]
  storage_account_id = data.azurerm_storage_account.flowlogs.id
  enabled            = true
  version            = 2

  retention_policy {
    enabled = true
    days    = 30
  }

  traffic_analytics {
    enabled               = true
    workspace_id          = var.log_analytics_workspace_guid
    workspace_region      = var.location
    workspace_resource_id = var.log_analytics_workspace_id
    interval_in_minutes   = 10
  }

  tags = merge(var.tags, { component = "flow-mapping" })
}

# ── Cosmos DB container for network flows ─────────────────────────────────────

resource "azurerm_cosmosdb_sql_container" "network_flows" {
  name                = "network-flows"
  resource_group_name = var.rg_name
  account_name        = var.cosmos_account_name
  database_name       = "observability"
  partition_key_paths = ["/subscriptionId"]

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    excluded_path {
      path = "/\"_etag\"/?"
    }
  }
}

# ── Flow Mapper ACI (scheduled one-shot, same pattern as scanner) ─────────────

resource "azurerm_container_group" "flow_mapper" {
  name                = "${var.prefix}-${var.environment}-flow-mapper"
  location            = var.location
  resource_group_name = var.rg_name
  os_type             = "Linux"
  ip_address_type     = "None"
  restart_policy      = "Never"

  identity {
    type         = "UserAssigned"
    identity_ids = [var.discovery_identity_id]
  }

  image_registry_credential {
    server   = var.acr_login_server
    username = var.acr_admin_username
    password = var.acr_admin_password
  }

  container {
    name   = "flow-mapper"
    image  = "${var.acr_login_server}/azobs-flow-mapper:latest"
    cpu    = "1"
    memory = "1"

    environment_variables = {
      "AZURE_CLIENT_ID"        = var.discovery_identity_client_id
      "STORAGE_ACCOUNT_NAME"   = data.azurerm_storage_account.flowlogs.name
      "COSMOS_ENDPOINT"        = var.cosmos_endpoint
      "COSMOS_DATABASE"        = "observability"
      "TARGET_SUBSCRIPTION_ID" = var.target_subscription_id
    }

    secure_environment_variables = {
      "APPLICATIONINSIGHTS_CONNECTION_STRING" = var.appinsights_connection_string
    }
  }

  tags = merge(var.tags, { component = "flow-mapping" })
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "flowlogs_storage_account" {
  value = data.azurerm_storage_account.flowlogs.name
}
