"""
Unit tests for the Discovery Scanner.

Uses mocks for Azure SDK clients to test logic without real Azure resources.
"""

import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
from datetime import datetime, timezone

# Module under test
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scanner.scan import DiscoveryScanner, get_credential, QUERIES


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def mock_credential():
    with patch("scanner.scan.get_credential") as mock:
        mock.return_value = MagicMock()
        yield mock.return_value


@pytest.fixture
def mock_graph_response():
    """Factory for Resource Graph responses."""
    def _make(data, total=None, skip_token=None):
        resp = MagicMock()
        resp.data = data
        resp.total_records = total or len(data)
        resp.skip_token = skip_token
        return resp
    return _make


@pytest.fixture
def sample_resources():
    return [
        {
            "id": "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm01",
            "name": "vm01",
            "type": "microsoft.compute/virtualmachines",
            "location": "eastus2",
            "subscriptionId": "sub1",
            "resourceGroup": "rg1",
            "tags": {"env": "prod"},
            "properties": {"vmId": "abc-123"},
            "sku": None,
            "kind": None,
            "identity": None,
        },
        {
            "id": "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Network/virtualNetworks/vnet01",
            "name": "vnet01",
            "type": "microsoft.network/virtualnetworks",
            "location": "eastus2",
            "subscriptionId": "sub1",
            "resourceGroup": "rg1",
            "tags": {},
            "properties": {},
            "sku": None,
            "kind": None,
            "identity": None,
        },
    ]


@pytest.fixture
def sample_peerings():
    return [
        {
            "sourceVnetId": "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Network/virtualNetworks/vnet01",
            "sourceVnetName": "vnet01",
            "peeringName": "peer-to-vnet02",
            "remoteVnetId": "/subscriptions/sub2/resourceGroups/rg2/providers/Microsoft.Network/virtualNetworks/vnet02",
            "peeringState": "Connected",
        }
    ]


@pytest.fixture
def sample_private_endpoints():
    return [
        {
            "peId": "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Network/privateEndpoints/pe-sql",
            "peName": "pe-sql",
            "subscriptionId": "sub1",
            "resourceGroup": "rg1",
            "targetResourceId": "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Sql/servers/sql01",
            "groupIds": ["sqlServer"],
        }
    ]


@pytest.fixture
def scanner(mock_credential):
    with patch("scanner.scan.ResourceGraphClient"):
        s = DiscoveryScanner()
        s.resources_container = AsyncMock()
        s.relationships_container = AsyncMock()
        s.cosmos_client = AsyncMock()
        s.database = MagicMock()
        return s


# ── Tests: get_credential ─────────────────────────────────────────────────────

class TestGetCredential:

    @patch("scanner.scan.MANAGED_IDENTITY_CLIENT_ID", "test-client-id")
    @patch("scanner.scan.DefaultAzureCredential")
    @patch("scanner.scan.ManagedIdentityCredential")
    @patch("scanner.scan.ChainedTokenCredential")
    def test_uses_user_assigned_mi_when_client_id_set(self, mock_chain, mock_mi, mock_default):
        get_credential()
        mock_mi.assert_called_once_with(client_id="test-client-id")
        mock_default.assert_called_once()
        mock_chain.assert_called_once()

    @patch.dict(os.environ, {}, clear=True)
    @patch("scanner.scan.MANAGED_IDENTITY_CLIENT_ID", None)
    @patch("scanner.scan.DefaultAzureCredential")
    @patch("scanner.scan.ManagedIdentityCredential")
    @patch("scanner.scan.ChainedTokenCredential")
    def test_uses_system_assigned_mi_when_no_client_id(self, mock_chain, mock_mi, mock_default):
        get_credential()
        mock_mi.assert_called_once_with()
        mock_default.assert_called_once()


# ── Tests: query_resource_graph ───────────────────────────────────────────────

class TestQueryResourceGraph:

    def test_single_page(self, scanner, mock_graph_response, sample_resources):
        scanner.graph_client.resources.return_value = mock_graph_response(sample_resources)
        results = scanner.query_resource_graph("resources | project id, name")
        assert len(results) == 2
        assert results[0]["name"] == "vm01"
        scanner.graph_client.resources.assert_called_once()

    def test_pagination(self, scanner, mock_graph_response, sample_resources):
        """Verify automatic pagination when skip_token is returned."""
        page1 = mock_graph_response([sample_resources[0]], total=2, skip_token="token123")
        page2 = mock_graph_response([sample_resources[1]], total=2, skip_token=None)
        scanner.graph_client.resources.side_effect = [page1, page2]

        results = scanner.query_resource_graph("resources | project id, name")
        assert len(results) == 2
        assert scanner.graph_client.resources.call_count == 2

    def test_empty_results(self, scanner, mock_graph_response):
        scanner.graph_client.resources.return_value = mock_graph_response([])
        results = scanner.query_resource_graph("resources | where 1 == 0")
        assert results == []


# ── Tests: upsert_resource ────────────────────────────────────────────────────

