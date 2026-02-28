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
