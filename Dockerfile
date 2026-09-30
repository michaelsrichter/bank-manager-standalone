# syntax=docker/dockerfile:1
# Multi-stage build: ACS native wheel (Rust) + pinned OPA + React frontend,
# then a slim non-root Python runtime. Built remotely by ACR Tasks via `azd`.

# tour:begin dockerfile-acs-build
FROM python:3.12-slim AS acs-build
ARG AGT_COMMIT=c07577d9785d4f64225a7b367cb2a978e9fc784d
WORKDIR /build
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl git pkg-config ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN git clone --filter=blob:none https://github.com/microsoft/agent-governance-toolkit.git agt \
    && git -C agt checkout "${AGT_COMMIT}" \
    && git -C agt rev-parse HEAD | grep -Fx "${AGT_COMMIT}" \
    && python -m pip wheel --no-cache-dir --no-deps --wheel-dir /wheels ./agt/policy-engine/sdk/python

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
# tour:end dockerfile-acs-build

FROM node:24-slim AS web-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY docs/ /src/docs/
RUN DOCS_CONTAINER_BUILD=1 npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ACS_OPA_PATH=/usr/local/bin/opa
WORKDIR /app
RUN useradd --create-home --uid 10001 appuser
COPY backend/requirements.txt backend/requirements.txt
COPY --from=acs-build /wheels/ /tmp/wheels/
COPY --from=opa-build /build/opa /usr/local/bin/opa
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
      -r backend/requirements.txt /tmp/wheels/agent_control_specification-*.whl \
    && rm -rf /tmp/wheels
COPY --chown=appuser:appuser config/ config/
COPY --chown=appuser:appuser backend/bank_manager/ backend/bank_manager/
COPY --chown=appuser:appuser backend/governance/ backend/governance/
COPY --from=web-build --chown=appuser:appuser /src/frontend/dist/ frontend/dist/
USER appuser
WORKDIR /app/backend
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "bank_manager.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
