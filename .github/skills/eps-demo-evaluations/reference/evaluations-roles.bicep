// Role assignments for Foundry Evaluations (eps-demo-evaluations).
//
// Three different identities take part in one evaluation run:
//   1. The web app's managed identity reads and starts runs. It needs Foundry User on
//      the PROJECT (Microsoft's documented role for evaluations), plus the small custom
//      "Foundry evaluation runner" role on the ACCOUNT (defined below), because Foundry
//      creates matching OpenAI evals on the account as the caller.
//   2. The developer (optional) gets the same two roles, so local runs and the Foundry
//      portal's Evaluations pages work with the same rights as the app.
//   3. The Foundry project's own managed identity runs the graders in the cloud and
//      updates the run status. It needs Foundry User on the account, and
//      Cognitive Services OpenAI User on the account that owns the judge model.
// Giving the judge-model role to the web app's identity instead does NOT work:
// Foundry calls the judge model as the project's identity.
// The existing app role "Cognitive Services OpenAI User" (data-plane-roles.bicep) is
// still needed to produce the answers that get graded.
targetScope = 'resourceGroup'

param foundryAccountName string
param projectName string
param appPrincipalId string
param developerPrincipalId string = ''
@allowed(['User', 'ServicePrincipal'])
param developerPrincipalType string = 'User'

// Foundry User (formerly "Azure AI User"): use project data-plane features, no management rights.
var foundryUserRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '53ca6127-db72-4b80-b1b0-d745d6d5456d'
)
// Cognitive Services OpenAI User: call model deployments (the judge model).
var openAiUserRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
)

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: foundryAccountName
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' existing = {
  parent: foundry
  name: projectName
}

// Foundry evaluation runner (custom role): the evaluation data actions on the ACCOUNT.
// For OpenAI-style graders (string_check, label_model) Foundry creates matching evals on
// the account as the caller, which checks OpenAI/evals/*. Foundry User on the project does
// not reach the account, and the built-in roles that do (Foundry User on the account,
// Cognitive Services OpenAI Contributor) also allow listing keys or fine-tuning.
resource evaluationRunnerRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, 'foundry-evaluation-runner')
  properties: {
    roleName: 'Foundry evaluation runner (${resourceGroup().name})'
    description: 'Create and read Azure OpenAI evals on the Foundry account, which Foundry does as the caller for OpenAI-style graders. No models, keys, files, or fine-tuning.'
    type: 'CustomRole'
    permissions: [
      {
        actions: []
        notActions: []
        dataActions: [
          'Microsoft.CognitiveServices/accounts/OpenAI/evals/read'
          'Microsoft.CognitiveServices/accounts/OpenAI/evals/write'
        ]
        notDataActions: []
      }
    ]
    assignableScopes: [resourceGroup().id]
  }
}

resource appEvaluationRunner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, appPrincipalId, evaluationRunnerRole.id)
  scope: foundry
  properties: {
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: evaluationRunnerRole.id
  }
}

// Foundry User on the project: Microsoft's documented role for running evaluations. It covers
// the project's evaluation API (AIServices/evaluations/*) and the project assets where evals are
// stored (AIServices/assets/*). Project scope keeps it away from the account's deployments.
// Note: 'UnauthorizedUserAction: Forbidden' on new runs is a NETWORK block, not a missing role
// (docs/adr/0014-foundry-public-endpoint-for-evaluations.md).
resource appProjectUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(project.id, appPrincipalId, foundryUserRole)
  scope: project
  properties: {
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: foundryUserRole
  }
}

resource developerEvaluationRunner 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(developerPrincipalId)) {
  name: guid(foundry.id, developerPrincipalId, evaluationRunnerRole.id)
  scope: foundry
  properties: {
    principalId: developerPrincipalId
    principalType: developerPrincipalType
    roleDefinitionId: evaluationRunnerRole.id
  }
}

// The developer also gets Foundry User on the project, so the Foundry portal's
// Evaluations pages open with the same rights the app has.
resource developerProjectUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(developerPrincipalId)) {
  name: guid(project.id, developerPrincipalId, foundryUserRole)
  scope: project
  properties: {
    principalId: developerPrincipalId
    principalType: developerPrincipalType
    roleDefinitionId: foundryUserRole
  }
}

resource projectAccountUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, project.id, foundryUserRole)
  scope: foundry
  properties: {
    principalId: project.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: foundryUserRole
  }
}

resource projectJudgeModelUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, project.id, openAiUserRole)
  scope: foundry
  properties: {
    principalId: project.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: openAiUserRole
  }
}

output projectPrincipalId string = project.identity.principalId
