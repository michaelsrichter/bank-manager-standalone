from __future__ import annotations

import logging
import os

from azure.monitor.opentelemetry import configure_azure_monitor


def configure_telemetry(logger_name: str) -> logging.Logger:
    if os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING"):
        configure_azure_monitor(logger_name=logger_name)

    logger = logging.getLogger(logger_name)
    logger.setLevel(logging.INFO)
    return logger
