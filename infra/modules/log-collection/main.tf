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

variable "retention_days" {
  description = "Log retention in days"
  type        = number
  default     = 90
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.prefix}-${var.environment}-law"
  location            = var.location
  resource_group_name = var.rg_name
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_days

  tags = merge(var.tags, { component = "log-collection" })
}

resource "azurerm_application_insights" "main" {
  name                = "${var.prefix}-${var.environment}-ai"
  location            = var.location
  resource_group_name = var.rg_name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"

  tags = merge(var.tags, { component = "log-collection" })
}

# ── Azure Policy: Auto-enable diagnostic settings ─────────────────────────────

data "azurerm_subscription" "current" {}

# Built-in policy: Deploy diagnostic settings for Key Vault to Log Analytics
resource "azurerm_subscription_policy_assignment" "diag_keyvault" {
  name                 = "${var.prefix}-${var.environment}-diag-kv"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/bef3f64c-5290-43b7-85b0-9b254eef4c47"
  display_name         = "Deploy diagnostic settings for Key Vault to Log Analytics"
  location             = var.location

  identity {
    type = "SystemAssigned"
  }

  parameters = jsonencode({
    logAnalytics = { value = azurerm_log_analytics_workspace.main.id }
  })
}

# Built-in policy: Deploy Diagnostic Settings for Network Security Groups
# Note: This policy sends NSG flow logs to a storage account, not directly to Log Analytics
resource "azurerm_subscription_policy_assignment" "diag_nsg" {
  name                 = "${var.prefix}-${var.environment}-diag-nsg"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/c9c29499-c1d1-4195-99bd-2ec9e3a9dc89"
  display_name         = "Deploy diagnostic settings for NSG flow logs"
  location             = var.location

  identity {
    type = "SystemAssigned"
  }

  parameters = jsonencode({
    rgName        = { value = var.rg_name }
    storagePrefix = { value = "${var.prefix}${var.environment}nsgflow" }
  })
}

# Built-in policy: Deploy Diagnostic Settings for Activity Log to Log Analytics
resource "azurerm_subscription_policy_assignment" "diag_activity_log" {
  name                 = "${var.prefix}-${var.environment}-diag-act"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/2465583e-4e78-4c15-b6be-a36cbc7c8b0f"
  display_name         = "Deploy diagnostic settings for Activity Log to Log Analytics"
  location             = var.location

  identity {
    type = "SystemAssigned"
  }

  parameters = jsonencode({
    logAnalytics = { value = azurerm_log_analytics_workspace.main.id }
  })
}

# Role assignments: policy identities need Contributor to deploy diagnostic settings
resource "azurerm_role_assignment" "policy_diag_kv_contributor" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_subscription_policy_assignment.diag_keyvault.identity[0].principal_id
}

resource "azurerm_role_assignment" "policy_diag_nsg_contributor" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_subscription_policy_assignment.diag_nsg.identity[0].principal_id
}

resource "azurerm_role_assignment" "policy_diag_activity_contributor" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_subscription_policy_assignment.diag_activity_log.identity[0].principal_id
}

output "workspace_id" {
  value = azurerm_log_analytics_workspace.main.id
}

output "workspace_name" {
  value = azurerm_log_analytics_workspace.main.name
}

output "appinsights_connection_string" {
  value     = azurerm_application_insights.main.connection_string
  sensitive = true
}
