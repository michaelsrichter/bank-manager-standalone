[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$LogAnalyticsWorkspaceName,
    [Parameter(Mandatory)][string]$ApplicationInsightsName,
    [Parameter(Mandatory)][string]$FoundryProjectEndpoint,
    [Parameter(Mandatory)][string]$FoundryProjectResourceId,
    [string]$ResourceGroupName = 'rgBankManager',
    [string]$Location = 'eastus2',
    [string]$ContainerAppsLocation = 'eastus2',
    [string]$DeploymentName = 'bank-manager-linux',
    [string]$ImageRepository = 'bank-manager',
    [string]$ImageTag = (Get-Date -Format 'yyyyMMddHHmmss'),
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$template = Join-Path $root 'infra\main.bicep'

function Invoke-AzureCli {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $output = & az @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI failed: az $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }
    return $output
}

function Get-DeploymentOutputs {
    param([Parameter(Mandatory)][string[]]$AdditionalParameters)

    $arguments = @(
        'deployment', 'group', 'create',
        '--name', $DeploymentName,
        '--resource-group', $ResourceGroupName,
        '--template-file', $template,
        '--parameters'
    ) + $AdditionalParameters + @(
        '--only-show-errors',
        '--output', 'json'
    )
    $json = Invoke-AzureCli $arguments
    return (($json -join [Environment]::NewLine) | ConvertFrom-Json).properties.outputs
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI is required.'
}
if (-not (Test-Path $template)) {
    throw 'The infrastructure template is missing.'
}

Invoke-AzureCli @('account', 'set', '--subscription', $SubscriptionId) | Out-Null
Invoke-AzureCli @(
    'group', 'create',
    '--name', $ResourceGroupName,
    '--location', $Location,
    '--tags', 'workload=bank-manager', 'managedBy=scripts/deploy.ps1',
    '--only-show-errors',
    '--output', 'none'
) | Out-Null

$baseOutputs = Get-DeploymentOutputs -AdditionalParameters @(
    "location=$Location",
    "containerAppsLocation=$ContainerAppsLocation",
    "logAnalyticsWorkspaceName=$LogAnalyticsWorkspaceName",
    "applicationInsightsName=$ApplicationInsightsName",
    "foundryProjectEndpoint=$FoundryProjectEndpoint",
    'deployApp=false'
)

$principalId = $baseOutputs.runtimeIdentityPrincipalId.value
$foundryRoleOutput = Invoke-AzureCli @(
    'role', 'assignment', 'list',
    '--assignee-object-id', $principalId,
    '--scope', $FoundryProjectResourceId,
    '--role', 'Foundry User',
    '--query', '[0].id',
    '--output', 'tsv'
)
$foundryRole = ($foundryRoleOutput -join '').Trim()
if (-not $foundryRole) {
    Invoke-AzureCli @(
        'role', 'assignment', 'create',
        '--assignee-object-id', $principalId,
        '--assignee-principal-type', 'ServicePrincipal',
        '--scope', $FoundryProjectResourceId,
        '--role', 'Foundry User',
        '--only-show-errors',
        '--output', 'none'
    ) | Out-Null
}

$registryName = $baseOutputs.containerRegistryName.value
$loginServer = $baseOutputs.containerRegistryLoginServer.value
if (-not $SkipBuild) {
    $buildRunOutput = Invoke-AzureCli @(
        'acr', 'build',
        '--registry', $registryName,
        '--image', "${ImageRepository}:$ImageTag",
        '--platform', 'linux/amd64',
        '--file', (Join-Path $root 'Dockerfile'),
        '--no-logs',
        '--only-show-errors',
        '--query', 'runId',
        '--output', 'tsv',
        $root
    )
    $buildRunId = ($buildRunOutput -join '').Trim()
    if (-not $buildRunId) {
        throw 'ACR did not return a build run ID.'
    }

    for ($attempt = 1; $attempt -le 60; $attempt++) {
        $buildStatusOutput = Invoke-AzureCli @(
            'acr', 'task', 'show-run',
            '--registry', $registryName,
            '--run-id', $buildRunId,
            '--query', 'status',
            '--output', 'tsv'
        )
        $buildStatus = ($buildStatusOutput -join '').Trim()
        Write-Host "ACR build $buildRunId status: $buildStatus"
        if ($buildStatus -notin @('Queued', 'Started', 'Running')) {
            break
        }
        Start-Sleep -Seconds 15
    }
    if ($buildStatus -ne 'Succeeded') {
        throw "ACR build $buildRunId ended with status '$buildStatus'."
    }
}

$digestOutput = Invoke-AzureCli @(
    'acr', 'manifest', 'list-metadata',
    '--registry', $registryName,
    '--name', $ImageRepository,
    '--query', "[?contains(tags, '$ImageTag')].digest | [0]",
    '--output', 'tsv',
    '--only-show-errors'
)
$digest = ($digestOutput -join '').Trim()
if (-not $digest) {
    throw "Could not resolve the digest for ${ImageRepository}:$ImageTag."
}
$imageReference = "$loginServer/$ImageRepository@$digest"

$appOutputs = Get-DeploymentOutputs -AdditionalParameters @(
    "location=$Location",
    "containerAppsLocation=$ContainerAppsLocation",
    "logAnalyticsWorkspaceName=$LogAnalyticsWorkspaceName",
    "applicationInsightsName=$ApplicationInsightsName",
    "foundryProjectEndpoint=$FoundryProjectEndpoint",
    'deployApp=true',
    "imageReference=$imageReference"
)

[PSCustomObject]@{
    ResourceGroup = $ResourceGroupName
    ContainerAppName = $appOutputs.containerAppName.value
    ContainerAppsEnvironment = $appOutputs.containerAppsEnvironmentName.value
    ContainerAppsLocation = $ContainerAppsLocation
    ContainerRegistry = $registryName
    ImageReference = $imageReference
    Url = "https://$($appOutputs.containerAppFqdn.value)"
    HealthUrl = "https://$($appOutputs.containerAppFqdn.value)/_stcore/health"
    RuntimePrincipalId = $principalId
}
