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

variable "cosmos_endpoint" {
  type = string
}

variable "cosmos_account_name" {
  type = string
}

variable "discovery_identity_id" {
  type = string
}

variable "appinsights_connection_string" {
  type      = string
  sensitive = true
}

# Storage account for Function App
resource "azurerm_storage_account" "functions" {
  name                     = "${var.prefix}${var.environment}funcsa"
  resource_group_name      = var.rg_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  tags                     = merge(var.tags, { component = "scanner" })
}

# App Service Plan (Consumption for Function, B1 for Dashboard)
resource "azurerm_service_plan" "functions" {
  name                = "${var.prefix}-${var.environment}-func-plan"
  location            = var.location
  resource_group_name = var.rg_name
  os_type             = "Linux"
  sku_name            = "Y1" # Consumption plan — pay per execution
  tags                = merge(var.tags, { component = "scanner" })
}

resource "azurerm_service_plan" "dashboard" {
  name                = "${var.prefix}-${var.environment}-dash-plan"
  location            = var.location
  resource_group_name = var.rg_name
  os_type             = "Linux"
  sku_name            = "B1" # Basic — cheapest always-on SKU
  tags                = merge(var.tags, { component = "dashboard" })
}

# Function App — Discovery Scanner
resource "azurerm_linux_function_app" "scanner" {
  name                       = "${var.prefix}-${var.environment}-scanner"
  location                   = var.location
  resource_group_name        = var.rg_name
  service_plan_id            = azurerm_service_plan.functions.id
  storage_account_name       = azurerm_storage_account.functions.name
  storage_account_access_key = azurerm_storage_account.functions.primary_access_key

  identity {
    type         = "UserAssigned"
    identity_ids = [var.discovery_identity_id]
  }

  site_config {
    application_stack {
      python_version = "3.11"
    }
  }

  app_settings = {
    "COSMOS_ENDPOINT"                     = var.cosmos_endpoint
    "COSMOS_DATABASE"                     = "observability"
    "AZURE_CLIENT_ID"                     = data.azurerm_user_assigned_identity.discovery.client_id
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = var.appinsights_connection_string
    "SCM_DO_BUILD_DURING_DEPLOYMENT"      = "true"
  }

  tags = merge(var.tags, { component = "scanner" })
}

# Dashboard Web App
resource "azurerm_linux_web_app" "dashboard" {
  name                = "${var.prefix}-${var.environment}-dashboard"
  location            = var.location
  resource_group_name = var.rg_name
  service_plan_id     = azurerm_service_plan.dashboard.id

  identity {
    type         = "UserAssigned"
    identity_ids = [var.discovery_identity_id]
  }

  site_config {
    application_stack {
      node_version = "20-lts"
    }
  }

  app_settings = {
    "COSMOS_ENDPOINT"                     = var.cosmos_endpoint
    "COSMOS_DATABASE"                     = "observability"
    "AZURE_CLIENT_ID"                     = data.azurerm_user_assigned_identity.discovery.client_id
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = var.appinsights_connection_string
    "SCM_DO_BUILD_DURING_DEPLOYMENT"      = "true"
  }

  tags = merge(var.tags, { component = "dashboard" })
}

data "azurerm_user_assigned_identity" "discovery" {
  name                = "${var.prefix}-${var.environment}-discovery-id"
  resource_group_name = var.rg_name
}

output "function_app_name" {
  value = azurerm_linux_function_app.scanner.name
}

output "function_app_url" {
  value = "https://${azurerm_linux_function_app.scanner.default_hostname}"
}

output "dashboard_url" {
  value = "https://${azurerm_linux_web_app.dashboard.default_hostname}"
}
