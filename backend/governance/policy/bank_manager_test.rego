# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
#
# AGT-DELTA D1 regression tests. The previous policy emitted a v4
# `effects: [redact ...]` payload at post_tool_call for SSN / card
# matches. The Rust core hard-rejects any verdict with an `effects`
# key, so the redact_ssn / redact_card helpers now produce an AGT
# D1.1 Transform verdict that replaces the policy target text with
# the redacted string.
package agent_control_specification.bank_manager_test

import data.agent_control_specification.bank_manager as guard
import rego.v1

test_post_tool_call_ssn_redacts_via_transform if {
	verdict := guard.post_tool_call_verdict with input as {
		"intervention_point": "post_tool_call",
		"tool": {"name": "lookup_customer"},
		"policy_target": {"value": {"text": "customer SSN 123-45-6789 file"}},
	}
	verdict.decision == "transform"
	verdict.reason == "redact_ssn_in_tool_result"
	verdict.transform.path == "$target.text"
	verdict.transform.value == "customer SSN [SSN-REDACTED] file"
}

test_post_tool_call_card_redacts_via_transform if {
	verdict := guard.post_tool_call_verdict with input as {
		"intervention_point": "post_tool_call",
		"tool": {"name": "lookup_customer"},
		"policy_target": {"value": {"text": "card 4111 1111 1111 1111 used"}},
	}
	verdict.decision == "transform"
	verdict.reason == "redact_card_in_tool_result"
	verdict.transform.value == "card [CARD-REDACTED] used"
}

test_transfer_over_limit_denies if {
	verdict := guard.pre_tool_call_verdict with input as {
		"intervention_point": "pre_tool_call",
		"tool": {"name": "create_transfer"},
		"policy_target": {"value": {"account_id": "A-1001", "amount": 60000}},
		"snapshot": {
			"manager_role": "bank_manager",
			"assigned_account_ids": ["A-1001"],
			"transfer_approved": true,
			"customer_ack_token": "tok",
		},
	}
	verdict.decision == "deny"
	verdict.reason == "payment_amount_hard_limit"
}

test_assigned_account_read_allows if {
	verdict := guard.pre_tool_call_verdict with input as {
		"intervention_point": "pre_tool_call",
		"tool": {"name": "read_account"},
		"policy_target": {"value": {"account_id": "A-1001"}},
		"snapshot": {
			"manager_role": "bank_manager",
			"assigned_account_ids": ["A-1001"],
		},
	}
	verdict.decision == "allow"
}

# tour:begin rego-test-unassigned
test_unassigned_account_read_denies if {
	verdict := guard.pre_tool_call_verdict with input as {
		"intervention_point": "pre_tool_call",
		"tool": {"name": "read_account"},
		"policy_target": {"value": {"account_id": "A-9000"}},
		"snapshot": {
			"manager_role": "bank_manager",
			"assigned_account_ids": ["A-1001"],
		},
	}
	verdict.decision == "deny"
	verdict.reason == "account_access_denied"
}
# tour:end rego-test-unassigned

test_auditor_cannot_prepare_transfer if {
	verdict := guard.pre_tool_call_verdict with input as {
		"intervention_point": "pre_tool_call",
		"tool": {"name": "prepare_transfer"},
		"policy_target": {"value": {"account_id": "A-1001", "amount": 500}},
		"snapshot": {
			"manager_role": "auditor",
			"assigned_account_ids": ["A-1001"],
		},
	}
	verdict.decision == "deny"
	verdict.reason == "auditor_write_denied"
}