class TestUpsertResource:

    @pytest.mark.asyncio
    async def test_upsert_success(self, scanner, sample_resources):
        scanner.resources_container.upsert_item = AsyncMock()
        await scanner.upsert_resource(sample_resources[0])

        assert scanner.stats["resources"] == 1
        assert scanner.stats["errors"] == 0

        call_args = scanner.resources_container.upsert_item.call_args[0][0]
        assert call_args["name"] == "vm01"
        assert call_args["subscriptionId"] == "sub1"
        assert call_args["type"] == "microsoft.compute/virtualmachines"
        assert "discoveredAt" in call_args
        assert "snapshotDate" in call_args

    @pytest.mark.asyncio
    async def test_upsert_failure_increments_errors(self, scanner, sample_resources):
        scanner.resources_container.upsert_item = AsyncMock(side_effect=Exception("Cosmos error"))
        await scanner.upsert_resource(sample_resources[0])

        assert scanner.stats["resources"] == 0
        assert scanner.stats["errors"] == 1

    @pytest.mark.asyncio
    async def test_document_id_is_sanitized(self, scanner, sample_resources):
        scanner.resources_container.upsert_item = AsyncMock()
        await scanner.upsert_resource(sample_resources[0])

        doc = scanner.resources_container.upsert_item.call_args[0][0]
        assert "/" not in doc["id"]  # slashes replaced with underscores

    @pytest.mark.asyncio
    async def test_handles_missing_optional_fields(self, scanner):
        minimal_resource = {
            "id": "/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm-minimal",
            "subscriptionId": "sub1",
        }
        scanner.resources_container.upsert_item = AsyncMock()
        await scanner.upsert_resource(minimal_resource)

        doc = scanner.resources_container.upsert_item.call_args[0][0]
        assert doc["name"] == ""
        assert doc["type"] == ""
        assert doc["tags"] == {}


# ── Tests: upsert_relationship ────────────────────────────────────────────────

class TestUpsertRelationship:

    @pytest.mark.asyncio
    async def test_upsert_peering(self, scanner, sample_peerings):
        scanner.relationships_container.upsert_item = AsyncMock()
        p = sample_peerings[0]
        await scanner.upsert_relationship(
            p["sourceVnetId"], p["remoteVnetId"], "VNET_PEERING",
            {"peeringName": p["peeringName"], "state": p["peeringState"]}
        )

        assert scanner.stats["relationships"] == 1
        doc = scanner.relationships_container.upsert_item.call_args[0][0]
        assert doc["relationshipType"] == "VNET_PEERING"
        assert doc["sourceSubscriptionId"] == "sub1"
        assert doc["metadata"]["state"] == "Connected"

    @pytest.mark.asyncio
    async def test_upsert_private_endpoint(self, scanner, sample_private_endpoints):
        scanner.relationships_container.upsert_item = AsyncMock()
        ep = sample_private_endpoints[0]
        await scanner.upsert_relationship(
            ep["peId"], ep["targetResourceId"], "PRIVATE_ENDPOINT",
            {"groupIds": ep["groupIds"]}
        )

        assert scanner.stats["relationships"] == 1
        doc = scanner.relationships_container.upsert_item.call_args[0][0]
        assert doc["relationshipType"] == "PRIVATE_ENDPOINT"

    @pytest.mark.asyncio
    async def test_relationship_failure(self, scanner):
        scanner.relationships_container.upsert_item = AsyncMock(side_effect=Exception("fail"))
        await scanner.upsert_relationship("src", "tgt", "TEST")
        assert scanner.stats["errors"] == 1
        assert scanner.stats["relationships"] == 0

    @pytest.mark.asyncio
    async def test_id_truncated_to_255(self, scanner):
        scanner.relationships_container.upsert_item = AsyncMock()
        long_id = "/subscriptions/sub1/" + "a" * 300
        await scanner.upsert_relationship(long_id, long_id, "LONG")
        doc = scanner.relationships_container.upsert_item.call_args[0][0]
        assert len(doc["id"]) <= 255


# ── Tests: scan_all_resources (integration of above) ──────────────────────────

class TestScanAllResources:

    @pytest.mark.asyncio
    async def test_full_scan(self, scanner, mock_graph_response, sample_resources, sample_peerings, sample_private_endpoints):
        scanner.resources_container.upsert_item = AsyncMock()
        scanner.relationships_container.upsert_item = AsyncMock()

        scanner.graph_client.resources.side_effect = [
            mock_graph_response(sample_resources),      # all_resources
            mock_graph_response(sample_peerings),       # vnet_peerings
            mock_graph_response(sample_private_endpoints),  # private_endpoints
        ]

        await scanner.scan_all_resources()

        assert scanner.stats["resources"] == 2
        assert scanner.stats["relationships"] == 2
        assert scanner.stats["errors"] == 0

    @pytest.mark.asyncio
    async def test_scan_with_partial_failures(self, scanner, mock_graph_response, sample_resources):
        # First upsert succeeds, second fails
        scanner.resources_container.upsert_item = AsyncMock(
            side_effect=[None, Exception("fail")]
        )
        scanner.relationships_container.upsert_item = AsyncMock()

        scanner.graph_client.resources.side_effect = [
            mock_graph_response(sample_resources),
            mock_graph_response([]),  # no peerings
            mock_graph_response([]),  # no private endpoints
        ]

        await scanner.scan_all_resources()

        assert scanner.stats["resources"] == 1
        assert scanner.stats["errors"] == 1


# ── Tests: KQL queries syntax ────────────────────────────────────────────────

class TestQueries:

    def test_all_queries_are_non_empty_strings(self):
        for name, query in QUERIES.items():
            assert isinstance(query, str), f"Query '{name}' is not a string"
            assert len(query.strip()) > 0, f"Query '{name}' is empty"

    def test_all_resources_query_projects_required_fields(self):
        q = QUERIES["all_resources"]
        for field in ["id", "name", "type", "location", "subscriptionId", "resourceGroup"]:
            assert field in q, f"all_resources query missing '{field}'"

    def test_vnet_peerings_query_has_required_projections(self):
        q = QUERIES["vnet_peerings"]
        for field in ["sourceVnetId", "remoteVnetId", "peeringState"]:
            assert field in q, f"vnet_peerings query missing '{field}'"

    def test_private_endpoints_query_has_required_projections(self):
        q = QUERIES["private_endpoints"]
        for field in ["peId", "targetResourceId", "groupIds"]:
            assert field in q, f"private_endpoints query missing '{field}'"
