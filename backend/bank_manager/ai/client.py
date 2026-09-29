from __future__ import annotations

from typing import Any

from ..config import IntentRoleConfig, Settings


def build_openai_client(settings: Settings, config: IntentRoleConfig) -> Any:
    """Create an Azure OpenAI client that authenticates with Microsoft Entra ID.

    DefaultAzureCredential resolves to the Container App's user-assigned managed
    identity in Azure and to the developer's `az login` session locally. No API
    key is ever read or stored.
    """
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
    from openai import AzureOpenAI

    if not settings.foundry_endpoint:
        raise ValueError("AZURE_AI_ENDPOINT is required unless FAKE_AI=1.")
    credential = DefaultAzureCredential(
        managed_identity_client_id=settings.azure_client_id,
        exclude_interactive_browser_credential=True,
    )
    return AzureOpenAI(
        azure_endpoint=settings.foundry_endpoint,
        azure_ad_token_provider=get_bearer_token_provider(credential, config.token_scope),
        api_version=config.api_version,
        timeout=config.request_timeout_seconds,
        max_retries=1,
    )
