# Content filtering

## In plain language

Azure checks every request to the AI model and every answer for harmful
content (like hate or violence) and blocks it. We keep those checks turned on.

## Configuration

Every deployment in [`config/models.json`](../../config/models.json) is created by
Bicep with `raiPolicyName: 'Microsoft.DefaultV2'` — the platform default filter
(hate, sexual, violence, self-harm at medium threshold; jailbreak/prompt-shield
and protected-material detection per the default policy). No deviation.

## App behavior

- If Azure blocks the prompt (HTTP 400 with `content_filter` /
  `ResponsibleAIPolicyViolation`) or the completion (`finish_reason: content_filter`),
  the backend raises `ContentFilteredError` and streams an `error` event with
  code `content_filtered` and a friendly message. No tool runs in either lane.
- The model output is a structured tool selection, not free text, which further
  limits what a harmful completion could do.

Reference: [Azure OpenAI content filtering](https://learn.microsoft.com/azure/ai-services/openai/concepts/content-filter).
