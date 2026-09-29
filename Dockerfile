FROM python:3.11-slim AS acs-build

ARG AGT_COMMIT=c07577d9785d4f64225a7b367cb2a978e9fc784d

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl git pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal

ENV PATH="/root/.cargo/bin:${PATH}"

RUN git clone --filter=blob:none https://github.com/microsoft/agent-governance-toolkit.git agt \
    && git -C agt checkout "${AGT_COMMIT}" \
    && git -C agt rev-parse HEAD | grep -Fx "${AGT_COMMIT}" \
    && python -m pip wheel --no-cache-dir --wheel-dir /wheels ./agt/policy-engine/sdk/python

FROM debian:bookworm-slim AS opa-build

ARG OPA_VERSION=v1.21.0
ARG OPA_SHA256=5eef70644868bb04d0556bcc795ee42f2ab379e73f51d1bfa30f83e1305bc9b9

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      "https://github.com/open-policy-agent/opa/releases/download/${OPA_VERSION}/opa_linux_amd64_static" \
      --output opa \
    && echo "${OPA_SHA256}  opa" | sha256sum --check \
    && chmod 0755 opa

FROM python:3.11-slim AS runtime

LABEL com.azure.containerizationassist.createdby="containerization-assist"
LABEL org.opencontainers.image.source="https://github.com/microsoft/agent-governance-toolkit"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AZURE_HOSTED=1 \
    ACS_OPA_PATH=/usr/local/bin/opa \
    FOUNDRY_MODEL_NAME=gpt-4.1

WORKDIR /app

RUN useradd --create-home --uid 10001 appuser

COPY requirements.txt ./
COPY --from=acs-build /wheels/agent_control_specification-0.4.0b0-*.whl /tmp/
COPY --from=opa-build /build/opa /usr/local/bin/opa

RUN python -m pip install --no-cache-dir --disable-pip-version-check \
      -r requirements.txt /tmp/agent_control_specification-0.4.0b0-*.whl \
    && rm /tmp/agent_control_specification-0.4.0b0-*.whl

COPY --chown=appuser:appuser app ./app
COPY --chown=appuser:appuser policy ./policy
COPY --chown=appuser:appuser manifest.yaml ./

EXPOSE 8501

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8501/_stcore/health', timeout=3)"

USER appuser

CMD ["python", "-m", "streamlit", "run", "app/chat_app.py", "--server.address=0.0.0.0", "--server.port=8501", "--server.headless=true", "--browser.gatherUsageStats=false"]
