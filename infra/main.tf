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
  discovery_identity_id         = module.discovery.discovery_identity_id
  appinsights_connection_string = module.log_collection.appinsights_connection_string
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

output "scanner_function_url" {
  value = module.compute.function_app_url
}

output "dashboard_url" {
  value = module.compute.dashboard_url
}
