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

output "cosmos_endpoint" {
  value = module.discovery.cosmos_endpoint
}

output "log_analytics_workspace_id" {
  value = module.log_collection.workspace_id
}
