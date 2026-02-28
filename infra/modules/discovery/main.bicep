@description('Deployment region')
param location string

@description('Project prefix')
param prefix string

@description('Environment')
param environment string

// Cosmos DB Account
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: '${prefix}-${environment}-cosmos'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
  }
  tags: {
    component: 'discovery'
    environment: environment
  }
}

// Database
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: 'observability'
  properties: {
    resource: {
      id: 'observability'
    }
  }
}

// Container: Resources (partitioned by subscriptionId)
resource resourcesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'resources'
  properties: {
    resource: {
      id: 'resources'
      partitionKey: {
        paths: ['/subscriptionId']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          { path: '/type/?' }
          { path: '/location/?' }
          { path: '/resourceGroup/?' }
          { path: '/tags/*' }
          { path: '/discoveredAt/?' }
        ]
        excludedPaths: [
          { path: '/properties/*' }
          { path: '/"_etag"/?' }
        ]
      }
    }
  }
}

// Container: Relationships
resource relationshipsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'relationships'
  properties: {
    resource: {
      id: 'relationships'
      partitionKey: {
        paths: ['/sourceSubscriptionId']
        kind: 'Hash'
      }
    }
  }
}

// Container: Snapshots (for change tracking)
resource snapshotsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'snapshots'
  properties: {
    resource: {
      id: 'snapshots'
      partitionKey: {
        paths: ['/snapshotDate']
        kind: 'Hash'
      }
    }
  }
}

output cosmosAccountName string = cosmosAccount.name
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output databaseName string = database.name
