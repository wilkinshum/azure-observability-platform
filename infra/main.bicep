targetScope = 'subscription'

@description('Primary deployment region')
param location string = 'eastus2'

@description('Environment name')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'dev'

@description('Project prefix for resource naming')
param prefix string = 'azobs'

// Resource Group
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: '${prefix}-${environment}-rg'
  location: location
  tags: {
    project: 'azure-observability-platform'
    environment: environment
  }
}

// Discovery module - Cosmos DB for resource inventory
module discovery 'modules/discovery/main.bicep' = {
  name: 'discovery-${environment}'
  scope: rg
  params: {
    location: location
    prefix: prefix
    environment: environment
  }
}

// Log Collection module - Log Analytics + Policies
module logCollection 'modules/log-collection/main.bicep' = {
  name: 'log-collection-${environment}'
  scope: rg
  params: {
    location: location
    prefix: prefix
    environment: environment
  }
}
