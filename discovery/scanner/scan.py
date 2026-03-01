"""
Azure Resource Discovery Scanner

Auth priority:
  1. Managed Identity (User-Assigned or System-Assigned)
  2. Service Principal (via environment variables)
  3. Azure CLI (local dev fallback)

Scans all accessible subscriptions via Azure Resource Graph
and stores results in Cosmos DB using RBAC (no keys).
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from azure.identity import ManagedIdentityCredential, DefaultAzureCredential, ChainedTokenCredential
from azure.mgmt.resourcegraph import ResourceGraphClient
from azure.mgmt.resourcegraph.models import QueryRequest, QueryRequestOptions
from azure.cosmos.aio import CosmosClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Configuration via environment variables
COSMOS_ENDPOINT = os.environ.get("COSMOS_ENDPOINT", "https://<your-cosmos>.documents.azure.com:443/")
DATABASE_NAME = os.environ.get("COSMOS_DATABASE", "observability")
CONTAINER_NAME = os.environ.get("COSMOS_CONTAINER", "resources")
RELATIONSHIPS_CONTAINER = os.environ.get("COSMOS_RELATIONSHIPS_CONTAINER", "relationships")

# Optional: User-Assigned Managed Identity client ID
MANAGED_IDENTITY_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", None)

# Resource Graph queries
QUERIES = {
    "all_resources": """
        resources
        | project id, name, type, location, subscriptionId, resourceGroup,
                  tags, properties, sku, kind, identity
        | order by type asc, name asc
    """,
    "all_resource_groups": """
        resourcecontainers
        | where type == 'microsoft.resources/subscriptions/resourcegroups'
        | project id, name, subscriptionId, location, tags, properties
    """,
    "all_subscriptions": """
        resourcecontainers
        | where type == 'microsoft.resources/subscriptions'
        | project id, name, subscriptionId, properties
    """,
    "networking": """
        resources
        | where type in~ (
            'microsoft.network/virtualnetworks',
            'microsoft.network/networkinterfaces',
            'microsoft.network/networksecuritygroups',
            'microsoft.network/publicipaddresses',
            'microsoft.network/loadbalancers',
            'microsoft.network/applicationgateways',
            'microsoft.network/privateendpoints',
            'microsoft.network/privatednszones'
        )
        | project id, name, type, location, subscriptionId, resourceGroup,
                  tags, properties
    """,
    "vnet_peerings": """
        resources
        | where type =~ 'microsoft.network/virtualnetworks'
        | mv-expand peering = properties.virtualNetworkPeerings
        | project sourceVnetId = id,
                  sourceVnetName = name,
                  peeringName = peering.name,
                  remoteVnetId = tostring(peering.properties.remoteVirtualNetwork.id),
                  peeringState = tostring(peering.properties.peeringState)
    """,
    "private_endpoints": """
        resources
        | where type =~ 'microsoft.network/privateendpoints'
        | mv-expand connection = properties.privateLinkServiceConnections
        | project peId = id, peName = name, subscriptionId, resourceGroup,
                  targetResourceId = tostring(connection.properties.privateLinkServiceId),
                  groupIds = connection.properties.groupIds
    """,
}


def get_credential():
    """
    Build credential chain:
      1. Managed Identity (user-assigned if AZURE_CLIENT_ID is set, else system-assigned)
      2. Falls back to DefaultAzureCredential (SPN via env vars, CLI, etc.)
    """
    credentials = []

    if MANAGED_IDENTITY_CLIENT_ID:
        logger.info(f"Adding User-Assigned Managed Identity credential (client_id={MANAGED_IDENTITY_CLIENT_ID})")
        credentials.append(ManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID))
    else:
        logger.info("Adding System-Assigned Managed Identity credential")
        credentials.append(ManagedIdentityCredential())

    logger.info("Adding DefaultAzureCredential as fallback (SPN / CLI / env vars)")
    credentials.append(DefaultAzureCredential())

    return ChainedTokenCredential(*credentials)


class DiscoveryScanner:
    def __init__(self):
        self.credential = get_credential()
        self.graph_client = ResourceGraphClient(self.credential)
        self.scan_timestamp = datetime.now(timezone.utc).isoformat()
        self.scan_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.stats = {"resources": 0, "relationships": 0, "errors": 0}

    async def init_cosmos(self):
        """Connect to Cosmos DB using RBAC (Managed Identity). No keys needed."""
        self.cosmos_client = CosmosClient(COSMOS_ENDPOINT, credential=self.credential)
        self.database = self.cosmos_client.get_database_client(DATABASE_NAME)
        self.resources_container = self.database.get_container_client(CONTAINER_NAME)
        self.relationships_container = self.database.get_container_client(RELATIONSHIPS_CONTAINER)
        logger.info(f"Connected to Cosmos DB: {COSMOS_ENDPOINT} (RBAC auth)")

    def query_resource_graph(self, query: str, subscriptions: list[str] | None = None) -> list[dict]:
        """Execute a Resource Graph query with automatic pagination."""
        all_results = []
        skip_token = None

        options = QueryRequestOptions(top=1000, result_format="objectArray")
        request = QueryRequest(
            query=query,
            subscriptions=subscriptions or [],
            options=options,
        )

        while True:
            if skip_token:
                options.skip_token = skip_token
                request.options = options

            response = self.graph_client.resources(request)
            all_results.extend(response.data)
            logger.info(f"  Fetched {len(response.data)} results (total: {len(all_results)}/{response.total_records})")

            skip_token = response.skip_token
            if not skip_token:
                break

        return all_results

    async def upsert_resource(self, resource: dict):
        """Upsert a resource document into Cosmos DB."""
        doc = {
            "id": resource["id"].lower().replace("/", "_"),
            "resourceId": resource["id"],
            "name": resource.get("name", ""),
            "type": resource.get("type", "").lower(),
            "location": resource.get("location", ""),
            "subscriptionId": resource.get("subscriptionId", ""),
            "resourceGroup": resource.get("resourceGroup", ""),
            "tags": resource.get("tags", {}),
            "properties": resource.get("properties", {}),
            "sku": resource.get("sku"),
            "kind": resource.get("kind"),
            "identity": resource.get("identity"),
            "discoveredAt": self.scan_timestamp,
            "snapshotDate": self.scan_date,
        }
        try:
            await self.resources_container.upsert_item(doc)
            self.stats["resources"] += 1
        except Exception as e:
            logger.error(f"Failed to upsert {resource['id']}: {e}")
            self.stats["errors"] += 1

    async def upsert_relationship(self, source_id: str, target_id: str, rel_type: str, metadata: dict | None = None):
        """Store a relationship between two resources."""
        doc = {
            "id": f"{rel_type}_{source_id}_{target_id}".lower().replace("/", "_")[:255],
            "sourceId": source_id,
            "targetId": target_id,
            "relationshipType": rel_type,
            "sourceSubscriptionId": source_id.split("/")[2] if "/subscriptions/" in source_id else "unknown",
            "metadata": metadata or {},
            "discoveredAt": self.scan_timestamp,
        }
        try:
            await self.relationships_container.upsert_item(doc)
            self.stats["relationships"] += 1
        except Exception as e:
            logger.error(f"Failed to upsert relationship {rel_type}: {e}")
            self.stats["errors"] += 1

    async def cleanup_stale_resources(self, current_resource_ids: set[str]):
        """Remove resources from Cosmos that no longer exist in Azure."""
        logger.info("Cleaning up stale resources...")
        stale_count = 0
        query = "SELECT c.id, c.resourceId, c.subscriptionId FROM c"
        existing_items = []
        async for page in self.resources_container.query_items(query=query).by_page():
            async for item in page:
                existing_items.append(item)
        for item in existing_items:
            if item["resourceId"] not in current_resource_ids:
                try:
                    await self.resources_container.delete_item(item["id"], partition_key=item["subscriptionId"])
                    stale_count += 1
                except Exception as e:
                    logger.error(f"Failed to delete stale resource {item['resourceId']}: {e}")
                    self.stats["errors"] += 1
        logger.info(f"Removed {stale_count} stale resources")
        return stale_count

    async def cleanup_stale_relationships(self, current_relationship_ids: set[str]):
        """Remove relationships from Cosmos that no longer exist."""
        logger.info("Cleaning up stale relationships...")
        stale_count = 0
        query = "SELECT c.id, c.sourceSubscriptionId FROM c"
        existing_items = []
        async for page in self.relationships_container.query_items(query=query).by_page():
            async for item in page:
                existing_items.append(item)
        for item in existing_items:
            if item["id"] not in current_relationship_ids:
                try:
                    await self.relationships_container.delete_item(item["id"], partition_key=item["sourceSubscriptionId"])
                    stale_count += 1
                except Exception as e:
                    logger.error(f"Failed to delete stale relationship {item['id']}: {e}")
                    self.stats["errors"] += 1
        logger.info(f"Removed {stale_count} stale relationships")
        return stale_count

    async def scan_all_resources(self):
        """Main discovery scan."""
        logger.info("=== Starting Discovery Scan ===")
        logger.info(f"Timestamp: {self.scan_timestamp}")

        # 1. Scan all resources
        logger.info("Scanning all resources...")
        resources = self.query_resource_graph(QUERIES["all_resources"])
        logger.info(f"Found {len(resources)} resources")

        current_resource_ids = set()
        for resource in resources:
            current_resource_ids.add(resource["id"])
            await self.upsert_resource(resource)

        # 2. Discover VNet peerings (relationships)
        logger.info("Scanning VNet peerings...")
        current_relationship_ids = set()
        peerings = self.query_resource_graph(QUERIES["vnet_peerings"])
        for p in peerings:
            rel_id = f"VNET_PEERING_{p['sourceVnetId']}_{p['remoteVnetId']}".lower().replace("/", "_")[:255]
            current_relationship_ids.add(rel_id)
            await self.upsert_relationship(
                p["sourceVnetId"], p["remoteVnetId"], "VNET_PEERING",
                {"peeringName": p["peeringName"], "state": p["peeringState"]}
            )

        # 3. Discover Private Endpoints (relationships)
        logger.info("Scanning private endpoints...")
        endpoints = self.query_resource_graph(QUERIES["private_endpoints"])
        for ep in endpoints:
            rel_id = f"PRIVATE_ENDPOINT_{ep['peId']}_{ep['targetResourceId']}".lower().replace("/", "_")[:255]
            current_relationship_ids.add(rel_id)
            await self.upsert_relationship(
                ep["peId"], ep["targetResourceId"], "PRIVATE_ENDPOINT",
                {"groupIds": ep.get("groupIds", [])}
            )

        # 4. Remove stale data that no longer exists in Azure
        stale_resources = await self.cleanup_stale_resources(current_resource_ids)
        stale_relationships = await self.cleanup_stale_relationships(current_relationship_ids)

        logger.info(f"=== Scan Complete ===")
        logger.info(f"Resources: {self.stats['resources']}, Relationships: {self.stats['relationships']}, Errors: {self.stats['errors']}")
        logger.info(f"Stale removed: {stale_resources} resources, {stale_relationships} relationships")

    async def close(self):
        await self.cosmos_client.close()


async def main():
    scanner = DiscoveryScanner()
    await scanner.init_cosmos()
    try:
        await scanner.scan_all_resources()
    finally:
        await scanner.close()


if __name__ == "__main__":
    asyncio.run(main())
