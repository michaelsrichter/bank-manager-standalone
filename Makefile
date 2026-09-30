# ---------------------------------------------------------------------------
# Uniform EPS demo CLI (eps-demo-devx / eps-demo-repo-hygiene):
#   dev / test / lint / deploy. VS Code tasks and CI call these targets.
# Requires GNU Make, Python 3.12, Node 24, and Rust (for the ACS wheel).
# ---------------------------------------------------------------------------
.DEFAULT_GOAL := help
.PHONY: help install install-acs install-opa dev dev-backend dev-frontend test test-backend \
        test-frontend lint guidance-lint lint-backend lint-frontend bicep-lint policy-test \
        format openapi deploy traffic tour diagrams

AGT_COMMIT ?= c07577d9785d4f64225a7b367cb2a978e9fc784d
OPA_VERSION ?= v1.21.0
VENV ?= .venv
PY := $(VENV)/bin/python
OPA := $(CURDIR)/.tools/opa
export ACS_OPA_PATH ?= $(OPA)

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: install-opa install-acs ## Install backend + frontend dependencies
	$(PY) -m pip install -q -r backend/requirements-dev.txt
	cd frontend && npm ci

$(PY):
	python3 -m venv $(VENV)
	$(PY) -m pip install -q --upgrade pip

install-acs: $(PY) ## Build the ACS wheel from the pinned Agent Governance Toolkit commit
	$(PY) -m pip install -q "git+https://github.com/microsoft/agent-governance-toolkit.git@$(AGT_COMMIT)#subdirectory=policy-engine/sdk/python"

install-opa: ## Download the pinned OPA binary into .tools/
	@mkdir -p .tools
	@if [ ! -x $(OPA) ]; then \
		os=$$(uname -s | tr A-Z a-z); arch=$$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/'); \
		suffix=$$([ "$$os" = linux ] && echo "_static" || echo ""); \
		curl -fsSL -o $(OPA) "https://github.com/open-policy-agent/opa/releases/download/$(OPA_VERSION)/opa_$${os}_$${arch}$${suffix}"; \
		chmod +x $(OPA); fi

dev: ## Run the full stack locally (FAKE_AI=1 unless already set)
	@$(MAKE) -j2 dev-backend dev-frontend

dev-backend: ## Run the FastAPI backend on :8000
	cd backend && FAKE_AI=$${FAKE_AI:-1} ../$(PY) -m uvicorn bank_manager.main:app_factory --factory --reload --port 8000

dev-frontend: ## Run the Vite dev server on :5173 (proxies /api)
	cd frontend && npm run dev

test: ## Run all tests with coverage gates (FAKE_AI=1)
	@FAKE_AI=1 $(MAKE) policy-test test-backend test-frontend

test-backend: ## pytest with >= 70% coverage
	cd backend && FAKE_AI=1 ../$(PY) -m pytest

test-frontend: ## vitest with >= 60% coverage
	cd frontend && npm run test:coverage

policy-test: ## OPA unit tests for the Rego policy
	$(OPA) test backend/governance/policy

lint: guidance-lint lint-backend lint-frontend bicep-lint ## Lint everything

guidance-lint: ## Validate skills, custom agents, and prompt routing
	python3 tools/validate-guidance.py

lint-backend: ## ruff lint + format check
	cd backend && ../$(PY) -m ruff check . && ../$(PY) -m ruff format --check .

lint-frontend: ## eslint + prettier + tsc
	cd frontend && npm run lint

bicep-lint: ## Validate the Bicep templates compile
	az bicep build --file infra/main.bicep --stdout > /dev/null && echo "infra/main.bicep OK"

format: ## Auto-format backend + frontend
	cd backend && ../$(PY) -m ruff format . && ../$(PY) -m ruff check --fix .
	cd frontend && npm run format

openapi: ## Regenerate docs/api/openapi.json from FastAPI
	cd backend && FAKE_AI=1 ../$(PY) -c "import json; from bank_manager.main import create_app; print(json.dumps(create_app().openapi(), indent=2))" > ../docs/api/openapi.json

tour: ## Refresh code-tour excerpts in /docs from the tour:begin/end source markers
	cd frontend && npm run tour:sync

diagrams: ## Re-render docs/architecture/diagrams/*.mmd to SVG
	cd docs/architecture/diagrams && for d in architecture identity acs-flow request-flow; do \
		npx -y @mermaid-js/mermaid-cli@11 -i $$d.mmd -o $$d.svg -p puppeteer.json -C render.css -b white; done

traffic: ## Seed ~60 min of realistic demo traffic against the deployed app (real models, ~USD 0.15)
	python3 tools/generate-traffic.py --url "$$(azd env get-value SERVICE_WEB_URL)" --minutes $${MINUTES:-60}

deploy: bicep-lint ## Deploy via Azure Developer CLI (azd up)
	@command -v azd >/dev/null 2>&1 || { echo "azd not found — see https://aka.ms/azd"; exit 1; }
	azd up
