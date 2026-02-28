@description('Deployment region')
param location string

@description('Project prefix')
param prefix string

@description('Environment')
param environment string

@description('Log retention in days')
param retentionDays int = 90

// Log Analytics Workspace
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-${environment}-law'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
  tags: {
    component: 'log-collection'
    environment: environment
  }
}

// Application Insights (for the platform itself)
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-${environment}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    RetentionInDays: retentionDays
  }
  tags: {
    component: 'log-collection'
    environment: environment
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
