param(
  [string]$StackName = "BycCampDevStack",
  [string]$Region,
  [string]$ContainerName = "web",
  [switch]$SkipSeed
)

$ErrorActionPreference = "Stop"

function Invoke-AwsJson {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $baseArguments = @()
  if ($Region) {
    $baseArguments += @("--region", $Region)
  }

  $output = & aws @baseArguments @Arguments --output json
  if ($LASTEXITCODE -ne 0) {
    throw "AWS command failed: aws $(($baseArguments + $Arguments) -join ' ')"
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

  $match = $Outputs | Where-Object { $_.OutputKey -eq $OutputKey } | Select-Object -First 1
  if (-not $match -or -not $match.OutputValue) {
    throw "Missing required CloudFormation output: $OutputKey"
  }

  return [string]$match.OutputValue
}

function Get-TaskLogTarget {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TaskDefinitionArn,
    [Parameter(Mandatory = $true)]
    [string]$TaskArn
  )

  $taskDefinition = Invoke-AwsJson -Arguments @(
    "ecs",
    "describe-task-definition",
    "--task-definition",
    $TaskDefinitionArn
  )
  $containerDefinition = $taskDefinition.taskDefinition.containerDefinitions |
    Where-Object { $_.name -eq $ContainerName } |
    Select-Object -First 1

  if (-not $containerDefinition -or -not $containerDefinition.logConfiguration) {
    return $null
  }

  $logOptions = $containerDefinition.logConfiguration.options
  $logGroup = $logOptions."awslogs-group"
  $streamPrefix = $logOptions."awslogs-stream-prefix"
  if (-not $logGroup -or -not $streamPrefix) {
    return $null
  }

  $taskId = ($TaskArn -split "/")[-1]
  return [pscustomobject]@{
    Group = $logGroup
    Stream = "$streamPrefix/$ContainerName/$taskId"
  }
}

function Invoke-EcsOneOffTask {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [string]$ClusterName,
    [Parameter(Mandatory = $true)]
    [string]$TaskDefinitionArn,
    [Parameter(Mandatory = $true)]
    [string]$NetworkConfiguration,
    [Parameter(Mandatory = $true)]
    [string]$Command
  )

  Write-Host "Starting $Label task..."
  $overrides = @{
    containerOverrides = @(
      @{
        name = $ContainerName
        command = @("sh", "-c", $Command)
      }
    )
  } | ConvertTo-Json -Compress -Depth 10

  # Windows PowerShell can strip the quotes from JSON passed directly to a
  # native executable. Give the AWS CLI a UTF-8 file instead so --overrides is
  # parsed consistently across Windows PowerShell and PowerShell 7.
  $overridesFile = [System.IO.Path]::GetTempFileName()
  try {
    $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($overridesFile, $overrides, $utf8WithoutBom)
    $overridesUri = "file://$($overridesFile -replace '\\', '/')"

    $runTaskResult = Invoke-AwsJson -Arguments @(
      "ecs",
      "run-task",
      "--cluster",
      $ClusterName,
      "--launch-type",
      "FARGATE",
      "--task-definition",
      $TaskDefinitionArn,
      "--network-configuration",
      $NetworkConfiguration,
      "--overrides",
      $overridesUri
    )
  } finally {
    if (Test-Path -LiteralPath $overridesFile) {
      Remove-Item -LiteralPath $overridesFile -Force
    }
  }

  if ($runTaskResult.failures -and $runTaskResult.failures.Count -gt 0) {
    $failureMessage = $runTaskResult.failures | ConvertTo-Json -Compress -Depth 10
    throw "$Label task failed to start: $failureMessage"
  }

  $taskArn = [string]$runTaskResult.tasks[0].taskArn
  if (-not $taskArn) {
    throw "$Label task did not return a task ARN."
  }

  $logTarget = Get-TaskLogTarget -TaskDefinitionArn $TaskDefinitionArn -TaskArn $taskArn
  if ($logTarget) {
    Write-Host "$Label logs: group=$($logTarget.Group) stream=$($logTarget.Stream)"
  } else {
    Write-Host "$Label logs: unable to determine CloudWatch log stream from task definition."
  }

  Write-Host "Waiting for $Label task to stop..."
  $baseArguments = @()
  if ($Region) {
    $baseArguments += @("--region", $Region)
  }
  & aws @baseArguments ecs wait tasks-stopped --cluster $ClusterName --tasks $taskArn
  if ($LASTEXITCODE -ne 0) {
    throw "Timed out or failed while waiting for $Label task to stop."
  }

  $taskDescription = Invoke-AwsJson -Arguments @(
    "ecs",
    "describe-tasks",
    "--cluster",
    $ClusterName,
    "--tasks",
    $taskArn
  )
  $task = $taskDescription.tasks[0]
  $container = $task.containers |
    Where-Object { $_.name -eq $ContainerName } |
    Select-Object -First 1

  if (-not $container) {
    throw "$Label task stopped without a $ContainerName container result."
  }

  if ($null -eq $container.exitCode) {
    $reason = if ($container.reason) { $container.reason } else { $task.stoppedReason }
    throw "$Label task stopped without an exit code. Reason: $reason"
  }

  if ([int]$container.exitCode -ne 0) {
    $reason = if ($container.reason) { $container.reason } else { $task.stoppedReason }
    throw "$Label task failed with exit code $($container.exitCode). Reason: $reason"
  }

  Write-Host "$Label task completed successfully."
}

$stack = Invoke-AwsJson -Arguments @(
  "cloudformation",
  "describe-stacks",
  "--stack-name",
  $StackName,
  "--query",
  "Stacks[0].Outputs"
)

$clusterName = Get-RequiredStackOutput -Outputs $stack -OutputKey "ClusterName"
$taskDefinitionArn = Get-RequiredStackOutput -Outputs $stack -OutputKey "TaskDefinitionArn"
$publicSubnetIds = Get-RequiredStackOutput -Outputs $stack -OutputKey "PublicSubnetIds"
$ecsSecurityGroupId = Get-RequiredStackOutput -Outputs $stack -OutputKey "EcsSecurityGroupId"

$subnetList = ($publicSubnetIds -split ",") |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_.Length -gt 0 }
if ($subnetList.Count -eq 0) {
  throw "CloudFormation output PublicSubnetIds did not contain any subnet IDs."
}

$networkConfiguration = "awsvpcConfiguration={subnets=[$($subnetList -join ',')],securityGroups=[$ecsSecurityGroupId],assignPublicIp=ENABLED}"

Invoke-EcsOneOffTask `
  -Label "Prisma migration" `
  -ClusterName $clusterName `
  -TaskDefinitionArn $taskDefinitionArn `
  -NetworkConfiguration $networkConfiguration `
  -Command "cd /app/server && npx prisma migrate deploy"

if ($SkipSeed) {
  Write-Host "Skipping initial super admin seed task because -SkipSeed was provided."
  exit 0
}

Invoke-EcsOneOffTask `
  -Label "Initial super admin seed" `
  -ClusterName $clusterName `
  -TaskDefinitionArn $taskDefinitionArn `
  -NetworkConfiguration $networkConfiguration `
  -Command "cd /app/server && npm run db:seed:prod"
