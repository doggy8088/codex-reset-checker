param(
    [string]$AuthPath = "$env:USERPROFILE\.codex\auth.json"
)

$ErrorActionPreference = 'Stop'
$APIUrl = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'

if (-not (Test-Path -LiteralPath $AuthPath)) {
    Write-Error "錯誤：找不到 auth.json：$AuthPath"
    exit 1
}

try {
    $authJson = Get-Content -Raw -LiteralPath $AuthPath -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
} catch {
    Write-Error "錯誤：讀取或解析 auth.json 失敗：$($_.Exception.Message)"
    exit 1
}

$accessToken = $null
$accountId = $null
if ($null -ne $authJson.tokens) {
    if ($null -ne $authJson.tokens.access_token) { $accessToken = [string]$authJson.tokens.access_token }
    if ($null -ne $authJson.tokens.account_id) { $accountId = [string]$authJson.tokens.account_id }
}

if ([string]::IsNullOrWhiteSpace($accessToken)) {
    Write-Error '錯誤：auth.json 內未找到 tokens.access_token'
    exit 1
}

$headers = @{
    'Authorization' = "Bearer $accessToken"
    'OpenAI-Beta'  = 'codex-1'
    'originator'   = 'Codex Desktop'
}
if (-not [string]::IsNullOrWhiteSpace($accountId)) {
    $headers['ChatGPT-Account-ID'] = $accountId
}

function Convert-ToLocalTimeString {
    param([Parameter(Mandatory = $true)][AllowNull()][object]$Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return 'N/A'
    }
    try {
        $dt = [DateTimeOffset]::Parse([string]$Value)
        return $dt.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss zzz')
    } catch {
        return [string]$Value
    }
}

try {
    $response = Invoke-RestMethod -Method Get -Uri $APIUrl -Headers $headers -ErrorAction Stop
} catch {
    $statusCode = $null
    if ($_.Exception.Response -is [System.Net.WebException]) {
        try {
            $statusCode = [int]$_.Exception.Response.StatusCode
        } catch { }
    }
    $msg = $_.Exception.Message
    if ($statusCode) {
        Write-Error "錯誤：請求 API 失敗，HTTP $statusCode。$msg"
    } else {
        Write-Error "錯誤：請求 API 失敗：$msg"
    }
    exit 1
}

$availableCount = if ($response.PSObject.Properties.Name -contains 'available_count') { $response.available_count } else { 'N/A' }
Write-Output "available_count: $availableCount"

$credits = if ($response.PSObject.Properties.Name -contains 'credits') {
    $response.credits
} elseif ($response.PSObject.Properties.Name -contains 'items') {
    $response.items
} elseif ($response.PSObject.Properties.Name -contains 'data') {
    $response.data
} else {
    @()
}

if (-not $credits) {
    Write-Output 'credits: 0'
    exit 0
}

$credits = @($credits)
Write-Output 'credits:'

for ($i = 0; $i -lt $credits.Count; $i++) {
    $credit = $credits[$i]
    $grantedAt = Convert-ToLocalTimeString -Value $credit.granted_at
    $expiresAt = Convert-ToLocalTimeString -Value $credit.expires_at
    $status = if ($credit.PSObject.Properties.Name -contains 'status') { $credit.status } else { 'N/A' }

    Write-Output "- credit #$($i + 1)"
    Write-Output "  granted_at: $grantedAt"
    Write-Output "  expires_at: $expiresAt"
    Write-Output "  status: $status"
}
