terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # Uncomment for remote state
  # backend "azurerm" {
  #   resource_group_name  = "tfstate-rg"
  #   storage_account_name = "tfstateazobs"
  #   container_name       = "tfstate"
  #   key                  = "observability.tfstate"
  # }
}

provider "azurerm" {
  features {}
}

provider "azurerm" {
  alias           = "target_sub"
  subscription_id = "f627598e-05c5-4093-8667-5730c4026ea3"
  features {}
}

variable "location" {
  description = "Primary deployment region"
  type        = string
  default     = "eastus2"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "prefix" {
  description = "Project prefix for resource naming"
  type        = string
  default     = "azobs"
}

locals {
  common_tags = {
    project     = "azure-observability-platform"
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "azurerm_resource_group" "main" {
  name     = "${var.prefix}-${var.environment}-rg"
  location = var.location
  tags     = local.common_tags
}

module "discovery" {
  source      = "./modules/discovery"
  location    = azurerm_resource_group.main.location
  rg_name     = azurerm_resource_group.main.name
  prefix      = var.prefix
  environment = var.environment
  tags        = local.common_tags
}

module "log_collection" {
  source      = "./modules/log-collection"
  location    = azurerm_resource_group.main.location
  rg_name     = azurerm_resource_group.main.name
  prefix      = var.prefix
  environment = var.environment
  tags        = local.common_tags
}

# Grant discovery identity "Reader" at subscription level for Resource Graph queries
data "azurerm_subscription" "current" {}

resource "azurerm_role_assignment" "discovery_reader" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Reader"
  principal_id         = module.discovery.discovery_identity_principal_id
}

# Grant discovery identity "Log Analytics Reader" on the workspace
resource "azurerm_role_assignment" "discovery_log_reader" {
  scope                = module.log_collection.workspace_id
  role_definition_name = "Log Analytics Reader"
  principal_id         = module.discovery.discovery_identity_principal_id
}

module "compute" {
  source                        = "./modules/compute"
  location                      = azurerm_resource_group.main.location
  rg_name                       = azurerm_resource_group.main.name
  prefix                        = var.prefix
  environment                   = var.environment
  tags                          = local.common_tags
  cosmos_endpoint               = module.discovery.cosmos_endpoint
  cosmos_account_name           = module.discovery.cosmos_account_name
  discovery_identity_id              = module.discovery.discovery_identity_id
  discovery_identity_principal_id    = module.discovery.discovery_identity_principal_id
  appinsights_connection_string      = module.log_collection.appinsights_connection_string
}

output "cosmos_endpoint" {
  value = module.discovery.cosmos_endpoint
}

output "discovery_identity_client_id" {
  value = module.discovery.discovery_identity_client_id
}

output "log_analytics_workspace_id" {
  value = module.log_collection.workspace_id
}

output "dashboard_url" {
  value = module.compute.dashboard_url
}

# ── Phase 2: Flow Mapping ────────────────────────────────────────────────────

module "flow_mapping" {
  source      = "./modules/flow-mapping"
  location    = azurerm_resource_group.main.location
  rg_name     = azurerm_resource_group.main.name
  prefix      = var.prefix
  environment = var.environment
  tags        = local.common_tags

  providers = {
    azurerm            = azurerm
    azurerm.target_sub = azurerm.target_sub
  }

  discovery_identity_id           = module.discovery.discovery_identity_id
  discovery_identity_principal_id = module.discovery.discovery_identity_principal_id
  cosmos_endpoint                 = module.discovery.cosmos_endpoint
  cosmos_account_name             = module.discovery.cosmos_account_name

  acr_login_server   = module.compute.acr_login_server
  acr_admin_username = module.compute.acr_admin_username
  acr_admin_password = module.compute.acr_admin_password

  appinsights_connection_string = module.log_collection.appinsights_connection_string

  log_analytics_workspace_id   = module.log_collection.workspace_id
  log_analytics_workspace_guid = module.log_collection.workspace_customer_id

  target_subscription_id = "f627598e-05c5-4093-8667-5730c4026ea3"
  target_vnet_ids = [
    "/subscriptions/f627598e-05c5-4093-8667-5730c4026ea3/resourceGroups/connected/providers/Microsoft.Network/virtualNetworks/connected-test",
    "/subscriptions/f627598e-05c5-4093-8667-5730c4026ea3/resourceGroups/default-activitylogalerts/providers/Microsoft.Network/virtualNetworks/dev-vnet1",
    "/subscriptions/f627598e-05c5-4093-8667-5730c4026ea3/resourceGroups/devopsagent/providers/Microsoft.Network/virtualNetworks/hub-vnet",
    "/subscriptions/f627598e-05c5-4093-8667-5730c4026ea3/resourceGroups/es-kub/providers/Microsoft.Network/virtualNetworks/es-kub-vnet",
    "/subscriptions/f627598e-05c5-4093-8667-5730c4026ea3/resourceGroups/networktest-rg/providers/Microsoft.Network/virtualNetworks/networktest-vnet2",
    "/subscriptions/f627598e-05c5-4093-8667-5730c4026ea3/resourceGroups/overlaykubdev/providers/Microsoft.Network/virtualNetworks/overlaykubdev-vnet1",
  ]
}

output "flowlogs_storage_account" {
  value = module.flow_mapping.flowlogs_storage_account
}
