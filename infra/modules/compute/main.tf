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

variable "discovery_identity_principal_id" {
  type = string
}

variable "appinsights_connection_string" {
  type      = string
  sensitive = true
}

data "azurerm_user_assigned_identity" "discovery" {
  name                = "${var.prefix}-${var.environment}-discovery-id"
  resource_group_name = var.rg_name
}

# ACR for container images
resource "azurerm_container_registry" "main" {
  name                = "${var.prefix}${var.environment}acr"
  resource_group_name = var.rg_name
  location            = var.location
  sku                 = "Basic"
  admin_enabled       = true
  tags                = merge(var.tags, { component = "compute" })
}

# Grant discovery MI AcrPull on ACR
resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = var.discovery_identity_principal_id
}

# Dashboard — ACI with public IP
resource "azurerm_container_group" "dashboard" {
  name                = "${var.prefix}-${var.environment}-dashboard"
  location            = var.location
  resource_group_name = var.rg_name
  os_type             = "Linux"
  ip_address_type     = "Public"
  dns_name_label      = "${var.prefix}-${var.environment}-dashboard"
  restart_policy      = "Always"

  identity {
    type         = "UserAssigned"
    identity_ids = [var.discovery_identity_id]
  }

  image_registry_credential {
    server   = azurerm_container_registry.main.login_server
    username = azurerm_container_registry.main.admin_username
    password = azurerm_container_registry.main.admin_password
  }

  container {
    name   = "dashboard"
    image  = "${azurerm_container_registry.main.login_server}/azobs-dashboard:latest"
    cpu    = "0.5"
    memory = "0.5"

    ports {
      port     = 3000
      protocol = "TCP"
    }

    environment_variables = {
      "COSMOS_ENDPOINT" = var.cosmos_endpoint
      "COSMOS_DATABASE" = "observability"
      "AZURE_CLIENT_ID" = data.azurerm_user_assigned_identity.discovery.client_id
      "PORT"            = "3000"
    }

    secure_environment_variables = {
      "APPLICATIONINSIGHTS_CONNECTION_STRING" = var.appinsights_connection_string
    }
  }

  exposed_port {
    port     = 3000
    protocol = "TCP"
  }

  tags = merge(var.tags, { component = "dashboard" })

  depends_on = [azurerm_role_assignment.acr_pull]
}

output "acr_login_server" {
  value = azurerm_container_registry.main.login_server
}

output "acr_name" {
  value = azurerm_container_registry.main.name
}

output "dashboard_url" {
  value = "http://${azurerm_container_group.dashboard.fqdn}:3000"
}

output "dashboard_ip" {
  value = azurerm_container_group.dashboard.ip_address
}
