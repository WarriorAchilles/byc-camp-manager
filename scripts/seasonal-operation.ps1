param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("STATUS", "WAKE", "HIBERNATE")]
  [string]$Operation,
  [string]$StackName = "BycCampDevStack",
  [string]$Region = "us-east-2",
  [string]$Profile,
  [switch]$Recover
)

$ErrorActionPreference = "Stop"

function Invoke-AwsJson {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $awsArguments = @($Arguments)
  if ($Region) {
    $awsArguments += @("--region", $Region)
  }
  if ($Profile) {
    $awsArguments += @("--profile", $Profile)
  }
  $awsArguments += @("--output", "json", "--no-cli-pager")

  $output = & aws @awsArguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS command failed: aws $($awsArguments -join ' ')"
  }

  if (-not $output) {
    return $null
  }

  return $output | ConvertFrom-Json
}

function Get-RequiredStackOutput {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Outputs,
    [Parameter(Mandatory = $true)]
    [string]$OutputKey
  )

  $match = $Outputs |
    Where-Object { $_.OutputKey -eq $OutputKey } |
    Select-Object -First 1

  if (-not $match -or -not $match.OutputValue) {
    throw "Missing required CloudFormation output: $OutputKey"
  }

  return [string]$match.OutputValue
}

function Get-SeasonalMode {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ParameterName
  )

  $result = Invoke-AwsJson -Arguments @(
    "ssm",
    "get-parameter",
    "--name",
    $ParameterName
  )

  return [string]$result.Parameter.Value
}

function Get-Executions {
  param(
    [Parameter(Mandatory = $true)]
    [string]$StateMachineArn,
    [string]$StatusFilter,
    [int]$MaximumResults = 10
  )

  $arguments = @(
    "stepfunctions",
    "list-executions",
    "--state-machine-arn",
    $StateMachineArn,
    "--max-results",
    [string]$MaximumResults
  )
  if ($StatusFilter) {
    $arguments += @("--status-filter", $StatusFilter)
  }

  $result = Invoke-AwsJson -Arguments $arguments
  return @($result.executions)
}

function Write-ExecutionSummary {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [object[]]$Executions
  )

  if ($Executions.Count -eq 0) {
    Write-Host "Recent executions: none"
    return
  }

  Write-Host "Recent executions:"
  $Executions |
    Select-Object status, startDate, stopDate, name |
    Format-Table -AutoSize |
    Out-Host
}

function Start-SeasonalExecution {
  param(
    [Parameter(Mandatory = $true)]
    [string]$StateMachineArn,
    [Parameter(Mandatory = $true)]
    [string]$RequestedOperation
  )

  $executionInput = @{
    operation = $RequestedOperation
    source = "operator"
  } | ConvertTo-Json -Compress

  # Passing JSON directly to native executables is unreliable across Windows
  # PowerShell versions. A UTF-8 file avoids shell quote rewriting entirely.
  $inputFile = [System.IO.Path]::GetTempFileName()
  try {
    $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($inputFile, $executionInput, $utf8WithoutBom)
    $inputUri = "file://$($inputFile -replace '\\', '/')"

    return Invoke-AwsJson -Arguments @(
      "stepfunctions",
      "start-execution",
      "--state-machine-arn",
      $StateMachineArn,
      "--input",
      $inputUri
    )
  } finally {
    if (Test-Path -LiteralPath $inputFile) {
      Remove-Item -LiteralPath $inputFile -Force
    }
  }
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw "The AWS CLI is required but was not found on PATH."
}

$stack = Invoke-AwsJson -Arguments @(
  "cloudformation",
  "describe-stacks",
  "--stack-name",
  $StackName
)
$stackOutputs = @($stack.Stacks[0].Outputs)
$stateMachineArn = Get-RequiredStackOutput `
  -Outputs $stackOutputs `
  -OutputKey "SeasonalControllerStateMachineArn"
$modeParameter = Get-RequiredStackOutput `
  -Outputs $stackOutputs `
  -OutputKey "SeasonalModeParameterName"
$mode = Get-SeasonalMode -ParameterName $modeParameter

Write-Host "Stack: $StackName"
Write-Host "Region: $Region"
Write-Host "Seasonal mode: $mode"

if ($Operation -eq "STATUS") {
  $recentExecutions = @(
    Get-Executions `
      -StateMachineArn $stateMachineArn `
      -MaximumResults 5
  )
  Write-ExecutionSummary -Executions $recentExecutions
  exit 0
}

$runningExecutions = @(
  Get-Executions `
    -StateMachineArn $stateMachineArn `
    -StatusFilter "RUNNING" `
    -MaximumResults 100
)
if ($runningExecutions.Count -gt 0) {
  Write-ExecutionSummary -Executions $runningExecutions
  throw "A seasonal-controller execution is already running. Wait for it to finish or inspect it in Step Functions before starting another operation."
}

$satisfiedMode = if ($Operation -eq "WAKE") { "ACTIVE" } else { "HIBERNATED" }
$allowedModes = if ($Operation -eq "WAKE") {
  @("HIBERNATED", "ERROR")
} else {
  @("ACTIVE", "ERROR")
}
$recoverableModes = @("WAKING", "HIBERNATING", "MAINTENANCE")

if ($mode -eq $satisfiedMode) {
  Write-Host "No action needed; the system is already $satisfiedMode."
  exit 0
}

if ($allowedModes -notcontains $mode) {
  if ($Recover -and $recoverableModes -contains $mode) {
    Write-Warning "Recovering abandoned seasonal mode $mode by setting the controller mode to ERROR."
    Invoke-AwsJson -Arguments @(
      "ssm",
      "put-parameter",
      "--name",
      $modeParameter,
      "--value",
      "ERROR",
      "--type",
      "String",
      "--overwrite"
    ) | Out-Null
    $mode = "ERROR"
  } else {
    $recoveryHint = if ($recoverableModes -contains $mode) {
      " After inspecting the failed execution, use the explicit season:recover:$($Operation.ToLowerInvariant()) command."
    } else {
      ""
    }
    throw "Cannot start $Operation while the seasonal mode is $mode.$recoveryHint"
  }
}

$execution = Start-SeasonalExecution `
  -StateMachineArn $stateMachineArn `
  -RequestedOperation $Operation

Write-Host "$Operation execution started successfully."
Write-Host "Execution ARN: $($execution.executionArn)"
Write-Host "Run 'npm run season:status' to monitor its progress."
