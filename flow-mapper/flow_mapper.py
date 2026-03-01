"""
Azure VNet Flow Log Mapper

Reads VNet flow logs from Azure Storage (MI auth), parses them,
and writes network flow summaries to Cosmos DB SQL API.

Auth: Managed Identity (User-Assigned via AZURE_CLIENT_ID)
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone, timedelta
from collections import defaultdict

from azure.identity import ManagedIdentityCredential, DefaultAzureCredential, ChainedTokenCredential
from azure.identity.aio import ManagedIdentityCredential as AsyncManagedIdentityCredential
from azure.identity.aio import DefaultAzureCredential as AsyncDefaultAzureCredential
from azure.identity.aio import ChainedTokenCredential as AsyncChainedTokenCredential
from azure.storage.blob import BlobServiceClient
from azure.cosmos.aio import CosmosClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

STORAGE_ACCOUNT_NAME = os.environ.get("STORAGE_ACCOUNT_NAME", "")
COSMOS_ENDPOINT = os.environ.get("COSMOS_ENDPOINT", "")
COSMOS_DATABASE = os.environ.get("COSMOS_DATABASE", "observability")
TARGET_SUBSCRIPTION_ID = os.environ.get("TARGET_SUBSCRIPTION_ID", "")
MANAGED_IDENTITY_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", None)
LOOKBACK_HOURS = int(os.environ.get("LOOKBACK_HOURS", "24"))


def get_sync_credential():
    creds = []
    if MANAGED_IDENTITY_CLIENT_ID:
        creds.append(ManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID))
    creds.append(DefaultAzureCredential())
    return ChainedTokenCredential(*creds)


def get_async_credential():
    creds = []
    if MANAGED_IDENTITY_CLIENT_ID:
        creds.append(AsyncManagedIdentityCredential(client_id=MANAGED_IDENTITY_CLIENT_ID))
    creds.append(AsyncDefaultAzureCredential())
    return AsyncChainedTokenCredential(*creds)


class FlowMapper:
    def __init__(self):
        self.sync_credential = get_sync_credential()
        self.async_credential = get_async_credential()
        self.stats = {"blobs_processed": 0, "tuples_parsed": 0, "flows_written": 0, "errors": 0}
        # Aggregate flows: key=(srcIp, dstIp, dstPort, protocol) → stats
        self.flow_aggregates = defaultdict(lambda: {
            "packets_s2d": 0, "bytes_s2d": 0,
            "packets_d2s": 0, "bytes_d2s": 0,
            "allowed": 0, "denied": 0,
            "first_seen": None, "last_seen": None,
            "rules": set(),
        })

    def read_flow_logs(self):
        """Read VNet flow log blobs from storage using MI auth."""
        logger.info(f"Reading flow logs from storage account: {STORAGE_ACCOUNT_NAME}")

        blob_service = BlobServiceClient(
            account_url=f"https://{STORAGE_ACCOUNT_NAME}.blob.core.windows.net",
            credential=self.sync_credential,
        )

        container_name = "insights-logs-flowlogflowevent"
        try:
            container_client = blob_service.get_container_client(container_name)
            container_client.get_container_properties()
        except Exception as e:
            logger.warning(f"Flow log container not found: {e}")
            logger.info("Flow logs may not have been generated yet (can take 10-15 min after enabling). Skipping.")
            return

        cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)

        for blob in container_client.list_blobs():
            blob_time = self._parse_blob_time(blob.name)
            if blob_time and blob_time < cutoff:
                continue

            try:
                data = container_client.download_blob(blob).readall()
                flow_log = json.loads(data)
                self._parse_flow_log(flow_log, blob.name)
                self.stats["blobs_processed"] += 1
            except Exception as e:
                logger.error(f"Error processing {blob.name}: {e}")
                self.stats["errors"] += 1

        logger.info(f"Processed {self.stats['blobs_processed']} blobs, parsed {self.stats['tuples_parsed']} flow tuples")
        logger.info(f"Aggregated into {len(self.flow_aggregates)} unique flows")

    def _parse_blob_time(self, name: str) -> datetime | None:
        """Extract timestamp from flow log blob path."""
        try:
            parts = name.split("/")
            t = {}
            for part in parts:
                if part.startswith("y="):
                    t["y"] = int(part[2:])
                elif part.startswith("d="):
                    t["d"] = int(part[2:])
                elif part.startswith("h="):
                    t["h"] = int(part[2:])
                elif part.startswith("m=") and "mac" not in part.lower() and len(part) <= 4:
                    t["m"] = int(part[2:])
            if "y" in t and "d" in t:
                return datetime(t["y"], t.get("m", 1), t["d"], t.get("h", 0), tzinfo=timezone.utc)
        except (ValueError, KeyError):
            pass
        return None

    def _parse_flow_log(self, flow_log: dict, blob_name: str):
        """Parse a flow log JSON and aggregate into flow_aggregates.

        VNet flow log v4 structure:
          records[].flowRecords.flows[].flowGroups[].flowTuples[]
        NSG flow log v2 structure (fallback):
          records[].properties.flows[].flows[].flowTuples[]
        """
        for record in flow_log.get("records", []):
            timestamp = record.get("time", "")

            # VNet flow log v4 format
            flow_records = record.get("flowRecords", {}).get("flows", [])
            if flow_records:
                for acl_group in flow_records:
                    for flow_group in acl_group.get("flowGroups", []):
                        rule = flow_group.get("rule", "unknown")
                        for entry in flow_group.get("flowTuples", []):
                            self._aggregate_tuple(entry, rule, timestamp)
            else:
                # NSG flow log v2 fallback
                for flow_group in record.get("properties", {}).get("flows", []):
                    rule = flow_group.get("rule", "unknown")
                    for ft in flow_group.get("flows", []):
                        for entry in ft.get("flowTuples", []):
                            self._aggregate_tuple(entry, rule, timestamp)

    def _aggregate_tuple(self, tuple_str: str, rule: str, timestamp: str):
        """Parse and aggregate a flow tuple."""
        try:
            p = tuple_str.split(",")
            if len(p) < 8:
                return

            src_ip, dst_ip = p[1], p[2]
            dst_port = p[4]
            protocol = {"T": "TCP", "U": "UDP", "6": "TCP", "17": "UDP"}.get(p[5], p[5])
            decision = p[7]  # A=allowed, D=denied

            key = (src_ip, dst_ip, dst_port, protocol)
            agg = self.flow_aggregates[key]

            if decision == "A":
                agg["allowed"] += 1
            else:
                agg["denied"] += 1

            # Version 2 fields
            if len(p) > 12:
                agg["packets_s2d"] += int(p[9]) if p[9] else 0
                agg["bytes_s2d"] += int(p[10]) if p[10] else 0
                agg["packets_d2s"] += int(p[11]) if p[11] else 0
                agg["bytes_d2s"] += int(p[12]) if p[12] else 0

            agg["rules"].add(rule)

            if agg["first_seen"] is None or timestamp < agg["first_seen"]:
                agg["first_seen"] = timestamp
            if agg["last_seen"] is None or timestamp > agg["last_seen"]:
                agg["last_seen"] = timestamp

            self.stats["tuples_parsed"] += 1

        except Exception as e:
            logger.error(f"Error parsing tuple: {e}")
            self.stats["errors"] += 1

    async def write_to_cosmos(self):
        """Write aggregated flows to Cosmos DB network-flows container."""
        if not self.flow_aggregates:
            logger.info("No flows to write")
            return

        logger.info(f"Writing {len(self.flow_aggregates)} flows to Cosmos DB...")

        cosmos_client = CosmosClient(COSMOS_ENDPOINT, credential=self.async_credential)
        database = cosmos_client.get_database_client(COSMOS_DATABASE)
        container = database.get_container_client("network-flows")

        written = 0
        for (src_ip, dst_ip, dst_port, protocol), agg in self.flow_aggregates.items():
            doc_id = f"{src_ip}_{dst_ip}_{dst_port}_{protocol}".replace(".", "-").replace(":", "-")

            doc = {
                "id": doc_id,
                "subscriptionId": TARGET_SUBSCRIPTION_ID,
                "sourceIp": src_ip,
                "destIp": dst_ip,
                "destPort": dst_port,
                "protocol": protocol,
                "allowed": agg["allowed"],
                "denied": agg["denied"],
                "packetsS2D": agg["packets_s2d"],
                "bytesS2D": agg["bytes_s2d"],
                "packetsD2S": agg["packets_d2s"],
                "bytesD2S": agg["bytes_d2s"],
                "rules": list(agg["rules"]),
                "firstSeen": agg["first_seen"],
                "lastSeen": agg["last_seen"],
                "scannedAt": datetime.now(timezone.utc).isoformat(),
            }

            try:
                await container.upsert_item(doc)
                written += 1
            except Exception as e:
                logger.error(f"Error writing flow {doc_id}: {e}")
                self.stats["errors"] += 1

        self.stats["flows_written"] = written
        await cosmos_client.close()
        logger.info(f"Wrote {written} flow documents to Cosmos DB")

    async def close(self):
        await self.async_credential.close()


async def main():
    logger.info("=== Flow Mapper Starting ===")
    logger.info(f"Storage: {STORAGE_ACCOUNT_NAME}, Cosmos: {COSMOS_ENDPOINT}")
    logger.info(f"Subscription: {TARGET_SUBSCRIPTION_ID}, Lookback: {LOOKBACK_HOURS}h")

    mapper = FlowMapper()

    try:
        # 1. Read and aggregate flow logs from storage
        mapper.read_flow_logs()

        # 2. Write aggregated flows to Cosmos DB
        await mapper.write_to_cosmos()

        logger.info("=== Flow Mapper Complete ===")
        logger.info(f"Blobs: {mapper.stats['blobs_processed']}, Tuples: {mapper.stats['tuples_parsed']}, "
                     f"Flows written: {mapper.stats['flows_written']}, Errors: {mapper.stats['errors']}")
    finally:
        await mapper.close()


if __name__ == "__main__":
    asyncio.run(main())
