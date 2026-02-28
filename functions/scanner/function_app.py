"""
Azure Function: Discovery Scanner (Timer Trigger)
Runs every 6 hours to scan all Azure resources and store in Cosmos DB.
"""

import logging
import asyncio
import azure.functions as func

# Reuse the scanner from discovery module
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "discovery"))
from scanner.scan import DiscoveryScanner


async def run_scan():
    scanner = DiscoveryScanner()
    await scanner.init_cosmos()
    try:
        await scanner.scan_all_resources()
        return scanner.stats
    finally:
        await scanner.close()


def main(timer: func.TimerRequest) -> None:
    logging.info("Discovery scanner triggered")

    if timer.past_due:
        logging.warning("Timer is past due — running catch-up scan")

    stats = asyncio.run(run_scan())
    logging.info(
        f"Scan complete: {stats['resources']} resources, "
        f"{stats['relationships']} relationships, "
        f"{stats['errors']} errors"
    )
