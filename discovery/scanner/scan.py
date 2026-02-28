"""
Azure Resource Discovery Scanner

Scans all accessible subscriptions via Azure Resource Graph
and stores results in Cosmos DB.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from azure.identity import DefaultAzureCredential
from azure.mgmt.resourcegraph import ResourceGraphClient
from azure.mgmt.resourcegraph.models import QueryRequest, QueryRequestOptions
from azure.cosmos.aio import CosmosClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Configuration
COSMOS_ENDPOINT = "https://<your-cosmos>.documents.azure.com:443/"
DATABASE_NAME = "observability"
CONTAINER_NAME = "resources"
RELATIONSHIPS_CONTAINER = "relationships"

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


class DiscoveryScanner:
    def __init__(self):
        self.credential = DefaultAzureCredential()
        self.graph_client = ResourceGraphClient(self.credential)
        self.scan_timestamp = datetime.now(timezone.utc).isoformat()
        self.scan_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.stats = {"resources": 0, "relationships": 0, "errors": 0}

    async def init_cosmos(self):
        self.cosmos_client = CosmosClient(COSMOS_ENDPOINT, credential=self.credential)
        self.database = self.cosmos_client.get_database_client(DATABASE_NAME)
        self.resources_container = self.database.get_container_client(CONTAINER_NAME)
        self.relationships_container = self.database.get_container_client(RELATIONSHIPS_CONTAINER)

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

    async def scan_all_resources(self):
        """Main discovery scan."""
        logger.info("=== Starting Discovery Scan ===")
        logger.info(f"Timestamp: {self.scan_timestamp}")

        # 1. Scan all resources
        logger.info("Scanning all resources...")
        resources = self.query_resource_graph(QUERIES["all_resources"])
        logger.info(f"Found {len(resources)} resources")

        for resource in resources:
            await self.upsert_resource(resource)

        # 2. Discover VNet peerings (relationships)
        logger.info("Scanning VNet peerings...")
        peerings = self.query_resource_graph(QUERIES["vnet_peerings"])
        for p in peerings:
            await self.upsert_relationship(
                p["sourceVnetId"], p["remoteVnetId"], "VNET_PEERING",
                {"peeringName": p["peeringName"], "state": p["peeringState"]}
            )

        # 3. Discover Private Endpoints (relationships)
        logger.info("Scanning private endpoints...")
        endpoints = self.query_resource_graph(QUERIES["private_endpoints"])
        for ep in endpoints:
            await self.upsert_relationship(
                ep["peId"], ep["targetResourceId"], "PRIVATE_ENDPOINT",
                {"groupIds": ep.get("groupIds", [])}
            )

        logger.info(f"=== Scan Complete ===")
        logger.info(f"Resources: {self.stats['resources']}, Relationships: {self.stats['relationships']}, Errors: {self.stats['errors']}")

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
