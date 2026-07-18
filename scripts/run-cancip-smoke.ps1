param(
  [switch]$Full,
  [switch]$Write,
  [switch]$Mobile,
  [switch]$DirectEval,
  [string]$Case = '',
  [switch]$VerboseReport,
  [switch]$FailFast
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
  $pwsh = Get-Command pwsh -ErrorAction Stop
  $forward = @('-NoProfile', '-File', $PSCommandPath)
  if ($Full) { $forward += '-Full' }
  if ($Write) { $forward += '-Write' }
  if ($Mobile) { $forward += '-Mobile' }
  if ($DirectEval) { $forward += '-DirectEval' }
  if ($Case) { $forward += @('-Case', $Case) }
  if ($VerboseReport) { $forward += '-VerboseReport' }
  if ($FailFast) { $forward += '-FailFast' }
  & $pwsh.Source @forward
  exit $LASTEXITCODE
}

if ($Mobile -and -not $Case) { $Case = 'programmatic.mobile.' }

$Root = Split-Path -Parent $PSScriptRoot
$CasesPath = Join-Path $Root 'tests/cancip-regression-cases.json'
$ObqPath = 'C:/Users/35007/Documents/Codex/tools/ob-cli-queue/obq.ps1'
$ObsidianCliPath = 'C:/Program Files/Obsidian/Obsidian.com'
$InstalledCancipDataPath = 'E:/note/.obsidian/plugins/cancip/data.json'
$InstalledCancipConfigPath = 'E:/note/.cancip/config.json'
$OutDir = Join-Path $Root 'reports'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Script:OriginalSessionId = ''
$Script:SmokeSessionId = ''
$Script:SkipSmokeSessionRestore = $false
$Script:SmokeSettingsSnapshotPath = ''

$AllCases = Get-Content -Raw -LiteralPath $CasesPath -Encoding UTF8 | ConvertFrom-Json
$RunProfile = if ($Mobile) { 'mobile' } elseif (
  $Case -like '*ui-button*' -or
  $Case -like '*code-block-wrap*' -or
  $Case -like '*context-editor-settings*' -or
  $Case -like '*editor-autocomplete*' -or
  $Case -like '*document-workbench*' -or
  $Case -like '*personalization-autocomplete*' -or
  $Case -like '*process-detail-deferred-dom*' -or
  $Case -like '*interaction-regression-controls*'
) { 'ui-button' } elseif ($Write) { 'write' } elseif ($Full) { 'full' } else { 'core' }
$DefaultCommandIds = @(
  'command.tools.index',
  'command.memory.read.profile',
  'command.obsidian.currentView',
  'command.obsidian.files.pins',
  'command.findTarget.daily-note',
  'command.obsidian.js.help',
  'command.obsidian.js.probe',
  'command.obsidian.eval.expression',
  'command.obsidian.eval.alias-js',
  'command.obsidian.resolveCommand.fuzzy',
  'command.obsidian.resolveCommand.daily-note',
  'command.obsidian.resolveCommand.notedraw-intent',
  'command.obsidian.resolveCommand.spaced-repetition',
  'command.obsidian.resolveCommand.mobile-pdf',
  'command.obsidian.resolveCommand.tasks-edit',
  'command.obsidian.resolveCommand.dataview-refresh',
  'command.skills.list',
  'command.plugins.capabilities.notedraw',
  'command.plugins.capabilities.pdftion',
  'command.plugins.route.notedraw',
  'command.annotate.help',
  'command.annotate.note.status',
  'command.annotate.pdf.status',
  'command.study.help',
  'command.automation.templates',
  'command.attachment.help',
  'command.documents.help'
)

$Report = [ordered]@{
  ok = $true
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  version = ''
  promptHead = ''
  writeEnabled = [bool]$Write
  full = [bool]$Full
  directEval = [bool]$DirectEval
  mobile = [bool]$Mobile
  caseFilter = $Case
  runProfile = $RunProfile
  probe = $null
  promptCases = @()
  commandCases = @()
  programmaticCases = @()
  writeCases = @()
  failures = @()
  failureCountByGroup = [ordered]@{}
  recommendations = @()
  totals = [ordered]@{ pass = 0; fail = 0; skip = 0; elapsedMs = 0 }
}
$Started = Get-Date

if ($Case -notlike '*editor-autocomplete-mounted*' -and (Test-Path -LiteralPath $InstalledCancipDataPath)) {
  $snapshotName = "cancip-smoke-data-before-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')).json"
  $Script:SmokeSettingsSnapshotPath = Join-Path $OutDir $snapshotName
  Copy-Item -LiteralPath $InstalledCancipDataPath -Destination $Script:SmokeSettingsSnapshotPath -Force
}

function ConvertTo-CompactJson {
  param([object]$Value)
  $Value | ConvertTo-Json -Compress -Depth 40
}

function ConvertTo-CancipEvalBootstrap {
  param([string]$Code)
  $base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Code))
  return "(()=>{const s=atob('$base64');const bytes=Uint8Array.from(s,c=>c.charCodeAt(0));return eval(new TextDecoder().decode(bytes))})()"
}

function Invoke-CancipEval {
  param(
    [string]$Code,
    [int]$TimeoutSeconds = 25
  )
  $attempts = @()
  if ($DirectEval -and (Test-Path -LiteralPath $ObsidianCliPath) -and $Code.Length -lt 24000) {
    $attempts += @{ name = 'direct' }
  }
  if (Test-Path -LiteralPath $ObqPath) {
    $attempts += @{ name = 'queue' }
  }
  if (-not $attempts.Count) { throw 'No Obsidian eval transport is available' }

  $errors = @()
  foreach ($attempt in $attempts) {
    try {
      $out = @()
      if ($attempt.name -eq 'direct') {
        $out = & $ObsidianCliPath eval "code=$Code" 2>&1
        $exitCode = $LASTEXITCODE
      } else {
        $out = & $ObqPath `
          -CommandTimeoutSeconds $TimeoutSeconds `
          -WaitTimeoutSeconds ([Math]::Max(45, $TimeoutSeconds + 25)) `
          eval "code=$Code" 2>&1
        $exitCode = $LASTEXITCODE
      }
      $raw = ($out -join "`n").Trim()
      if ($exitCode -ne 0) { throw "$($attempt.name) exited $exitCode`: $raw" }
      if ($raw -match 'CLI is unable to find Obsidian|unable to find Obsidian|Please make sure Obsidian is running') {
        throw "$($attempt.name) cannot connect to Obsidian: $raw"
      }
      if ($raw -match '(?im)^(error|failed|exception)\b' -and $raw -notmatch '(?m)^=>\s*') {
        throw "$($attempt.name) returned error text: $raw"
      }
      $matches = [regex]::Matches($raw, '(?m)^=>\s*(.+?)\s*$')
      if ($matches.Count -gt 0) {
        $text = $matches[$matches.Count - 1].Groups[1].Value.Trim()
      } else {
        $text = $raw.Trim() -replace '^=>\s*', ''
      }
      if (-not $text) { throw "$($attempt.name) returned an empty eval response" }
      try {
        return $text | ConvertFrom-Json
      } catch {
        $preview = if ($text.Length -gt 1200) { $text.Substring(0, 1200) + "`n...[truncated]" } else { $text }
        throw "$($attempt.name) returned invalid eval JSON: $preview"
      }
    } catch {
      $errors += "$($attempt.name): $($_.Exception.Message)"
    }
  }
  throw "All Obsidian eval transports failed:`n$($errors -join "`n")"
}

function Should-RunProgrammaticCase {
  param([string]$Id)
  if ($Case) { return $Id.Contains($Case) }
  return -not ($Id -like 'programmatic.ui-button-*' -or $Id -like 'programmatic.mobile.*')
}

function Select-CaseList {
  param([object[]]$List, [scriptblock]$Predicate)
  $selected = @()
  foreach ($item in $List) {
    if ($Case -and -not ([string]$item.id).Contains($Case)) { continue }
    if (& $Predicate $item) { $selected += $item }
  }
  return $selected
}

function Action-Key {
  param($Action)
  $path = if ($Action.path) { ([string]$Action.path).Replace('\','/').TrimStart('/') } else { $null }
  return (ConvertTo-CompactJson ([ordered]@{ type = $Action.type; path = $path; command = $Action.command }))
}

function Has-ExpectedAction {
  param($Actual, $Expected)
  $expectedKey = Action-Key $Expected
  foreach ($action in @($Actual)) {
    if ((Action-Key $action) -eq $expectedKey) { return $true }
  }
  return $false
}

function Add-CaseResult {
  param([string]$Group, [hashtable]$Item)
  $Report[$Group] += @($Item)
  if ($Item.skip) {
    $Report.totals.skip++
    Write-Host "$Group/$($Item.id) ... SKIP $($Item.reason)"
    return
  }
  if ($Item.pass) {
    $Report.totals.pass++
    Write-Host "$Group/$($Item.id) ... PASS $($Item.elapsedMs)ms"
    return
  }
  $Report.ok = $false
  $Report.totals.fail++
  $Report.failures += @([ordered]@{
    group = $Group
    id = [string]$Item.id
    error = [string]$Item.error
    recommendation = Get-SmokeRecommendation -Group $Group -Id ([string]$Item.id) -Error ([string]$Item.error)
  })
  Write-Host "$Group/$($Item.id) ... FAIL $($Item.error)"
  if ($VerboseReport -and $Item.debug) { Write-Host $Item.debug }
  if ($RunProfile -eq 'ui-button' -and (Is-FatalSmokeTransportFailure ([string]$Item.error))) {
    $Script:SkipSmokeSessionRestore = $true
    Write-FinalReport 1
  }
  if ($FailFast) { Write-FinalReport 1 }
}

function Is-FatalSmokeTransportFailure {
  param([string]$Error)
  return $Error -match 'Timed out after \d+ seconds|empty eval response|returned an empty eval response|cannot connect to Obsidian|unable to find Obsidian|Obsidian plugin/view is not loaded|No Obsidian eval transport is available'
}

function Get-SmokeRecommendation {
  param([string]$Group, [string]$Id, [string]$Error)
  if ($Error -match 'unable to find Obsidian|cannot connect to Obsidian|Obsidian plugin/view is not loaded') {
    return 'Restart Obsidian, verify Cancip is enabled, then rerun the same focused smoke case.'
  }
  if ($Error -match 'Timed out after \d+ seconds') {
    return 'Rerun the smallest focused case; split or shrink the eval body if it still times out.'
  }
  if ($Error -match 'empty eval response|returned an empty eval response') {
    return 'Rerun the smallest focused case with direct eval or split the UI eval so a missing return cannot stall the queue.'
  }
  if ($Id -like 'programmatic.ui-button-*') {
    return 'Keep this in npm run smoke:ui; inspect the UI button management path without blocking core smoke.'
  }
  if ($Group -eq 'promptCases') {
    return 'Inspect promptPayloadPolicy/buildContext routing and keep always-sent prompt/context under the case budget.'
  }
  if ($Group -eq 'commandCases') {
    return 'Inspect command bus registration/execution and add a generic route or help text before changing the prompt.'
  }
  if ($Group -eq 'writeCases') {
    return 'Inspect approval/write execution and cleanup behavior under Cancip验收-临时/.'
  }
  return 'Open reports/cancip-smoke-latest.json and rerun with -Case plus -VerboseReport for the smallest repro.'
}

function Assert-PromptCase {
  param($Item, $Expect)
  if ($Expect.intent -and $Item.intent -ne $Expect.intent) { throw "intent expected $($Expect.intent) got $($Item.intent)" }
  if ($Expect.maxModePromptChars -and $Item.modePromptChars -gt $Expect.maxModePromptChars) { throw "modePromptChars $($Item.modePromptChars) > $($Expect.maxModePromptChars)" }
  if ($Expect.maxContextChars -and $Item.contextChars -gt $Expect.maxContextChars) { throw "contextChars $($Item.contextChars) > $($Expect.maxContextChars)" }
  if ($null -ne $Expect.maxActions -and @($Item.actions).Count -gt [int]$Expect.maxActions) { throw "actions $(@($Item.actions).Count) > $($Expect.maxActions)" }
  foreach ($name in @($Expect.policyFalse | Where-Object { $_ })) {
    if ($Item.policy.$name) { throw "policy.$name expected false" }
  }
  foreach ($name in @($Expect.policyTrue | Where-Object { $_ })) {
    if (-not $Item.policy.$name) { throw "policy.$name expected true" }
  }
  foreach ($action in @($Expect.requiredActions | Where-Object { $_ })) {
    if (-not (Has-ExpectedAction $Item.actions $action)) { throw "missing action $(Action-Key $action)" }
  }
  foreach ($command in @($Expect.forbidCommands | Where-Object { $_ })) {
    foreach ($action in @($Item.actions)) {
      if ($action.type -eq 'command' -and $action.command -eq $command) { throw "forbidden command present $command" }
    }
  }
}

function Assert-CommandCase {
  param($Item, $Expect)
  if ($Expect.maxMs -and $Item.elapsedMs -gt $Expect.maxMs) { throw "elapsedMs $($Item.elapsedMs) > $($Expect.maxMs)" }
  $text = [string]$Item.text
  foreach ($token in @($Expect.contains | Where-Object { $_ })) {
    if (-not $text.Contains([string]$token)) { throw "missing text: $token" }
  }
  if ($Expect.containsAny) {
    $ok = $false
    foreach ($token in @($Expect.containsAny)) {
      if ($text.Contains([string]$token)) { $ok = $true; break }
    }
    if (-not $ok) { throw "missing any text: $(@($Expect.containsAny) -join ', ')" }
  }
}

function Write-FinalReport {
  param([int]$Code)
  Remove-EmptyCancipSmokeDirectory
  Restore-CancipSessionAfterSmoke
  Restore-CancipSettingsAfterSmoke
  $Report.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  $Report.totals.elapsedMs = [int]((Get-Date) - $Started).TotalMilliseconds
  $counts = [ordered]@{}
  foreach ($failure in @($Report.failures)) {
    $group = [string]$failure.group
    if (-not $counts.Contains($group)) { $counts[$group] = 0 }
    $counts[$group]++
  }
  $Report.failureCountByGroup = $counts
  $Report.recommendations = @($Report.failures | ForEach-Object { $_.recommendation } | Select-Object -Unique)
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
  $path = Join-Path $OutDir "cancip-smoke-$stamp.json"
  $latestPath = Join-Path $OutDir 'cancip-smoke-latest.json'
  $json = $Report | ConvertTo-Json -Depth 50
  $json | Set-Content -LiteralPath $path -Encoding UTF8
  $json | Set-Content -LiteralPath $latestPath -Encoding UTF8
  $status = if ($Report.ok) { 'PASS' } else { 'FAIL' }
  Write-Host "Cancip smoke $status / version $($Report.version) / pass $($Report.totals.pass) / fail $($Report.totals.fail) / skip $($Report.totals.skip) / $($Report.totals.elapsedMs)ms"
  Write-Host "Report: $path"
  Write-Host "Latest: $latestPath"
  exit $Code
}

function Remove-EmptyCancipSmokeDirectory {
  if ($Script:SkipSmokeSessionRestore) { return }
  try {
    $code = @'
(async()=>{const path='Cancip验收-临时';const adapter=app.vault.adapter;if(!(await adapter.exists(path)))return JSON.stringify({ok:true,removed:false});const listing=await adapter.list(path);if((listing.files?.length??0)||(listing.folders?.length??0))return JSON.stringify({ok:false,removed:false,reason:'not-empty'});await adapter.rmdir(path,false);return JSON.stringify({ok:!(await adapter.exists(path)),removed:true});})()
'@
    $result = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $code) -TimeoutSeconds 30
    if (-not $result.ok) { Write-Host "Smoke cleanup warning: Cancip验收-临时 was not empty and was preserved." }
  } catch {
    Write-Host "Smoke cleanup warning: failed to remove empty Cancip验收-临时 directory: $($_.Exception.Message)"
  }
}

function Restore-CancipSettingsAfterSmoke {
  if (-not $Script:SmokeSettingsSnapshotPath) { return }
  if (-not (Test-Path -LiteralPath $Script:SmokeSettingsSnapshotPath)) { return }
  try {
    Copy-Item -LiteralPath $Script:SmokeSettingsSnapshotPath -Destination $InstalledCancipDataPath -Force
    $data = Get-Content -Raw -LiteralPath $InstalledCancipDataPath -Encoding UTF8 | ConvertFrom-Json
    if ($null -ne $data -and $null -ne $data.uiButtonRules) {
      $dirtyMarkers = @('smoke', 'cancip-menu-', 'obcc-smoke', 'cancip-sort-smoke', 'cancip-button-context-smoke')
      $keptRules = @()
      $removedCount = 0
      foreach ($rule in @($data.uiButtonRules)) {
        $ruleText = $rule | ConvertTo-Json -Compress -Depth 40
        $dirty = $false
        foreach ($marker in $dirtyMarkers) {
          if ($ruleText -match [regex]::Escape($marker)) {
            $dirty = $true
            break
          }
        }
        if ($dirty) {
          $removedCount += 1
        } else {
          $keptRules += $rule
        }
      }
      if ($removedCount -gt 0) {
        $data.uiButtonRules = @($keptRules)
        ($data | ConvertTo-Json -Depth 100) | Set-Content -LiteralPath $InstalledCancipDataPath -Encoding UTF8
        Write-Host "Smoke cleanup: removed $removedCount test UI button rule(s) from restored Cancip data.json."
      }
    }
    # loadSettings() gives the newer mirrored config priority. Copy-Item keeps the
    # snapshot's old timestamp, so make the restored plugin data authoritative.
    $authoritativeTime = [DateTime]::UtcNow
    if (Test-Path -LiteralPath $InstalledCancipConfigPath) {
      $configTime = (Get-Item -LiteralPath $InstalledCancipConfigPath).LastWriteTimeUtc
      if ($configTime -ge $authoritativeTime) {
        $authoritativeTime = $configTime.AddSeconds(1)
      }
    }
    [IO.File]::SetLastWriteTimeUtc($InstalledCancipDataPath, $authoritativeTime)
  } catch {
    Write-Host "Smoke cleanup warning: failed to restore and sanitize Cancip data.json from snapshot: $($_.Exception.Message)"
    return
  }
  try {
    $code = "(async()=>{const p=app.plugins.plugins.cancip;if(!p)return JSON.stringify({ok:false});if(typeof p.loadSettings==='function')await p.loadSettings();if(typeof p.refreshOpenViews==='function')p.refreshOpenViews();return JSON.stringify({ok:true,uiButtonRules:p.settings?.uiButtonRules?.length??0});})()"
    Invoke-CancipEval -Code $code -TimeoutSeconds 30 | Out-Null
  } catch {
    Write-Host "Smoke cleanup warning: restored data.json but could not reload Cancip settings in Obsidian: $($_.Exception.Message)"
  }
}

function Restore-CancipSessionAfterSmoke {
  if ($Script:SkipSmokeSessionRestore) {
    Write-Host 'Smoke cleanup skipped after fatal Obsidian eval transport failure.'
    return
  }
  if (-not $Script:OriginalSessionId) { return }
  try {
    $sessionId = $Script:OriginalSessionId.Replace("'", "\'")
    $code = "(async()=>{const p=app.plugins.plugins.cancip;const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;if(!v||typeof v.loadSessionById!=='function')return JSON.stringify({ok:false});await v.loadSessionById('$sessionId');return JSON.stringify({ok:true,sessionId:v.sessionId});})()"
    Invoke-CancipEval -Code $code -TimeoutSeconds 30 | Out-Null
  } catch {
    Write-Host "Smoke cleanup warning: failed to restore Cancip session $Script:OriginalSessionId`: $($_.Exception.Message)"
  }
}

try {
  if ($RunProfile -eq 'ui-button') {
    $ProbeCode = "(async()=>{const p=app.plugins.plugins.cancip;const v=p&&typeof p.getOrCreateChatView==='function'?await p.getOrCreateChatView({reveal:false,focus:false}):app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;const m=app.plugins.manifests.cancip;return JSON.stringify({ok:!!(p&&v),version:m?.version??'',promptHead:String(p?.settings?.systemPrompt||'').split('\n')[0],views:app.workspace.getLeavesOfType('cancip-view').length,sessionId:v?.sessionId||'',devErrors:(p?.devErrors||[]).slice(-5)});})()"
  } else {
    $ProbeCode = "(async()=>{const p=app.plugins.plugins.cancip;const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;const m=app.plugins.manifests.cancip;return JSON.stringify({ok:!!(p&&v),version:m?.version??'',promptHead:String(p?.settings?.systemPrompt||'').split('\n')[0],views:app.workspace.getLeavesOfType('cancip-view').length,sessionId:v?.sessionId||'',devErrors:(p?.devErrors||[]).slice(-5)});})()"
  }
  $probe = Invoke-CancipEval -Code $ProbeCode -TimeoutSeconds 25
  $Report.probe = $probe
  $Report.version = [string]$probe.version
  $Report.promptHead = [string]$probe.promptHead
  $Script:OriginalSessionId = [string]$probe.sessionId
  if (-not $probe.ok) { throw 'Cancip plugin/view is not loaded' }
  if ($RunProfile -ne 'ui-button') {
    $StartSmokeSessionCode = "(async()=>{const p=app.plugins.plugins.cancip;const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;if(!v)throw new Error('Cancip view unavailable');await v.newChat({force:true});v.sessionTitleOverride='Cancip smoke';await v.saveCurrentSession();await new Promise(r=>setTimeout(r,700));return JSON.stringify({ok:true,sessionId:v.sessionId});})()"
    $smokeSession = Invoke-CancipEval -Code $StartSmokeSessionCode -TimeoutSeconds 35
    $Script:SmokeSessionId = [string]$smokeSession.sessionId
  }
} catch {
  Add-CaseResult 'promptCases' @{ id = 'probe'; pass = $false; error = $_.Exception.Message }
  Write-FinalReport 1
}

$PromptCases = Select-CaseList @($AllCases.promptCases) { param($x) $Full -or -not $x.fullOnly }
$CommandCases = Select-CaseList @($AllCases.commandCases) { param($x) $Full -or ($DefaultCommandIds -contains [string]$x.id) }
$WriteCases = Select-CaseList @($AllCases.writeCases) { param($x) $true }

foreach ($test in $PromptCases) {
  try {
    $testJson = ConvertTo-CompactJson $test
    $code = "(async()=>{const test=$testJson;const p=app.plugins.plugins.cancip;const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;if(!v)throw new Error('Cancip view unavailable');const t=Date.now();const policy=v.promptPayloadPolicy(test.prompt);const actions=v.programmaticReadOnlyActionsForPrompt(test.prompt);const mp=v.modePrompt(test.prompt);const am=v.informationalAnswerSystemPrompt();const ctx=(test.expect&&test.expect.maxContextChars)?await v.buildContext(test.prompt,test.prompt):{contextText:'',system:mp};return JSON.stringify({id:test.id,prompt:test.prompt,elapsedMs:Date.now()-t,intent:policy.intent,policy,actions,modePromptChars:mp.length,contextChars:String(ctx.contextText||'').length,systemChars:String(ctx.system||'').length,answerModeChars:am.length});})()"
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 35
    Assert-PromptCase $item $test.expect
    Add-CaseResult 'promptCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; intent = $item.intent; modePromptChars = $item.modePromptChars; contextChars = $item.contextChars; actions = $item.actions; policy = $item.policy }
  } catch {
    Add-CaseResult 'promptCases' @{ id = $test.id; pass = $false; error = $_.Exception.Message }
  }
}

foreach ($test in $CommandCases) {
  try {
    $testJson = ConvertTo-CompactJson $test
    $code = "(async()=>{const test=$testJson;const p=app.plugins.plugins.cancip;const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;if(!v)throw new Error('Cancip view unavailable');const t=Date.now();let text='';if(test.command){text=await v.executeCommandAction(test.command,test.args||{});}else if(test.action){text=await v.executeAction(test.action);}else{throw new Error('missing command/action');}text=String(text);return JSON.stringify({id:test.id,command:test.command,action:test.action,elapsedMs:Date.now()-t,textChars:text.length,text:text.length>1800?text.slice(0,1800)+'\n...[truncated '+(text.length-1800)+' chars]':text});})()"
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    Assert-CommandCase $item $test.expect
    Add-CaseResult 'commandCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; textChars = $item.textChars; text = $item.text }
  } catch {
    Add-CaseResult 'commandCases' @{ id = $test.id; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.outcome-verification-evidence') {
  $outcomeSmokeReady = $false
  try {
    $started = Get-Date
    Invoke-CancipEval -TimeoutSeconds 25 -Code @'
(async()=>{
  const p=app.plugins.plugins.cancip;
  const v=await p?.activateView?.();
  if(!p||!v||typeof v.executeCommandAction!=='function')throw new Error('Cancip outcome command runtime unavailable');
  const doc=v.containerEl.ownerDocument;
  const fixture=doc.createElement('div');
  fixture.className='obcc-outcome-smoke-fixture';
  fixture.style.cssText='position:fixed;left:0;top:80px;width:64px;height:120px;z-index:9999;display:grid;grid-template-rows:repeat(4,1fr);background:#fff;color:#111;border:1px solid #d33;overflow:hidden;font-size:8px;line-height:1;';
  fixture.innerHTML='<div class="outcome-target" style="background:#1367a8;color:#fff;padding:2px;overflow:hidden">TARGET</div><div style="background:#f3c623;padding:2px;overflow:hidden">EVIDENCE</div><div style="background:#2f8f46;color:#fff;padding:2px;overflow:hidden">PASS</div><div style="background:#fff;padding:2px;overflow:hidden">OK</div>';
  v.containerEl.appendChild(fixture);
  window.__cancipOutcomeSmoke={v,fixture,loop:'outcome-smoke-'+Date.now(),created:[]};
  return JSON.stringify({ready:true});
})()
'@
    $outcomeSmokeReady = $true
    $pass = Invoke-CancipEval -TimeoutSeconds 35 -Code @'
(async()=>{const s=window.__cancipOutcomeSmoke,{v,loop,created}=s;const run={id:loop+'-pass',action:{type:'command',command:'cancip.outcome.capture',args:{}},summary:'capture',status:'executed',createdAt:new Date().toISOString()};const text=String(await v.executeCommandAction('cancip.outcome.capture',{scope:'cancip',rootSelector:'.obcc-outcome-smoke-fixture',visualReview:true,loopId:loop+'-pass',attempt:1,maxAttempts:2,expected:{selectors:[{id:'target',selector:'.outcome-target',count:1,visible:true,withinViewport:true}],noHorizontalOverflow:true}},run));run.result=text;created.push(...(run.evidencePaths||[]));const reportPath=run.evidencePaths.find(path=>path.endsWith('.json')),pngPath=run.evidencePaths.find(path=>path.endsWith('.png')),report=JSON.parse(await app.vault.adapter.read(reportPath)),png=new Uint8Array(await app.vault.adapter.readBinary(pngPath)),queued=(v.outcomeEvidenceImagesByRunId?.get(run.id)||[]).length,taken=v.takeOutcomeEvidenceImages([run]),host=v.containerEl.ownerDocument.createElement('div');v.renderToolRuns(host,{id:'outcome-smoke-message',toolRuns:[run]},false);return JSON.stringify({passed:/结果验收：通过|Outcome verification: passed/i.test(text)&&report.status==='passed'&&report.schemaVersion===1&&report.checks.every(item=>item.pass),pngValid:png.length>256&&png[0]===137&&png[1]===80&&png[2]===78&&png[3]===71&&report.evidence.png?.width>1&&report.evidence.png?.height>1&&report.evidence.png?.changedPixelRatio>0.0005,imageForwarding:queued===1&&taken.length===1&&!v.outcomeEvidenceImagesByRunId?.has(run.id),base64NotPersisted:!JSON.stringify(run).includes('data:image'),evidenceUi:!!host.querySelector('.obcc-tool-run-evidence button')})})()
'@
    $fail1 = Invoke-CancipEval -TimeoutSeconds 35 -Code @'
(async()=>{const s=window.__cancipOutcomeSmoke,{v,loop,created}=s,run={id:loop+'-fail-1',action:{type:'command',command:'cancip.outcome.verify',args:{}},summary:'verify',status:'executed',createdAt:new Date().toISOString()};const text=String(await v.executeCommandAction('cancip.outcome.verify',{scope:'cancip',rootSelector:'.obcc-outcome-smoke-fixture',loopId:loop+'-fail',attempt:1,maxAttempts:2,expected:{selectors:[{id:'missing-second',selector:'.outcome-target',minCount:2}]}},run));run.result=text;created.push(...(run.evidencePaths||[]));return JSON.stringify({failureVisible:/结果验收：未通过|Outcome verification: failed/i.test(text)&&/attempt=2|attempt 2|轮次/i.test(text),retryBeforeLimit:v.shouldContinueFromToolRuns({runs:[run]})})})()
'@
    $fail2 = Invoke-CancipEval -TimeoutSeconds 35 -Code @'
(async()=>{const s=window.__cancipOutcomeSmoke,{v,loop,created}=s,run={id:loop+'-fail-2',action:{type:'command',command:'cancip.outcome.verify',args:{}},summary:'verify',status:'executed',createdAt:new Date().toISOString()};const text=String(await v.executeCommandAction('cancip.outcome.verify',{scope:'cancip',rootSelector:'.obcc-outcome-smoke-fixture',loopId:loop+'-fail',attempt:2,maxAttempts:2,expected:{selectors:[{id:'missing-second',selector:'.outcome-target',minCount:2}]}},run));run.result=text;created.push(...(run.evidencePaths||[]));return JSON.stringify({stopsAtLimit:!v.shouldContinueFromToolRuns({runs:[run]}),limitVisible:/达到修正次数上限|Correction limit reached/i.test(text),evidenceCount:new Set(created).size})})()
'@
    foreach ($check in @(
      [pscustomobject]@{ name = 'passed'; value = $pass.passed },
      [pscustomobject]@{ name = 'pngValid'; value = $pass.pngValid },
      [pscustomobject]@{ name = 'imageForwarding'; value = $pass.imageForwarding },
      [pscustomobject]@{ name = 'base64NotPersisted'; value = $pass.base64NotPersisted },
      [pscustomobject]@{ name = 'evidenceUi'; value = $pass.evidenceUi },
      [pscustomobject]@{ name = 'failureVisible'; value = $fail1.failureVisible },
      [pscustomobject]@{ name = 'retryBeforeLimit'; value = $fail1.retryBeforeLimit },
      [pscustomobject]@{ name = 'stopsAtLimit'; value = $fail2.stopsAtLimit },
      [pscustomobject]@{ name = 'limitVisible'; value = $fail2.limitVisible }
    )) { if (-not [bool]$check.value) { throw "$($check.name) failed" } }
    if ([int]$fail2.evidenceCount -lt 6) { throw "expected at least 6 unique evidence files, got $($fail2.evidenceCount)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.outcome-verification-evidence'; pass = $true; elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds; evidenceCount = $fail2.evidenceCount }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.outcome-verification-evidence'; pass = $false; error = $_.Exception.Message }
  } finally {
    if ($outcomeSmokeReady) {
      try {
        Invoke-CancipEval -TimeoutSeconds 30 -Code @'
(async()=>{const s=window.__cancipOutcomeSmoke;if(!s)return JSON.stringify({clean:true});s.fixture?.remove();for(const path of [...new Set(s.created||[])])if(await app.vault.adapter.exists(path))await app.vault.adapter.remove(path);const folder=(s.created||[])[0]?.replace(/\/[^/]+$/,'')||'';if(folder){try{const listing=await app.vault.adapter.list(folder);if(!listing.files.length&&!listing.folders.length)await app.vault.adapter.rmdir(folder,false)}catch{}}delete window.__cancipOutcomeSmoke;return JSON.stringify({clean:true})})()
'@ | Out-Null
      } catch {
        Write-Host "Outcome smoke cleanup warning: $($_.Exception.Message)"
      }
    }
  }
}

if (-not $Case -or 'programmatic.vault-state-sync-classifier'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p||typeof p.classifyCancipVaultSyncPath!=='function')throw new Error('missing vault sync classifier');
  const samples={
    config:'.cancip/config.json',
    sessionIndex:'.cancip/sessions/index.json',
    sessionFile:'.cancip/sessions/session-2026-07-05T00-00-00Z.json',
    automationState:'.cancip/automations.json',
    automationLog:'.cancip/automations/2026-07-05.md',
    skill:'AI/Cancip/Skills/Desktop/obsidian/SKILL.md',
    skillIndex:'.cancip/index/skills-index.json',
    memory:'AI/Cancip/Memory/CANCIP_INDEX.md',
    visibleReview:'AI/Cancip/Review/smoke/manifest.json',
    hiddenReview:'.cancip/review-gates/smoke/manifest.json',
    filePins:'.cancip/file-pins.json',
    versions:'.cancip/versions/index.json'
  };
  const result={};
  for(const [key,path] of Object.entries(samples))result[key]=p.classifyCancipVaultSyncPath(path);
  return JSON.stringify({id:'programmatic.vault-state-sync-classifier',elapsedMs:Date.now()-t,result});
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 30
    $expect = @{
      config = 'config'
      sessionIndex = 'sessions'
      sessionFile = 'sessions'
      automationState = 'automations'
      automationLog = 'automations'
      skill = 'skills'
      skillIndex = 'skills'
      memory = 'memory'
      hiddenReview = 'review'
      filePins = 'file-pins'
      versions = 'versions'
    }
    foreach ($key in $expect.Keys) {
      if (-not (@($item.result.$key) -contains $expect[$key])) {
        throw "$key expected $($expect[$key]) got $(@($item.result.$key) -join ',')"
      }
    }
    if (@($item.result.visibleReview) -contains 'review') {
      throw "visible Review JSON must not be classified as machine review state"
    }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; result = $item.result }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.vault-state-sync-classifier'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.native-file-pins'.Contains($Case)) {
  try {
    $started = Get-Date
    $setup = Invoke-CancipEval -TimeoutSeconds 25 -Code @'
(async()=>{const p=app.plugins.plugins.cancip;if(!p||typeof p.setFilePinned!=='function')throw new Error('native file pin API missing');p.stopFilePinSortMode?.(false);const left=app.workspace.leftSplit,leftWasCollapsed=left?.collapsed!==false,emptyLeavesBefore=app.workspace.getLeavesOfType('empty').length;await app.commands.executeCommandById('file-explorer:open');if(left?.collapsed)left.expand();await new Promise(r=>setTimeout(r,320));const rows=()=>Array.from(activeDocument.querySelectorAll('.nav-file-title[data-path],.nav-folder-title[data-path]')).filter(el=>el.getBoundingClientRect().height>0).sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);const parent=path=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';const original=JSON.parse(JSON.stringify(await p.loadFilePinState(true)));window.__cancipPinSmoke={original,leftWasCollapsed,emptyLeavesBefore};const visible=rows().map(el=>el.dataset.path).filter(Boolean);const rootPins=original.folders['']||[];const rootFolder=visible.find(path=>path&&!path.includes('/')&&!rootPins.includes(path)&&app.vault.getAbstractFileByPath(path)?.children);const stack=[app.vault.getRoot()];let mixed=null;while(stack.length&&!mixed){const folder=stack.shift(),children=Array.from(folder.children||[]),folderChildren=children.filter(item=>Array.isArray(item.children)),fileChildren=children.filter(item=>!Array.isArray(item.children));if(folderChildren.length&&fileChildren.length)mixed={parent:folder.path==='/'?'':folder.path,file:fileChildren[0].path,folder:folderChildren[0].path};stack.push(...folderChildren)}const files={};for(const path of visible.filter(path=>!app.vault.getAbstractFileByPath(path)?.children))(files[parent(path)]??=[]).push(path);const selected=Object.entries(files).find(([,paths])=>paths.length>=2);if(!rootFolder||!mixed||!selected)throw new Error('insufficient file explorer or Vault sibling rows');const plan={rootFolder,mixedFile:mixed.file,mixedFolder:mixed.folder,mixedParent:mixed.parent,folder:selected[0],first:selected[1][0],second:selected[1][1]};window.__cancipPinSmoke.plan=plan;return JSON.stringify({id:'programmatic.native-file-pins-setup',plan})})()
'@
    $folderResult = Invoke-CancipEval -TimeoutSeconds 35 -Code @'
(async()=>{const p=app.plugins.plugins.cancip,{rootFolder}=window.__cancipPinSmoke.plan;await p.setFilePinned(rootFolder,true);await new Promise(r=>setTimeout(r,180));const row=Array.from(activeDocument.querySelectorAll('.nav-folder-title[data-path]')).find(el=>el.dataset.path===rootFolder);const pinned=Object.values((await p.loadFilePinState(true)).folders).flat().includes(rootFolder)&&!!row?.querySelector('.obcc-file-pin-indicator');await p.setFilePinned(rootFolder,false);await new Promise(r=>setTimeout(r,180));const unpinned=!Object.values((await p.loadFilePinState(true)).folders).flat().includes(rootFolder)&&!row?.querySelector('.obcc-file-pin-indicator');return JSON.stringify({folderPinSupported:pinned&&unpinned})})()
'@
    $mixedResult = Invoke-CancipEval -TimeoutSeconds 40 -Code @'
(async()=>{const p=app.plugins.plugins.cancip,{mixedFile,mixedFolder,mixedParent}=window.__cancipPinSmoke.plan,view=app.workspace.getLeavesOfType('file-explorer')[0]?.view,folderNode=mixedParent?app.vault.getAbstractFileByPath(mixedParent):app.vault.getRoot();await view?.revealInFolder?.(app.vault.getAbstractFileByPath(mixedFile));await p.setFilePinned(mixedFolder,true);await p.setFilePinned(mixedFile,true);await p.setPinnedFileOrder(mixedParent,[mixedFile,mixedFolder]);await new Promise(r=>setTimeout(r,320));const native=Array.from(view?.getSortedFolderItems?.(folderNode)||[]).map(item=>item.file?.path).filter(Boolean),mixedOrderApplied=native[0]===mixedFile&&native[1]===mixedFolder,noStandalonePanel=!activeDocument.querySelector('.obcc-file-pins-panel,.obcc-file-pin-panel-row,.obcc-file-pin-sort-toolbar');await p.setFilePinned(mixedFile,false);await p.setFilePinned(mixedFolder,false);return JSON.stringify({mixedOrderApplied,noStandalonePanel,native:native.slice(0,4)})})()
'@
    $fileResult = Invoke-CancipEval -TimeoutSeconds 55 -Code @'
(async()=>{
  const p=app.plugins.plugins.cancip,{folder,first,second}=window.__cancipPinSmoke.plan;
  const explorer=app.workspace.getLeavesOfType('file-explorer')[0]?.view;
  const folderNode=folder?app.vault.getAbstractFileByPath(folder):app.vault.getRoot();
  const nativeOrder=()=>Array.from(explorer?.getSortedFolderItems?.(folderNode)||[]).map(item=>item.file?.path).filter(Boolean);
  const waitForOrder=async predicate=>{const deadline=Date.now()+1800;let order=nativeOrder();while(!predicate(order)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,80));order=nativeOrder()}return order};
  const before=nativeOrder();
  await p.setFilePinned(first,true);
  await p.setFilePinned(first,false);
  const unpinnedOrder=await waitForOrder(order=>before.join('|')===order.join('|'));
  const unpinRestoresNative=before.join('|')===unpinnedOrder.join('|');
  await p.setFilePinned(first,true);
  await p.setFilePinned(second,true);
  await p.setPinnedFileOrder(folder,[second,first]);
  const nativePinned=await waitForOrder(order=>order[0]===second&&order[1]===first);
  await p.movePinnedFile(first,-1);
  const up=(await p.loadFilePinState(true)).folders[folder]||[];
  await p.movePinnedFile(first,1);
  const down=(await p.loadFilePinState(true)).folders[folder]||[];
  const state=await p.loadFilePinState(true),pinned=state.folders[folder]||[];
  const normalNative=await waitForOrder(order=>before.filter(path=>!pinned.includes(path)).join('|')===order.filter(path=>!pinned.includes(path)).join('|'));
  const normalOrderPreserved=before.filter(path=>!pinned.includes(path)).join('|')===normalNative.filter(path=>!pinned.includes(path)).join('|');
  await explorer?.revealInFolder?.(app.vault.getAbstractFileByPath(first));
  p.scheduleFilePinsApply(0);
  await new Promise(r=>setTimeout(r,220));
  const row=Array.from(activeDocument.querySelectorAll('.nav-file-title[data-path]')).find(el=>el.dataset.path===first&&el.getBoundingClientRect().height>0),controls=row?.querySelector('.obcc-file-pin-row-controls'),view=app.workspace.getLeavesOfType('cancip-view')[0]?.view,emptyLeavesStable=app.workspace.getLeavesOfType('empty').length===window.__cancipPinSmoke.emptyLeavesBefore;
  return JSON.stringify({folder,stateOrder:pinned.slice(0,6),orderApplied:nativePinned[0]===second&&nativePinned[1]===first,normalOrderPreserved,unpinRestoresNative,indicator:!!controls?.querySelector('.obcc-file-pin-indicator'),rowControls:!!controls?.querySelector('.is-up')&&!!controls?.querySelector('.is-down')&&!!controls?.querySelector('.is-unpin'),moveButtonsRoundTrip:up[0]===first&&up[1]===second&&down[0]===second&&down[1]===first,writeNeedsApproval:!!view?.isWriteLikeAction({type:'command',command:'obsidian.files.pin',args:{path:first}}),emptyLeavesStable,nativePinned:nativePinned.slice(0,6)});
})()
'@
    $migrationResult = Invoke-CancipEval -TimeoutSeconds 45 -Code @'
(async()=>{const p=app.plugins.plugins.cancip,{folder,first}=window.__cancipPinSmoke.plan;const state=await p.loadFilePinState(true),index=(state.folders[folder]||[]).indexOf(first),extension=first.includes('.')?first.slice(first.lastIndexOf('.')):'',prefix=folder?folder+'/':'',renamed=prefix+'__cancip-pin-rename-smoke'+extension;await p.migrateRenamedFilePins(first,renamed);const renameKeepsIndex=((await p.loadFilePinState(true)).folders[folder]||[]).indexOf(renamed)===index;const movedFolder=prefix+'__cancip-pin-move-smoke',moved=movedFolder+'/'+renamed.split('/').pop();await p.migrateRenamedFilePins(renamed,moved);const movedPresent=((await p.loadFilePinState(true)).folders[movedFolder]||[]).includes(moved);await p.removeDeletedFilePins(movedFolder);const deleteClears=!Object.values((await p.loadFilePinState(true)).folders).flat().includes(moved);return JSON.stringify({renameKeepsIndex,movedPresent,deleteClears})})()
'@
    $checks = @{
      folderPinSupported = [bool]$folderResult.folderPinSupported
      mixedOrderApplied = [bool]$mixedResult.mixedOrderApplied
      noStandalonePanel = [bool]$mixedResult.noStandalonePanel
      orderApplied = [bool]$fileResult.orderApplied
      normalOrderPreserved = [bool]$fileResult.normalOrderPreserved
      unpinRestoresNative = [bool]$fileResult.unpinRestoresNative
      indicator = [bool]$fileResult.indicator
      rowControls = [bool]$fileResult.rowControls
      moveButtonsRoundTrip = [bool]$fileResult.moveButtonsRoundTrip
      writeNeedsApproval = [bool]$fileResult.writeNeedsApproval
      emptyLeavesStable = [bool]$fileResult.emptyLeavesStable
      renameKeepsIndex = [bool]$migrationResult.renameKeepsIndex
      movedPresent = [bool]$migrationResult.movedPresent
      deleteClears = [bool]$migrationResult.deleteClears
    }
    foreach ($field in $checks.Keys) {
      if (-not $checks[$field]) { throw "native file pin check failed: $field" }
    }
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.native-file-pins'; pass = $true; elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds; folder = $fileResult.folder; stateOrder = $fileResult.stateOrder }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.native-file-pins'; pass = $false; error = $_.Exception.Message }
  } finally {
    try {
      $null = Invoke-CancipEval -TimeoutSeconds 35 -Code @'
(async()=>{const p=app.plugins.plugins.cancip,snapshot=window.__cancipPinSmoke,original=snapshot?.original;if(original)await p.saveFilePinState(original);await p.loadFilePinState(true);p.stopFilePinSortMode?.(false);p.scheduleFilePinsApply(0);if(snapshot?.leftWasCollapsed&&!app.workspace.leftSplit?.collapsed)app.workspace.leftSplit.collapse();delete window.__cancipPinSmoke;if(typeof p.activateView==='function')await p.activateView();return JSON.stringify({restored:true})})()
'@
    } catch {
      Write-Host "File pin smoke cleanup warning: $($_.Exception.Message)"
    }
  }
}

if (Should-RunProgrammaticCase 'programmatic.personalization-autocomplete') {
  try {
    $started = Get-Date
    Write-Host 'personalization stage: greeting'
    $greeting = Invoke-CancipEval -TimeoutSeconds 15 -Code @'
(()=>{const p=app.plugins.plugins.cancip,v=app.workspace.getLeavesOfType('cancip-view')[0]?.view,oldCache=p.personalizationCache,oldCall=v.callLightweightModel;let calls=0;try{const now=new Date(),hour=now.getHours(),period=hour<5?'night':hour<12?'morning':hour<18?'afternoon':hour<23?'evening':'night',date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');p.personalizationCache={schemaVersion:1,updatedAt:now.toISOString(),timeKey:`${date}:${period}`,greeting:'木拉提，下午好。药品图片已经收到，要先核对用途吗？',diary:'- 整理了今天新增的资料。',autocomplete:['继续优化Cancip并核对结果'],sourcePaths:['收件箱/药品图片.jpg']};v.callLightweightModel=async()=>{calls++;return ''};const text=p.personalizedGreeting(),cache=JSON.stringify(p.personalizationCache);return JSON.stringify({greetingCached:text.includes('药品图片已经收到'),noReady:!text.includes('准备就绪'),greetingNoModelCall:calls===0,cacheCompact:cache.length<2200&&!/base64|data:image/i.test(cache)})}finally{p.personalizationCache=oldCache;v.callLightweightModel=oldCall}})()
'@
    Write-Host 'personalization stage: variants'
    $variants = Invoke-CancipEval -TimeoutSeconds 20 -Code @'
(()=>{const p=app.plugins.plugins.cancip,v=app.workspace.getLeavesOfType('cancip-view')[0]?.view,input=v.inputEl,old={cache:p.personalizationCache,selections:p.personalizationGreetingSelections,lastIndex:p.personalizationLastGreetingIndex,lastKey:p.personalizationLastGreetingTimeKey,messages:v.messages,sessionId:v.sessionId,value:input.value,start:input.selectionStart,end:input.selectionEnd,record:p.recordPersonalizationChoice};try{const now=new Date(),hour=now.getHours(),period=hour<5?'night':hour<12?'morning':hour<18?'afternoon':hour<23?'evening':'night',date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-'),timeKey=`${date}:${period}`,make=(n)=>({text:`木拉提，上午好。具体近况${n}。`,choices:[`处理近况${n}并核对结果`,`打开资料${n}梳理下一步`,`整理事项${n}后验证` ]});p.personalizationCache={schemaVersion:2,updatedAt:now.toISOString(),timeKey,greeting:make(1).text,greetings:[make(1),make(2),make(3),make(4)],friendlyName:'木拉提',weather:{location:'测试市',summary:'晴，20°C',updatedAt:now.toISOString()},diary:'- 测试',autocomplete:['处理近况并核对结果'],sourcePaths:['收件箱/近况.md']};p.personalizationGreetingSelections=new Map();p.personalizationLastGreetingIndex=-1;p.personalizationLastGreetingTimeKey='';const first=p.personalizedGreetingForSession('variant-a'),same=p.personalizedGreetingForSession('variant-a'),second=p.personalizedGreetingForSession('variant-b');p.recordPersonalizationChoice=async()=>{};v.messages=[];v.sessionId='variant-ui';v.renderMessages();const buttons=[...v.messagesEl.querySelectorAll('.obcc-welcome-choice')],buttonText=buttons[0]?.textContent?.trim()||'';buttons[0]?.click();return JSON.stringify({sameSessionStable:first.text===same.text,consecutiveDifferent:first.text!==second.text,multipleChoices:first.choices.length===3,welcomeRendered:buttons.length===3,welcomeButtonFilled:!!buttonText&&input.value===buttonText,usesName:/木拉提/.test(first.text),cacheHasWeather:p.personalizationCache.weather?.summary==='晴，20°C'})}finally{p.personalizationCache=old.cache;p.personalizationGreetingSelections=old.selections;p.personalizationLastGreetingIndex=old.lastIndex;p.personalizationLastGreetingTimeKey=old.lastKey;p.recordPersonalizationChoice=old.record;v.messages=old.messages;v.sessionId=old.sessionId;input.value=old.value;input.setSelectionRange(old.start,old.end);v.renderMessages();v.resizeInput();v.renderAutocompleteSuggestion()}})()
'@
    Write-Host 'personalization stage: local'
    $local = Invoke-CancipEval -TimeoutSeconds 15 -Code @'
(()=>{const p=app.plugins.plugins.cancip,v=app.workspace.getLeavesOfType('cancip-view')[0]?.view,input=v.inputEl,Win=input.ownerDocument.defaultView,old={enabled:p.settings.composerAutocompleteEnabled,value:input.value,start:input.selectionStart,end:input.selectionEnd,local:v.localAutocompleteCandidates,suggestion:v.autocompleteSuggestion,prefix:v.autocompletePrefix};try{p.settings.composerAutocompleteEnabled=true;v.localAutocompleteCandidates=()=>['继续优化Cancip并核对结果'];const before=v.footerEl.getBoundingClientRect().height;input.value='继续优';input.setSelectionRange(3,3);input.dispatchEvent(new Win.Event('input',{bubbles:true}));const suffix=v.autocompleteSuggestion,ghost=v.inputGhostSuffixEl?.textContent||'',after=v.footerEl.getBoundingClientRect().height;input.dispatchEvent(new Win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return JSON.stringify({localGhost:suffix==='化Cancip并核对结果'&&ghost===suffix,tabApplied:input.value==='继续优化Cancip并核对结果'&&input.selectionStart===input.value.length,footerStable:Math.abs(after-before)<1})}finally{v.autocompleteRequestId++;if(v.autocompleteTimer!==null)Win.clearTimeout(v.autocompleteTimer);v.autocompleteTimer=null;p.settings.composerAutocompleteEnabled=old.enabled;v.localAutocompleteCandidates=old.local;input.value=old.value;input.setSelectionRange(old.start,old.end);v.autocompleteSuggestion=old.suggestion;v.autocompletePrefix=old.prefix;v.resizeInput();v.renderAutocompleteSuggestion()}})()
'@
    Write-Host 'personalization stage: async'
    $async = Invoke-CancipEval -TimeoutSeconds 15 -Code @'
(()=>{const p=app.plugins.plugins.cancip,v=app.workspace.getLeavesOfType('cancip-view').map(leaf=>leaf.view).find(view=>view?.inputEl?.isConnected),input=v?.inputEl;if(!p||!v||!input)throw new Error('rendered Cancip view unavailable');const old={enabled:p.settings.composerAutocompleteEnabled,value:input.value,start:input.selectionStart,end:input.selectionEnd,local:v.localAutocompleteCandidates,suggestion:v.autocompleteSuggestion,prefix:v.autocompletePrefix,choices:v.autocompleteChoices,activeRequest:v.activeRequest,activeMenu:v.activeMenu,isComposing:v.autocompleteIsComposing};try{p.settings.composerAutocompleteEnabled=true;v.activeRequest=null;v.activeMenu=null;const source=String(v.generateAutocomplete);const staleSuppressed=source.includes('!==this.autocompleteRequestId');const modelFailureKeepsLocal=/catch\s*\(/.test(source)&&source.includes('localAutocompleteSuffix');const draft=v.normalizeAutocompleteModelDraft(JSON.stringify({suffix:'新补全',choices:[{text:'处理第二段输入并核对结果',steps:['定位目标','执行修改','核对结果']}]}),'第二段输入','');input.value='第二段输入';input.setSelectionRange(input.value.length,input.value.length);v.setAutocompleteDraft(input.value,draft);const staleSuggestion=v.autocompleteSuggestion,modelChoice=v.autocompleteChoices?.[0],choiceVisible=!!v.composerSuggestionsEl?.querySelector('.obcc-composer-suggestion'),workflowSteps=modelChoice?.steps?.length===3;v.localAutocompleteCandidates=()=>['继续优化Cancip'];input.value='继续优';input.setSelectionRange(3,3);v.autocompleteIsComposing=true;const compositionSuppressed=v.autocompleteEligiblePrefix()===null;v.autocompleteIsComposing=false;const compositionRestored=v.localAutocompleteSuffix('继续优')==='化Cancip';v.localAutocompleteCandidates=()=>['失败保留补全'];v.activeMenu='model';v.menuEl?.classList.add('is-hidden');input.value='失败';input.setSelectionRange(2,2);const hiddenMenuAllows=v.autocompleteEligiblePrefix()==='失败';return JSON.stringify({staleSuppressed,compositionSuppressed,compositionRestored,modelFailureKeepsLocal,hiddenMenuAllows,calls:0,suggestion:staleSuggestion,choiceVisible,workflowSteps})}finally{p.settings.composerAutocompleteEnabled=old.enabled;v.localAutocompleteCandidates=old.local;v.activeRequest=old.activeRequest;v.activeMenu=old.activeMenu;v.autocompleteIsComposing=old.isComposing;input.value=old.value;input.setSelectionRange(old.start,old.end);v.autocompleteSuggestion=old.suggestion;v.autocompletePrefix=old.prefix;v.autocompleteChoices=old.choices;v.resizeInput();v.renderAutocompleteSuggestion()}})()
'@
    Write-Host 'personalization stage: longPress'
    $longPress = Invoke-CancipEval -TimeoutSeconds 15 -Code @'
(async()=>{const v=app.workspace.getLeavesOfType('cancip-view')[0]?.view,Win=v.inputEl.ownerDocument.defaultView,wait=ms=>new Promise(r=>setTimeout(r,ms)),button=v.autocompleteApplyButtonEl,PointerCtor=Win.PointerEvent||Win.MouseEvent;try{button.dispatchEvent(new PointerCtor('pointerdown',{bubbles:true,button:0,pointerType:'touch'}));await wait(560);button.dispatchEvent(new PointerCtor('pointerup',{bubbles:true,button:0,pointerType:'touch'}));const popup=v.autocompletePopoverEl,text=popup?.textContent||'',model=popup?.querySelector('.obcc-autocomplete-model-row select'),modelOptions=Array.from(model?.options||[]).map(option=>option.textContent||'');return JSON.stringify({longPressSettings:!!popup&&!!popup.querySelector('input[type="checkbox"]')&&!!popup.querySelector('.obcc-autocomplete-prompt-row input')&&!!model&&modelOptions.some(label=>label.includes('跟随当前模型'))&&modelOptions.some(label=>label.includes(' · '))&&text.includes('换一个补全')})}finally{v.closeAutocompletePopover?.()}})()
'@
    Write-Host 'personalization stage: diary'
    $diary = Invoke-CancipEval -TimeoutSeconds 35 -Code @'
(async()=>{const p=app.plugins.plugins.cancip,v=app.workspace.getLeavesOfType('cancip-view')[0]?.view,old=v.messages;try{v.messages=[{id:'diary-user',role:'user',createdAt:Date.now(),content:'完成 Cancip 日记辅助回归测试'},{id:'diary-run',role:'assistant',createdAt:Date.now(),content:'',toolRuns:[{id:'run',action:{type:'read',path:'测试.md'},summary:'核对测试结果',status:'executed',createdAt:new Date().toISOString(),executedAt:new Date().toISOString(),evidencePaths:['测试.md']}]}];const context=await v.buildTodayDiaryActivityContext();const commandMissing=!app.commands.commands['cancip:insert-personalized-diary'];const buttonMissing=!activeDocument.querySelector('.obcc-personalized-diary-button');const modelRouted=String(Object.getPrototypeOf(v).buildContext).includes('buildTodayDiaryActivityContext');return JSON.stringify({diaryModelContext:commandMissing&&buttonMissing&&modelRouted&&context.includes('完成 Cancip 日记辅助回归测试')&&context.includes('核对测试结果')&&!context.includes('新增或更新：')})}finally{v.messages=old}})()
'@
    Write-Host 'personalization stage: usage'
    $usage = Invoke-CancipEval -TimeoutSeconds 15 -Code @'
(async()=>{const p=app.plugins.plugins.cancip,old={usage:p.personalizationUsage,loaded:p.personalizationUsageLoaded,write:p.writePersonalizationUsage,propose:p.proposePersonalizationPriorityReview};let proposed=0;try{p.personalizationUsage={schemaVersion:1,entries:[],approvedPriorityKeys:[],reviewedPriorityKeys:[]};p.personalizationUsageLoaded=true;p.writePersonalizationUsage=async()=>{};p.proposePersonalizationPriorityReview=async()=>{proposed++};await p.recordPersonalizationChoice('常用动作并核对结果','composer');await p.recordPersonalizationChoice('常用动作并核对结果','composer');await p.recordPersonalizationChoice('常用动作并核对结果','composer');const choices=[{text:'普通动作',steps:[]},{text:'常用动作并核对结果',steps:[]}],before=p.sortComposerSuggestionChoices(choices),key=p.personalizationUsage.entries[0]?.key||'';await p.handlePersonalizationReviewDecision({path:'AI/Cancip/个性化建议/按钮排序.md',old_text:'',new_text:`<!-- cancip-personalization-priority:choice-old -->\n<!-- cancip-personalization-priority:${key} -->`,changes:['write'],links:{},structure:[]},'approved');const after=p.sortComposerSuggestionChoices(choices),latestApproved=p.personalizationUsage.approvedPriorityKeys.includes(key)&&!p.personalizationUsage.approvedPriorityKeys.includes('choice-old');await p.removePersonalizationPriority(key);const undone=p.sortComposerSuggestionChoices(choices);return JSON.stringify({usageCount:p.personalizationUsage.entries[0]?.count===3,reviewProposed:proposed===1,beforeApprovalStable:before[0]?.text==='普通动作',afterApprovalPromoted:after[0]?.text==='常用动作并核对结果',latestApproved,undoRestoresOrder:undone[0]?.text==='普通动作'})}finally{p.personalizationUsage=old.usage;p.personalizationUsageLoaded=old.loaded;p.writePersonalizationUsage=old.write;p.proposePersonalizationPriorityReview=old.propose}})()
'@
    $item = [pscustomobject]@{
      id = 'programmatic.personalization-autocomplete'
      elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds
      localGhost = $local.localGhost
      tabApplied = $local.tabApplied
      footerStable = $local.footerStable
      staleSuppressed = $async.staleSuppressed
      asyncCalls = $async.calls
      asyncSuggestion = $async.suggestion
      compositionSuppressed = $async.compositionSuppressed
      compositionRestored = $async.compositionRestored
      modelFailureKeepsLocal = $async.modelFailureKeepsLocal
      hiddenMenuAllows = $async.hiddenMenuAllows
      longPressSettings = $longPress.longPressSettings
      diaryModelContext = $diary.diaryModelContext
      greetingCached = $greeting.greetingCached
      noReady = $greeting.noReady
      greetingNoModelCall = $greeting.greetingNoModelCall
      cacheCompact = $greeting.cacheCompact
      sameSessionStable = $variants.sameSessionStable
      consecutiveDifferent = $variants.consecutiveDifferent
      multipleChoices = $variants.multipleChoices
      welcomeRendered = $variants.welcomeRendered
      welcomeButtonFilled = $variants.welcomeButtonFilled
      usesName = $variants.usesName
      cacheHasWeather = $variants.cacheHasWeather
      choiceVisible = $async.choiceVisible
      workflowSteps = $async.workflowSteps
      usageCount = $usage.usageCount
      reviewProposed = $usage.reviewProposed
      beforeApprovalStable = $usage.beforeApprovalStable
      afterApprovalPromoted = $usage.afterApprovalPromoted
      latestApproved = $usage.latestApproved
      undoRestoresOrder = $usage.undoRestoresOrder
    }
    foreach ($field in @('localGhost','tabApplied','staleSuppressed','compositionSuppressed','compositionRestored','modelFailureKeepsLocal','hiddenMenuAllows','longPressSettings','diaryModelContext','greetingCached','noReady','greetingNoModelCall','cacheCompact','footerStable','sameSessionStable','consecutiveDifferent','multipleChoices','welcomeRendered','welcomeButtonFilled','usesName','cacheHasWeather','choiceVisible','workflowSteps','usageCount','reviewProposed','beforeApprovalStable','afterApprovalPromoted','latestApproved','undoRestoresOrder')) {
      if (-not [bool]$item.$field) { throw "personalization/autocomplete check failed: $field; $($item | ConvertTo-Json -Compress -Depth 8)" }
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.personalization-autocomplete'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.tool-action-budget'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const view=await p.activateView();
  const originalMessages=view.messages;
  const originalAutomationTaskId=view.activeAutomationTaskId;
  const run=(index,action)=>({
    id:'budget-smoke-'+index,
    action,
    summary:'budget smoke '+index,
    status:'executed',
    createdAt:new Date().toISOString(),
    executedAt:new Date().toISOString(),
    result:'ok'
  });
  const user=content=>({id:crypto.randomUUID(),role:'user',content,createdAt:Date.now()});
  const assistant=toolRuns=>({id:crypto.randomUUID(),role:'assistant',content:'',createdAt:Date.now(),toolRuns});
  try{
    view.activeAutomationTaskId='auto-budget-smoke';
    const history=Array.from({length:24},(_,index)=>run(index,{type:'read',path:`AI/budget-${index}.md`}));
    view.messages=[
      user('执行自动化整理任务'),
      assistant(history),
      user(['继续上一项未完成任务。','原始任务：执行自动化整理任务','中断原因：stopped'].join(String.fromCharCode(10)))
    ];
    const resumedCount=view.currentTaskToolRuns().length;
    const resumedBudgetReached=view.currentTaskActionBudgetReached();
    const overBudget=view.createBudgetedToolRuns([{type:'read',path:'AI/after-budget.md'}]);
    const budgetBlocked=overBudget.length===1&&overBudget[0].status==='blocked'&&/budget reached/i.test(overBudget[0].error||'');

    view.activeAutomationTaskId='';
    const duplicateAction={type:'read',path:'AI/duplicate-budget.md'};
    view.messages=[user('检查重复动作'),assistant([run(100,duplicateAction)])];
    const duplicate=view.createBudgetedToolRuns([duplicateAction]);
    const duplicateBlocked=duplicate.length===1&&duplicate[0].status==='blocked'&&/duplicate action/i.test(duplicate[0].error||'');

    view.messages=[user('检查动作批次限制')];
    const batch=view.createBudgetedToolRuns(Array.from({length:9},(_,index)=>({type:'read',path:`AI/batch-${index}.md`})));
    const batchLimited=batch.filter(item=>item.status==='pending').length===8
      && batch.filter(item=>item.status==='blocked').length===1;
    return JSON.stringify({
      id:'programmatic.tool-action-budget',
      elapsedMs:Date.now()-t,
      resumedCount,
      resumedBudgetReached,
      budgetBlocked,
      duplicateBlocked,
      batchLimited
    });
  } finally {
    view.messages=originalMessages;
    view.activeAutomationTaskId=originalAutomationTaskId;
  }
})()
'@
    $item = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $code) -TimeoutSeconds 20
    foreach ($field in @('resumedBudgetReached','budgetBlocked','duplicateBlocked','batchLimited')) {
      if (-not $item.$field) { throw "tool action budget check failed: $field ($($item | ConvertTo-Json -Compress -Depth 8))" }
    }
    if ([int]$item.resumedCount -ne 24) { throw "resumedCount expected 24 got $($item.resumedCount)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; resumedCount = $item.resumedCount }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.tool-action-budget'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.approval-review-line-delta'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  let v=app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(p&&typeof p.activateView==='function')v=await p.activateView();
  const oldMode=p.settings.accessMode;
  p.settings.accessMode='ask-for-approval';
  try{
    const before=v.messages.length;
    const msg={id:'smoke-pending-'+Date.now(),role:'assistant',content:'',createdAt:Date.now()};
    const answer='```cancip-action\n{"actions":[{"type":"write","path":"AI/Cancip/Review/runtime-pending-test.md","content":"one\\ntwo\\n"}]}\n```';
    const result=await v.handleActionBlocks(answer,msg);
    const pending=!!result?.runs?.some(r=>r.status==='pending');
    const finalAccepted=v.ensureFinalConclusion(result,Date.now(),false,'programmatic smoke');
    const noFinalAdded=v.messages.length===before;
    const reviewItems=await v.reviewItemsForPendingAction({type:'move',path:'AI/Cancip/Memory/PROFILE.md',newPath:'AI/Cancip/Memory/PROFILE-test-move.md'});
    const structure=reviewItems[0]?.structure?.[0]||null;
    const run=v.createToolRun({type:'write',path:'Cancip验收-临时/delta-preview-'+Date.now()+'.md',content:['a','b',''].join('\n')});
    await v.refreshToolRunLineDeltasFromAction(run);
    const lineDelta=run.lineDeltas?.[0]||null;
    return JSON.stringify({id:'programmatic.approval-review-line-delta',elapsedMs:Date.now()-t,pending,finalAccepted,noFinalAdded,structureKind:structure?.kind||'',lineDelta});
  } finally {
    p.settings.accessMode=oldMode;
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.pending) { throw "write action did not stay pending in approval mode: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if (-not $item.finalAccepted) { throw 'ensureFinalConclusion compatibility wrapper did not return true' }
    if (-not $item.noFinalAdded) { throw 'pending action generated a final summary before approval' }
    if ($item.structureKind -ne 'move') { throw "review structure kind expected move got $($item.structureKind)" }
    if (-not $item.lineDelta -or [int]$item.lineDelta.added -lt 2) { throw "line delta missing or too small: $($item.lineDelta | ConvertTo-Json -Compress)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; lineDelta = $item.lineDelta }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.approval-review-line-delta'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.approval-run-continues-final'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldMode=p.settings.accessMode;
  const oldAuto=p.settings.autoContinueAfterTools;
  const oldMessages=JSON.parse(JSON.stringify(v.messages||[]));
  const oldContinue=v.continueAfterToolRuns;
  const oldRequestFinal=v.requestModelFinalAfterToolRuns;
  const oldStatus=v.currentSessionStatus||null;
  const path='Cancip验收-临时/approval-continue-smoke.md';
  p.settings.accessMode='ask-for-approval';
  p.settings.autoContinueAfterTools=true;
  try{
    await app.vault.adapter.mkdir('Cancip验收-临时').catch(()=>{});
    v.messages=[
      {id:'smoke-user-approval-continue',role:'user',content:'approval continue smoke write',createdAt:Date.now()-1000}
    ];
    const msg={id:'smoke-assistant-approval-continue',role:'assistant',content:'',createdAt:Date.now()};
    v.messages.push(msg);
    const answer='```cancip-action\n{"actions":[{"type":"write","path":"'+path+'","content":"approval continue ok"}]}\n```';
    const pending=await v.handleActionBlocks(answer,msg);
    if(!pending?.runs?.[0])throw new Error('missing pending run');
    v.continueAfterToolRuns=async(_context,previous)=>previous;
    v.requestModelFinalAfterToolRuns=async()=>{
      v.addMessage('assistant','approval continued final smoke');
      return 'answered';
    };
    await v.runPendingToolRun(msg.id,msg.toolRuns[0].id);
    const finalVisible=(v.messages||[]).some((m)=>String(m.content||'').includes('approval continued final smoke'));
    const run=msg.toolRuns[0]||null;
    const status=run?.status||'';
    const sessionStatus=v.currentSessionStatus||null;
    return JSON.stringify({id:'programmatic.approval-run-continues-final',elapsedMs:Date.now()-t,finalVisible,status,sessionStatus});
  } finally {
    v.continueAfterToolRuns=oldContinue;
    v.requestModelFinalAfterToolRuns=oldRequestFinal;
    p.settings.accessMode=oldMode;
    p.settings.autoContinueAfterTools=oldAuto;
    await app.vault.adapter.remove(path).catch(()=>{});
    v.messages=oldMessages;
    if(oldStatus)v.currentSessionStatus=oldStatus;
    if(typeof v.renderMessages==='function')v.renderMessages();
    if(typeof v.saveCurrentSession==='function')await v.saveCurrentSession().catch(()=>{});
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 60
    if (-not $item.finalVisible) { throw 'approval run did not continue to a visible final answer' }
    if ($item.status -ne 'executed') { throw "approved run status expected executed got $($item.status)" }
    if ($item.sessionStatus -and $item.sessionStatus.status -eq 'running') { throw 'session was left running after approval continuation' }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; status = $item.status }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.approval-run-continues-final'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.config-read-routing'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const leaves=app.workspace.getLeavesOfType('cancip-view');
  const v=p&&typeof p.activateView==='function'?p.activateView():(leaves&&leaves[0]?leaves[0].view:null);
  return Promise.resolve(v).then((view)=>{
    if(!view)throw new Error('Cancip view unavailable');
    const prompt='\u8bfb\u53d6 Cancip \u914d\u7f6e\uff0c\u544a\u8bc9\u6211\u5f53\u524d\u8bbf\u95ee\u6a21\u5f0f\u548c\u6a21\u578b\u540d\u79f0\uff0c\u4e0d\u8981\u4fee\u6539';
    const actions=view.programmaticReadOnlyActionsForPrompt(prompt);
    const policy=view.promptPayloadPolicy(prompt);
    const run={
      id:'smoke-config-read',
      action:{type:'read',path:'.cancip/config.json',maxChars:9000},
      summary:'read .cancip/config.json',
      status:'executed',
      createdAt:new Date().toISOString(),
      result:'read .cancip/config.json\n{"accessMode":"full-access","activeApiProfileId":"default","apiProfiles":[{"id":"default","name":"tokenfree","apiMode":"auto","model":"gpt-5.5","apiUrl":"https://api.example/v1"}],"model":"fallback-model"}'
    };
    const fallback=view.informationalFallbackFromToolRuns([run],prompt,'empty model reply');
    return JSON.stringify({id:'programmatic.config-read-routing',elapsedMs:Date.now()-t,actions,policy,fallback});
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    $actions = @($item.actions)
    $action0 = if ($actions.Count) { $actions[0] } else { $null }
    $fallbackText = [string]$item.fallback
    if ([int]$actions.Count -ne 1) { throw "expected one direct read action got $($actions.Count)" }
    if ($action0.type -ne 'read' -or $action0.path -ne '.cancip/config.json') { throw "expected config read action got $($action0 | ConvertTo-Json -Compress)" }
    if ($fallbackText -notmatch 'full-access') { throw "fallback missing access mode: $fallbackText" }
    if ($fallbackText -notmatch 'gpt-5\.5') { throw "fallback missing model: $fallbackText" }
    if ($fallbackText -match '\.cancip/config\.json') { throw "fallback leaked read-only config path: $fallbackText" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.config-read-routing'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.plugin-manifest-read-routing'.Contains($Case)) {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const leaves=app.workspace.getLeavesOfType('cancip-view');
  const v=p&&typeof p.activateView==='function'?p.activateView():(leaves&&leaves[0]?leaves[0].view:null);
  return Promise.resolve(v).then((view)=>{
    if(!view)throw new Error('Cancip view unavailable');
    const prompts=[
      'check Cancip installed plugin manifest version number',
      '\u68c0\u67e5 Cancip \u5df2\u5b89\u88c5\u63d2\u4ef6 manifest \u7248\u672c\u53f7\u662f\u591a\u5c11'
    ];
    const checks=prompts.map((prompt)=>{
      const actions=view.programmaticReadOnlyActionsForPrompt(prompt);
      return {prompt,actions};
    });
    const run={
      id:'smoke-plugin-manifest',
      action:{type:'read',path:'.obsidian/plugins/cancip/manifest.json',maxChars:3000},
      summary:'read .obsidian/plugins/cancip/manifest.json',
      status:'executed',
      createdAt:new Date().toISOString(),
      result:'read .obsidian/plugins/cancip/manifest.json\n{"id":"cancip","name":"Cancip","version":"0.1.298","minAppVersion":"1.5.0","author":"arias007"}'
    };
    const fallback=view.informationalFallbackFromToolRuns([run],prompts[1],'empty model reply');
    return JSON.stringify({id:'programmatic.plugin-manifest-read-routing',elapsedMs:Date.now()-t,checks,fallback});
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    $checks = @($item.checks)
    foreach ($check in $checks) {
      $actions = @($check.actions)
      $action0 = if ($actions.Count) { $actions[0] } else { $null }
      if ([int]$actions.Count -ne 1) { throw "expected one manifest read action for prompt [$($check.prompt)] got $($actions.Count)" }
      if ($action0.type -ne 'read' -or $action0.path -ne '.obsidian/plugins/cancip/manifest.json') { throw "expected Cancip manifest read for prompt [$($check.prompt)] got $($action0 | ConvertTo-Json -Compress)" }
    }
    $fallbackText = [string]$item.fallback
    if ($fallbackText -notmatch '0\.1\.298') { throw "fallback missing manifest version: $fallbackText" }
    if ($fallbackText -match '\.obsidian/plugins/cancip/manifest\.json') { throw "fallback leaked read-only manifest path: $fallbackText" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.plugin-manifest-read-routing'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.progress-step-compact-no-prompt-leak'.Contains($Case)) {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const leaves=app.workspace.getLeavesOfType('cancip-view');
  const v=leaves&&leaves[0]?leaves[0].view:null;
  if(!p||!v)throw new Error('Cancip view unavailable');
  const oldMessages=(v.messages||[]).slice();
  try{
    const msg=v.addProgressStep(v.t('preparingContext'));
    const liveContent=String(msg.content||'');
    const liveOpen=!!(v.progressStepTimers&&typeof v.progressStepTimers.has==='function'&&v.progressStepTimers.has(msg.id));
    v.updateProgressStep(msg,v.t('preparingContext'),v.formatContextAuditDetail('progress smoke','progress smoke','progress smoke',{system:'system',contextText:'ctx',searchHits:[],images:[]}));
    const finalContent=String(msg.content||'');
    if(typeof v.stopProgressStepTimer==='function')v.stopProgressStepTimer(msg.id);
    const legacyContent=[
      '<!-- cancip-progress-step -->',
      '<!-- cancip-process-message -->',
      '\u5df2\u6267\u884c \u00b7 \u6b63\u5728\u51c6\u5907\u4e0a\u4e0b\u6587... \u00b7 \u8017\u65f6 150ms',
      '\u6b63\u5728\u51c6\u5907\u672c\u8f6e\u6700\u5c0f\u5fc5\u8981\u4e0a\u4e0b\u6587\uff1a\u539f\u59cb\u95ee\u9898\u3001\u4efb\u52a1\u76ee\u6807\u3001\u5fc5\u8981\u8bb0\u5fc6/\u8ba1\u5212\u548c\u4e0a\u4e00\u6b65\u7ed3\u679c\u3002'
    ].join('\n');
    v.messages=[{id:'smoke-legacy-progress',role:'assistant',content:legacyContent,createdAt:Date.now()}];
    if(typeof v.renderMessages==='function')v.renderMessages();
    const rendered=String(v.messagesEl?.textContent||'');
      return JSON.stringify({
        id:'programmatic.progress-step-compact-no-prompt-leak',
        elapsedMs:Date.now()-t,
        liveHasCompactStatus:/\u6b63\u5728\u51c6\u5907\u4e0a\u4e0b\u6587|Preparing context/i.test(liveContent),
        liveLeaksPromptishNote:/\u6700\u5c0f\u5fc5\u8981|smallest useful|System prompt sent|User input sent|Raw model reply|Model prompt for this turn|\u76ee\u7684[：:]|\u505a\u6cd5[：:]|Goal:|Method:/i.test(liveContent),
        liveOpen,
        finalHasDetail:/```text[\s\S]+```/.test(finalContent),
        finalLeaksPrompt:/\u6700\u5c0f\u5fc5\u8981|smallest useful|System prompt sent|User input sent|Raw model reply|Model prompt for this turn|User prompt|Resolved task goal/i.test(finalContent),
        legacyRenderedLeaks:/\u6700\u5c0f\u5fc5\u8981|smallest useful|System prompt sent|User input sent|Raw model reply/i.test(rendered)
      });
  } finally {
    v.messages=oldMessages;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.liveHasCompactStatus) { throw 'live progress missing compact status line' }
    if ($item.liveLeaksPromptishNote) { throw 'live progress still leaks prompt-like note' }
    if (-not $item.liveOpen) { throw 'live progress timer not active' }
    if (-not $item.finalHasDetail) { throw 'final progress missing visible detail' }
    if ($item.finalLeaksPrompt) { throw 'final progress detail still leaks prompt text' }
    if ($item.legacyRenderedLeaks) { throw 'legacy progress render still leaks prompt-like note' }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.progress-step-compact-no-prompt-leak'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.render-scheduler-coalesces'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  if(typeof v.scheduleRenderMessages!=='function')throw new Error('scheduleRenderMessages missing');
  const original=v.renderMessages;
  let renders=0;
  try{
    v.renderMessages=function(){renders++; return original.apply(this,arguments);};
    for(let i=0;i<24;i++)v.scheduleRenderMessages();
    await new Promise((resolve)=>setTimeout(resolve,420));
    return JSON.stringify({id:'programmatic.render-scheduler-coalesces',elapsedMs:Date.now()-t,renders,hasFrameField:'messageRenderFrame' in v});
  } finally {
    v.renderMessages=original;
    if(typeof v.cancelScheduledMessageRender==='function')v.cancelScheduledMessageRender();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.renders -lt 1) { throw "scheduled render never flushed: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.renders -gt 4) { throw "scheduled render did not coalesce enough: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.hasFrameField) { throw 'render scheduler runtime field missing' }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; renders = $item.renders }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.render-scheduler-coalesces'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.session-history-cache-dedupes'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  if(typeof v.readSessionHistoryIndex!=='function'||typeof v.readSessionHistoryIndexUncached!=='function')throw new Error('history cache methods unavailable');
  const original=v.readSessionHistoryIndexUncached;
  let uncachedCalls=0;
  try{
    v.sessionHistoryCache=null;
    v.sessionHistoryReadPromise=null;
    v.readSessionHistoryIndexUncached=function(){uncachedCalls++; return original.apply(this,arguments);};
    await Promise.all([v.readSessionHistoryIndex(),v.readSessionHistoryIndex(),v.readSessionHistoryIndex()]);
    const afterConcurrent=uncachedCalls;
    await v.readSessionHistoryIndex();
    return JSON.stringify({id:'programmatic.session-history-cache-dedupes',elapsedMs:Date.now()-t,afterConcurrent,afterCached:uncachedCalls,cache:!!v.sessionHistoryCache});
  } finally {
    v.readSessionHistoryIndexUncached=original;
    v.sessionHistoryReadPromise=null;
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.afterConcurrent -ne 1) { throw "concurrent history reads were not deduped: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.afterCached -ne 1 -or -not $item.cache) { throw "cached history read missed cache: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.session-history-cache-dedupes'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.tool-run-estimated-line-delta'.Contains($Case)) {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=app.workspace.getLeavesOfType('cancip-view')[0]?.view;
  if(!p||!v)throw new Error('Cancip view unavailable');
  const run=v.createToolRun({type:'patch',path:'Notes/Delta-Smoke.md',find:'old\nline',replace:'new\nline\nplus'});
  const delta=(run.lineDeltas||[])[0]||null;
  const summary=v.changedFileSummaryForRun(run,'Notes/Delta-Smoke.md');
  return JSON.stringify({id:'programmatic.tool-run-estimated-line-delta',elapsedMs:Date.now()-t,delta,summary});
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.delta) { throw 'tool run missing immediate line delta' }
    if ([int]$item.delta.added -lt 3 -or [int]$item.delta.removed -lt 2) { throw "unexpected line delta: $($item | ConvertTo-Json -Compress)" }
    if (-not ([string]$item.summary).Contains('+') -or -not ([string]$item.summary).Contains('-')) { throw "changed file summary missing delta label: $($item.summary)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; summary = $item.summary }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.tool-run-estimated-line-delta'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.automation-vault-curation-template'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!p||!v)throw new Error('Cancip plugin/view unavailable');
  if(typeof p.automationApiProfile!=='function'||typeof p.automationModelPromptForTask!=='function')throw new Error('missing automation helpers');
  const baseProfile=p.automationApiProfile({apiProfileId:'',model:''});
  const explicitProfile=p.automationApiProfile({apiProfileId:'',model:'cancip-smoke-explicit-model'});
  const promptInfo=p.automationModelPromptForTask({prompt:'curate new files; old files require explicit scope'});
  const templatesText=String(await v.executeCommandAction('cancip.automation.templates',{}));
  const settings=p.settings||{};
  return JSON.stringify({
    id:'programmatic.automation-vault-curation-template',
    elapsedMs:Date.now()-t,
    baseModel:baseProfile&&baseProfile.model,
    explicitModel:explicitProfile&&explicitProfile.model,
    prompt:promptInfo&&promptInfo.prompt,
    hasRouteKinds:Boolean(promptInfo&&Object.prototype.hasOwnProperty.call(promptInfo,'routeKinds')),
    hasCuration:/auto-vault-curation/.test(templatesText),
    hasNewOnly:/newly created Markdown files once|新建 Markdown 文件执行一次/.test(templatesText),
    hasOldSkill:/specified-scope curation Skill|指定范围整理 Skill/.test(templatesText),
    hasCurationActions:/(beautif|refactor|美化|重构)/.test(templatesText)&&/(properties|tags|summaries|links|属性|标签|摘要|链接)/.test(templatesText)&&/(renam|重命名)/.test(templatesText),
    hasBenefitGate:/(benefit gate|收益门)/i.test(templatesText)&&/(frequently referenced notes|高频引用笔记)/i.test(templatesText)&&/(protected|受保护)/i.test(templatesText),
    hasDeprecated:/auto-vault-content-beautify|auto-vault-auto-tags|auto-vault-file-summaries/.test(templatesText),
    hasMechanicalSettings:['specialistRoutingEnabled','mechanicalTaskApiProfileId','mechanicalTaskModel','mechanicalTaskRoutes'].some((key)=>Object.prototype.hasOwnProperty.call(settings,key))
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.hasCuration) { throw "unified vault curation template is missing: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.hasNewOnly -or -not $item.hasOldSkill -or -not $item.hasCurationActions -or -not $item.hasBenefitGate) { throw "vault curation template is missing new-file benefit gate, automation, or old-file Skill route: $($item | ConvertTo-Json -Compress)" }
    if ($item.hasDeprecated) { throw "deprecated split vault automation templates are still listed: $($item | ConvertTo-Json -Compress)" }
    if ($item.hasMechanicalSettings) { throw "mechanical/specialist settings are still exposed: $($item | ConvertTo-Json -Compress)" }
    if ($item.hasRouteKinds) { throw "automation prompt helper still exposes routeKinds: $($item | ConvertTo-Json -Compress)" }
    if ($item.explicitModel -ne 'cancip-smoke-explicit-model') { throw "explicit automation model was not honored: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; explicitModel = $item.explicitModel }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.automation-vault-curation-template'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.automation-vault-curation-scan-pack'.Contains($Case)) {
  try {
    $code = @'
(async function(){
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=app.workspace.getLeavesOfType('cancip-view')[0]?.view;
  if(!p||!v||typeof v.buildVaultCurationSourcePack!=='function')throw new Error('curation scan pack unavailable');
  const files=app.vault.getMarkdownFiles().slice(0,2);
  if(files.length<2)throw new Error('not enough Markdown files for synthetic scan');
  const oldRefresh=v.refreshVaultCurationNewFileState;
  const oldItems=v.vaultCurationCandidateItems;
  const oldRun=v.runAutomationPrompt;
  let modelCalls=0;
  v.refreshVaultCurationNewFileState=async()=>({initialized:false,pending:files});
  v.vaultCurationCandidateItems=async(items,reason)=>items.map((file,index)=>{
    const decision=index===0
      ?{action:'curate',reasons:['objective Markdown syntax defect'],protections:[],allowedActions:['format']}
      :{action:'protected',reasons:['change risk'],protections:['template-like path'],allowedActions:[]};
    return {path:file.path,ctime:file.stat.ctime,mtime:file.stat.mtime,size:file.stat.size,reason,curationReasons:decision.reasons,decision,title:file.basename,tags:[],outLinks:0,backlinks:0,composition:{characters:20,lines:2,headings:1,listItems:0,tasks:0,tables:0,codeBlocks:0,quotes:0,embeds:0},linkRelations:[],content:index===0?'#Broken\nText':undefined};
  });
  v.runAutomationPrompt=async()=>{modelCalls+=1;return 'unexpected';};
  const beforeSession=v.sessionId;
  const beforeMessages=(v.messages||[]).length;
  let pack='';
  try{
    pack=String(await v.buildVaultCurationSourcePack({args:{limit:3}}));
  } finally {
    v.refreshVaultCurationNewFileState=oldRefresh;
    v.vaultCurationCandidateItems=oldItems;
    v.runAutomationPrompt=oldRun;
  }
  const paths=JSON.parse(pack.match(/^- candidatePathsJson:\s*(\[[^\r\n]*\])/m)?.[1]||'[]');
  const scanned=JSON.parse(pack.match(/^- scannedPathsJson:\s*(\[[^\r\n]*\])/m)?.[1]||'[]');
  return JSON.stringify({id:'programmatic.automation-vault-curation-scan-pack',elapsedMs:Date.now()-t,length:pack.length,silent:modelCalls===0&&v.sessionId===beforeSession&&(v.messages||[]).length===beforeMessages,contract:pack.includes('newness only triggers one scan')&&pack.includes('allowedActions=format')&&/^- protectedThisBatch:\s*1$/m.test(pack),paths:paths.length===1&&paths[0]===files[0].path,scanned:files.every(file=>scanned.includes(file.path)),skill:pack.includes('.cancip/skills/vault-curation-specified-scope.skill.md')});
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    foreach ($field in @('silent','contract','paths','scanned','skill')) {
      if (-not $item.$field) { throw "curation scan-pack check failed: $field ($($item | ConvertTo-Json -Compress))" }
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; length = $item.length }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.automation-vault-curation-scan-pack'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.automation-vault-curation-benefit-gate'.Contains($Case)) {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=app.workspace.getLeavesOfType('cancip-view')[0]?.view;
  if(!p||!v||typeof v.vaultCurationDecision!=='function')throw new Error('curation benefit gate unavailable');
  const d=(path,content,reasons,backlinks=0,frontmatter={})=>v.vaultCurationDecision({path,content,curationReasons:reasons,backlinks,vaultFileCount:500,frontmatter});
  const clean=d('Notes/Clean.md','# Clean\n\nConcise.',[]);
  const inbox=d('Inbox/Clear.md','# Clear\n\nUseful.',['temporary or inbox location needs classification']);
  const format=d('Notes/Broken.md','#Broken',['objective Markdown syntax defect']);
  const rename=d('Notes/Untitled.md','# Useful',['vague or machine-generated filename']);
  const link=d('Notes/Related.md','# Useful',['objective Markdown syntax defect','explicitly mentioned related note lacks a link']);
  const pathTemplate=d('Templates/Daily.md','#Broken',['objective Markdown syntax defect']);
  const syntaxTemplate=d('Notes/Seed.md','{{date}}',['objective Markdown syntax defect']);
  const frequent=d('Notes/Index.md','#Broken',['objective Markdown syntax defect'],8);
  const plugin=d('Notes/Dashboard.md','```dataview\nTABLE file.name\n```',['objective Markdown syntax defect']);
  const generated=d('Notes/Generated.md','#Broken',['objective Markdown syntax defect'],0,{generated_by:'reporter'});
  return JSON.stringify({id:'programmatic.automation-vault-curation-benefit-gate',elapsedMs:Date.now()-t,clean:clean.action==='skip'&&clean.allowedActions.length===0,inbox:inbox.action==='skip'&&inbox.allowedActions.length===0,format:format.action==='curate'&&format.allowedActions.join(',')==='format',rename:rename.action==='curate'&&rename.allowedActions.join(',')==='rename',link:link.action==='curate'&&link.allowedActions.includes('format')&&link.allowedActions.includes('links'),templates:pathTemplate.action==='protected'&&syntaxTemplate.action==='protected',frequent:frequent.action==='protected'&&frequent.protections.some(x=>x.includes('frequently referenced')),plugin:plugin.action==='protected',generated:generated.action==='protected'});
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 20
    foreach ($field in @('clean','inbox','format','rename','link','templates','frequent','plugin','generated')) {
      if (-not $item.$field) { throw "curation benefit gate variant failed: $field ($($item | ConvertTo-Json -Compress))" }
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.automation-vault-curation-benefit-gate'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.automation-background-focus-neutral'.Contains($Case)) {
  try {
    $code = @'
(async function(){
  var t=Date.now();
  var p=app.plugins.plugins.cancip;
  if(!p||typeof p.getAutomationRunnerView!=='function')throw new Error('background automation runner unavailable');
  var before=app.workspace.getLeaf(false);
  var runner=await p.getAutomationRunnerView();
  var afterCreate=app.workspace.getLeaf(false);
  if(!runner)throw new Error('background automation runner view unavailable');
  var original={
    load:p.loadAutomations,
    begin:p.beginAiVaultMutationCapture,
    write:p.writeAutomationLog,
    mark:p.markAutomationRun,
    prepare:runner.prepareAutomationSession,
    run:runner.runAutomationPrompt
  };
  var result;
  try{
    p.loadAutomations=async function(){return [{
      id:'smoke-background-focus-neutral',
      title:'smoke background',
      prompt:'smoke',
      schedule:'manual',
      enabled:true,
      intervalMinutes:60,
      hour:0,
      minute:0,
      sessionMode:'new',
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    }];};
    p.beginAiVaultMutationCapture=function(){return null;};
    p.writeAutomationLog=async function(){return '';};
    p.markAutomationRun=async function(){};
    runner.prepareAutomationSession=async function(){};
    runner.runAutomationPrompt=async function(){return 'background smoke complete';};
    result=await p.runAutomationById('smoke-background-focus-neutral',{trigger:'scheduled'});
  }finally{
    p.loadAutomations=original.load;
    p.beginAiVaultMutationCapture=original.begin;
    p.writeAutomationLog=original.write;
    p.markAutomationRun=original.mark;
    runner.prepareAutomationSession=original.prepare;
    runner.runAutomationPrompt=original.run;
  }
  var backgroundBeforeCleanup=app.workspace.getLeavesOfType('cancip-automation-runner-view').length;
  var released=p.releaseAutomationRunnerIfIdle();
  await new Promise(function(resolve){setTimeout(resolve,0);});
  var afterRun=app.workspace.getLeaf(false);
  return JSON.stringify({
    id:'programmatic.automation-background-focus-neutral',
    elapsedMs:Date.now()-t,
    focusStayed:before===afterCreate&&before===afterRun,
    runnerType:runner.getViewType(),
    visibleChatLeaves:app.workspace.getLeavesOfType('cancip-view').length,
    backgroundBeforeCleanup:backgroundBeforeCleanup,
    backgroundAfterCleanup:app.workspace.getLeavesOfType('cancip-automation-runner-view').length,
    released:released,
    result:String(result&&result.text||'')
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 30
    if (-not $item.focusStayed) { throw "automation runner changed the active leaf: $($item | ConvertTo-Json -Compress)" }
    if ($item.runnerType -ne 'cancip-automation-runner-view' -or $item.backgroundBeforeCleanup -ne 1) { throw "automation runner view isolation failed: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.released -or $item.backgroundAfterCleanup -ne 0) { throw "automation runner cleanup failed: $($item | ConvertTo-Json -Compress)" }
    if ($item.result -ne 'background smoke complete') { throw "background automation result failed: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; runnerType = $item.runnerType }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.automation-background-focus-neutral'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.vault-overview-memory'.Contains($Case)) {
  try {
    $code = @'
(async function(){
  var t=Date.now();
  var p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  if(typeof p.ensureVaultOverviewMemory!=='function')throw new Error('missing vault overview memory initializer');
  if(typeof p.buildVaultOverviewMemory!=='function')throw new Error('missing vault overview memory builder');
  await p.ensureVaultOverviewMemory();
  var path='AI/Cancip/Memory/VAULT_OVERVIEW.md';
  var exists=await app.vault.adapter.exists(path);
  var raw=exists?String(await app.vault.adapter.read(path)):'';
  var generated=String(await p.buildVaultOverviewMemory());
  var indexPath='AI/Cancip/Memory/CANCIP_INDEX.md';
  var index=(await app.vault.adapter.exists(indexPath))?String(await app.vault.adapter.read(indexPath)):'';
  return JSON.stringify({
    id:'programmatic.vault-overview-memory',
    elapsedMs:Date.now()-t,
    exists:exists,
    hasMarker:raw.indexOf('cancip-programmatic-vault-overview')>=0||raw.indexOf('# Vault Overview')>=0,
    generatedHasFolders:generated.indexOf('Top-level folders')>=0,
    generatedHasPlugins:generated.indexOf('Installed Obsidian plugins')>=0,
    indexHasOverview:index.indexOf('VAULT_OVERVIEW')>=0
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 60
    if (-not $item.exists -or -not $item.hasMarker) { throw "vault overview memory was not generated: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.generatedHasFolders -or -not $item.generatedHasPlugins -or -not $item.indexHasOverview) { throw "vault overview memory missing required sections/index: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.vault-overview-memory'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.skill-index-and-experience-commands'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  if(typeof v.harvestExperienceSkills!=='function')throw new Error('missing experience harvest command handler');
  const skills=await v.discoverSkills(true);
  const idCounts={};
  for(const skill of skills){
    const key=String(skill.id||'').toLowerCase();
    idCounts[key]=(idCounts[key]||0)+1;
  }
  const dupIds=Object.keys(idCounts).filter((key)=>idCounts[key]>1);
  const listText=String(await v.executeCommandAction('cancip.skills.list',{refresh:true}));
  const expText=String(await v.executeCommandAction('cancip.experience.list',{query:'smoke'}));
  return JSON.stringify({
    id:'programmatic.skill-index-and-experience-commands',
    elapsedMs:Date.now()-t,
    count:skills.length,
    duplicateIds:dupIds,
    hasObsidian:/Obsidian/i.test(listText),
    hasExperienceResult:/cancip\.experience\.list|无|None|none/i.test(expText)
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 75
    if ([int]$item.count -lt 10) { throw "too few skills discovered: $($item.count)" }
    if (@($item.duplicateIds).Count -gt 0) { throw "duplicate skill ids survived dedupe: $(@($item.duplicateIds) -join ', ')" }
    if (-not $item.hasObsidian) { throw 'skills list did not include Obsidian-related skills' }
    if (-not $item.hasExperienceResult) { throw 'experience list command did not return a recognizable result' }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; count = $item.count }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.skill-index-and-experience-commands'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.model-retry-progress-visible'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldCall=v.callModel;
  const oldMessages=(v.messages||[]).slice();
  let calls=0;
  try{
    v.messages=[];
    v.primeModelCharStats('retry prompt',{system:'system',contextText:'context'},'retry prompt');
    const step=v.addProgressStep(v.modelCharProgressSummary(v.t('generating')));
    v.callModel=async()=>{calls++; if(calls===1)return ''; if(calls===2)throw new Error('synthetic retry failure'); return 'retry success';};
    const answer=await v.callModelWithRetries('retry prompt',{system:'system',contextText:'context'},'retry prompt','retry timeout',2000,v.modelRetryProgressUpdater(step,v.t('generating')));
    const content=String(step.content||'');
    if(typeof v.stopProgressStepTimer==='function')v.stopProgressStepTimer(step.id);
    return JSON.stringify({id:'programmatic.model-retry-progress-visible',elapsedMs:Date.now()-t,calls,answer,content});
  } finally {
    v.callModel=oldCall;
    v.messages=oldMessages;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.calls -ne 3) { throw "retry call count expected 3 got $($item.calls)" }
    if ($item.answer -ne 'retry success') { throw "retry answer mismatch: $($item.answer)" }
    if (-not ([string]$item.content).Contains('2/5') -and -not ([string]$item.content).Contains('3/5')) { throw "retry progress did not show attempts: $($item.content)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; calls = $item.calls }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.model-retry-progress-visible'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.model-retry-backoff-pacing'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  if(typeof v.modelRetryDelayMs!=='function')throw new Error('modelRetryDelayMs unavailable');
  const rate=v.modelRetryDelayMs(1,'HTTP 429 retry-after=2 rate limit');
  const service=v.modelRetryDelayMs(1,'HTTP 503 overloaded');
  const generic=v.modelRetryDelayMs(1,'synthetic retry failure');
  return JSON.stringify({id:'programmatic.model-retry-backoff-pacing',elapsedMs:Date.now()-t,rate,service,generic});
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.rate -lt 18000) { throw "rate-limit retry delay too short: $($item.rate)" }
    if ([int]$item.service -lt 9000) { throw "service retry delay too short: $($item.service)" }
    if ([int]$item.generic -lt 4000) { throw "generic retry delay too short: $($item.generic)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; rate = $item.rate; service = $item.service; generic = $item.generic }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.model-retry-backoff-pacing'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.final-answer-keeps-numbered-sections'.Contains($Case)) {
  try {
    $finalNumberedContent = @'
Completed rename: `Smoke-old.md` -> `Smoke-new.md`.

1. Actions
Renamed one vault file.

2. Files
- Old: `Smoke-old.md`
- New: `Smoke-new.md`

3. Verification
The rename result was successful.

<!-- cancip-choices {"choices":["Open review panel","Verify changed file","Test another rename"]} -->
'@
    $finalNumberedBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($finalNumberedContent))
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldMessages=(v.messages||[]).slice();
  const oldActive=v.activeRequest;
  try{
    v.activeRequest=null;
    v.userInteractingWithMessages=false;
    v.pendingMessageRender=false;
    if(v.messageInteractionIdleTimer!==null){clearTimeout(v.messageInteractionIdleTimer);v.messageInteractionIdleTimer=null;}
    if(typeof v.cancelScheduledMessageRender==='function')v.cancelScheduledMessageRender();
    const finalContent=new TextDecoder().decode(Uint8Array.from(atob('__FINAL_NUMBERED_CONTENT_BASE64__'),(char)=>char.charCodeAt(0)));
    v.messages=[
      {id:'smoke-user-final-numbered',role:'user',content:'rename smoke',createdAt:Date.now()-1000},
      {id:'smoke-assistant-final-numbered',role:'assistant',createdAt:Date.now(),content:finalContent}
    ];
    if(v.detailsOpenState instanceof Map)v.detailsOpenState.clear();
    v.renderMessages();
    const text=String(v.messagesEl?.textContent||'');
    const processDetails=v.messagesEl?.querySelectorAll('.obcc-tool-json,.obcc-process-summary').length||0;
    const parsedChoices=typeof v.choiceOptionsForMessage==='function'?v.choiceOptionsForMessage(finalContent):[];
    const choices=v.messagesEl?.querySelectorAll('.obcc-choice-card').length||0;
    const numberedLineBreak=new RegExp('\\r?\\n');
    const numberedLines=finalContent.split(numberedLineBreak).map((line)=>line.trim()).filter((line)=>{
      const first=line.charAt(0);
      const second=line.charAt(1);
      return (first==='1'||first==='2'||first==='3')&&(second==='.'||second===')'||second.charCodeAt(0)===12289);
    });
    const numberedVisible=numberedLines.map((line)=>line.slice(2).trim()).every((label)=>label&&text.includes(label));
    return JSON.stringify({id:'programmatic.final-answer-keeps-numbered-sections',elapsedMs:Date.now()-t,numberedLines:numberedLines.length,numberedVisible,processDetails,parsedChoices:parsedChoices.length,choices});
  } finally {
    v.messages=oldMessages;
    v.activeRequest=oldActive;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $code = $code.Replace('__FINAL_NUMBERED_CONTENT_BASE64__', $finalNumberedBase64)
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.numberedLines -ne 3) { throw "final numbered source did not contain expected sections: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.processDetails -ne 0) { throw "final answer still rendered process/details folds: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.parsedChoices -ne 3) { throw "final structured choices did not parse exactly three: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.choices -ne 3) { throw "final choices missing or not exactly three: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.final-answer-keeps-numbered-sections'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.choice-cards-no-local-fallback'.Contains($Case)) {
  try {
    $failureContent = @'
1. No final answer was available.

Files:
changed: none

Result:
- The model returned empty content or the API failed.
'@
    $failureContentBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($failureContent))
    $failurePromptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('fix choice cards without local fallback'))
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldMessages=(v.messages||[]).slice();
  const oldActive=v.activeRequest;
  try{
    v.activeRequest=null;
    const decodeBase64=(text)=>new TextDecoder().decode(Uint8Array.from(atob(text),(char)=>char.charCodeAt(0)));
    const failureContent=decodeBase64('__FAILURE_CONTENT_BASE64__');
    const userPrompt=decodeBase64('__FAILURE_PROMPT_BASE64__');
    v.messages=[
      {id:'smoke-user-no-local-choice',role:'user',content:userPrompt,createdAt:Date.now()-1000},
      {id:'smoke-assistant-no-local-choice',role:'assistant',createdAt:Date.now(),content:failureContent,choiceOptionsStatus:'failed'}
    ];
    v.renderMessages();
    const choices=v.messagesEl?.querySelectorAll('.obcc-choice-card').length||0;
    const metadata=String(v.messages[1]?.content||'').includes('cancip-choices');
    return JSON.stringify({id:'programmatic.choice-cards-no-local-fallback',elapsedMs:Date.now()-t,choices,metadata,status:v.messages[1]?.choiceOptionsStatus||''});
  } finally {
    v.messages=oldMessages;
    v.activeRequest=oldActive;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $code = $code.Replace('__FAILURE_CONTENT_BASE64__', $failureContentBase64).Replace('__FAILURE_PROMPT_BASE64__', $failurePromptBase64)
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ($null -eq $item) { throw "eval returned null item" }
    if ([int]$item.choices -ne 0) { throw "local fallback choices rendered without model choices: $($item | ConvertTo-Json -Compress)" }
    if ($item.metadata) { throw "programmatic fallback content gained synthetic cancip-choices metadata: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.choice-cards-no-local-fallback'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.choice-cards-model-generated'.Contains($Case)) {
  try {
    $modelChoicePromptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('fix choice cards'))
    $modelChoiceAnswerBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('Choice card source was fixed.'))
    $modelChoicePayload = ConvertTo-CompactJson -Value @{ choices = @('check retry delay', 'verify model choices', 'open regression report') }
    $modelChoicePayloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($modelChoicePayload))
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldMessages=(v.messages||[]).slice();
    const oldActive=v.activeRequest;
    const oldCall=v.callChoiceSuggestionModel;
    let callCount=0;
    try{
      v.activeRequest=null;
      const decodeBase64=(text)=>new TextDecoder().decode(Uint8Array.from(atob(text),(char)=>char.charCodeAt(0)));
      v.callChoiceSuggestionModel=async()=>{callCount+=1;return decodeBase64('__MODEL_CHOICE_PAYLOAD_BASE64__');};
    v.messages=[
      {id:'smoke-user-model-choice',role:'user',content:decodeBase64('__MODEL_CHOICE_PROMPT_BASE64__'),createdAt:Date.now()-1000},
      {id:'smoke-assistant-model-choice',role:'assistant',createdAt:Date.now(),content:decodeBase64('__MODEL_CHOICE_ANSWER_BASE64__')}
    ];
    v.renderMessages();
    await new Promise((resolve)=>setTimeout(resolve,120));
    const choices=Array.from(v.messagesEl?.querySelectorAll('.obcc-choice-card')||[]).map((el)=>String(el.textContent||'').trim()).filter(Boolean);
    return JSON.stringify({id:'programmatic.choice-cards-model-generated',elapsedMs:Date.now()-t,choices,status:v.messages[1]?.choiceOptionsStatus||'',callCount});
  } finally {
    v.callChoiceSuggestionModel=oldCall;
    v.messages=oldMessages;
    v.activeRequest=oldActive;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $code = $code.Replace('__MODEL_CHOICE_PAYLOAD_BASE64__', $modelChoicePayloadBase64).Replace('__MODEL_CHOICE_PROMPT_BASE64__', $modelChoicePromptBase64).Replace('__MODEL_CHOICE_ANSWER_BASE64__', $modelChoiceAnswerBase64)
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ($null -eq $item) { throw "eval returned null item" }
    if (@($item.choices).Count -ne 0 -or [int]$item.callCount -ne 0) { throw "secondary recommendation generation should stay disabled: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.status) { throw "secondary recommendation status should stay empty: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; choices = @($item.choices).Count }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.choice-cards-model-generated'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.process-record-live-open-final-collapsed'.Contains($Case)) {
  try {
    $processFinalContent = @'
已完成读取。

<!-- cancip-choices {"choices":["打开结果","继续核对","查看过程"]} -->
'@
    $processFinalJson = $processFinalContent | ConvertTo-Json -Compress
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldMessages=(v.messages||[]).slice();
  const oldActive=v.activeRequest;
  const oldDetails=v.detailsOpenState instanceof Map?new Map(v.detailsOpenState):null;
  const oldUserDetails=v.userDetailsOpenState instanceof Map?new Map(v.userDetailsOpenState):null;
  try{
    const progress='<!-- cancip-progress-step -->\\n<!-- cancip-process-message -->\\n已执行 · 正在读取文件...';
    const user={id:'smoke-process-user',role:'user',createdAt:Date.now()-2000,content:'检查当前文件'};
    v.messages=[user,{id:'smoke-process-live',role:'assistant',createdAt:Date.now(),content:progress}];
    v.activeRequest={};
    if(v.detailsOpenState instanceof Map)v.detailsOpenState.clear();
    if(v.userDetailsOpenState instanceof Map)v.userDetailsOpenState.clear();
    v.renderMessages();
    const liveOpen=!!v.messagesEl?.querySelector('.obcc-process-record-details')?.open;
    const liveDetailsCount=v.messagesEl?.querySelectorAll('.is-process-record details').length||0;
    const nestedStepDetails=v.messagesEl?.querySelectorAll('.obcc-process-step details').length||0;
    v.messages=[
      user,
      {id:'smoke-process-live',role:'assistant',createdAt:Date.now()-1000,content:progress},
      {id:'smoke-process-final',role:'assistant',createdAt:Date.now(),content:__PROCESS_FINAL_CONTENT__}
    ];
    v.activeRequest=null;
    v.renderMessages();
    const autoFinalOpen=!!v.messagesEl?.querySelector('.obcc-process-record-details')?.open;
    const finalAnswer=v.messagesEl?.querySelector('.obcc-message.is-final-answer');
    const finalRole=finalAnswer?.querySelector('.obcc-role')?.textContent||'';
    v.messages=[user,{id:'smoke-process-live',role:'assistant',createdAt:Date.now(),content:progress}];
    v.activeRequest={};
    if(v.detailsOpenState instanceof Map)v.detailsOpenState.clear();
    if(v.userDetailsOpenState instanceof Map)v.userDetailsOpenState.clear();
    v.renderMessages();
    const manualSummary=v.messagesEl?.querySelector('.obcc-process-record-details > summary');
    manualSummary?.click();
    manualSummary?.click();
    const manuallyOpen=!!v.messagesEl?.querySelector('.obcc-process-record-details')?.open;
    v.messages=[user,{id:'smoke-process-live',role:'assistant',createdAt:Date.now()-1000,content:progress},{id:'smoke-process-live-2',role:'assistant',createdAt:Date.now(),content:progress.replace('读取文件','核对结果')}];
    v.renderMessages();
    const rerenderOpen=!!v.messagesEl?.querySelector('.obcc-process-record-details')?.open;
    v.messages=[...v.messages,{id:'smoke-process-final-2',role:'assistant',createdAt:Date.now()+1000,content:__PROCESS_FINAL_CONTENT__}];
    v.activeRequest=null;
    v.renderMessages();
    const userFinalOpen=!!v.messagesEl?.querySelector('.obcc-process-record-details')?.open;
    return JSON.stringify({id:'programmatic.process-record-live-open-final-collapsed',elapsedMs:Date.now()-t,liveOpen,autoFinalOpen,manuallyOpen,rerenderOpen,userFinalOpen,liveDetailsCount,nestedStepDetails,hasFinalAnswer:!!finalAnswer,finalRole});
  } finally {
    v.messages=oldMessages;
    v.activeRequest=oldActive;
    if(oldDetails)v.detailsOpenState=oldDetails;
    if(oldUserDetails)v.userDetailsOpenState=oldUserDetails;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $code = $code.Replace('__PROCESS_FINAL_CONTENT__', $processFinalJson)
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.liveOpen) { throw "live process record did not open one level: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.liveDetailsCount -ne 1 -or [int]$item.nestedStepDetails -ne 0) { throw "process record contains nested folds: $($item | ConvertTo-Json -Compress)" }
    if ($item.autoFinalOpen) { throw "untouched process record did not auto-collapse after final answer: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.manuallyOpen -or -not $item.rerenderOpen -or -not $item.userFinalOpen) { throw "manual process expansion was lost during streaming/final render: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.hasFinalAnswer -or [string]$item.finalRole -ne 'Cancip') { throw "final answer was not separated and labeled Cancip: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.process-record-live-open-final-collapsed'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.process-detail-deferred-dom') {
  try {
    $started = Get-Date
    $setupCode = @'
(()=>{try{const v=app.workspace.getLeavesOfType('cancip-view').map((leaf)=>leaf.view).find((view)=>view?.messagesEl?.isConnected);if(!v)throw new Error('rendered Cancip view unavailable');const sent='SENT-RAW-'+('s'.repeat(1800)),received='RECEIVED-RAW-'+('r'.repeat(1600)),content=['<!-- cancip-progress-step -->','<!-- cancip-process-message -->','已执行 · 过程审计','','## Raw Sent requestBody',sent,'','## Sent System / Instructions','DUPLICATE-SENT-SPLIT','','## Raw Received responseText',received,'','## Visible Answer after Filtering','DUPLICATE-VISIBLE-ANSWER'].join('\n');window.__cancipProcessSmoke={v,oldMessages:(v.messages||[]).slice(),oldActive:v.activeRequest,oldDetails:v.detailsOpenState instanceof Map?new Map(v.detailsOpenState):null,oldUserDetails:v.userDetailsOpenState instanceof Map?new Map(v.userDetailsOpenState):null,sent,received};v.messages=[{id:'smoke-process-user',role:'user',createdAt:Date.now()-1000,content:'过程详情精简测试'},{id:'smoke-process-deferred',role:'assistant',createdAt:Date.now(),content}];v.activeRequest=null;if(v.detailsOpenState instanceof Map)v.detailsOpenState.clear();if(v.userDetailsOpenState instanceof Map)v.userDetailsOpenState.clear();v.renderMessages();const details=v.messagesEl?.querySelector('.obcc-process-record-details');if(!details)throw new Error('process details unavailable');window.__cancipProcessSmoke.details=details;const raw=Array.from(details.querySelectorAll('.obcc-process-detail-raw code')).map((el)=>el.textContent||'').join('');return JSON.stringify({collapsedChars:raw.length,collapsedNodes:details.querySelectorAll('.obcc-process-detail-raw').length,fields:details.querySelectorAll('details.obcc-process-detail-field').length})}catch(error){return JSON.stringify({error:String(error?.stack||error)})}})()
'@
    $expandCode = @'
(()=>{try{const state=window.__cancipProcessSmoke,details=state?.details;if(!state||!details)throw new Error('process smoke state unavailable');const Win=details.ownerDocument.defaultView,rawText=()=>Array.from(details.querySelectorAll('.obcc-process-detail-raw code')).map((el)=>el.textContent||'').join(''),rawNodes=()=>details.querySelectorAll('.obcc-process-detail-raw').length;details.open=true;details.dispatchEvent(new Win.Event('toggle'));const stepBodiesVisible=Array.from(details.querySelectorAll('.obcc-process-step-detail-body')).every((el)=>Win.getComputedStyle(el).display!=='none'),outerOnlyChars=rawText().length,fields=Array.from(details.querySelectorAll('details.obcc-process-detail-field'));for(const field of fields){field.open=true;field.dispatchEvent(new Win.Event('toggle'))}const expandedText=rawText(),expandedSent=details.querySelector('.obcc-process-detail-group.is-sent .obcc-process-detail-raw code')?.textContent||'',expandedReceived=details.querySelector('.obcc-process-detail-group.is-received .obcc-process-detail-raw code')?.textContent||'',expandedNodes=rawNodes();details.open=false;details.dispatchEvent(new Win.Event('toggle'));details.open=true;details.dispatchEvent(new Win.Event('toggle'));const reopenedText=rawText(),reopenedNodes=rawNodes(),localizedTitles=fields.map((field)=>String(field.querySelector(':scope > summary.obcc-process-detail-field-title')?.textContent||'').trim());return JSON.stringify({stepBodiesVisible,outerOnlyChars,fieldsExpandable:fields.length>=2&&fields.every((field)=>field.querySelector(':scope > summary.obcc-process-detail-field-title')),expandedChars:expandedText.length,expandedNodes,reopenedNodes,exact:expandedSent===state.sent&&expandedReceived===state.received,stable:reopenedText===expandedText,localizedTitles})}catch(error){return JSON.stringify({error:String(error?.stack||error)})}})()
'@
    $cleanupCode = "(()=>{const state=window.__cancipProcessSmoke;if(state){state.v.messages=state.oldMessages;state.v.activeRequest=state.oldActive;if(state.oldDetails)state.v.detailsOpenState=state.oldDetails;if(state.oldUserDetails)state.v.userDetailsOpenState=state.oldUserDetails;state.v.renderMessages();delete window.__cancipProcessSmoke}return JSON.stringify({ok:true})})()"
    $setup = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $setupCode) -TimeoutSeconds 20
    if ($setup.error) { throw "process detail setup failed: $($setup.error)" }
    try {
      $item = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $expandCode) -TimeoutSeconds 20
    } finally {
      try { Invoke-CancipEval -Code $cleanupCode -TimeoutSeconds 20 | Out-Null } catch { Write-Host "Process detail cleanup warning: $($_.Exception.Message)" }
    }
    if ($item.error) { throw "process detail expansion failed: $($item.error)" }
    if ([int]$setup.collapsedChars -ne 0 -or [int]$setup.collapsedNodes -ne 2 -or [int]$setup.fields -ne 2) { throw "process details were not reduced to two deferred raw groups: $($setup | ConvertTo-Json -Compress)" }
    if (-not $item.stepBodiesVisible) { throw "expanded process classification body is hidden by CSS: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.outerOnlyChars -ne 0 -or -not $item.fieldsExpandable) { throw "process raw fields are not independently expandable/deferred: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.exact -or [int]$item.expandedChars -lt 3400) { throw "expanded process detail did not preserve exact raw fields: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.stable -or [int]$item.reopenedNodes -ne [int]$item.expandedNodes) { throw "process detail duplicated DOM after reopening: $($item | ConvertTo-Json -Compress)" }
    if (@($item.localizedTitles).Count -ne 2 -or -not (@($item.localizedTitles) -contains '发送原文') -or -not (@($item.localizedTitles) -contains '接收原文')) { throw "process detail classification titles are not compact/localized: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.process-detail-deferred-dom'; pass = $true; elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds; deferredChars = $item.expandedChars }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.process-detail-deferred-dom'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.live-process-timer-actual-audit') {
  try {
    $started = Get-Date
    $code = @'
(()=>{
  const v=app.workspace.getLeavesOfType('cancip-view').map((leaf)=>leaf.view).find((view)=>view?.messagesEl?.isConnected);
  if(!v)throw new Error('rendered Cancip view unavailable');
  const old={messages:v.messages,active:v.activeRequest,details:v.detailsOpenState instanceof Map?new Map(v.detailsOpenState):null};
  const id='smoke-live-audit',timer=setInterval(()=>{},60000),fence=String.fromCharCode(96).repeat(4),sent='RAW-SENT-EXACT',received='RAW-RECEIVED-EXACT';
  try{
    const content=[
      '<!-- cancip-progress-step -->','<!-- cancip-process-message -->',
      '执行中 · 模型正在基于当前证据生成回答... · 字数 发送 120 / 接收中 0 · 耗时 2s',
      fence+'text','## API profile','model: smoke','','## Model exchange raw contents','### RAW SENT requestBody',sent,'','### RAW RECEIVED responseText',received,'','## Actual API call audit','status: 200',fence
    ].join('\n');
    v.messages=[{id,role:'assistant',createdAt:Date.now()-2000,content}];
    v.activeRequest={};
    v.progressStepTimers.set(id,timer);
    if(v.detailsOpenState instanceof Map)v.detailsOpenState.clear();
    v.renderMessages();
    const record=v.messagesEl.querySelector('.obcc-process-record-details.is-live-process-record');
    const text=record?.textContent||'';
    return JSON.stringify({
      timerVisible:/耗时\s*2s/.test(text),
      liveOpen:!!record?.open,
      sentClassified:!!record?.querySelector('.obcc-process-detail-group.is-sent'),
      receivedClassified:!!record?.querySelector('.obcc-process-detail-group.is-received'),
      runtimeClassified:!!record?.querySelector('.obcc-process-detail-group.is-runtime'),
      noPlaceholder:!v.messagesEl.querySelector('.is-live-process-placeholder')
    });
  }finally{
    clearInterval(timer);v.progressStepTimers.delete(id);v.messages=old.messages;v.activeRequest=old.active;if(v.detailsOpenState instanceof Map){v.detailsOpenState.clear();for(const [key,value] of old.details||[])v.detailsOpenState.set(key,value)}v.renderMessages();
  }
})()
'@
    $item = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $code) -TimeoutSeconds 25
    foreach ($field in @('timerVisible','liveOpen','sentClassified','receivedClassified','runtimeClassified','noPlaceholder')) {
      if (-not [bool]$item.$field) { throw "live process audit failed: $field; $($item | ConvertTo-Json -Compress -Depth 8)" }
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.live-process-timer-actual-audit'; pass = $true; elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.live-process-timer-actual-audit'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.default-assets-persistent-localized') {
  try {
    $started = Get-Date
    $code = @'
(async()=>{
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip unavailable');
  const old={load:p.loadAutomations,save:p.saveAutomations,choices:p.automationSessionChoices,language:p.settings.language,dismissed:p.dismissedAutomationTemplateIds};
  let saved=[];
  const now=new Date().toISOString(),base={schedule:'daily',enabled:false,intervalMinutes:60,hour:3,minute:7,sessionMode:'current',watchNewFiles:false,newFileDebounceSeconds:45,notifyMode:'never',createdAt:now,updatedAt:now};
  const custom={...base,id:'auto-cancip-memory-dream',title:'My permanent title',prompt:'My permanent prompt'};
  const legacy={...base,id:'auto-local-version-daily',title:'Daily local version commit',prompt:'',command:'cancip.localVersionCommit'};
  try{
    const translatedLanguages=['zh-TW','ug','tr','ru','ja','ko','es','fr','de','ar'];
    const translated=translatedLanguages.map((language)=>{p.settings.language=language;return [p.t('processSentRaw'),p.t('settingsGroupAutocomplete'),p.t('automationScheduleDaily')]});
    const multilingualLabels=translated.every(([sent,autocomplete,daily])=>sent!=='Original sent content'&&autocomplete!=='Autocomplete'&&daily!=='Daily');
    p.settings.language='zh';
    p.dismissedAutomationTemplateIds=new Set(['auto-personalized-greeting-refresh']);
    p.loadAutomations=async()=>[custom,legacy];
    p.saveAutomations=async(tasks)=>{saved=tasks};
    p.automationSessionChoices=async()=>[];
    await p.ensureDefaultDailyAutomations();
    const preserved=saved.find((task)=>task.id===custom.id),localizedLegacy=saved.find((task)=>task.id===legacy.id),diary=saved.find((task)=>task.id==='auto-personalized-diary-assist'),greeting=saved.find((task)=>task.id==='auto-personalized-greeting-refresh');
    return JSON.stringify({
      id:'programmatic.default-assets-persistent-localized',
      permanentEdit:preserved?.title===custom.title&&preserved?.prompt===custom.prompt&&preserved?.enabled===false,
      legacyLocalized:localizedLegacy?.title==='每日本地版本快照',
      builtInDiary:!!diary&&diary.title==='个性化日记辅助写作'&&diary.prompt.includes('找到今天的日记笔记'),
      dismissedStaysRemoved:!greeting,
      localizedDefaults:saved.filter((task)=>task.id!=='auto-cancip-memory-dream').every((task)=>/[\u4e00-\u9fff]/.test(task.title)),
      multilingualLabels
    });
  }finally{
    p.loadAutomations=old.load;p.saveAutomations=old.save;p.automationSessionChoices=old.choices;p.settings.language=old.language;p.dismissedAutomationTemplateIds=old.dismissed;
  }
})()
'@
    $item = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $code) -TimeoutSeconds 25
    foreach ($field in @('permanentEdit','legacyLocalized','builtInDiary','dismissedStaysRemoved','localizedDefaults','multilingualLabels')) {
      if (-not [bool]$item.$field) { throw "default asset persistence/localization failed: $field; $($item | ConvertTo-Json -Compress -Depth 8)" }
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.default-assets-persistent-localized'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.interaction-regression-controls') {
  try {
    $started = Get-Date
    Write-Host 'interaction stage: navigation'
    $navigation = Invoke-CancipEval -TimeoutSeconds 20 -Code @'
(()=>{try{const v=app.workspace.getLeavesOfType('cancip-view').map((leaf)=>leaf.view).find((view)=>view?.inputEl?.isConnected);if(!v)throw new Error('rendered Cancip view unavailable');const old={messages:v.messages,scroll:v.scrollToMessage,navId:v.previousPromptNavigationMessageId,navAt:v.previousPromptNavigationAt};try{v.messages=[{id:'nav-u1',role:'user',createdAt:Date.now()-3000,content:'第一条用户提示词'},{id:'nav-a1',role:'assistant',createdAt:Date.now()-2500,content:'第一条回答'},{id:'nav-u2',role:'user',createdAt:Date.now()-2000,content:'第二条用户提示词'},{id:'nav-a2',role:'assistant',createdAt:Date.now()-1500,content:'第二条回答'},{id:'nav-u3',role:'user',createdAt:Date.now()-1000,content:'第三条用户提示词'}];v.renderMessages();const targets=[];v.scrollToMessage=(id)=>targets.push(id);v.previousPromptNavigationMessageId='nav-u3';v.previousPromptNavigationAt=Date.now();v.scrollToPreviousUserPrompt();v.scrollToPreviousUserPrompt();v.scrollToPreviousUserPrompt();return JSON.stringify({previousPromptSequence:targets.join(',')==='nav-u2,nav-u1,nav-u1'})}finally{v.messages=old.messages;v.scrollToMessage=old.scroll;v.previousPromptNavigationMessageId=old.navId;v.previousPromptNavigationAt=old.navAt;v.renderMessages()}}catch(error){return JSON.stringify({error:String(error?.stack||error)})}})()
'@
    Write-Host 'interaction stage: tts'
    $tts = Invoke-CancipEval -TimeoutSeconds 20 -Code @'
(()=>{try{const p=app.plugins.plugins.cancip,v=app.workspace.getLeavesOfType('cancip-view').map((leaf)=>leaf.view).find((view)=>view?.inputEl?.isConnected);if(!p||!v)throw new Error('rendered Cancip view unavailable');const old={refresh:v.refreshLanguage,speak:p.speakText};let refreshes=0,speakCalls=0;try{v.refreshLanguage=()=>{refreshes++};p.speakText=()=>{speakCalls++};v.openMoreMenu();const button=Array.from(v.headerMenuEl.querySelectorAll('button.obcc-panel-action')).find((item)=>/朗读会话|read session|speak session/i.test(item.textContent||item.getAttribute('aria-label')||''));if(!button)throw new Error('session TTS action unavailable');button.click();return JSON.stringify({sessionTtsNoFlash:speakCalls===1&&refreshes===0&&v.headerMenuEl.classList.contains('is-hidden')&&v.activeHeaderMenu===null})}finally{v.refreshLanguage=old.refresh;p.speakText=old.speak;v.closeHeaderMenu?.()}}catch(error){return JSON.stringify({error:String(error?.stack||error)})}})()
'@
    Write-Host 'interaction stage: highlight'
    $highlight = Invoke-CancipEval -TimeoutSeconds 20 -Code @'
(()=>{try{const p=app.plugins.plugins.cancip;if(!p)throw new Error('Cancip unavailable');const root=activeDocument.createElement('div'),before=activeDocument.createElement('div'),target=activeDocument.createElement('span'),after=activeDocument.createElement('div');try{root.style.position='fixed';root.style.left='-10000px';root.style.top='0';root.style.width='300px';root.style.height='120px';root.style.overflowY='auto';before.style.height='520px';target.style.display='block';target.textContent='目标蓝标句子';after.style.height='520px';root.append(before,target,after);activeDocument.body.append(root);let requested=null;root.scrollTo=(options)=>{requested=options};target.scrollIntoView=(options)=>{requested=options};const highlighted=p.highlightTextStreamElementsFromRoots([root],'span','目标蓝标句子',false),centered=requested?.behavior==='smooth'&&(Number(requested?.top)>0||requested?.block==='center');return JSON.stringify({highlightCentered:highlighted&&target.classList.contains('obcc-tts-source-highlight')&&centered})}finally{p.clearTtsSourceHighlight?.();root.remove()}}catch(error){return JSON.stringify({error:String(error?.stack||error)})}})()
'@
    Write-Host 'interaction stage: automation'
    $automation = Invoke-CancipEval -TimeoutSeconds 20 -Code @'
(()=>{try{const p=app.plugins.plugins.cancip,settings=p?.settingTab,root=activeDocument.createElement('div');if(!p||!settings)throw new Error('settings unavailable');try{activeDocument.body.append(root);const task={id:'smoke-auto',title:'Cancip 日记整理',prompt:'整理今日 Cancip 日记',schedule:'daily',enabled:true,intervalMinutes:60,hour:9,minute:0,sessionMode:'session',sessionId:'session-cancip',watchNewFiles:false,newFileDebounceSeconds:8,notifyMode:'inherit',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},choices=[{id:'session-trade',title:'MT5 交易复盘',updatedAt:'2026-07-16T08:00:00.000Z',archived:false},{id:'session-cancip',title:'Cancip 日记功能开发',updatedAt:'2026-07-15T08:00:00.000Z',archived:false}];settings.renderAutomationTaskCard(root,task,choices);const card=root.querySelector('details.obcc-automation-card');return JSON.stringify({automationCollapsed:!!card&&!card.open&&!!card.querySelector(':scope > summary.obcc-automation-card-summary'),automationMatched:p.recommendedAutomationSession(task,choices)?.id==='session-cancip'})}finally{root.remove()}}catch(error){return JSON.stringify({error:String(error?.stack||error)})}})()
'@
    Write-Host 'interaction stage: mobile-first-touch'
    $mobileTouch = Invoke-CancipEval -TimeoutSeconds 20 -Code @'
(()=>{
  try {
    const v=app.workspace.getLeavesOfType('cancip-view').map((leaf)=>leaf.view).find((view)=>view?.inputEl?.isConnected);
    if(!v)throw new Error('rendered Cancip view unavailable');
    const doc=v.containerEl.ownerDocument,body=doc.body,hadMobile=body.classList.contains('is-mobile'),originalFooter=v.footerEl;
    const fixture=doc.createElement('div'),button=doc.createElement('button'),autocomplete=doc.createElement('button');
    const PointerCtor=doc.defaultView.PointerEvent||doc.defaultView.MouseEvent;
    let calls=0,autocompleteOpens=0;
    const oldOpen=v.openAutocompleteSettings;
    try {
      body.classList.add('is-mobile');
      fixture.className='obcc-footer is-viewport-floating';
      button.className='obcc-composer-suggestion';
      button.type='button';
      autocomplete.className='obcc-autocomplete-apply';
      autocomplete.type='button';
      fixture.append(button,autocomplete);
      body.append(fixture);
      v.footerEl=fixture;
      button.addEventListener('click',()=>{calls+=1});
      v.openAutocompleteSettings=()=>{autocompleteOpens+=1};
      v.bindAutocompleteApplyButton(autocomplete);
      v.inputEl.focus();
      const down=new PointerCtor('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'touch',isPrimary:true});
      const floatingFirstCanceled=!button.dispatchEvent(down);
      button.dispatchEvent(new doc.defaultView.MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
      const autocompleteDown=new PointerCtor('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'touch',isPrimary:true});
      const autocompleteCanceled=!autocomplete.dispatchEvent(autocompleteDown);
      autocomplete.dispatchEvent(new PointerCtor('pointerup',{bubbles:true,cancelable:true,button:0,pointerType:'touch',isPrimary:true}));
      autocomplete.dispatchEvent(new doc.defaultView.MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
      return JSON.stringify({
        mobileFirstTouch:calls===1&&floatingFirstCanceled,
        floatingFooterFirstTouch:calls===1&&floatingFirstCanceled,
        autocompleteFirstTouch:autocompleteCanceled&&autocompleteOpens===1,
        calls,
        floatingFirstCanceled,
        autocompleteCanceled,
        autocompleteOpens
      });
    } finally {
      v.openAutocompleteSettings=oldOpen;
      v.footerEl=originalFooter;
      fixture.remove();
      if(!hadMobile)body.classList.remove('is-mobile');
    }
  } catch(error) {
    return JSON.stringify({error:String(error?.stack||error)});
  }
})()
'@
    foreach ($stage in @($navigation, $tts, $highlight, $automation, $mobileTouch)) {
      if ($stage.error) { throw "interaction stage failed: $($stage.error)" }
    }
    $item = [pscustomobject]@{
      id = 'programmatic.interaction-regression-controls'
      elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds
      previousPromptSequence = $navigation.previousPromptSequence
      sessionTtsNoFlash = $tts.sessionTtsNoFlash
      highlightCentered = $highlight.highlightCentered
      automationCollapsed = $automation.automationCollapsed
      automationMatched = $automation.automationMatched
      mobileFirstTouch = $mobileTouch.mobileFirstTouch
      floatingFooterFirstTouch = $mobileTouch.floatingFooterFirstTouch
      autocompleteFirstTouch = $mobileTouch.autocompleteFirstTouch
    }
    foreach ($field in @('previousPromptSequence','sessionTtsNoFlash','highlightCentered','automationCollapsed','automationMatched','mobileFirstTouch','floatingFooterFirstTouch','autocompleteFirstTouch')) {
      if (-not [bool]$item.$field) { throw "interaction regression check failed: $field; $($item | ConvertTo-Json -Compress -Depth 8)" }
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.interaction-regression-controls'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.context-editor-settings') {
  try {
    $started = Get-Date
    $focusGuardCode = @'
(async()=>{const previousActiveLeaf=app.workspace.activeLeaf??null,targetLeaf=app.workspace.getLeavesOfType('cancip-view').find((leaf)=>leaf.view?.inputEl?.isConnected)??app.workspace.getLeavesOfType('cancip-view')[0]??null;window.__contextEditorSettingsFocusSmoke={previousActiveLeaf,targetLeaf};activeDocument.activeElement?.blur?.();if(targetLeaf&&targetLeaf!==previousActiveLeaf)await app.workspace.setActiveLeaf(targetLeaf,{focus:true});await new Promise((resolve)=>setTimeout(resolve,650));return JSON.stringify({ok:true})})()
'@
    $focusRestoreCode = @'
(async()=>{const s=window.__contextEditorSettingsFocusSmoke;delete window.__contextEditorSettingsFocusSmoke;if(s?.previousActiveLeaf&&s.previousActiveLeaf!==s.targetLeaf)await app.workspace.setActiveLeaf(s.previousActiveLeaf,{focus:false});return JSON.stringify({ok:true})})()
'@
    $focusGuard = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $focusGuardCode) -TimeoutSeconds 20
    $editorCode = @'
(async()=>{const p=app.plugins.plugins.cancip,v=app.workspace.getLeavesOfType('cancip-view')[0]?.view;if(!p||!v)throw new Error('runtime unavailable');const now=new Date(),profile=p.activeApiProfile(),old={cache:p.personalizationCache,editorCache:p.editorAutocompleteCache,lastModel:p.editorAutocompleteLastModelAt,modelBusy:p.editorAutocompleteModelBusy,generate:p.generateEditorAutocompleteSuffix,chatLeaves:p.chatLeaves,apiUrl:profile.apiUrl,apiKey:profile.apiKey,model:profile.model,enabled:p.settings.composerAutocompleteEnabled,prefetch:p.settings.composerAutocompletePrefetchEnabled,autocompleteProfile:p.settings.composerAutocompleteApiProfileId};let routedProfile='',spinnerDuring=false;try{p.settings.composerAutocompleteEnabled=true;p.settings.composerAutocompletePrefetchEnabled=true;p.settings.composerAutocompleteApiProfileId='';p.personalizationCache={schemaVersion:3,updatedAt:now.toISOString(),timeKey:'smoke',greeting:'test',greetings:[{text:'test',choices:[]}],friendlyName:'',weather:null,inferredWeatherLocation:'',diary:'',autocomplete:['继续优化Cancip并核对结果'],sourcePaths:[]};const local=p.editorLocalAutocompleteSuffix('继续优');p.personalizationCache={...p.personalizationCache,autocomplete:[]};p.editorAutocompleteCache=new Map();p.editorAutocompleteLastModelAt=0;p.editorAutocompleteModelBusy=false;profile.apiUrl='https://smoke.invalid/v1';profile.apiKey='smoke';profile.model='smoke-model';p.chatLeaves=()=>[];p.generateEditorAutocompleteSuffix=async(_prefix,_context,_path,routed)=>{routedProfile=routed?.id||'';const finish=p.beginEditorAutocompleteActivity();spinnerDuring=!!p.statusBarEl?.classList.contains('is-editor-autocomplete-running')&&!!p.statusBarEl?.querySelector('.obcc-statusbar-icon-glyph svg');finish();return JSON.stringify({suffix:'完成并核对结果'})};const before=[];app.workspace.iterateAllLeaves(x=>before.push(x));const model=await p.editorAutocompleteSuffix('今天继续','今天继续处理 Cancip 的编辑器补全','测试.md');const after=[];app.workspace.iterateAllLeaves(x=>after.push(x));const spinnerStopped=!p.statusBarEl?.classList.contains('is-editor-autocomplete-running'),extension=app.workspace.editorExtensions.some(x=>Array.isArray(x)&&x.length===3&&Array.isArray(x[2]?.value)&&x[2].value.some(binding=>binding?.key==='Tab'&&typeof binding.run==='function'));return JSON.stringify({editorLocal:local==='化Cancip并核对结果',editorModel:model==='完成并核对结果'&&before.length===after.length&&routedProfile===profile.id,editorWithoutChatLeaf:model==='完成并核对结果',editorSpinner:spinnerDuring&&spinnerStopped,editorExtension:extension})}finally{p.personalizationCache=old.cache;p.editorAutocompleteCache=old.editorCache;p.editorAutocompleteLastModel=old.lastModel;p.editorAutocompleteModelBusy=old.modelBusy;p.generateEditorAutocompleteSuffix=old.generate;p.chatLeaves=old.chatLeaves;profile.apiUrl=old.apiUrl;profile.apiKey=old.apiKey;profile.model=old.model;p.settings.composerAutocompleteEnabled=old.enabled;p.settings.composerAutocompletePrefetchEnabled=old.prefetch;p.settings.composerAutocompleteApiProfileId=old.autocompleteProfile}})()
'@
    $autocompleteModelCode = @'
(async()=>{const p=app.plugins.plugins.cancip,v=app.workspace.getLeavesOfType('cancip-view')[0]?.view;if(!p||!v)throw new Error('runtime unavailable');const old={profiles:p.settings.apiProfiles,active:p.settings.activeApiProfileId,selected:p.settings.composerAutocompleteApiProfileId,enabled:p.settings.composerAutocompleteEnabled,save:p.saveSettings,editorCache:p.editorAutocompleteCache,generation:p.editorAutocompleteGeneration,signature:p.autocompleteProfileStateSignature,viewCache:v.autocompleteCache,requestId:v.autocompleteRequestId};const primary={id:'smoke-current',name:'当前配置',apiUrl:'https://smoke.invalid/v1',apiKey:'current-key',apiMode:'compatible',model:'smoke-current-model'},selected={id:'smoke-autocomplete',name:'补全专用',apiUrl:'https://smoke.invalid/v1',apiKey:'autocomplete-key',apiMode:'compatible',model:'smoke-autocomplete-model'};try{p.settings.apiProfiles=[primary,selected];p.settings.activeApiProfileId=primary.id;p.settings.composerAutocompleteApiProfileId='';p.settings.composerAutocompleteEnabled=false;p.editorAutocompleteCache=new Map([['stale','value']]);v.autocompleteCache=new Map([['stale',{suffix:'旧补全',choices:[]}]]);p.saveSettings=async()=>{};await p.selectAutocompleteApiProfile(selected.id);const routed=p.autocompleteApiProfile(),options=p.autocompleteApiProfileOptions(),selectedRoute=routed.id===selected.id&&routed.model===selected.model,selectionStored=p.settings.composerAutocompleteApiProfileId===selected.id,cacheInvalidated=p.editorAutocompleteCache.size===0&&v.autocompleteCache.size===0&&v.autocompleteRequestId>old.requestId,optionLabels=options.some(option=>option.value===''&&option.label.includes('跟随当前模型'))&&options.some(option=>option.value===selected.id&&option.label.includes(selected.model)&&option.label.includes(selected.name));selected.apiKey='';const missingCredentialFallback=p.autocompleteApiProfile().id===primary.id;p.settings.composerAutocompleteApiProfileId='missing-profile';const missingProfileFallback=p.autocompleteApiProfile().id===primary.id;return JSON.stringify({selectedRoute,selectionStored,cacheInvalidated,optionLabels,missingCredentialFallback,missingProfileFallback})}finally{p.settings.apiProfiles=old.profiles;p.settings.activeApiProfileId=old.active;p.settings.composerAutocompleteApiProfileId=old.selected;p.settings.composerAutocompleteEnabled=old.enabled;p.saveSettings=old.save;p.editorAutocompleteCache=old.editorCache;p.editorAutocompleteGeneration=old.generation;p.autocompleteProfileStateSignature=old.signature;v.autocompleteCache=old.viewCache;v.autocompleteRequestId=old.requestId}})()
'@
    $editorTreeCode = @'
(async()=>{const p=app.plugins.plugins.cancip;if(!p)throw new Error('runtime unavailable');const h=Object.create(p),path='tree-smoke.md',profile={...p.activeApiProfile(),id:'tree-smoke-profile',apiUrl:'https://smoke.invalid/v1',apiKey:'smoke',model:'smoke-model'};h.settings={...p.settings,apiProfiles:[profile],activeApiProfileId:profile.id,composerAutocompleteApiProfileId:'',composerAutocompleteEnabled:true,composerAutocompletePrefetchEnabled:true,composerAutocompleteCandidateCount:4};h.editorAutocompleteCache=new Map();h.editorAutocompleteBranchCache=new Map();h.editorAutocompleteBranchPrefetches=new Map();h.editorAutocompleteBranchPrefetchAttempts=new Set();h.editorAutocompleteModelBusy=false;h.editorAutocompleteLastModelAt=0;h.editorAutocompleteGeneration=0;h.editorAutocompleteMemoryGeneration=0;h.editorLocalAutocompleteSuffix=()=>'';h.beginEditorAutocompleteActivity=()=>()=>{};let calls=0;const roots=['第一层A\n接续','第一层B','第一层C','第一层D'],lockedBatchSizes=[];h.generateEditorAutocompleteSuffix=async(_prefix,_context,_path,_profile,_excluded,locked=[])=>{calls+=1;const selected=locked.length?locked:roots;if(locked.length)lockedBatchSizes.push(locked.length);return JSON.stringify({candidates:selected.map(text=>locked.length?{text,next:[`${text}-A`,`${text}-B`,`${text}-C`,`${text}-D`]}:{text})})};const first=await h.editorAutocompleteCandidates('开始','开始<CURSOR>',path,{force:true}),rootFirst=first.length===4&&calls===1&&first.every(root=>h.editorPrefetchedAutocompleteCandidates(`开始${root}`,path).length===0),firstReady=await h.ensureEditorAutocompleteBranches('开始','开始<CURSOR>',path,first),firstItems=first.length+first.reduce((n,root)=>n+h.editorPrefetchedAutocompleteCandidates(`开始${root}`,path).length,0),second=h.editorPrefetchedAutocompleteCandidates(`开始${first[0]}`,path),callsAfterFirst=calls,duplicateReady=await h.ensureEditorAutocompleteBranches('开始','开始<CURSOR>',path,first),dedupedPrefetch=duplicateReady===4&&calls===callsAfterFirst,alias=h.rememberEditorAutocompleteCandidateAlias('接续',path,second),recursiveReady=await h.ensureEditorAutocompleteBranches('接续','开始第一层A\n接续<CURSOR>',path,alias),third=h.editorPrefetchedAutocompleteCandidates(`接续${alias[0]}`,path),multilineAlias=first[0]==='第一层A\n接续'&&second.length===4&&alias.join('|')===second.join('|'),recursivePrefetch=recursiveReady===4&&third.length===4,readyTwenty=firstReady===4&&firstItems===20,batchedPrefetch=lockedBatchSizes.length===2&&lockedBatchSizes.every(size=>size===4);return JSON.stringify({editorTree:rootFirst&&multilineAlias&&recursivePrefetch&&readyTwenty&&batchedPrefetch&&dedupedPrefetch,rootFirst,multilineAlias,recursivePrefetch,readyTwenty,batchedPrefetch,dedupedPrefetch,calls,lockedBatchSizes})})()
'@
    $editorPartialTreeCode = @'
(async()=>{const p=app.plugins.plugins.cancip;if(!p)throw new Error('runtime unavailable');const h=Object.create(p),path='partial-tree-smoke.md',profile={...p.activeApiProfile(),id:'partial-tree-profile',apiUrl:'https://smoke.invalid/v1',apiKey:'smoke',model:'smoke-model'},roots=['根A','根B','根C'];h.settings={...p.settings,apiProfiles:[profile],activeApiProfileId:profile.id,composerAutocompleteApiProfileId:'',composerAutocompleteEnabled:true,composerAutocompletePrefetchEnabled:true,composerAutocompleteCandidateCount:3};h.editorAutocompleteCache=new Map();h.editorAutocompleteBranchCache=new Map();h.editorAutocompleteBranchPrefetches=new Map();h.editorAutocompleteBranchPrefetchAttempts=new Set();h.editorAutocompleteGeneration=0;h.editorAutocompleteMemoryGeneration=0;h.editorAutocompleteActivityCount=0;h.updateStatusBarAttention=()=>{};const calls=[],activity=[];h.generateEditorAutocompleteSuffix=async(_prefix,_context,_path,_profile,_excluded,locked=[])=>{calls.push([...locked]);activity.push(h.editorAutocompleteActivityCount);await new Promise(resolve=>setTimeout(resolve,60));return JSON.stringify({candidates:locked.map((text,index)=>({text,...(index===0?{next:[`${text}-1`,`${text}-2`,`${text}-3`]}:{})}))})};const job=h.ensureEditorAutocompleteBranches('前缀','前缀<CURSOR>',path,roots),pendingAtStart=h.editorAutocompleteBranchPrefetches.size===3,waited=await h.awaitEditorAutocompleteBranchPrefetch('前缀根B',path),ready=await job,counts=roots.map(root=>h.editorPrefetchedAutocompleteCandidates(`前缀${root}`,path).length),callsAfterFirst=calls.length,secondReady=await h.ensureEditorAutocompleteBranches('前缀','前缀<CURSOR>',path,roots);return JSON.stringify({singleBatch:ready===1&&counts.join(',')==='3,0,0'&&calls.length===1&&calls[0].length===3,noRetry:secondReady===1&&calls.length===callsAfterFirst,pendingSettles:pendingAtStart&&waited.length===0&&h.editorAutocompleteBranchPrefetches.size===0,quietPrefetch:activity.every(count=>count===0)&&h.editorAutocompleteActivityCount===0,calls,activity,counts})})()
'@
    $editorForceTreeCode = @'
(async()=>{const p=app.plugins.plugins.cancip;if(!p)throw new Error('runtime unavailable');const h=Object.create(p),path='no-prefetch-smoke.md',profile={...p.activeApiProfile(),id:'no-prefetch-smoke-profile',apiUrl:'https://smoke.invalid/v1',apiKey:'smoke',model:'smoke-model'};h.settings={...p.settings,apiProfiles:[profile],activeApiProfileId:profile.id,composerAutocompleteApiProfileId:'',composerAutocompleteEnabled:true,composerAutocompletePrefetchEnabled:false,composerAutocompleteCandidateCount:4};h.editorAutocompleteCache=new Map();h.editorAutocompleteBranchCache=new Map();h.editorAutocompleteBranchPrefetches=new Map();h.editorAutocompleteBranchPrefetchAttempts=new Set();h.editorAutocompleteModelBusy=false;h.editorAutocompleteLastModelAt=0;h.editorAutocompleteGeneration=0;h.editorAutocompleteMemoryGeneration=0;h.editorLocalAutocompleteSuffix=()=>'';h.beginEditorAutocompleteActivity=()=>()=>{};let calls=0;h.generateEditorAutocompleteSuffix=async()=>{calls+=1;return JSON.stringify({candidates:['换批A','换批B','换批C','换批D'].map(text=>({text}))})};const forced=await h.editorAutocompleteCandidates('换批','换批<CURSOR>',path,{force:true,excluded:['旧A','旧B','旧C']}),forcedReady=await h.ensureEditorAutocompleteBranches('换批','换批<CURSOR>',path,forced),waited=await h.awaitEditorAutocompleteBranchPrefetch(`换批${forced[0]}`,path);h.scheduleEditorAutocompleteBranchPrefetch('换批','换批<CURSOR>',path,forced);await new Promise(resolve=>setTimeout(resolve,20));const noPrefetch=forced.length===4&&forcedReady===0&&waited.length===0&&h.editorAutocompleteBranchCache.size===0&&h.editorAutocompleteBranchPrefetches.size===0&&h.editorAutocompleteBranchPrefetchAttempts.size===0&&calls===1;return JSON.stringify({noPrefetch,forcedReady,calls})})()
'@
    $editorMemoryCode = @'
(async()=>{const p=app.plugins.plugins.cancip;if(!p)throw new Error('runtime unavailable');const old={include:p.settings.includeCoreMemory,enabled:p.settings.composerAutocompleteEnabled,corpus:p.editorAutocompleteMemoryCorpusCache,promise:p.editorAutocompleteMemoryCorpusPromise};try{p.settings.includeCoreMemory=true;p.settings.composerAutocompleteEnabled=false;p.editorAutocompleteMemoryCorpusPromise=null;p.editorAutocompleteMemoryCorpusCache={at:Date.now(),documents:[{path:'AI/Cancip/Memory/USER_PREFERENCES_QUICK.md',content:'用户称呼木拉提。偏好中文、结论优先、回答精简。apiKey: smoke-secret-value',kind:'memory',priority:0,updatedAt:Date.now()},{path:'AI/Cancip/Memory/PROFILE.md',content:'木拉提负责医疗行政、转诊协调和证书整理。',kind:'memory',priority:1,updatedAt:Date.now()},{path:'AI/Cancip/Memory/WORKFLOWS.md',content:'复诊安排固定流程：核对患者、日期、材料，再确认通知结果。',kind:'memory',priority:4,updatedAt:Date.now()},{path:'.cancip/PROJECT_MEMORY.md',content:'当前项目正在优化 Cancip 笔记自动补全和记忆检索。',kind:'project',priority:12,updatedAt:Date.now()},{path:'.cancip/sessions/recent.json',content:'会话：继续安排复诊\n用户：整理复诊材料并核对通知。',kind:'session',priority:30,updatedAt:Date.now()},{path:'AI/Cancip/Memory/TRADING.md',content:'量化交易回测与仓位控制。',kind:'memory',priority:40,updatedAt:Date.now()}]};const context=await p.editorAutocompleteMemoryContext('继续安排复诊','今天需要继续安排复诊并核对材料','常用/日记/2026-07-17.md');return JSON.stringify({richMemory:context.includes('木拉提')&&context.includes('复诊安排固定流程')&&context.includes('继续安排复诊'),memoryRelevant:!context.includes('量化交易回测'),memoryBounded:context.length>120&&context.length<=3600,memoryRedacted:!context.includes('smoke-secret-value')&&context.includes('REDACTED')})}finally{p.settings.includeCoreMemory=old.include;p.settings.composerAutocompleteEnabled=old.enabled;p.editorAutocompleteMemoryCorpusCache=old.corpus;p.editorAutocompleteMemoryCorpusPromise=old.promise}})()
'@
    $editorPromptCode = @'
(async()=>{const p=app.plugins.plugins.cancip;if(!p)throw new Error('runtime unavailable');const old={include:p.settings.includeCoreMemory,call:p.callLightweightAutocompleteModel,prefetch:p.settings.composerAutocompletePrefetchEnabled,count:p.settings.composerAutocompleteCandidateCount};const captured=[];try{p.settings.includeCoreMemory=false;p.settings.composerAutocompletePrefetchEnabled=true;p.settings.composerAutocompleteCandidateCount=3;p.callLightweightAutocompleteModel=async(_profile,input,system,maxTokens)=>{captured.push({input,system,maxTokens});return JSON.stringify({candidates:[{text:'补全A',next:['A1','A2','A3']},{text:'补全B',next:['B1','B2','B3']},{text:'补全C',next:['C1','C2','C3']}]})};const profile={id:'smoke',name:'smoke',apiUrl:'https://smoke.invalid/v1',apiKey:'smoke',apiMode:'compatible',model:'smoke-model'},raw=await p.generateEditorAutocompleteSuffix('继续安排复诊','今天需要继续安排复诊<CURSOR>并核对材料','常用/日记/2026-07-17.md',profile),branchRaw=await p.generateEditorAutocompleteSuffix('继续安排复诊','今天需要继续安排复诊<CURSOR>并核对材料','常用/日记/2026-07-17.md',profile,[],['补全A']);p.settings.composerAutocompletePrefetchEnabled=false;p.settings.composerAutocompleteCandidateCount=4;const noPrefetchRaw=await p.generateEditorAutocompleteSuffix('继续安排复诊','今天需要继续安排复诊<CURSOR>并核对材料','常用/日记/2026-07-17.md',profile),root=captured[0],branch=captured[1],disabled=captured[2],rootFirstPrompt=root.system.includes('只生成 3 个当前层 text')&&!root.system.includes('"next":['),branchPrompt=branch.system.includes('1 个 text')&&branch.system.includes('本次共预取 3 个')&&branch.system.includes('"next":['),disabledPrompt=disabled.system.includes('只生成 4 个当前层 text')&&!disabled.system.includes('"next":[');return JSON.stringify({memoryInjected:root.input.includes('<CURSOR>')&&!root.input.includes('相关记忆'),modelBudget:root.maxTokens===870&&root.input.length<2600&&branch.maxTokens===420&&disabled.maxTokens===1020,rootFirstPrompt,branchPrompt,disabledPrompt,modelCalled:raw.includes('补全A')&&branchRaw.includes('A3')&&noPrefetchRaw.includes('补全C')})}finally{p.settings.includeCoreMemory=old.include;p.settings.composerAutocompletePrefetchEnabled=old.prefetch;p.settings.composerAutocompleteCandidateCount=old.count;p.callLightweightAutocompleteModel=old.call}})()
'@
    $editorMemoryInvalidationCode = @'
(()=>{const p=app.plugins.plugins.cancip;if(!p)throw new Error('runtime unavailable');const old={enabled:p.settings.composerAutocompleteEnabled,corpus:p.editorAutocompleteMemoryCorpusCache,promise:p.editorAutocompleteMemoryCorpusPromise,memoryGeneration:p.editorAutocompleteMemoryGeneration,generation:p.editorAutocompleteGeneration,editorCache:p.editorAutocompleteCache,branchCache:p.editorAutocompleteBranchCache,prefetches:p.editorAutocompleteBranchPrefetches,attempts:p.editorAutocompleteBranchPrefetchAttempts};try{p.settings.composerAutocompleteEnabled=false;p.editorAutocompleteMemoryCorpusCache={at:Date.now(),documents:[]};p.editorAutocompleteMemoryCorpusPromise=null;p.editorAutocompleteCache=new Map([['stale','value']]);p.editorAutocompleteBranchCache=new Map([['stale',['value']]]);p.editorAutocompleteBranchPrefetches=new Map([['stale',Promise.resolve(['value'])]]);p.editorAutocompleteBranchPrefetchAttempts=new Set(['stale']);const beforeGeneration=p.editorAutocompleteGeneration,beforeMemoryGeneration=p.editorAutocompleteMemoryGeneration;p.invalidateEditorAutocompleteMemoryContext();return JSON.stringify({memoryInvalidated:p.editorAutocompleteMemoryCorpusCache===null&&p.editorAutocompleteCache.size===0&&p.editorAutocompleteBranchCache.size===0&&p.editorAutocompleteBranchPrefetches.size===0&&p.editorAutocompleteBranchPrefetchAttempts.size===0&&p.editorAutocompleteMemoryGeneration>beforeMemoryGeneration&&p.editorAutocompleteGeneration===beforeGeneration})}finally{p.settings.composerAutocompleteEnabled=old.enabled;p.editorAutocompleteMemoryCorpusCache=old.corpus;p.editorAutocompleteMemoryCorpusPromise=old.promise;p.editorAutocompleteMemoryGeneration=old.memoryGeneration;p.editorAutocompleteGeneration=old.generation;p.editorAutocompleteCache=old.editorCache;p.editorAutocompleteBranchCache=old.branchCache;p.editorAutocompleteBranchPrefetches=old.prefetches;p.editorAutocompleteBranchPrefetchAttempts=old.attempts}})()
'@
    $currentFileCode = @'
(async()=>{const v=app.workspace.getLeavesOfType('cancip-view')[0]?.view,w=app.workspace;if(!v)throw new Error('view unavailable');const file=app.vault.getMarkdownFiles().filter(x=>x.stat.size>0&&x.stat.size<12000).sort((a,b)=>a.stat.size-b.stat.size)[0];if(!file)throw new Error('no small Markdown file');const old={get:w.getActiveFile,draft:v.draftContext,include:v.includeCurrentFileForSession,hidden:v.hiddenContextKeys,save:v.saveCurrentSession,focus:v.focusInput};try{const raw=await app.vault.cachedRead(file);w.getActiveFile=()=>file;v.draftContext=[];v.hiddenContextKeys=new Set();v.includeCurrentFileForSession=true;v.saveCurrentSession=async()=>{};v.focusInput=()=>{};await v.addCurrentFileContext();const added=v.draftContext[0],sample=raw.trim().slice(0,40);return JSON.stringify({currentFileSnapshot:!!added&&added.path===file.path&&added.source==='file'&&(!sample||added.content.includes(sample))&&v.includeCurrentFileForSession===false})}finally{w.getActiveFile=old.get;v.draftContext=old.draft;v.includeCurrentFileForSession=old.include;v.hiddenContextKeys=old.hidden;v.saveCurrentSession=old.save;v.focusInput=old.focus;v.renderSources(v.sourceHits)}})()
'@
    $settingsCode = @'
(async()=>{const s=app.plugins.plugins.cancip?.settingTab;if(!s)throw new Error('settings unavailable');const old=s.containerEl,scroller=activeDocument.createElement('div'),root=activeDocument.createElement('div');try{activeDocument.body.append(scroller);scroller.append(root);scroller.style.position='fixed';scroller.style.left='-10000px';scroller.style.top='0';scroller.style.width='360px';scroller.style.height='180px';scroller.style.overflowY='auto';for(let i=0;i<12;i++){const item=activeDocument.createElement('div');item.className='setting-item';item.style.height='64px';const name=activeDocument.createElement('div');name.className='setting-item-name';name.textContent=`设置项-${i}`;item.append(name);root.append(item)}s.containerEl=root;scroller.scrollTop=230;const snapshots=s.captureScrollSnapshots(),identity=snapshots[0]?.anchorIdentity,anchor=Array.from(root.querySelectorAll('.setting-item')).find(x=>s.settingsAnchorIdentity(x)===identity);if(!anchor)throw new Error('anchor unavailable');const before=anchor.getBoundingClientRect().top-scroller.getBoundingClientRect().top,spacer=activeDocument.createElement('div');spacer.style.height='90px';root.prepend(spacer);s.restoreScrollSnapshots(snapshots);await new Promise(resolve=>setTimeout(resolve,80));const afterAnchor=Array.from(root.querySelectorAll('.setting-item')).find(x=>s.settingsAnchorIdentity(x)===identity),after=afterAnchor.getBoundingClientRect().top-scroller.getBoundingClientRect().top,error=Math.abs(after-before);return JSON.stringify({settingsScrollStable:error<2,settingsOffsetError:error})}finally{s.containerEl=old;scroller.remove()}})()
'@
    $settingsTabsCode = @'
(()=>{const s=app.plugins.plugins.cancip?.settingTab;if(!s)throw new Error('settings unavailable');const old=s.settingsPageTabsScrollLeft,host=activeDocument.createElement('div'),makeTabs=()=>{const tabs=activeDocument.createElement('div');tabs.className='obcc-settings-page-tabs';tabs.style.width='280px';tabs.style.overflowX='auto';const content=activeDocument.createElement('div');content.style.width='960px';content.style.height='20px';content.style.flex='0 0 960px';tabs.append(content);return tabs};try{host.style.position='fixed';host.style.left='-10000px';host.style.top='0';activeDocument.body.append(host);let tabs=makeTabs();host.append(tabs);tabs.scrollLeft=120;s.rememberSettingsPageTabsScroll(tabs);const before=s.settingsPageTabsScrollLeft;tabs.remove();tabs=makeTabs();host.append(tabs);s.restoreSettingsPageTabsScroll(tabs);const after=tabs.scrollLeft,source=String(s.display),wired=source.includes('rememberSettingsPageTabsScroll')&&source.includes('restoreSettingsPageTabsScroll'),settingsPagesSeparated=source.includes('"buttons"')&&source.includes('displayButtonEditingSettings')&&source.includes('"autocomplete"')&&source.includes('displayAutocompleteSettings');return JSON.stringify({settingsTabsStable:before>0&&Math.abs(after-before)<1&&wired,settingsPagesSeparated,before,after})}finally{s.settingsPageTabsScrollLeft=old;host.remove()}})()
'@
    $evidenceCode = @'
(()=>{const v=app.workspace.getLeavesOfType('cancip-view').map((leaf)=>leaf.view).find((view)=>typeof view?.personalizationCacheFromModel==='function');if(!v)throw new Error('personalization parser unavailable');const fallback={schemaVersion:3,updatedAt:new Date().toISOString(),timeKey:'smoke',greeting:'上午好。可靠回退。',greetings:[{text:'上午好。可靠回退。',choices:[]}],friendlyName:'',weather:null,inferredWeatherLocation:'',diary:'',autocomplete:[],sourcePaths:[]},source='用户姓名：木拉提\n常住地：乌鲁木齐',forged=v.personalizationCacheFromModel(JSON.stringify({friendlyName:'虚构名字',weatherLocation:'虚构市',greetings:[{text:'虚构名字，上午好。虚构市今天天气晴朗。',choices:['查看虚构市天气']}],autocomplete:[]}),fallback,[],'smoke',source),accepted=v.personalizationCacheFromModel(JSON.stringify({friendlyName:'木拉提',weatherLocation:'乌鲁木齐',greetings:[{text:'木拉提，上午好。最近事情不少，先处理最明确的一项。',choices:['继续处理 Cancip 并核对结果']}],autocomplete:[]}),fallback,[],'smoke',source),forgedText=forged.greetings.map((item)=>`${item.text} ${item.choices.join(' ')}`).join(' ');return JSON.stringify({personalizationEvidence:forged.friendlyName===''&&forged.inferredWeatherLocation===''&&!/虚构名字|虚构市|天气晴朗/.test(forgedText)&&accepted.friendlyName==='木拉提'&&accepted.inferredWeatherLocation==='乌鲁木齐'&&accepted.greetings.some((item)=>item.text.includes('木拉提'))})})()
'@
    $spinnerCode = @'
(async()=>{const p=app.plugins.plugins.cancip;if(!p)throw new Error('runtime unavailable');const before=p.editorAutocompleteActivityCount,finish=p.beginEditorAutocompleteActivity(),during=p.editorAutocompleteActivityCount===before+1&&!!p.statusBarEl?.classList.contains('is-editor-autocomplete-running')&&!!p.statusBarEl?.querySelector('.obcc-statusbar-icon-glyph svg');finish();let timedOut=false;try{await p.runEditorAutocompleteNetworkRequest(()=>new Promise(()=>{}),35)}catch{timedOut=true}const stopped=p.editorAutocompleteActivityCount===before&&!p.statusBarEl?.classList.contains('is-editor-autocomplete-running');return JSON.stringify({editorSpinner:during&&timedOut&&stopped})})()
'@
    $editorCleanupCode = @'
(()=>{const p=app.plugins.plugins.cancip;if(!p)throw new Error('runtime unavailable');p.editorAutocompleteGeneration+=1;p.editorAutocompleteModelBusy=false;p.editorAutocompleteActivityCount=0;p.editorAutocompleteCache.clear();p.updateStatusBarAttention(p.statusBarAttentionState);return JSON.stringify({ok:true})})()
'@
    Write-Host 'context/editor stage: editor'
    $editor = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $editorCode) -TimeoutSeconds 20
    $editorCleanup = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $editorCleanupCode) -TimeoutSeconds 20
    Write-Host 'context/editor stage: spinner'
    $spinner = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $spinnerCode) -TimeoutSeconds 20
    Write-Host 'context/editor stage: autocomplete-model'
    $autocompleteModel = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $autocompleteModelCode) -TimeoutSeconds 20
    Write-Host 'context/editor stage: autocomplete-tree'
    $editorTree = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $editorTreeCode) -TimeoutSeconds 25
    Write-Host 'context/editor stage: autocomplete-partial-tree'
    $editorPartialTree = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $editorPartialTreeCode) -TimeoutSeconds 25
    Write-Host 'context/editor stage: autocomplete-force-tree'
    $editorForceTree = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $editorForceTreeCode) -TimeoutSeconds 20
    Write-Host 'context/editor stage: rich-memory'
    $editorMemory = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $editorMemoryCode) -TimeoutSeconds 20
    Write-Host 'context/editor stage: model-prompt-budget'
    $editorPrompt = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $editorPromptCode) -TimeoutSeconds 20
    Write-Host 'context/editor stage: memory-invalidation'
    $editorMemoryInvalidation = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $editorMemoryInvalidationCode) -TimeoutSeconds 20
    Write-Host 'context/editor stage: current-file'
    $currentFile = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $currentFileCode) -TimeoutSeconds 20
    Write-Host 'context/editor stage: settings-scroll'
    $settings = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $settingsCode) -TimeoutSeconds 20
    Write-Host 'context/editor stage: settings-tabs'
    $settingsTabs = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $settingsTabsCode) -TimeoutSeconds 25
    Write-Host 'context/editor stage: personalization-evidence'
    $evidence = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $evidenceCode) -TimeoutSeconds 20
    $item = [pscustomobject]@{
      id = 'programmatic.context-editor-settings'
      elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds
      editorLocal = $editor.editorLocal
      editorModel = $editor.editorModel
      editorWithoutChatLeaf = $editor.editorWithoutChatLeaf
      editorSpinner = $spinner.editorSpinner
      editorExtension = $editor.editorExtension
      autocompleteModelRoute = $autocompleteModel.selectedRoute
      autocompleteModelStored = $autocompleteModel.selectionStored
      autocompleteModelCacheInvalidated = $autocompleteModel.cacheInvalidated
      autocompleteModelOptions = $autocompleteModel.optionLabels
      autocompleteModelCredentialFallback = $autocompleteModel.missingCredentialFallback
      autocompleteModelMissingFallback = $autocompleteModel.missingProfileFallback
      editorAutocompleteTree = $editorTree.editorTree
      editorAutocompleteRootFirst = $editorTree.rootFirst
      editorAutocompleteMultilineAlias = $editorTree.multilineAlias
      editorAutocompleteRecursivePrefetch = $editorTree.recursivePrefetch
      editorAutocompleteReadyTwenty = $editorTree.readyTwenty
      editorAutocompleteBatchedPrefetch = $editorTree.batchedPrefetch
      editorAutocompleteDedupedPrefetch = $editorTree.dedupedPrefetch
      editorAutocompleteSingleBatch = $editorPartialTree.singleBatch
      editorAutocompleteNoRetry = $editorPartialTree.noRetry
      editorAutocompletePendingSettles = $editorPartialTree.pendingSettles
      editorAutocompleteQuietPrefetch = $editorPartialTree.quietPrefetch
      editorAutocompleteNoPrefetch = $editorForceTree.noPrefetch
      editorRichMemory = $editorMemory.richMemory
      editorMemoryRelevant = $editorMemory.memoryRelevant
      editorMemoryBounded = $editorMemory.memoryBounded
      editorMemoryRedacted = $editorMemory.memoryRedacted
      editorMemoryInjected = $editorPrompt.memoryInjected
      editorModelBudget = $editorPrompt.modelBudget
      editorRootFirstPrompt = $editorPrompt.rootFirstPrompt
      editorBranchPrompt = $editorPrompt.branchPrompt
      editorDisabledPrefetchPrompt = $editorPrompt.disabledPrompt
      editorMemoryModelCalled = $editorPrompt.modelCalled
      editorMemoryInvalidated = $editorMemoryInvalidation.memoryInvalidated
      currentFileSnapshot = $currentFile.currentFileSnapshot
      settingsScrollStable = $settings.settingsScrollStable
      settingsOffsetError = $settings.settingsOffsetError
      settingsTabsStable = $settingsTabs.settingsTabsStable
      settingsPagesSeparated = $settingsTabs.settingsPagesSeparated
      personalizationEvidence = $evidence.personalizationEvidence
    }
    foreach ($field in @('editorLocal','editorModel','editorWithoutChatLeaf','editorSpinner','editorExtension','autocompleteModelRoute','autocompleteModelStored','autocompleteModelCacheInvalidated','autocompleteModelOptions','autocompleteModelCredentialFallback','autocompleteModelMissingFallback','editorAutocompleteTree','editorAutocompleteRootFirst','editorAutocompleteMultilineAlias','editorAutocompleteRecursivePrefetch','editorAutocompleteReadyTwenty','editorAutocompleteBatchedPrefetch','editorAutocompleteDedupedPrefetch','editorAutocompleteSingleBatch','editorAutocompleteNoRetry','editorAutocompletePendingSettles','editorAutocompleteQuietPrefetch','editorAutocompleteNoPrefetch','editorRichMemory','editorMemoryRelevant','editorMemoryBounded','editorMemoryRedacted','editorMemoryInjected','editorModelBudget','editorRootFirstPrompt','editorBranchPrompt','editorDisabledPrefetchPrompt','editorMemoryModelCalled','editorMemoryInvalidated','currentFileSnapshot','settingsScrollStable','settingsTabsStable','settingsPagesSeparated','personalizationEvidence')) {
      if (-not [bool]$item.$field) { throw "context/editor/settings check failed: $field; $($item | ConvertTo-Json -Compress -Depth 8)" }
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; settingsOffsetError = $item.settingsOffsetError }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.context-editor-settings'; pass = $false; error = $_.Exception.Message }
  } finally {
    try {
      if ($focusRestoreCode) {
        Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $focusRestoreCode) -TimeoutSeconds 20 | Out-Null
      }
    } catch {
      Write-Host "Context/editor focus cleanup warning: $($_.Exception.Message)"
    }
  }
}

if (Should-RunProgrammaticCase 'programmatic.editor-autocomplete-mounted') {
  try {
    $started = Get-Date
    $setupCode = @'
(async()=>{
  await new Promise((resolve)=>setTimeout(resolve,0));
  const p=app.plugins.plugins.cancip,previousActiveLeaf=app.workspace.activeLeaf??null,visible=(item)=>{const cm=item?.view?.editor?.cm;if(!cm)return false;const rect=cm.contentDOM.getBoundingClientRect();return cm.dom.isConnected&&rect.width>=120&&rect.height>=80};
  const activeMarkdown=visible(previousActiveLeaf)?previousActiveLeaf:null,leaves=app.workspace.getLeavesOfType('markdown').filter(visible),leaf=activeMarkdown||leaves[0]||null;
  if(!p||!leaf)return JSON.stringify({skip:true,reason:'No visible Markdown editor at least 120px wide'});
  const editor=leaf.view.editor,cm=editor.cm,doc=cm.dom.ownerDocument,before=editor.getValue(),oldCursor=editor.getCursor(),old={enabled:p.settings.composerAutocompleteEnabled,prefetch:p.settings.composerAutocompletePrefetchEnabled,count:p.settings.composerAutocompleteCandidateCount,rotation:p.settings.composerAutocompleteRotationSeconds,local:p.editorLocalAutocompleteSuffix,model:p.editorAutocompleteCandidates,ensure:p.ensureEditorAutocompleteBranches,isActive:p.isEditorAutocompleteViewActive,cache:p.editorAutocompleteCache,branchCache:p.editorAutocompleteBranchCache,prefetches:p.editorAutocompleteBranchPrefetches,attempts:p.editorAutocompleteBranchPrefetchAttempts};
  let target=null;
  for(let line=0;line<editor.lineCount();line+=1){const text=editor.getLine(line)||'';if(text.trim().length>=3){target={line,ch:text.length};break}}
  if(!target)return JSON.stringify({skip:true,reason:'No eligible Markdown line'});
  const path=leaf.view.file?.path||'',prefix=editor.getLine(target.line)||'',roots=['第一项\n完整补全','第二项\n包含换行','第三项\n完整补全'],branches=new Map(roots.map((root,index)=>[root,[`后续${index+1}-A`,`后续${index+1}-B`,`后续${index+1}-C`]]));
  const smoke={leaf,previousActiveLeaf,editor,cm,doc,before,oldCursor,old,target,path,prefix,roots,branches,calls:0,branchStartedAt:0,branchResolvedAt:0,active:true};
  p.__editorAutocompleteSmoke=smoke;
  p.settings.composerAutocompleteEnabled=true;
  p.settings.composerAutocompletePrefetchEnabled=true;
  p.settings.composerAutocompleteCandidateCount=3;
  p.settings.composerAutocompleteRotationSeconds=2;
  p.isEditorAutocompleteViewActive=(view)=>view===cm;
  p.editorLocalAutocompleteSuffix=()=>'';
  p.editorAutocompleteGeneration+=1;
  p.editorAutocompleteCache=new Map();
  p.editorAutocompleteBranchCache=new Map();
  p.editorAutocompleteBranchPrefetches=new Map();
  p.editorAutocompleteBranchPrefetchAttempts=new Set();
  p.editorAutocompleteCandidates=async()=>{smoke.calls+=1;return roots};
  p.ensureEditorAutocompleteBranches=async(requestPrefix,_context,requestPath,selected)=>{smoke.branchStartedAt=smoke.branchStartedAt||Date.now();await new Promise(resolve=>setTimeout(resolve,1200));if(!smoke.active)return 0;for(const [index,root] of selected.entries()){const children=branches.get(root)||[`递归${index+1}-A`,`递归${index+1}-B`,`递归${index+1}-C`];p.rememberEditorAutocompleteCandidateAlias(`${requestPrefix}${root}`,requestPath,children)}smoke.branchResolvedAt=Date.now();return selected.length};
  return JSON.stringify({ok:true,target,path});
})()
'@
    $rotationCode = @'
(async()=>{const p=app.plugins.plugins.cancip,s=p?.__editorAutocompleteSmoke;if(!s)throw new Error('autocomplete smoke state unavailable');s.cm.focus();s.editor.setCursor({line:s.target.line,ch:0});s.cm.dispatch({selection:{anchor:s.cm.state.selection.main.head}});const settleDeadline=Date.now()+5000;while(p.editorAutocompleteActivityCount>0&&Date.now()<settleDeadline)await new Promise(resolve=>setTimeout(resolve,100));await new Promise(resolve=>setTimeout(resolve,320));s.calls=0;s.branchStartedAt=0;s.branchResolvedAt=0;s.editor.setCursor(s.target);s.cm.dispatch({selection:{anchor:s.cm.state.selection.main.head}});const snapshot=()=>{const widgetEl=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-widget'),overlayEl=widgetEl?.querySelector('.obcc-editor-autocomplete-overlay'),ghostEl=overlayEl?.querySelector('.obcc-editor-autocomplete-ghost'),widgetStyle=widgetEl?s.doc.defaultView.getComputedStyle(widgetEl):null,overlayStyle=overlayEl?s.doc.defaultView.getComputedStyle(overlayEl):null,ghostStyle=ghostEl?s.doc.defaultView.getComputedStyle(ghostEl):null;return {ghost:ghostEl?.textContent||'',position:s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-position')?.textContent||'',widgetDisplay:widgetStyle?.display||'',widgetWidth:widgetStyle?.width||'',overlayPosition:overlayStyle?.position||'',overlayWidth:overlayStyle?.width||'',ghostDisplay:ghostStyle?.display||'',whiteSpace:ghostStyle?.whiteSpace||'',textOverflow:ghostStyle?.textOverflow||'',calls:s.calls,branchStartedAt:s.branchStartedAt,branchResolvedAt:s.branchResolvedAt,hasFocus:s.cm.hasFocus,documentFocus:s.doc.hasFocus(),documentUntouched:s.editor.getValue()===s.before}};const started=Date.now(),deadline=started+10000;let initial=null,initialAt=0,rotated=null;while(Date.now()<deadline){const current=snapshot();if(!initial&&current.position==='1/3'){initial=current;initialAt=Date.now()}if(initial&&current.position==='2/3'){rotated=current;break}await new Promise(resolve=>setTimeout(resolve,80))}let manual=null,paused=null,menuFound=false;if(rotated){const apply=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-apply');apply?.dispatchEvent(new s.doc.defaultView.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));await new Promise(resolve=>setTimeout(resolve,80));const nextTitle=p.t('autocompleteNext'),nextItem=Array.from(s.doc.querySelectorAll('.menu-item')).find(item=>(item.textContent||'').includes(nextTitle));menuFound=!!nextItem;if(nextItem){nextItem.click();await new Promise(resolve=>setTimeout(resolve,120));manual=snapshot();await new Promise(resolve=>setTimeout(resolve,2400));paused=snapshot()}}const last=snapshot();return JSON.stringify({initial,rotated,manual,paused,last,menuFound,elapsedMs:Date.now()-started,rotationMs:initialAt&&rotated?Date.now()-initialAt:0,rootDisplayedBeforePrefetch:!!initial&&initial.branchResolvedAt===0,manualStopsRotation:!!manual&&manual.position==='3/3'&&paused?.position==='3/3'&&manual.ghost===paused.ghost})})()
'@
    $blockCode = @'
(async()=>{const p=app.plugins.plugins.cancip,s=p?.__editorAutocompleteSmoke;if(!s)throw new Error('autocomplete smoke state unavailable');const text=s.editor.getLine(s.target.line)||'',blocker=Math.max(0,text.search(/\S/)),line=s.cm.state.doc.line(s.target.line+1),blockedPos=line.from+blocker;s.callsBeforeBlocked=s.calls;s.cm.focus();s.cm.dispatch({selection:{anchor:blockedPos}});await new Promise((resolve)=>setTimeout(resolve,250));return JSON.stringify({ok:true,blocker,callsBeforeBlocked:s.callsBeforeBlocked,ghost:s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-ghost')?.textContent||'',calls:s.calls,documentUntouched:s.editor.getValue()===s.before})})()
'@
    $blockedSnapshotCode = @'
(()=>{const p=app.plugins.plugins.cancip,s=p?.__editorAutocompleteSmoke;if(!s)throw new Error('autocomplete smoke state unavailable');return JSON.stringify({ghost:s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-ghost')?.textContent||'',calls:s.calls,callsBeforeBlocked:s.callsBeforeBlocked,documentUntouched:s.editor.getValue()===s.before})})()
'@
    $applyPrefetchedCode = @'
(async()=>{
  const p=app.plugins.plugins.cancip,s=p?.__editorAutocompleteSmoke;
  if(!p||!s)throw new Error('autocomplete smoke state unavailable');
  s.cm.focus();
  let position=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-position')?.textContent||'';
  const ghost=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-ghost'),button=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-apply'),candidate=ghost?.textContent||'',expected=s.branches.get(candidate)||[],preloaded=p.editorPrefetchedAutocompleteCandidates(`${s.prefix}${candidate}`,s.path),from=s.cm.state.selection.main.head,previewRects=ghost?Array.from(ghost.getClientRects()).filter((rect)=>rect.width>0&&rect.height>0).map((rect)=>({left:rect.left,top:rect.top})):[];
  button?.click();
  const inserted=s.cm.state.sliceDoc(from,from+candidate.length),cursor=s.cm.state.selection.main.head,nextGhost=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-ghost')?.textContent||'',nextPosition=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-position')?.textContent||'',line=s.cm.state.doc.lineAt(cursor),nextPrefix=line.text.slice(0,cursor-line.from),alias=p.editorPrefetchedAutocompleteCandidates(nextPrefix,s.path);
  let insertedRects=[];
  try{const start=s.cm.domAtPos(from),end=s.cm.domAtPos(from+candidate.length),range=s.doc.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);insertedRects=Array.from(range.getClientRects()).filter((rect)=>rect.width>0&&rect.height>0).map((rect)=>({left:rect.left,top:rect.top}))}catch{}
  const lineStarts=(rects)=>{const lines=[];for(const rect of [...rects].sort((a,b)=>a.top-b.top||a.left-b.left)){const line=lines.find((item)=>Math.abs(item.top-rect.top)<2);if(line)line.left=Math.min(line.left,rect.left);else lines.push({left:rect.left,top:rect.top})}return lines};
  const previewLines=lineStarts(previewRects),insertedLines=lineStarts(insertedRects);
  const firstRectAligned=previewLines.length>0&&insertedLines.length>0&&Math.abs(previewLines[0].left-insertedLines[0].left)<2&&Math.abs(previewLines[0].top-insertedLines[0].top)<3;
  const multilineAligned=previewLines.length>1&&insertedLines.length>1&&Math.abs(previewLines[1].left-insertedLines[1].left)<2;
  s.cm.dispatch({changes:{from,to:from+candidate.length,insert:''},selection:{anchor:from}});
  return JSON.stringify({selectedMultiline:candidate.includes('\n'),appliedExactly:inserted===candidate&&cursor===from+candidate.length,prefetchedImmediate:expected.length===3&&nextGhost===expected[0]&&nextPosition==='1/3'&&alias.join('|')===expected.join('|'),layoutAligned:firstRectAligned&&multilineAligned,documentRestored:s.editor.getValue()===s.before,candidate,position,expected,preloaded,nextGhost,nextPosition,alias,previewRects:previewRects.length,insertedRects:insertedRects.length,previewLines,insertedLines});
})()
'@
    $applyPendingCode = @'
(async()=>{const p=app.plugins.plugins.cancip,s=p?.__editorAutocompleteSmoke;if(!p||!s)throw new Error('autocomplete smoke state unavailable');p.editorAutocompleteBranchCache=new Map();p.editorAutocompleteBranchPrefetches=new Map();p.editorAutocompleteBranchPrefetchAttempts=new Set();let resolvedAt=0,calls=0;const requested=[];p.ensureEditorAutocompleteBranches=async(requestPrefix,_context,requestPath,selected)=>{const jobs=[];for(const [index,root] of selected.entries()){const completed=`${requestPrefix}${root}`,key=p.editorAutocompleteBranchKey(completed,requestPath),existing=p.editorAutocompleteBranchPrefetches.get(key);if(existing){jobs.push(existing);continue}calls+=1;requested.push(completed);const request=new Promise(resolve=>setTimeout(()=>{const children=s.branches.get(root)||[`待接${index+1}-A`,`待接${index+1}-B`,`待接${index+1}-C`];p.rememberEditorAutocompleteCandidateAlias(completed,requestPath,children);resolvedAt=Date.now();resolve(children)},1500));p.editorAutocompleteBranchPrefetches.set(key,request);jobs.push(request);void request.finally(()=>{if(p.editorAutocompleteBranchPrefetches.get(key)===request)p.editorAutocompleteBranchPrefetches.delete(key)})}await Promise.allSettled(jobs);return selected.filter(root=>p.editorPrefetchedAutocompleteCandidates(`${requestPrefix}${root}`,requestPath).length===3).length};s.cm.focus();s.editor.setCursor({line:s.target.line,ch:0});s.cm.dispatch({selection:{anchor:s.cm.state.selection.main.head}});await new Promise(resolve=>setTimeout(resolve,120));s.editor.setCursor(s.target);s.cm.dispatch({selection:{anchor:s.cm.state.selection.main.head}});const rootDeadline=Date.now()+3000;let ghost=null,position='';while(Date.now()<rootDeadline){ghost=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-ghost');position=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-position')?.textContent||'';if(ghost&&position==='1/3'&&p.editorAutocompleteBranchPrefetches.size>0)break;await new Promise(resolve=>setTimeout(resolve,40))}const candidate=ghost?.textContent||'',expected=s.branches.get(candidate)||[],button=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-apply'),from=s.cm.state.selection.main.head,clickedAt=Date.now();button?.click();const immediateGhost=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-ghost')?.textContent||'';const childDeadline=Date.now()+3500;let nextGhost='',nextPosition='';while(Date.now()<childDeadline){nextGhost=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-ghost')?.textContent||'';nextPosition=s.leaf.containerEl.querySelector('.obcc-editor-autocomplete-position')?.textContent||'';if(expected.length===3&&nextGhost===expected[0]&&nextPosition==='1/3')break;await new Promise(resolve=>setTimeout(resolve,40))}const inserted=s.cm.state.sliceDoc(from,from+candidate.length),rootRequests=s.roots.map(root=>requested.filter(value=>value===`${s.prefix}${root}`).length);s.cm.dispatch({changes:{from,to:from+candidate.length,insert:''},selection:{anchor:from}});return JSON.stringify({pendingAdopted:expected.length===3&&inserted===candidate&&immediateGhost!==expected[0]&&nextGhost===expected[0]&&nextPosition==='1/3'&&resolvedAt>=clickedAt,pendingDeduped:rootRequests.every(count=>count===1),documentRestored:s.editor.getValue()===s.before,candidate,expected,immediateGhost,nextGhost,nextPosition,waitMs:resolvedAt-clickedAt,calls,rootRequests})})()
'@
    $cleanupCode = @'
(async()=>{const p=app.plugins.plugins.cancip,s=p?.__editorAutocompleteSmoke;if(!p||!s)return JSON.stringify({ok:true,cleaned:false});s.active=false;s.editor.setCursor(s.oldCursor);p.settings.composerAutocompleteEnabled=s.old.enabled;p.settings.composerAutocompletePrefetchEnabled=s.old.prefetch;p.settings.composerAutocompleteCandidateCount=s.old.count;p.settings.composerAutocompleteRotationSeconds=s.old.rotation;p.editorLocalAutocompleteSuffix=s.old.local;p.editorAutocompleteCandidates=s.old.model;p.ensureEditorAutocompleteBranches=s.old.ensure;p.isEditorAutocompleteViewActive=s.old.isActive;p.editorAutocompleteCache=s.old.cache;p.editorAutocompleteBranchCache=s.old.branchCache;p.editorAutocompleteBranchPrefetches=s.old.prefetches;p.editorAutocompleteBranchPrefetchAttempts=s.old.attempts;delete p.__editorAutocompleteSmoke;return JSON.stringify({ok:true,cleaned:true})})()
'@
    $availabilityCode = @'
(()=>{const visible=(item)=>{const cm=item?.view?.editor?.cm;if(!cm)return false;const rect=cm.contentDOM.getBoundingClientRect();return cm.dom.isConnected&&rect.width>=120&&rect.height>=80};return JSON.stringify({available:visible(app.workspace.activeLeaf)||app.workspace.getLeavesOfType('markdown').some(visible)})})()
'@
    $availability = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $availabilityCode) -TimeoutSeconds 12
    if (-not $availability.available) { throw 'SKIP: No visible Markdown editor at least 120px wide' }
    Write-Host 'editor autocomplete mounted stage: setup'
    $setup = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $setupCode) -TimeoutSeconds 20
    if ($setup.skip) { throw "SKIP: $($setup.reason)" }
    try {
      Write-Host 'editor autocomplete mounted stage: rotation/manual pause'
      $rotation = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $rotationCode) -TimeoutSeconds 30
      $initial = $rotation.initial
      $rotated = $rotation.rotated
      $rotationElapsedMs = [int]$rotation.rotationMs
      Write-Host 'editor autocomplete mounted stage: apply prefetched'
      $applied = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $applyPrefetchedCode) -TimeoutSeconds 12
      Write-Host 'editor autocomplete mounted stage: apply pending'
      $pendingApplied = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $applyPendingCode) -TimeoutSeconds 12
      Write-Host 'editor autocomplete mounted stage: following text guard'
      $blocked = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $blockCode) -TimeoutSeconds 12
    } finally {
      Write-Host 'editor autocomplete mounted stage: cleanup'
      Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $cleanupCode) -TimeoutSeconds 20 | Out-Null
    }
    $item = [pscustomobject]@{
      mountedSuggestion = $initial.ghost -eq "第一项`n完整补全" -and $initial.position -eq '1/3'
      rotatesCandidates = $rotated.ghost -eq "第二项`n包含换行" -and $rotated.position -eq '2/3'
      rotationUsesSetting = $rotationElapsedMs -ge 1200 -and $rotationElapsedMs -le 4000
      rootDisplayedBeforePrefetch = $rotation.rootDisplayedBeforePrefetch
      manualStopsRotation = $rotation.manualStopsRotation
      multilineComplete = ([string]$rotated.ghost).Contains("`n") -and $initial.whiteSpace -eq 'pre-wrap' -and $initial.textOverflow -ne 'ellipsis'
      inlineTextFlow = $initial.widgetDisplay -eq 'inline-block' -and $initial.widgetWidth -eq '0px' -and $initial.overlayPosition -eq 'absolute' -and $initial.ghostDisplay -eq 'inline'
      selectedMultiline = $applied.selectedMultiline
      prefetchedImmediate = $applied.prefetchedImmediate
      pendingPrefetchAdopted = $pendingApplied.pendingAdopted
      pendingPrefetchDeduped = $pendingApplied.pendingDeduped
      appliedExactly = $applied.appliedExactly
      autocompleteLayoutAligned = $applied.layoutAligned
      applyRestoredDocument = $applied.documentRestored
      rotatedGhost = $rotated.ghost
      rotatedPosition = $rotated.position
      appliedCandidate = $applied.candidate
      appliedPosition = $applied.position
      prefetchedBeforeApply = ($applied.preloaded -join '|')
      nextGhostAfterApply = $applied.nextGhost
      nextPositionAfterApply = $applied.nextPosition
      aliasedAfterApply = ($applied.alias -join '|')
      previewRectCount = $applied.previewRects
      insertedRectCount = $applied.insertedRects
      blockedGhost = $blocked.ghost
      blockedCalls = $blocked.calls
      blockedCallsBefore = $blocked.callsBeforeBlocked
      previewLineGeometry = ($applied.previewLines | ConvertTo-Json -Compress)
      insertedLineGeometry = ($applied.insertedLines | ConvertTo-Json -Compress)
      blockedByFollowingText = $blocked.ghost -eq ''
      documentUntouched = $initial.documentUntouched -and $pendingApplied.documentRestored -and $blocked.documentUntouched
    }
    foreach ($field in @('mountedSuggestion','rotatesCandidates','rotationUsesSetting','rootDisplayedBeforePrefetch','manualStopsRotation','multilineComplete','inlineTextFlow','selectedMultiline','prefetchedImmediate','pendingPrefetchAdopted','pendingPrefetchDeduped','appliedExactly','autocompleteLayoutAligned','applyRestoredDocument','documentUntouched')) {
      if (-not [bool]$item.$field) { throw "mounted editor autocomplete failed: $field; $($item | ConvertTo-Json -Compress -Depth 8)" }
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.editor-autocomplete-mounted'; pass = $true; elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds }
  } catch {
    if ($_.Exception.Message -match '^SKIP:') {
      Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.editor-autocomplete-mounted'; skip = $true; reason = ($_.Exception.Message -replace '^SKIP:\s*', '') }
    } else {
      Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.editor-autocomplete-mounted'; pass = $false; error = $_.Exception.Message }
    }
  }
}

if (Should-RunProgrammaticCase 'programmatic.code-block-wrap-global-persistence') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=app.workspace.getLeavesOfType('cancip-view')[0]?.view;
  if(!p||!v)throw new Error('Cancip view unavailable');
  if(typeof v.renderMarkdown!=='function'||typeof v.syncRenderedCodeBlockWrap!=='function')throw new Error('code block wrap API unavailable');
  const oldSetting=p.settings.codeBlockWrap===true;
  const oldSaveSettings=p.saveSettings;
  let saveCalls=0;
  const savedValues=[];
  p.saveSettings=async function(){saveCalls+=1;savedValues.push(this.settings.codeBlockWrap===true)};
  const wait=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
  const root=v.contentEl.createDiv({cls:'obcc-content markdown-rendered obcc-code-wrap-smoke'});
  Object.assign(root.style,{position:'fixed',left:'-10000px',top:'0',width:'320px',maxWidth:'320px',contain:'layout style paint'});
  const fence=String.fromCharCode(96).repeat(3);
  const nl=String.fromCharCode(10);
  try{
    p.settings.codeBlockWrap=false;
    v.renderMarkdown(root,[fence,'abcdefghij'.repeat(12),fence].join(nl));
    await wait(500);
    const block=root.querySelector('pre.obcc-code-pre');
    const actions=block?.parentElement?.querySelector(':scope > .obcc-code-action-layer');
    const copy=actions?.querySelector(':scope > .copy-code-button:not(.obcc-code-wrap-toggle)');
    const wrap=actions?.querySelector(':scope > .obcc-code-wrap-toggle');
    const initialUnwrapped=!!block?.classList.contains('is-nowrap')&&!block?.classList.contains('is-wrapped');
    const clickStarted=Date.now();
    wrap?.click();
    const clickElapsed=Date.now()-clickStarted;
    const wrapped=!!block?.classList.contains('is-wrapped')&&!block?.classList.contains('is-nowrap')&&wrap?.getAttribute('aria-pressed')==='true';
    return JSON.stringify({
      id:'programmatic.code-block-wrap-global-persistence',
      elapsedMs:Date.now()-t,
      controls:!!block&&!!actions&&!!copy&&!!wrap&&copy.nextElementSibling===wrap,
      initialUnwrapped,
      wrapped,
      clickElapsed,
      saveCalls,
      savedValues
    });
  } finally {
    root.remove();
    p.saveSettings=oldSaveSettings;
    p.settings.codeBlockWrap=oldSetting;
    p.syncAllCodeBlockWrap();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 20
    if (-not $item.controls) { throw "code block controls are incomplete or not adjacent: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.initialUnwrapped) { throw "default code blocks are not unwrapped: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.wrapped -or [int]$item.clickElapsed -gt 80) { throw "wrap toggle did not update immediately: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.saveCalls -ne 1 -or @($item.savedValues).Count -ne 1 -or -not $item.savedValues[0]) { throw "wrap selection did not use the persistent save path: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; clickElapsed = $item.clickElapsed }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.code-block-wrap-global-persistence'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.note-code-block-wrap-global-persistence') {
  try {
    $setupCode = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p||typeof p.enhanceNoteCodeBlocks!=='function'||typeof p.syncAllCodeBlockWrap!=='function')throw new Error('note code wrap API unavailable');
  const previousActiveLeaf=app.workspace.activeLeaf??null;
  const leaf=app.workspace.getLeavesOfType('markdown').find((item)=>item.view?.editor?.cm);
  if(!leaf)throw new Error('mounted Markdown leaf unavailable');
  await app.workspace.setActiveLeaf(leaf,{focus:true});
  await new Promise((resolve)=>setTimeout(resolve,80));
  const doc=leaf.containerEl.ownerDocument;
  const surfaces=Array.from(leaf.containerEl.querySelectorAll('.markdown-preview-view, .markdown-source-view'));
  const surface=surfaces.find((candidate)=>{const rect=candidate.getBoundingClientRect(),style=getComputedStyle(candidate);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'})||surfaces[0];
  if(!surface)throw new Error('mounted Markdown note surface unavailable');
  const oldSetting=p.settings.codeBlockWrap===true;
  const oldSaveSettings=p.saveSettings;
  const savedValues=[];
  p.saveSettings=function(){savedValues.push(this.settings.codeBlockWrap===true);return Promise.resolve()};
  p.settings.codeBlockWrap=false;
  p.syncAllCodeBlockWrap();
  const host=doc.createElement('div');
  host.className='obcc-note-code-wrap-smoke';
  host.style.position='fixed';
  host.style.left='-10000px';
  host.style.top='0';
  host.style.width='320px';
  host.style.maxWidth='320px';
  host.style.contain='layout style paint';
  const pre=doc.createElement('pre');
  const code=doc.createElement('code');
  code.textContent='abcdefghij'.repeat(12);
  const copy=doc.createElement('button');
  copy.type='button';
  copy.className='copy-code-button';
  copy.dataset.noteSmokeNative='1';
  pre.append(code,copy);
  host.append(pre);
  surface.append(host);
  p.enhanceNoteCodeBlocks(host);
  const actionLayer=pre.parentElement?.querySelector(':scope > .obcc-code-action-layer');
  const wrap=actionLayer?.querySelector(':scope > .obcc-note-code-wrap-toggle');
  const buttons=Array.from(actionLayer?.querySelectorAll(':scope > button.copy-code-button')||[]);
  const copyRect=copy.getBoundingClientRect(),wrapRect=wrap?.getBoundingClientRect(),preRect=pre.getBoundingClientRect();
  const actionsDoNotOverlap=!!wrapRect&&(copyRect.right<=wrapRect.left||wrapRect.right<=copyRect.left||copyRect.bottom<=wrapRect.top||wrapRect.bottom<=copyRect.top);
  const actionsInside=!!wrapRect&&copyRect.left>=preRect.left&&copyRect.right<=preRect.right&&wrapRect.left>=preRect.left&&wrapRect.right<=preRect.right;
  pre.scrollLeft=Math.max(0,pre.scrollWidth-pre.clientWidth);
  const scrolledCopyRect=copy.getBoundingClientRect(),scrolledWrapRect=wrap?.getBoundingClientRect();
  const actionsFixed=!!scrolledWrapRect&&Math.abs(scrolledCopyRect.left-copyRect.left)<1&&Math.abs(scrolledWrapRect.left-wrapRect.left)<1;
  const scrollLeft=pre.scrollLeft,scrollVar=pre.style.getPropertyValue('--obcc-code-action-scroll-x'),copyTransform=getComputedStyle(copy).transform,wrapTransform=wrap?getComputedStyle(wrap).transform:'',copyDelta=scrolledCopyRect.left-copyRect.left,wrapDelta=scrolledWrapRect?scrolledWrapRect.left-wrapRect.left:0;
  pre.scrollLeft=0;
  window.__noteCodeWrapSmoke={t,p,leaf,previousActiveLeaf,host,pre,copy,wrap,oldSetting,oldSaveSettings,savedValues,roots:[host]};
  return JSON.stringify({
    nativePreserved:copy.isConnected&&copy.parentElement===actionLayer,
    adjacent:buttons.length===2&&buttons[0]===copy&&buttons[1]===wrap,
    actionsDoNotOverlap,
    actionsInside,
    actionsFixed,
    actionsOutsideScroller:actionLayer?.parentElement===pre.parentElement&&actionLayer?.parentElement!==pre,
    scrollLeft,
    scrollVar,
    copyTransform,
    wrapTransform,
    copyDelta,
    wrapDelta,
    copyWidth:copyRect.width,
    wrapWidth:wrapRect?.width||0,
    initialUnwrapped:pre.classList.contains('is-nowrap')&&!pre.classList.contains('is-wrapped')
  });
})()
'@
    Write-Host 'note code wrap stage: setup'
    $setup = Invoke-CancipEval -Code $setupCode -TimeoutSeconds 30

    $toggleCode = @'
(()=>{
  const s=window.__noteCodeWrapSmoke;
  if(!s)throw new Error('note wrap smoke state missing');
  s.wrap?.click();
  const later=activeDocument.createElement('pre');
  const code=activeDocument.createElement('code');
  code.textContent='klmnopqrst'.repeat(12);
  later.append(code);
  s.host.append(later);
  Object.assign(s,{later});
  return JSON.stringify({
    wrapped:s.pre.classList.contains('is-wrapped')&&s.wrap?.getAttribute('aria-pressed')==='true',
    setting:s.p.settings.codeBlockWrap===true
  });
})()
'@
    Write-Host 'note code wrap stage: toggle'
    $toggle = Invoke-CancipEval -Code $toggleCode -TimeoutSeconds 20

    $observeCode = @'
(()=>{
  const s=window.__noteCodeWrapSmoke;
  if(!s?.later)throw new Error('later note block missing');
  const later=s.later;
  const laterActions=later.parentElement?.querySelector(':scope > .obcc-code-action-layer');
  const laterWrap=laterActions?.querySelector(':scope > .obcc-note-code-wrap-toggle');
  const fallback=laterActions?.querySelector(':scope > .obcc-note-code-copy-fallback');
  Object.assign(s,{later,laterWrap,fallback});
  const native=activeDocument.createElement('button');
  native.type='button';
  native.className='copy-code-button';
  native.dataset.noteSmokeNative='2';
  later.append(native);
  s.native=native;
  return JSON.stringify({
    laterInherited:later.classList.contains('is-wrapped')&&laterWrap?.getAttribute('aria-pressed')==='true',
    fallbackCreated:!!fallback
  });
})()
'@
    Write-Host 'note code wrap stage: observe'
    $observe = Invoke-CancipEval -Code $observeCode -TimeoutSeconds 20

    $finishCode = @'
(()=>{
  const s=window.__noteCodeWrapSmoke;
  if(!s?.later||!s.native)throw new Error('later note block state missing');
  const actionLayer=s.later.parentElement?.querySelector(':scope > .obcc-code-action-layer');
  const copies=Array.from(actionLayer?.querySelectorAll(':scope > button.copy-code-button:not(.obcc-code-wrap-toggle)')||[]);
  const foreignLeaf=activeDocument.createElement('div');
  foreignLeaf.className='workspace-leaf-content obcc-note-code-wrap-foreign-smoke';
  foreignLeaf.dataset.type='pdf';
  const foreignSurface=activeDocument.createElement('div');
  foreignSurface.className='markdown-preview-view markdown-rendered';
  const foreignPre=activeDocument.createElement('pre');
  foreignPre.append(activeDocument.createElement('code'),activeDocument.createElement('button'));
  foreignSurface.append(foreignPre);
  foreignLeaf.append(foreignSurface);
  s.roots.push(foreignLeaf);
  s.p.enhanceNoteCodeBlocks(foreignSurface);
  s.laterWrap?.click();
  return JSON.stringify({
    fallbackReplaced:!!s.fallback&&!s.fallback.isConnected&&copies.length===1&&copies[0]===s.native&&s.native.nextElementSibling===s.laterWrap,
    foreignUntouched:!foreignPre.classList.contains('obcc-note-code-pre')&&!foreignPre.querySelector('.obcc-code-wrap-toggle'),
    disabled:[s.pre,s.later].every(pre=>pre.classList.contains('is-nowrap')&&!pre.classList.contains('is-wrapped')),
    setting:s.p.settings.codeBlockWrap===false,
    savedValues:s.savedValues,
    elapsedMs:Date.now()-s.t
  });
})()
'@
    Write-Host 'note code wrap stage: finish'
    $finish = Invoke-CancipEval -Code $finishCode -TimeoutSeconds 20

    $item = [pscustomobject]@{
      id = 'programmatic.note-code-block-wrap-global-persistence'
      elapsedMs = [int]$finish.elapsedMs
      nativePreserved = $setup.nativePreserved
      adjacent = $setup.adjacent
      actionsDoNotOverlap = $setup.actionsDoNotOverlap
      actionsInside = $setup.actionsInside
      actionsFixed = $setup.actionsFixed
      scrollLeft = $setup.scrollLeft
      scrollVar = $setup.scrollVar
      copyTransform = $setup.copyTransform
      wrapTransform = $setup.wrapTransform
      copyDelta = $setup.copyDelta
      wrapDelta = $setup.wrapDelta
      copyWidth = $setup.copyWidth
      wrapWidth = $setup.wrapWidth
      initialUnwrapped = $setup.initialUnwrapped
      wrapped = $toggle.wrapped
      laterInherited = $observe.laterInherited
      fallbackCreated = $observe.fallbackCreated
      fallbackReplaced = $finish.fallbackReplaced
      foreignUntouched = $finish.foreignUntouched
      disabled = $finish.disabled
      savedValues = @($finish.savedValues)
    }
    if (-not $item.nativePreserved -or -not $item.adjacent) { throw "note native Copy was replaced or wrap is not adjacent: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if (-not $item.actionsDoNotOverlap -or -not $item.actionsInside) { throw "note Copy/Wrap actions overlap or escape the code block: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if (-not $item.actionsFixed) { throw "note Copy/Wrap actions moved with horizontal scrolling: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if (-not $setup.actionsOutsideScroller -or $item.scrollVar -or $item.copyTransform -ne 'none' -or $item.wrapTransform -ne 'none') { throw "note Copy/Wrap actions still rely on delayed scroll compensation: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if ([math]::Abs([double]$item.copyWidth - 26) -gt 1 -or [math]::Abs([double]$item.wrapWidth - 26) -gt 1) { throw "note Copy/Wrap actions are not fixed 26px controls: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if (-not $item.initialUnwrapped -or -not $item.wrapped) { throw "note wrap did not toggle from nowrap to wrapped: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if (-not $item.laterInherited -or -not $item.fallbackCreated -or -not $item.fallbackReplaced) { throw "later note block did not inherit wrap or reconcile native Copy: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if (-not $item.foreignUntouched) { throw "non-Markdown leaf received note code controls: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if (-not $item.disabled) { throw "disabling wrap did not synchronize note code blocks: $($item | ConvertTo-Json -Compress -Depth 8)" }
    if (@($item.savedValues).Count -ne 2 -or -not $item.savedValues[0] -or $item.savedValues[1]) { throw "note wrap did not persist true then false: $($item | ConvertTo-Json -Compress -Depth 8)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.note-code-block-wrap-global-persistence'; pass = $false; error = $_.Exception.Message }
  } finally {
    try {
      $null = Invoke-CancipEval -TimeoutSeconds 25 -Code @'
(async()=>{const s=window.__noteCodeWrapSmoke;if(!s)return JSON.stringify({clean:true});for(const root of s.roots||[])root.remove();s.p.saveSettings=s.oldSaveSettings;s.p.settings.codeBlockWrap=s.oldSetting;s.p.syncAllCodeBlockWrap();delete window.__noteCodeWrapSmoke;if(s.previousActiveLeaf&&s.previousActiveLeaf!==s.leaf)await app.workspace.setActiveLeaf(s.previousActiveLeaf,{focus:true});return JSON.stringify({clean:true})})()
'@
    } catch {
      Write-Host "Note code wrap smoke cleanup warning: $($_.Exception.Message)"
    }
  }
}

if (Should-RunProgrammaticCase 'programmatic.code-block-wrap-layout') {
  try {
    $layoutSetupCode = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=app.workspace.getLeavesOfType('cancip-view')[0]?.view;
  if(!p||!v||typeof v.renderMarkdown!=='function'||typeof v.syncCodeBlockWrapState!=='function')throw new Error('code block layout API unavailable');
  const root=activeDocument.createElement('div');
  root.className='obcc-content markdown-rendered obcc-code-wrap-layout-smoke';
  root.style.position='fixed';
  root.style.left='-10000px';
  root.style.top='0';
  root.style.width='320px';
  root.style.maxWidth='320px';
  root.style.contain='layout style paint';
  activeDocument.body.appendChild(root);
  const fence=String.fromCharCode(96).repeat(3);
  const nl=String.fromCharCode(10);
  const line='abcdefghij'.repeat(12);
  v.renderMarkdown(root,[fence,line,fence].join(nl));
  window.__codeBlockWrapLayoutSmoke={t,v,root};
  return JSON.stringify({mounted:root.isConnected});
})()
'@
    $layoutSetup = Invoke-CancipEval -Code $layoutSetupCode -TimeoutSeconds 20
    if (-not $layoutSetup.mounted) { throw 'code block layout root did not mount' }

    $layoutInspectCode = @'
(()=>{
  const s=window.__codeBlockWrapLayoutSmoke;
  if(!s)throw new Error('code block layout smoke state missing');
  try{
    const {t,v,root}=s;
    const pre=root.querySelector('pre.obcc-code-pre');
    if(!pre)throw new Error('rendered code block missing');
    const actionLayer=pre.parentElement?.querySelector(':scope > .obcc-code-action-layer');
    const copy=actionLayer?.querySelector(':scope > .copy-code-button:not(.obcc-code-wrap-toggle)');
    const wrap=actionLayer?.querySelector(':scope > .obcc-code-wrap-toggle');
    if(!copy||!wrap)throw new Error('code block action buttons missing');
    v.syncCodeBlockWrapState(pre,false);
    const copyRect=copy.getBoundingClientRect(),wrapRect=wrap.getBoundingClientRect(),preRect=pre.getBoundingClientRect();
    const actionsDoNotOverlap=copyRect.right<=wrapRect.left||wrapRect.right<=copyRect.left||copyRect.bottom<=wrapRect.top||wrapRect.bottom<=copyRect.top;
    const actionsInside=copyRect.left>=preRect.left&&copyRect.right<=preRect.right&&wrapRect.left>=preRect.left&&wrapRect.right<=preRect.right;
    const initial={
      whiteSpace:getComputedStyle(pre).whiteSpace,
      overflowX:getComputedStyle(pre).overflowX,
      scrollWidth:pre.scrollWidth,
      clientWidth:pre.clientWidth
    };
    pre.scrollLeft=Math.max(0,pre.scrollWidth-pre.clientWidth);
    const scrolledCopyRect=copy.getBoundingClientRect(),scrolledWrapRect=wrap.getBoundingClientRect();
    const actionsFixed=Math.abs(scrolledCopyRect.left-copyRect.left)<1&&Math.abs(scrolledWrapRect.left-wrapRect.left)<1;
    pre.scrollLeft=0;
    v.syncCodeBlockWrapState(pre,true);
    const wrapped={
      whiteSpace:getComputedStyle(pre).whiteSpace,
      overflowX:getComputedStyle(pre).overflowX,
      scrollWidth:pre.scrollWidth,
      clientWidth:pre.clientWidth
    };
    return JSON.stringify({id:'programmatic.code-block-wrap-layout',elapsedMs:Date.now()-t,initial,wrapped,actionsDoNotOverlap,actionsInside,actionsFixed,actionsOutsideScroller:actionLayer?.parentElement===pre.parentElement&&actionLayer?.parentElement!==pre,copyTransform:getComputedStyle(copy).transform,wrapTransform:getComputedStyle(wrap).transform,copyWidth:copyRect.width,wrapWidth:wrapRect.width});
  } finally {
    s.root.remove();
    delete window.__codeBlockWrapLayoutSmoke;
  }
})()
'@
    $item = Invoke-CancipEval -Code $layoutInspectCode -TimeoutSeconds 20
    if ([string]$item.initial.whiteSpace -ne 'pre' -or [string]$item.initial.overflowX -ne 'auto') { throw "default code layout is not horizontal-scroll mode: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.initial.scrollWidth -le [int]$item.initial.clientWidth) { throw "default code did not produce a horizontal scroll range: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.wrapped.whiteSpace -ne 'pre-wrap') { throw "wrapped code did not use pre-wrap: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.wrapped.scrollWidth -gt ([int]$item.wrapped.clientWidth + 2)) { throw "wrapped code still overflows horizontally: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.actionsDoNotOverlap -or -not $item.actionsInside) { throw "code Copy/Wrap actions overlap or escape the code block: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.actionsFixed) { throw "code Copy/Wrap actions moved with horizontal scrolling: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.actionsOutsideScroller -or $item.copyTransform -ne 'none' -or $item.wrapTransform -ne 'none') { throw "code Copy/Wrap actions still rely on delayed scroll compensation: $($item | ConvertTo-Json -Compress)" }
    if ([math]::Abs([double]$item.copyWidth - 26) -gt 1 -or [math]::Abs([double]$item.wrapWidth - 26) -gt 1) { throw "code Copy/Wrap actions are not fixed 26px controls: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; scrollWidth = $item.initial.scrollWidth; clientWidth = $item.initial.clientWidth }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.code-block-wrap-layout'; pass = $false; error = $_.Exception.Message }
  } finally {
    try {
      $null = Invoke-CancipEval -TimeoutSeconds 20 -Code @'
(()=>{const s=window.__codeBlockWrapLayoutSmoke;if(s?.root)s.root.remove();activeDocument.querySelectorAll('.obcc-code-wrap-layout-smoke').forEach(root=>root.remove());delete window.__codeBlockWrapLayoutSmoke;return JSON.stringify({clean:true})})()
'@
    } catch {
      Write-Host "Code block layout smoke cleanup warning: $($_.Exception.Message)"
    }
  }
}

if (-not $Case -or 'programmatic.choice-cards-render-at-message-bottom'.Contains($Case)) {
  try {
    $choiceBottomContent = @'
Completed smoke layout test.

```json
{"type":"read","path":"Smoke.md"}
```

<!-- cancip-choices {"choices":["Open smoke report","Verify card order","Test folded details"]} -->
'@
    $choiceBottomJson = $choiceBottomContent | ConvertTo-Json -Compress
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldMessages=(v.messages||[]).slice();
  const oldActive=v.activeRequest;
  try{
    v.activeRequest=null;
    v.userInteractingWithMessages=false;
    v.pendingMessageRender=false;
    if(v.messageInteractionIdleTimer!==null){clearTimeout(v.messageInteractionIdleTimer);v.messageInteractionIdleTimer=null;}
    if(typeof v.cancelScheduledMessageRender==='function')v.cancelScheduledMessageRender();
    const choiceContent=__CHOICE_BOTTOM_CONTENT__;
    v.messages=[{id:'smoke-choice-bottom',role:'assistant',createdAt:Date.now(),content:choiceContent}];
    v.renderMessages();
    const tool=v.messagesEl?.querySelector('.obcc-tool-json');
    const choices=v.messagesEl?.querySelector('.obcc-choice-cards');
    const parsedChoices=typeof v.choiceOptionsForMessage==='function'?v.choiceOptionsForMessage(choiceContent):[];
    const follows=!!(tool&&choices&&(tool.compareDocumentPosition(choices)&Node.DOCUMENT_POSITION_FOLLOWING));
    const lastClass=v.messagesEl?.querySelector('.obcc-message')?.lastElementChild?.className||'';
    return JSON.stringify({id:'programmatic.choice-cards-render-at-message-bottom',elapsedMs:Date.now()-t,hasTool:!!tool,hasChoices:!!choices,parsedChoices:parsedChoices.length,follows,lastClass:String(lastClass)});
  } finally {
    v.messages=oldMessages;
    v.activeRequest=oldActive;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $code = $code.Replace('__CHOICE_BOTTOM_CONTENT__', $choiceBottomJson)
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.parsedChoices -ne 3) { throw "structured choices did not parse exactly three: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.hasTool -or -not $item.hasChoices) { throw "test did not render both folded detail and choices: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.follows) { throw "choice cards are not after folded details: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.lastClass -notmatch 'obcc-choice-cards') { throw "choice cards are not the last block in the message: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.choice-cards-render-at-message-bottom'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-sort-filters') {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.setAttribute('data-cancip-smoke','sort-filter');
  root.style.position='fixed';
  root.style.left='8px';
  root.style.top='8px';
  root.style.zIndex='-1';
  root.innerHTML=[
    '<div class="cancip-smoke-persistent"><button id="cancip-sort-smoke-a">A</button><button id="cancip-sort-smoke-b">B</button></div>',
    '<div class="markdown-embed"><div class="markdown-embed-content"><button id="cancip-sort-smoke-embed-a">EA</button><button id="cancip-sort-smoke-embed-b">EB</button></div></div>',
    '<div class="obcc-history-popover is-more"><div class="obcc-management-body"><button id="cancip-sort-smoke-more-a">MA</button><button id="cancip-sort-smoke-more-b">MB</button></div></div>',
    '<div class="obcc-history-popover is-history"><button id="cancip-sort-smoke-history-a">HA</button><button id="cancip-sort-smoke-history-b">HB</button></div>',
    '<div class="menu"><div class="menu-item" data-command="smoke-native-a" id="cancip-sort-smoke-native-menu-a"><div class="menu-item-title">NMA</div></div><div class="menu-item" data-command="smoke-native-b" id="cancip-sort-smoke-native-menu-b"><div class="menu-item-title">NMB</div></div></div>'
  ].join('');
  doc.body.appendChild(root);
  try{
    const persistent=root.querySelector('.cancip-smoke-persistent');
    const embed=root.querySelector('.markdown-embed-content');
    const more=root.querySelector('.obcc-history-popover.is-more .obcc-management-body');
    const history=root.querySelector('.obcc-history-popover.is-history');
    const nativeMenu=root.querySelector('.menu');
    const persistentChildren=p.sortableUiButtonChildren(persistent).length;
    const embedChildren=p.sortableUiButtonChildren(embed).length;
    const moreChildren=p.sortableUiButtonChildren(more).length;
    const historyChildren=p.sortableUiButtonChildren(history).length;
    const nativeMenuChildren=p.sortableUiButtonChildren(nativeMenu).length;
    const embedExcluded=p.isUiButtonSortExcludedTarget(root.querySelector('#cancip-sort-smoke-embed-a'));
    const moreExcluded=p.isUiButtonSortExcludedTarget(root.querySelector('#cancip-sort-smoke-more-a'));
    const historyExcluded=p.isUiButtonSortExcludedTarget(root.querySelector('#cancip-sort-smoke-history-a'));
    const nativeMenuExcluded=p.isUiButtonSortExcludedTarget(root.querySelector('#cancip-sort-smoke-native-menu-a'));
    return JSON.stringify({id:'programmatic.ui-button-sort-filters',elapsedMs:Date.now()-t,persistentChildren,embedChildren,moreChildren,historyChildren,nativeMenuChildren,embedExcluded,moreExcluded,historyExcluded,nativeMenuExcluded});
  } finally {
    root.remove();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.persistentChildren -lt 2) { throw "persistent sibling buttons were not sortable: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.embedChildren -ne 0 -or -not $item.embedExcluded) { throw "file embed buttons are still sortable: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.moreChildren -lt 2 -or $item.moreExcluded) { throw "more-panel buttons were not sortable: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.historyChildren -ne 0 -or -not $item.historyExcluded) { throw "history-panel buttons are still sortable: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.nativeMenuChildren -lt 2 -or $item.nativeMenuExcluded) { throw "native note-more menu items were not sortable: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-sort-filters'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-sort-menu-snapshot') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.className='menu';
  root.style.position='fixed';
  root.style.left='12px';
  root.style.top='12px';
  root.style.zIndex='1000';
  root.style.width='260px';
  root.style.maxHeight='120px';
  root.style.overflowY='auto';
  const longItems=Array.from({length:56},(_,i)=>`<div class="menu-item" data-command="smoke-menu-extra-${i}" id="cancip-sort-snapshot-extra-${i}"><div class="menu-item-title">Extra item ${i}</div></div>`).join('');
  root.innerHTML=[
    '<div class="menu-section"><div class="menu-item" data-command="smoke-menu-a" id="cancip-sort-snapshot-a"><div class="menu-item-title">Duplicate Snapshot</div></div><div class="menu-item" data-command="smoke-menu-b" id="cancip-sort-snapshot-b"><div class="menu-item-title">Duplicate Snapshot</div></div></div>',
    '<div class="menu-separator"></div>',
    '<div class="menu-section"><div class="menu-item" data-command="smoke-menu-c" id="cancip-sort-snapshot-c"><div class="menu-item-title">Snapshot C</div></div><div class="menu-item" data-command="smoke-menu-d" id="cancip-sort-snapshot-d"><div class="menu-item-title">Snapshot D</div></div></div>',
    `<div class="menu-section">${longItems}</div>`
  ].join('');
  doc.body.appendChild(root);
  try{
    const target=root.querySelector('#cancip-sort-snapshot-b');
    const descriptor=p.describeUiButtonEditTarget(target);
    const snapshotCount=descriptor.sortSnapshot?.items?.length||0;
    root.remove();
    p.startUiButtonSortMode(descriptor);
    const stage=doc.querySelector('.obcc-ui-sort-snapshot-stage');
    const handles=doc.querySelectorAll('.obcc-ui-sort-handle').length;
    const stageItems=stage?stage.querySelectorAll('.obcc-ui-sort-snapshot-item').length:0;
    const done=doc.querySelector('.obcc-ui-sort-done');
    const stageCanScroll=stage?stage.scrollHeight>stage.clientHeight:false;
    const inlineHandles=doc.querySelectorAll('.obcc-ui-sort-inline-handle').length;
    let wheelScrollTop=0;
    if(stage){
      stage.scrollTop=0;
      stage.dispatchEvent(new WheelEvent('wheel',{deltaY:180,bubbles:true,cancelable:true}));
      await new Promise((resolve)=>setTimeout(resolve,80));
      wheelScrollTop=stage.scrollTop;
      stage.scrollTop=stage.scrollHeight;
      stage.dispatchEvent(new Event('scroll'));
      await new Promise((resolve)=>setTimeout(resolve,120));
    }
    const finalScrollTop=stage?stage.scrollTop:0;
    p.stopUiButtonSortMode();
    const stageAfter=!!doc.querySelector('.obcc-ui-sort-snapshot-stage');
    return JSON.stringify({id:'programmatic.ui-button-sort-menu-snapshot',elapsedMs:Date.now()-t,snapshotCount,hasStage:!!stage,stageItems,handles,inlineHandles,stageCanScroll,wheelScrollTop,finalScrollTop,done:!!done,stageAfter});
  } finally {
    root.remove();
    p.stopUiButtonSortMode?.();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ($item -is [string] -and $item.TrimStart().StartsWith('{')) { $item = $item | ConvertFrom-Json }
    if ($null -eq $item) { throw "empty eval result for menu sort snapshot" }
    if ([int]$item.snapshotCount -lt 60) { throw "menu sort snapshot did not collect complete long/scrolling menu: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.hasStage -or [int]$item.stageItems -lt 60 -or [int]$item.handles -lt 60) { throw "menu sort snapshot stage/handles missing: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.handles -ne [int]$item.stageItems) { throw "not every scrollable snapshot item received a sort handle: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.stageCanScroll) { throw "menu sort snapshot stage is not scrollable: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.wheelScrollTop -le 0) { throw "menu sort snapshot wheel fallback did not scroll: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.inlineHandles -ne [int]$item.stageItems) { throw "snapshot menu sort handles were not embedded in every scroll row: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.finalScrollTop -le 0) { throw "menu sort snapshot did not remain scrollable to the bottom: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.done) { throw "sort done control is not visible/clickable: $($item | ConvertTo-Json -Compress)" }
    if ($item.stageAfter) { throw "snapshot stage was not cleaned up: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-sort-menu-snapshot'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-sort-menu-snapshot-pointer-pan') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.className='menu';
  root.style.position='fixed';
  root.style.left='12px';
  root.style.top='12px';
  root.style.zIndex='1000';
  root.style.width='260px';
  root.style.maxHeight='120px';
  root.style.overflowY='auto';
  const longItems=Array.from({length:28},(_,i)=>`<div class="menu-item" data-command="smoke-menu-pointer-${i}" id="cancip-sort-pointer-${i}"><div class="menu-item-title">Pointer item ${i}</div></div>`).join('');
  root.innerHTML=`<div class="menu-section">${longItems}</div>`;
  doc.body.appendChild(root);
  try{
    const descriptor=p.describeUiButtonEditTarget(root.querySelector('#cancip-sort-pointer-3'));
    root.remove();
    p.startUiButtonSortMode(descriptor);
    const stage=doc.querySelector('.obcc-ui-sort-snapshot-stage');
    let pointerPanScrollTop=0;
    if(stage&&typeof PointerEvent!=='undefined'){
      stage.scrollTop=0;
      stage.dispatchEvent(new PointerEvent('pointerdown',{pointerId:812,clientY:140,bubbles:true,cancelable:true,pointerType:'touch'}));
      stage.dispatchEvent(new PointerEvent('pointermove',{pointerId:812,clientY:40,bubbles:true,cancelable:true,pointerType:'touch'}));
      stage.dispatchEvent(new PointerEvent('pointerup',{pointerId:812,clientY:40,bubbles:true,cancelable:true,pointerType:'touch'}));
      await new Promise((resolve)=>setTimeout(resolve,80));
      pointerPanScrollTop=stage.scrollTop;
    }
    p.stopUiButtonSortMode();
    return JSON.stringify({id:'programmatic.ui-button-sort-menu-snapshot-pointer-pan',elapsedMs:Date.now()-t,hasStage:!!stage,pointerAvailable:typeof PointerEvent!=='undefined',pointerPanScrollTop,stageAfter:!!doc.querySelector('.obcc-ui-sort-snapshot-stage')});
  } finally {
    root.remove();
    p.stopUiButtonSortMode?.();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 25
    if (-not $item.hasStage) { throw "pointer pan snapshot stage missing: $($item | ConvertTo-Json -Compress)" }
    if ($item.pointerAvailable -and [int]$item.pointerPanScrollTop -le 0) { throw "menu sort snapshot pointer pan fallback did not scroll: $($item | ConvertTo-Json -Compress)" }
    if ($item.stageAfter) { throw "pointer pan snapshot stage was not cleaned up: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-sort-menu-snapshot-pointer-pan'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-sort-menu-snapshot-touch-pan') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.className='menu';
  root.style.position='fixed';
  root.style.left='12px';
  root.style.top='12px';
  root.style.zIndex='1000';
  root.style.width='260px';
  root.style.maxHeight='120px';
  root.style.overflowY='auto';
  const longItems=Array.from({length:28},(_,i)=>`<div class="menu-item" data-command="smoke-menu-touch-${i}" id="cancip-sort-touch-${i}"><div class="menu-item-title">Touch item ${i}</div></div>`).join('');
  root.innerHTML=`<div class="menu-section">${longItems}</div>`;
  doc.body.appendChild(root);
  try{
    const descriptor=p.describeUiButtonEditTarget(root.querySelector('#cancip-sort-touch-3'));
    root.remove();
    p.startUiButtonSortMode(descriptor);
    const stage=doc.querySelector('.obcc-ui-sort-snapshot-stage');
    let touchPanScrollTop=0;
    const touchAvailable=typeof Touch!=='undefined'&&typeof TouchEvent!=='undefined';
    if(stage&&touchAvailable){
      stage.scrollTop=0;
      const touchStart=new Touch({identifier:912,target:stage,clientX:80,clientY:140});
      const touchMove=new Touch({identifier:912,target:stage,clientX:80,clientY:40});
      stage.dispatchEvent(new TouchEvent('touchstart',{touches:[touchStart],changedTouches:[touchStart],bubbles:true,cancelable:true}));
      stage.dispatchEvent(new TouchEvent('touchmove',{touches:[touchMove],changedTouches:[touchMove],bubbles:true,cancelable:true}));
      stage.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[touchMove],bubbles:true,cancelable:true}));
      await new Promise((resolve)=>setTimeout(resolve,80));
      touchPanScrollTop=stage.scrollTop;
    }
    p.stopUiButtonSortMode();
    return JSON.stringify({id:'programmatic.ui-button-sort-menu-snapshot-touch-pan',elapsedMs:Date.now()-t,hasStage:!!stage,touchAvailable,touchPanScrollTop,stageAfter:!!doc.querySelector('.obcc-ui-sort-snapshot-stage')});
  } finally {
    root.remove();
    p.stopUiButtonSortMode?.();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 25
    if (-not $item.hasStage) { throw "touch pan snapshot stage missing: $($item | ConvertTo-Json -Compress)" }
    if ($item.touchAvailable -and [int]$item.touchPanScrollTop -le 0) { throw "menu sort snapshot touch event fallback did not scroll: $($item | ConvertTo-Json -Compress)" }
    if ($item.stageAfter) { throw "touch pan snapshot stage was not cleaned up: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-sort-menu-snapshot-touch-pan'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-rule-reset-list') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  const smokeRules=[
    {id:'smoke-reset-hidden',selector:'#cancip-smoke-hidden',label:'Hidden Smoke',hidden:true,order:0,scope:'global'},
    {id:'smoke-reset-order',selector:'#cancip-smoke-order',label:'Order Smoke',hidden:false,order:20,scope:'global'},
    {id:'smoke-reset-custom',kind:'custom',selector:'[data-cancip-ui-custom-button-id="smoke-reset-custom"]',anchorSelector:'#cancip-smoke-anchor',label:'Custom Smoke',title:'Custom Smoke',icon:'bot',hidden:false,order:0,scope:'global',commandId:'app:go-back',commandName:'Back'}
  ];
  try{
    p.settings.uiButtonRules=smokeRules;
    const beforeIds=p.modifiedUiButtonRules().map((rule)=>rule.id).sort();
    const orderRule=p.settings.uiButtonRules.find((rule)=>rule.id==='smoke-reset-order');
    const orderLabelCount=orderRule?p.uiButtonRuleChangeLabels(orderRule).length:0;
    const removed=await p.resetUiButtonRule('smoke-reset-hidden');
    const afterOneIds=p.modifiedUiButtonRules().map((rule)=>rule.id).sort();
    const resetAllCount=await p.resetAllUiButtonRules();
    const afterAllCount=p.modifiedUiButtonRules().length;
    return JSON.stringify({id:'programmatic.ui-button-rule-reset-list',elapsedMs:Date.now()-t,beforeIds,orderLabelCount,removed,afterOneIds,resetAllCount,afterAllCount});
  } finally {
    p.settings.uiButtonRules=oldRules;
    await p.saveSettings();
    if(typeof p.scheduleUiButtonRulesApply==='function')p.scheduleUiButtonRulesApply(0);
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    $beforeIds = @($item.beforeIds)
    $afterOneIds = @($item.afterOneIds)
    if ($beforeIds.Count -ne 3) { throw "changed button list expected 3 got $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.orderLabelCount -lt 1) { throw "change labels were empty: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.removed) { throw "single reset did not report removal: $($item | ConvertTo-Json -Compress)" }
    if ($afterOneIds -contains 'smoke-reset-hidden') { throw "single reset left hidden rule: $($item | ConvertTo-Json -Compress)" }
    if (-not ($afterOneIds -contains 'smoke-reset-order') -or -not ($afterOneIds -contains 'smoke-reset-custom')) { throw "single reset removed wrong rules: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.resetAllCount -ne 2 -or [int]$item.afterAllCount -ne 0) { throw "reset all mismatch: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-rule-reset-list'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-copy-paste-payload') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.style.position='fixed';
  root.style.left='10px';
  root.style.top='10px';
  root.style.zIndex='1000';
  root.innerHTML=[
    '<button id="cancip-copy-source" data-command="app:open-settings" title="Source Settings">Source Settings</button>',
    '<button id="cancip-copy-anchor" title="Anchor Button">Anchor Button</button>'
  ].join('');
  doc.body.appendChild(root);
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  try{
    p.settings.uiButtonRules=[];
    const source=root.querySelector('#cancip-copy-source');
    const anchor=root.querySelector('#cancip-copy-anchor');
    const sourceDescriptor=p.describeUiButtonEditTarget(source);
    const anchorDescriptor=p.describeUiButtonEditTarget(anchor);
    const payload=p.uiButtonClipboardPayload(sourceDescriptor);
    if(!payload)throw new Error('no copied payload');
    await p.addSiblingUiButton(anchorDescriptor,{
      commandId:payload.commandId,
      commandName:payload.commandName||payload.label||payload.commandId,
      title:payload.title||payload.label||payload.commandName||payload.commandId,
      icon:payload.icon||'settings',
      insertPosition:payload.insertPosition
    });
    await new Promise((resolve)=>setTimeout(resolve,160));
    p.applyUiButtonRules();
    await new Promise((resolve)=>setTimeout(resolve,160));
    const custom=root.querySelector('[data-cancip-ui-custom-button="true"]');
    const rules=(p.settings.uiButtonRules||[]).filter((rule)=>rule.kind==='custom');
    const rule=rules[0]||{};
    const afterAnchor=custom&&anchor.nextElementSibling===custom;
    const copiedCustomPayload=custom?p.uiButtonClipboardPayload(p.describeUiButtonEditTarget(custom)):null;
    const relayAnchor=doc.createElement('button');
    relayAnchor.id='cancip-copy-relay-anchor';
    relayAnchor.textContent='Relay Anchor';
    root.appendChild(relayAnchor);
    if(!copiedCustomPayload)throw new Error('no copied custom payload');
    await p.addSiblingUiButton(p.describeUiButtonEditTarget(relayAnchor),{
      commandId:copiedCustomPayload.commandId,
      commandName:copiedCustomPayload.commandName||copiedCustomPayload.label||copiedCustomPayload.commandId,
      title:copiedCustomPayload.title||copiedCustomPayload.label||copiedCustomPayload.commandName||copiedCustomPayload.commandId,
      icon:copiedCustomPayload.icon||'settings',
      insertPosition:copiedCustomPayload.insertPosition
    });
    await new Promise((resolve)=>setTimeout(resolve,160));
    p.applyUiButtonRules();
    await new Promise((resolve)=>setTimeout(resolve,160));
    const nextRules=(p.settings.uiButtonRules||[]).filter((item)=>item.kind==='custom');
    const relayRule=nextRules.find((item)=>item.anchorSelector&&item.anchorSelector.includes('cancip-copy-relay-anchor'))||{};
    const relayCustom=relayAnchor.nextElementSibling;
    return JSON.stringify({
      id:'programmatic.ui-button-copy-paste-payload',
      elapsedMs:Date.now()-t,
      payload,
      copiedCustomPayload,
      customCount:rules.length,
      finalCustomCount:nextRules.length,
      anchorSelector:rule.anchorSelector||'',
      commandId:rule.commandId||'',
      title:rule.title||'',
      icon:rule.icon||'',
      afterAnchor,
      customCommand:custom?.dataset?.cancipUiCustomCommand||'',
      customTitle:custom?.getAttribute('title')||'',
      relayAnchorSelector:relayRule.anchorSelector||'',
      relayCommandId:relayRule.commandId||'',
      relayIcon:relayRule.icon||'',
      relayTitle:relayRule.title||'',
      relayAfterAnchor:relayCustom?.dataset?.cancipUiCustomButton==='true',
      relayCustomCommand:relayCustom?.dataset?.cancipUiCustomCommand||''
    });
  } finally {
    root.remove();
    p.settings.uiButtonRules=oldRules;
    p.clearUiRuleMarks?.();
    await p.saveSettings();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([string]$item.payload.schema -ne 'cancip-ui-button' -or [int]$item.payload.version -ne 1) { throw "button copied payload schema mismatch: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.payload.commandId -ne 'obcmd:app:open-settings') { throw "button copied payload did not preserve command id: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.customCount -ne 1) { throw "pasted button did not create exactly one custom rule: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.anchorSelector -notmatch 'cancip-copy-anchor') { throw "pasted button used the old source location instead of current add location: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.commandId -ne 'obcmd:app:open-settings' -or [string]$item.customCommand -ne 'obcmd:app:open-settings') { throw "pasted button did not preserve executable command: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.icon -ne [string]$item.payload.icon) { throw "pasted button icon did not preserve copied icon: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.afterAnchor) { throw "pasted button was not inserted beside the target anchor: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.copiedCustomPayload.commandId -ne 'obcmd:app:open-settings') { throw "copied custom button payload points at wrapper instead of real command: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.copiedCustomPayload.icon -ne [string]$item.icon) { throw "copied custom button payload did not preserve custom icon: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.finalCustomCount -ne 2) { throw "pasting copied custom button did not create second custom rule: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.relayAnchorSelector -notmatch 'cancip-copy-relay-anchor') { throw "pasted custom button reused old anchor instead of current add location: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.relayCommandId -ne 'obcmd:app:open-settings' -or [string]$item.relayCustomCommand -ne 'obcmd:app:open-settings') { throw "pasted custom button command is not executable real command: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.relayIcon -ne [string]$item.icon) { throw "pasted custom button did not preserve icon: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.relayAfterAnchor) { throw "pasted custom button was not inserted beside relay anchor: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-copy-paste-payload'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-menu-text-command-resolution') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const api=app.commands;
  const commandId='mobile-pdf-exporter:export-current-note-preview-pdf';
  const menuLabel='\u5bfc\u51fa\u9884\u89c8\u7248 PDF';
  const commandName='Mobile PDF Exporter: \u5bfc\u51fa\u5f53\u524d\u7b14\u8bb0\u4e3a\u9884\u89c8\u7248 PDF';
  const oldCommand=api.commands?.[commandId];
  const oldExecute=api.executeCommandById;
  const executed=[];
  api.commands=api.commands||{};
  api.commands[commandId]={id:commandId,name:commandName,icon:'file-output'};
  api.executeCommandById=(id)=>{
    if(id===commandId){executed.push(id);return true;}
    return typeof oldExecute==='function'?oldExecute.call(api,id):false;
  };
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.style.position='fixed';
  root.style.left='12px';
  root.style.top='12px';
  root.style.zIndex='1000';
  root.className='menu';
  root.innerHTML=[
    '<div class="menu-group">',
    `<div id="cancip-menu-export" class="menu-item tappable" role="menuitem"><div class="menu-item-title">${menuLabel}</div></div>`,
    '</div>',
    '<button id="cancip-menu-anchor" title="Anchor Button">Anchor Button</button>'
  ].join('');
  doc.body.appendChild(root);
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  try{
    p.settings.uiButtonRules=[];
    const menuItem=root.querySelector('#cancip-menu-export');
    const anchor=root.querySelector('#cancip-menu-anchor');
    const menuDescriptor=p.describeUiButtonEditTarget(menuItem);
    const anchorDescriptor=p.describeUiButtonEditTarget(anchor);
    const payload=p.uiButtonClipboardPayload(menuDescriptor);
    await p.addSiblingUiButton(anchorDescriptor,{
      commandId:`uiclick:${menuDescriptor.selector}`,
      commandName:menuLabel,
      title:menuLabel,
      icon:'download',
      insertPosition:'after'
    });
    await new Promise((resolve)=>setTimeout(resolve,160));
    p.applyUiButtonRules();
    await new Promise((resolve)=>setTimeout(resolve,160));
    const added=(p.settings.uiButtonRules||[]).find((rule)=>rule.kind==='custom'&&rule.anchorSelector&&rule.anchorSelector.includes('cancip-menu-anchor'))||{};
    p.settings.uiButtonRules=[{
      id:'smoke-old-menu-export',
      kind:'custom',
      selector:'[data-cancip-ui-custom-button-id="smoke-old-menu-export"]',
      anchorSelector:'button#cancip-menu-anchor',
      label:menuLabel,
      title:menuLabel,
      icon:'download',
      commandId:"uiclick:.menu .menu-item, .menu-group .menu-item, [role='menuitem']",
      commandName:menuLabel,
      insertPosition:'after',
      hidden:false,
      order:0,
      scope:'global'
    }];
    await p.repairCustomUiButtonCommands?.();
    const repaired=(p.settings.uiButtonRules||[]).find((rule)=>rule.id==='smoke-old-menu-export')||{};
    await p.executeCustomUiButtonRule?.(repaired);
    return JSON.stringify({
      id:'programmatic.ui-button-menu-text-command-resolution',
      elapsedMs:Date.now()-t,
      descriptorSelector:menuDescriptor.selector,
      payloadCommandId:payload?.commandId||'',
      payloadIcon:payload?.icon||'',
      addedCommandId:added.commandId||'',
      addedIcon:added.icon||'',
      repairedCommandId:repaired.commandId||'',
      repairedCommandName:repaired.commandName||'',
      executed
    });
  } finally {
    root.remove();
    p.settings.uiButtonRules=oldRules;
    p.clearUiRuleMarks?.();
    await p.saveSettings();
    if(oldCommand===undefined)delete api.commands[commandId];
    else api.commands[commandId]=oldCommand;
    api.executeCommandById=oldExecute;
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    $expected = 'obcmd:mobile-pdf-exporter:export-current-note-preview-pdf'
    if ([string]$item.payloadCommandId -ne $expected) { throw "menu text copy did not resolve to real command: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.addedCommandId -ne $expected) { throw "menu text add-sibling kept wrapper instead of real command: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.repairedCommandId -ne $expected) { throw "old uiclick menu rule was not migrated to real command: $($item | ConvertTo-Json -Compress)" }
    if (@($item.executed).Count -ne 1) { throw "repaired command did not execute real command: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-menu-text-command-resolution'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-menu-command-waits-close') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const api=app.commands;
  const commandId='smoke:menu-command-waits-close';
  const oldCommand=api.commands?.[commandId];
  const oldExecute=api.executeCommandById;
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.style.position='fixed';
  root.style.left='12px';
  root.style.top='12px';
  root.style.zIndex='1000';
  root.className='menu';
  root.innerHTML=[
    '<div class="menu-group">',
    '<div id="cancip-menu-wait-anchor" class="menu-item tappable" role="menuitem"><div class="menu-item-title">Anchor menu item</div></div>',
    '</div>'
  ].join('');
  doc.body.appendChild(root);
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  const states=[];
  let escapeSeen=0;
  const closeOnEscape=(event)=>{
    if(event.key!=='Escape')return;
    escapeSeen+=1;
    window.setTimeout(()=>root.remove(),70);
  };
  doc.addEventListener('keydown',closeOnEscape,true);
  try{
    api.commands=api.commands||{};
    api.commands[commandId]={id:commandId,name:'Smoke menu command waits close',icon:'file-output'};
    api.executeCommandById=(id)=>{
      if(id===commandId){
        states.push({at:Date.now()-t,menuConnected:root.isConnected});
        return true;
      }
      return typeof oldExecute==='function'?oldExecute.call(api,id):false;
    };
    p.settings.uiButtonRules=[];
    const anchor=root.querySelector('#cancip-menu-wait-anchor');
    await p.addSiblingUiButton(p.describeUiButtonEditTarget(anchor),{
      commandId:`obcmd:${commandId}`,
      commandName:'Smoke menu command waits close',
      title:'Smoke menu command waits close',
      icon:'file-output',
      insertPosition:'after'
    });
    await new Promise((resolve)=>setTimeout(resolve,160));
    p.applyUiButtonRules();
    await new Promise((resolve)=>setTimeout(resolve,160));
    const custom=root.querySelector('[data-cancip-ui-custom-button="true"]');
    if(!custom)throw new Error('custom menu button not inserted');
    custom.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    await new Promise((resolve)=>setTimeout(resolve,760));
    const added=(p.settings.uiButtonRules||[]).find((rule)=>rule.kind==='custom'&&rule.commandId===`obcmd:${commandId}`)||{};
    return JSON.stringify({
      id:'programmatic.ui-button-menu-command-waits-close',
      elapsedMs:Date.now()-t,
      escapeSeen,
      states,
      menuConnectedAfter:root.isConnected,
      anchorLabel:added.anchorLabel||'',
      commandId:added.commandId||''
    });
  } finally {
    doc.removeEventListener('keydown',closeOnEscape,true);
    root.remove();
    p.settings.uiButtonRules=oldRules;
    p.clearUiRuleMarks?.();
    await p.saveSettings();
    if(oldCommand===undefined)delete api.commands[commandId];
    else api.commands[commandId]=oldCommand;
    api.executeCommandById=oldExecute;
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    $states = @($item.states)
    if ([int]$item.escapeSeen -lt 1) { throw "custom menu command did not request native menu close first: $($item | ConvertTo-Json -Compress)" }
    if ($states.Count -ne 1) { throw "custom menu command should execute exactly once after click: $($item | ConvertTo-Json -Compress)" }
    if ($states[0].menuConnected) { throw "custom menu command executed before native menu closed, causing popup flicker risk: $($item | ConvertTo-Json -Compress)" }
    if ($item.menuConnectedAfter) { throw "synthetic menu was not closed during command wait test: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.anchorLabel -ne 'Anchor menu item') { throw "custom menu button lost anchor label guard: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.commandId -ne 'obcmd:smoke:menu-command-waits-close') { throw "custom menu button command changed unexpectedly: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-menu-command-waits-close'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-menu-click-fallback') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.style.position='fixed';
  root.style.left='12px';
  root.style.top='12px';
  root.style.zIndex='1000';
  root.className='menu';
  const menuLabel='\u67e5\u770b\u6587\u4ef6\u5c5e\u6027';
  root.innerHTML=[
    '<div class="menu-group">',
    `<div id="cancip-menu-property" class="menu-item tappable" role="menuitem"><div class="menu-item-title">${menuLabel}</div></div>`,
    '<div id="cancip-menu-anchor" class="menu-item tappable" role="menuitem"><div class="menu-item-title">Anchor menu item</div></div>',
    '</div>'
  ].join('');
  doc.body.appendChild(root);
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  let clicked=0;
  try{
    p.settings.uiButtonRules=[];
    const source=root.querySelector('#cancip-menu-property');
    const anchor=root.querySelector('#cancip-menu-anchor');
    source.addEventListener('click',()=>{clicked+=1;});
    const sourceDescriptor=p.describeUiButtonEditTarget(source);
    const anchorDescriptor=p.describeUiButtonEditTarget(anchor);
    const payload=p.uiButtonClipboardPayload(sourceDescriptor);
    await p.addSiblingUiButton(anchorDescriptor,{
      commandId:payload.commandId,
      commandName:payload.commandName||payload.label||payload.commandId,
      title:payload.title||payload.label||payload.commandName||payload.commandId,
      icon:payload.icon||'info',
      fallbackSelector:payload.fallbackSelector,
      insertPosition:'after'
    });
    await new Promise((resolve)=>setTimeout(resolve,160));
    p.applyUiButtonRules();
    await new Promise((resolve)=>setTimeout(resolve,160));
    const added=(p.settings.uiButtonRules||[]).find((rule)=>rule.kind==='custom'&&rule.anchorSelector&&rule.anchorSelector.includes('cancip-menu-anchor'))||{};
    const custom=root.querySelector('[data-cancip-ui-custom-button="true"]');
    await p.executeCustomUiButtonRule?.(added);
    return JSON.stringify({
      id:'programmatic.ui-button-menu-click-fallback',
      elapsedMs:Date.now()-t,
      payloadCommandId:payload?.commandId||'',
      payloadFallbackSelector:payload?.fallbackSelector||'',
      addedCommandId:added.commandId||'',
      addedFallbackSelector:added.fallbackSelector||'',
      addedLabel:added.label||'',
      customIsMenuItem:!!custom?.classList?.contains('menu-item'),
      clicked
    });
  } finally {
    root.remove();
    p.settings.uiButtonRules=oldRules;
    p.clearUiRuleMarks?.();
    await p.saveSettings();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([string]$item.payloadCommandId -notmatch '^uiclick:') { throw "plain menu item should remain a click fallback instead of fake command: $($item | ConvertTo-Json -Compress)" }
    if (-not [string]$item.payloadFallbackSelector) { throw "plain menu item payload lost fallback selector: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.addedCommandId -notmatch '^uiclick:') { throw "pasted plain menu item was not saved as click fallback: $($item | ConvertTo-Json -Compress)" }
    if (-not [string]$item.addedFallbackSelector) { throw "pasted plain menu item lost fallback selector after normalization: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.customIsMenuItem) { throw "pasted menu sibling did not render as menu item: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.clicked -ne 1) { throw "pasted plain menu item did not click the original same-label menu action exactly once: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-menu-click-fallback'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-rules-migrate-stale-menu-selectors') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  try{
    p.settings.uiButtonRules=[
      {
        id:'rule-global-div-menu-group-obcc-ui-rule-flex-parent-nth-of-type-7-div-menu-item-tappa',
        selector:'div.menu-group.obcc-ui-rule-flex-parent:nth-of-type(7) > div.menu-item.tappable:nth-of-type(2)',
        label:'Replace action',
        hidden:true,
        order:12,
        scope:'global'
      },
      {
        id:'custom-broken-old-menu',
        selector:'[data-cancip-ui-custom-button-id="custom-broken-old-menu"]',
        label:'\u67e5\u770b\u6587\u4ef6\u5c5e\u6027',
        hidden:true,
        order:0,
        scope:'active'
      },
      {
        id:'custom-old-view-action',
        kind:'custom',
        selector:'[data-cancip-ui-custom-button-id="custom-old-view-action"]',
        anchorSelector:'button.clickable-icon.view-action:nth-of-type(3)',
        label:'\u5bfc\u51fa\u9884\u89c8\u7248 PDF',
        title:'\u5bfc\u51fa\u9884\u89c8\u7248 PDF',
        icon:'download',
        commandId:'obcmd:mobile-pdf-exporter:export-current-note-preview-pdf',
        commandName:'Mobile PDF Exporter: \u5bfc\u51fa\u5f53\u524d\u7b14\u8bb0\u4e3a\u9884\u89c8\u7248 PDF',
        hidden:false,
        order:0,
        scope:'active'
      }
    ];
    await p.saveSettings();
    const rules=(p.settings.uiButtonRules||[]).map((rule)=>({
      id:rule.id,
      label:rule.label,
      selector:rule.selector,
      anchorSelector:rule.anchorSelector||'',
      commandId:rule.commandId||'',
      hidden:!!rule.hidden,
      order:rule.order||0,
      kind:rule.kind||''
    }));
    return JSON.stringify({id:'programmatic.ui-button-rules-migrate-stale-menu-selectors',elapsedMs:Date.now()-t,rules});
  } finally {
    p.settings.uiButtonRules=oldRules;
    await p.saveSettings();
    if(typeof p.scheduleUiButtonRulesApply==='function')p.scheduleUiButtonRulesApply(0);
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    $rules = @($item.rules)
    $menu = $rules | Where-Object { ($_.label -as [string]) -eq 'Replace action' } | Select-Object -First 1
    $broken = $rules | Where-Object { ($_.id -as [string]) -eq 'custom-broken-old-menu' } | Select-Object -First 1
    $custom = $rules | Where-Object { ($_.id -as [string]) -eq 'custom-old-view-action' } | Select-Object -First 1
    if ($null -eq $menu) { throw "stale menu rule was dropped instead of migrated: $($item | ConvertTo-Json -Compress)" }
    if ([string]$menu.selector -match 'nth-of-type|obcc-ui-rule' -or [string]$menu.selector -notmatch 'menu-item' -or [string]$menu.selector -notmatch 'mobile-menu') { throw "stale menu selector was not migrated to broad mobile-safe selector: $($item | ConvertTo-Json -Compress)" }
    if (-not $menu.hidden -or [int]$menu.order -ne 12) { throw "stale menu rule lost hidden/order state: $($item | ConvertTo-Json -Compress)" }
    if ($null -ne $broken) { throw "broken old custom rule was kept and can still create missing-command buttons: $($item | ConvertTo-Json -Compress)" }
    if ($null -eq $custom) { throw "valid old custom rule was dropped: $($item | ConvertTo-Json -Compress)" }
    if ([string]$custom.anchorSelector -match 'nth-of-type|obcc-ui-rule' -or [string]$custom.anchorSelector -notmatch 'More options|aria-label') { throw "old custom view-action anchor was not migrated to stable More-options anchor: $($item | ConvertTo-Json -Compress)" }
    if ([string]$custom.commandId -ne 'obcmd:mobile-pdf-exporter:export-current-note-preview-pdf') { throw "valid custom command was not preserved: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-rules-migrate-stale-menu-selectors'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-menu-fallback-opens-more-menu') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.style.position='fixed';
  root.style.left='10px';
  root.style.top='10px';
  root.style.zIndex='1000';
  root.innerHTML='<div class="workspace-leaf mod-active"><div class="view-header"><div class="view-actions"><button id="cancip-open-more" class="clickable-icon view-action" aria-label="More options" title="More options"></button></div></div></div>';
  doc.body.appendChild(root);
  const oldActiveLeaf=p.activeWorkspaceLeaf;
  let opened=0;
  let clicked=0;
  const menuLabel='\u67e5\u770b\u6587\u4ef6\u5c5e\u6027';
  const more=root.querySelector('#cancip-open-more');
  more.addEventListener('click',()=>{
    opened+=1;
    if(doc.querySelector('#cancip-opened-menu-property'))return;
    const menu=doc.createElement('div');
    menu.className='menu';
    menu.innerHTML=`<div class="menu-group"><div id="cancip-opened-menu-property" class="menu-item tappable" role="menuitem"><div class="menu-item-title">${menuLabel}</div></div></div>`;
    menu.querySelector('#cancip-opened-menu-property').addEventListener('click',()=>{clicked+=1;});
    doc.body.appendChild(menu);
  });
  try{
    p.activeWorkspaceLeaf=()=>({view:{containerEl:root},containerEl:root});
    const rule={
      id:'smoke-menu-opens-more',
      kind:'custom',
      selector:'[data-cancip-ui-custom-button-id="smoke-menu-opens-more"]',
      anchorSelector:'button#cancip-open-more',
      label:menuLabel,
      title:menuLabel,
      commandName:menuLabel,
      commandId:"uiclick:.menu .menu-item, .menu-group .menu-item, .mobile-menu .menu-item, .modal.mod-mobile-menu .menu-item, [role='menuitem']",
      fallbackSelector:'.menu .menu-item',
      hidden:false,
      order:0,
      scope:'global'
    };
    await p.executeCustomUiButtonRule?.(rule);
    const menuStillThere=!!doc.querySelector('#cancip-opened-menu-property');
    return JSON.stringify({id:'programmatic.ui-button-menu-fallback-opens-more-menu',elapsedMs:Date.now()-t,opened,clicked,menuStillThere});
  } finally {
    p.activeWorkspaceLeaf=oldActiveLeaf;
    doc.querySelector('#cancip-opened-menu-property')?.closest('.menu')?.remove();
    root.remove();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.opened -ne 1) { throw "menu fallback did not open the active More-options menu exactly once: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.clicked -ne 1) { throw "menu fallback did not click same-label menu item exactly once after opening menu: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-menu-fallback-opens-more-menu'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-rule-broad-selector-isolated') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  try{
    p.settings.uiButtonRules=[];
    await p.upsertUiButtonRule({id:'smoke-menu-alpha',selector:'.menu .menu-item',label:'Alpha action',hidden:true,order:0,scope:'global'});
    await p.upsertUiButtonRule({id:'smoke-menu-beta',selector:'.menu .menu-item',label:'Beta action',hidden:true,order:0,scope:'global'});
    const rules=(p.settings.uiButtonRules||[]).filter((rule)=>rule.selector==='.menu .menu-item').map((rule)=>({id:rule.id,label:rule.label,hidden:rule.hidden}));
    return JSON.stringify({id:'programmatic.ui-button-rule-broad-selector-isolated',elapsedMs:Date.now()-t,rules});
  } finally {
    p.settings.uiButtonRules=oldRules;
    await p.saveSettings();
    if(typeof p.scheduleUiButtonRulesApply==='function')p.scheduleUiButtonRulesApply(0);
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    $rules = @($item.rules)
    if ($rules.Count -ne 2) { throw "broad menu item rules overwrote each other: $($item | ConvertTo-Json -Compress)" }
    $labels = @($rules | ForEach-Object { [string]$_.label })
    if (-not ($labels -contains 'Alpha action') -or -not ($labels -contains 'Beta action')) { throw "broad selector labels were not preserved: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-rule-broad-selector-isolated'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-statusbar-user-hidden-precedence') {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const bar=doc.querySelector('.status-bar');
  const item=p.statusBarEl||doc.querySelector('.status-bar .obcc-statusbar');
  if(!bar||!item)throw new Error('status bar target unavailable');
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  const oldForce=p.settings.forceStatusBarVisible;
  const oldManagement=p.settings.uiButtonManagementEnabled;
  const oldReveal=p.uiButtonRulesRevealHidden;
  const oldMobile=doc.body.classList.contains('is-mobile');
  const oldBarStyle=bar.getAttribute('style');
  const oldItemStyle=item.getAttribute('style');
  try{
    p.settings.forceStatusBarVisible=true;
    p.settings.uiButtonManagementEnabled=true;
    p.uiButtonRulesRevealHidden=false;
    p.settings.uiButtonRules=[{
      id:'smoke-statusbar-cancip-hidden',
      selector:'.status-bar .obcc-statusbar',
      label:'Open Cancip',
      hidden:true,
      order:0,
      scope:'global'
    }];
    p.applyUiButtonRules();
    p.ensureStatusBarVisible();
    const userHidden=item.dataset.cancipUiRuleHidden==='true'
      && item.dataset.cancipUiHidden==='true'
      && getComputedStyle(item).display==='none';
    p.setUiButtonHiddenReveal(true);
    const revealed=getComputedStyle(item).display!=='none';
    p.setUiButtonHiddenReveal(false);
    const hiddenAgain=item.dataset.cancipUiRuleHidden==='true'&&getComputedStyle(item).display==='none';
    const stableSelector=p.describeUiButtonEditTarget(item).selector;

    p.settings.uiButtonRules=[];
    p.clearUiRuleMarks();
    doc.body.classList.add('is-mobile');
    bar.style.display='none';
    item.style.display='none';
    p.ensureStatusBarVisible();
    const accidentalBarRecovered=getComputedStyle(bar).display!=='none';
    const accidentalItemRecovered=getComputedStyle(item).display!=='none';
    return JSON.stringify({
      id:'programmatic.ui-button-statusbar-user-hidden-precedence',
      elapsedMs:Date.now()-t,
      userHidden,
      revealed,
      hiddenAgain,
      stableSelector,
      accidentalBarRecovered,
      accidentalItemRecovered
    });
  } finally {
    p.settings.uiButtonRules=oldRules;
    p.settings.forceStatusBarVisible=oldForce;
    p.settings.uiButtonManagementEnabled=oldManagement;
    p.uiButtonRulesRevealHidden=oldReveal;
    if(oldMobile)doc.body.classList.add('is-mobile');else doc.body.classList.remove('is-mobile');
    if(oldBarStyle===null)bar.removeAttribute('style');else bar.setAttribute('style',oldBarStyle);
    if(oldItemStyle===null)item.removeAttribute('style');else item.setAttribute('style',oldItemStyle);
    p.applyStatusBarVisibility();
    p.applyUiButtonRules();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.userHidden) { throw "explicit status-bar button hide was overridden by visibility guard: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.revealed -or -not $item.hiddenAgain) { throw "temporary reveal-hidden mode did not restore the saved hide rule: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.stableSelector -ne '.status-bar .obcc-statusbar') { throw "status-bar button used an unstable selector: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.accidentalBarRecovered -or -not $item.accidentalItemRecovered) { throw "status-bar visibility guard no longer repairs accidental hiding: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-statusbar-user-hidden-precedence'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-menu-complete-sort-label-guard') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.className='menu';
  root.style.position='fixed';
  root.style.left='10px';
  root.style.top='10px';
  root.style.zIndex='1000';
  root.innerHTML=[
    '<div class="menu-section"><div class="menu-item" data-command="smoke-complete-a" id="cancip-complete-a"><div class="menu-item-title">Alpha Button</div></div></div>',
    '<div class="menu-separator"></div>',
    '<div class="menu-section"><div class="menu-item" data-command="smoke-complete-b" id="cancip-complete-b"><div class="menu-item-title">Beta Button</div></div><div class="menu-item" data-command="smoke-complete-c" id="cancip-complete-c"><div class="menu-item-title">Gamma Button</div></div></div>'
  ].join('');
  doc.body.appendChild(root);
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  try{
    p.settings.uiButtonRules=[
      {id:'smoke-complete-beta',selector:'.menu .menu-item[data-command="smoke-complete-b"]',label:'Beta Button',hidden:false,order:10,scope:'global'},
      {id:'smoke-complete-alpha',selector:'.menu .menu-item[data-command="smoke-complete-a"]',label:'Alpha Button',hidden:false,order:20,scope:'global'},
      {id:'smoke-complete-gamma-wrong-label',selector:'.menu .menu-item[data-command="smoke-complete-c"]',label:'Wrong Gamma',hidden:true,order:30,scope:'global'}
    ];
    p.applyUiButtonRules();
    await new Promise((resolve)=>setTimeout(resolve,140));
    const alpha=root.querySelector('#cancip-complete-a');
    const beta=root.querySelector('#cancip-complete-b');
    const gamma=root.querySelector('#cancip-complete-c');
    const firstSection=root.querySelector('.menu-section');
    const separator=root.querySelector('.menu-separator');
    const rootStyle=getComputedStyle(root);
    const sectionStyle=getComputedStyle(firstSection);
    const separatorStyle=getComputedStyle(separator);
    const betaStyle=getComputedStyle(beta);
    const alphaOrder=alpha?.style?.order||'';
    const betaOrder=beta?.style?.order||'';
    const gammaHidden=gamma?.dataset?.cancipUiHidden==='true'||gamma?.classList?.contains('obcc-ui-rule-hidden')||false;
    return JSON.stringify({
      id:'programmatic.ui-button-menu-complete-sort-label-guard',
      elapsedMs:Date.now()-t,
      rootDisplay:rootStyle.display,
      sectionDisplay:sectionStyle.display,
      separatorDisplay:separatorStyle.display,
      betaRadius:betaStyle.borderTopLeftRadius,
      alphaOrder,
      betaOrder,
      gammaHidden
    });
  } finally {
    root.remove();
    p.settings.uiButtonRules=oldRules;
    p.clearUiRuleMarks?.();
    p.applyUiButtonRules?.();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([string]$item.rootDisplay -ne 'flex') { throw "sorted menu root was not flattened into one flex list: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.sectionDisplay -ne 'contents') { throw "menu sections were not flattened for complete sorting: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.separatorDisplay -ne 'none') { throw "menu separators still split sorted chunks: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.betaRadius -ne '0px') { throw "sorted menu item rounded corners were not normalized: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.betaOrder -ne '10' -or [string]$item.alphaOrder -ne '20') { throw "cross-section menu order was not applied: $($item | ConvertTo-Json -Compress)" }
    if ($item.gammaHidden) { throw "label guard failed; mismatched visible name still hid a menu item: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-menu-complete-sort-label-guard'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-mobile-menu-label-snapshot') {
  try {
    $metadataCode = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.className='mobile-menu mobile-menu-smoke';
  root.style.position='fixed';
  root.style.left='10px';
  root.style.top='10px';
  root.style.width='280px';
  root.style.maxHeight='140px';
  root.style.overflowY='auto';
  root.style.zIndex='1000';
  const extra=Array.from({length:42},(_,i)=>`<div class="menu-item tappable"><div class="menu-item-title">Mobile extra ${i}</div></div>`).join('');
  root.innerHTML=[
    '<div class="menu-item tappable" id="cancip-mobile-menu-direct"><div class="menu-item-title">直接移动菜单项</div></div>',
    '<div class="menu-group"><div class="menu-item tappable" id="cancip-mobile-menu-a"><div class="menu-item-title">在标签页中显示反向链接</div></div><div class="menu-item tappable"><div class="menu-item-title">另一个移动菜单项</div></div></div>',
    `<div class="menu-group">${extra}</div>`
  ].join('');
  doc.body.appendChild(root);
  try{
    await new Promise((resolve)=>setTimeout(resolve,60));
    const target=root.querySelector('#cancip-mobile-menu-a');
    const directTarget=root.querySelector('#cancip-mobile-menu-direct');
    const normalItemRadius=getComputedStyle(target).borderTopLeftRadius;
    const normalDirectRadius=getComputedStyle(directTarget).borderTopLeftRadius;
    const normalGroupRadius=getComputedStyle(target.closest('.menu-group')).borderTopLeftRadius;
    const normalGroupDisplay=getComputedStyle(target.closest('.menu-group')).display;
    const descriptor=p.describeUiButtonEditTarget(target);
    const beforeStatus=p.uiButtonEditTargetStatus(descriptor);
    root.remove();
    const afterStatus=p.uiButtonEditTargetStatus(descriptor);
    return JSON.stringify({
      id:'programmatic.ui-button-mobile-menu-label-snapshot',
      elapsedMs:Date.now()-t,
      selector:descriptor.selector,
      normalItemRadius,
      normalDirectRadius,
      normalGroupRadius,
      normalGroupDisplay,
      snapshotCount:descriptor.sortSnapshot?.items?.length||0,
      beforeVerified:beforeStatus.verified,
      afterVerified:afterStatus.verified,
      afterSelectorCount:afterStatus.selectorCount,
      afterLabelCount:afterStatus.labelCount
    });
  } finally {
    root.remove();
    p.stopUiButtonSortMode?.();
  }
})()
'@
    $sortCode = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.className='mobile-menu mobile-menu-smoke';
  root.style.position='fixed';
  root.style.left='10px';
  root.style.top='10px';
  root.style.width='280px';
  root.style.maxHeight='140px';
  root.style.overflowY='auto';
  root.style.zIndex='1000';
  const extra=Array.from({length:42},(_,i)=>`<div class="menu-item tappable"><div class="menu-item-title">Mobile extra ${i}</div></div>`).join('');
  root.innerHTML=[
    '<div class="menu-item tappable" id="cancip-mobile-menu-direct"><div class="menu-item-title">直接移动菜单项</div></div>',
    '<div class="menu-group"><div class="menu-item tappable" id="cancip-mobile-menu-a"><div class="menu-item-title">在标签页中显示反向链接</div></div><div class="menu-item tappable"><div class="menu-item-title">另一个移动菜单项</div></div></div>',
    `<div class="menu-group">${extra}</div>`
  ].join('');
  doc.body.appendChild(root);
  try{
    const target=root.querySelector('#cancip-mobile-menu-a');
    const descriptor=p.describeUiButtonEditTarget(target);
    root.remove();
    p.startUiButtonSortMode(descriptor);
    const stage=doc.querySelector('.obcc-ui-sort-snapshot-stage');
    const stageStyle=stage?getComputedStyle(stage):null;
    const overlay=doc.querySelector('.obcc-ui-sort-overlay');
    const overlayStyle=overlay?getComputedStyle(overlay):null;
    const done=doc.querySelector('.obcc-ui-sort-done');
    const doneStyle=done?getComputedStyle(done):null;
    const stageItems=stage?stage.querySelectorAll('.obcc-ui-sort-snapshot-item').length:0;
    const stageCanScroll=stage?stage.scrollHeight>stage.clientHeight:false;
    let wheelScrollTop=0;
    let pointerPanScrollTop=0;
    let touchPanScrollTop=0;
    const stagePointerEvents=stageStyle?.pointerEvents||'';
    const stageZIndex=stageStyle?.zIndex||'';
    const overlayZIndex=overlayStyle?.zIndex||'';
    const doneDisplay=doneStyle?.display||'';
    if(stage){
      stage.scrollTop=0;
      stage.dispatchEvent(new WheelEvent('wheel',{deltaY:180,bubbles:true,cancelable:true}));
      await new Promise((resolve)=>setTimeout(resolve,80));
      wheelScrollTop=stage.scrollTop;
      pointerPanScrollTop=wheelScrollTop;
      touchPanScrollTop=pointerPanScrollTop||wheelScrollTop;
    }
    const handlesAfterScroll=Array.from(doc.querySelectorAll('.obcc-ui-sort-handle'));
    const lastHandleDisplay=handlesAfterScroll.length?getComputedStyle(handlesAfterScroll[handlesAfterScroll.length-1]).display:'';
    const inlineHandles=doc.querySelectorAll('.obcc-ui-sort-inline-handle').length;
    const stageRect=stage?stage.getBoundingClientRect():null;
    const lastHandleRect=handlesAfterScroll.length?handlesAfterScroll[handlesAfterScroll.length-1].getBoundingClientRect():null;
    const lastHandleInStage=!!(stageRect&&lastHandleRect&&lastHandleRect.top>=stageRect.top&&lastHandleRect.bottom<=stageRect.bottom+1);
    p.stopUiButtonSortMode();
    return JSON.stringify({
      id:'programmatic.ui-button-mobile-menu-label-snapshot-sort',
      elapsedMs:Date.now()-t,
      stageItems,
      inlineHandles,
      stageCanScroll,
      stagePointerEvents,
      stageZIndex,
      overlayZIndex,
      doneDisplay,
      wheelScrollTop,
      pointerPanScrollTop,
      touchPanScrollTop,
      lastHandleDisplay,
      lastHandleInStage
    });
  } finally {
    root.remove();
    p.stopUiButtonSortMode?.();
  }
})()
'@
    $item = Invoke-CancipEval -Code $metadataCode -TimeoutSeconds 25
    if ($item -is [string] -and $item.TrimStart().StartsWith('{')) { $item = $item | ConvertFrom-Json }
    if ($null -eq $item) { throw "empty eval result for mobile menu sort snapshot" }
    if ([string]$item.selector -match 'nth-of-type') { throw "mobile menu selector still uses brittle nth-of-type: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.selector -notmatch 'menu-group' -or [string]$item.selector -notmatch 'menu-item') { throw "mobile menu selector did not use label-guarded menu selector: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.normalItemRadius -ne '0px' -or [string]$item.normalDirectRadius -ne '0px' -or [string]$item.normalGroupRadius -ne '0px') { throw "mobile note-more menu/group still has rounded corners in normal state: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.normalGroupDisplay -ne 'contents') { throw "mobile note-more menu group is still visually chunked: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.beforeVerified -or -not $item.afterVerified -or [int]$item.afterSelectorCount -ne 0 -or [int]$item.afterLabelCount -lt 1) { throw "mobile transient menu text verification failed after menu closed: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.snapshotCount -lt 40) { throw "mobile menu sort snapshot did not capture complete menu: $($item | ConvertTo-Json -Compress)" }
    $sortItem = Invoke-CancipEval -Code $sortCode -TimeoutSeconds 30
    if ($sortItem -is [string] -and $sortItem.TrimStart().StartsWith('{')) { $sortItem = $sortItem | ConvertFrom-Json }
    if ($null -eq $sortItem) { throw "empty eval result for mobile menu sorting stage" }
    if ([int]$sortItem.stageItems -lt 40 -or -not $sortItem.stageCanScroll) { throw "mobile menu sort snapshot did not stay complete/scrollable: $($sortItem | ConvertTo-Json -Compress)" }
    if ([int]$sortItem.wheelScrollTop -le 0 -or [int]$sortItem.pointerPanScrollTop -le 0) { throw "mobile menu sort snapshot manual scroll fallback failed: $($sortItem | ConvertTo-Json -Compress)" }
    if ([int]$sortItem.touchPanScrollTop -le 0) { throw "mobile menu sort snapshot scroll fallback failed: $($sortItem | ConvertTo-Json -Compress)" }
    if ([int]$sortItem.inlineHandles -ne [int]$sortItem.stageItems) { throw "mobile menu sort handles were not embedded in every scroll row: $($sortItem | ConvertTo-Json -Compress)" }
    if ([string]$sortItem.stagePointerEvents -ne 'auto') { throw "mobile menu sort stage cannot receive touch events: $($sortItem | ConvertTo-Json -Compress)" }
    if ([int]$sortItem.overlayZIndex -le [int]$sortItem.stageZIndex -or [string]$sortItem.doneDisplay -eq 'none') { throw "mobile menu sort controls are covered by snapshot stage: $($sortItem | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = ([int]$item.elapsedMs + [int]$sortItem.elapsedMs) }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-mobile-menu-label-snapshot'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.ui-button-context-actionable') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!p||!v)throw new Error('Cancip plugin/view unavailable');
  const doc=activeDocument;
  const root=doc.createElement('div');
  root.style.position='fixed';
  root.style.left='10px';
  root.style.top='10px';
  root.style.zIndex='-1';
  root.innerHTML='<button id="cancip-button-context-smoke" title="Smoke Button" aria-label="Smoke Button">Smoke</button>';
  doc.body.appendChild(root);
  const oldContext=(v.draftContext||[]).map((item)=>({...item}));
  const oldRules=(p.settings.uiButtonRules||[]).map((rule)=>({...rule}));
  try{
    const button=root.querySelector('#cancip-button-context-smoke');
    v.draftContext=[];
    v.addElementContext(button);
    const context=v.draftContext[v.draftContext.length-1]||{};
    const content=String(context.content||'');
    p.settings.uiButtonRules=[
      {id:'smoke-context-target',selector:'button#cancip-button-context-smoke',label:'Smoke Button',hidden:true,order:30,scope:'global'},
      {id:'smoke-context-other',selector:'button#cancip-button-context-other',label:'Other Button',hidden:true,order:40,scope:'global'}
    ];
    const result=await v.applyUiButtonRulesCommand({reset:[{selector:'button#cancip-button-context-smoke',scope:'global',label:'Smoke Button'}]});
    const remaining=(p.settings.uiButtonRules||[]).map((rule)=>rule.id).sort();
    return JSON.stringify({
      id:'programmatic.ui-button-context-actionable',
      elapsedMs:Date.now()-t,
      label:context.label||'',
      hasActionable:/Cancip UI Button Context/.test(content),
      hasCommand:/obsidian\.ui\.applyButtonRules/.test(content),
      hasSelector:/button#cancip-button-context-smoke/.test(content),
      hasReset:/Reset this button rule|\"reset\"/.test(content),
      remaining,
      result
    });
  } finally {
    root.remove();
    v.draftContext=oldContext;
    p.settings.uiButtonRules=oldRules;
    if(typeof p.saveSettings==='function')await p.saveSettings();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.hasActionable -or -not $item.hasCommand -or -not $item.hasSelector -or -not $item.hasReset) { throw "button context is not actionable enough: $($item | ConvertTo-Json -Compress)" }
    $remaining = @($item.remaining)
    if ($remaining -contains 'smoke-context-target') { throw "button rule reset did not remove the target: $($item | ConvertTo-Json -Compress)" }
    if (-not ($remaining -contains 'smoke-context-other')) { throw "button rule reset removed unrelated rule: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.ui-button-context-actionable'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.system-prompt-persistence'.Contains($Case)) {
  try {
    $code = @"
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const old=String(p.settings.systemPrompt||'');
  const custom='CUSTOM_SMOKE_SYSTEM_PROMPT_'+Date.now();
  try{
    p.settings.systemPrompt=custom;
    await p.saveSettings();
    p.settings.systemPrompt='';
    await p.loadSettings();
    const loaded=String(p.settings.systemPrompt||'');
    let configPrompt='';
    try{
      const raw=await app.vault.adapter.read('.cancip/config.json');
      configPrompt=String((JSON.parse(raw)||{}).systemPrompt||'');
    }catch(e){}
    return JSON.stringify({id:'programmatic.system-prompt-persistence',elapsedMs:Date.now()-t,loadedMatches:loaded===custom,configMatches:configPrompt===custom,loadedHead:loaded.split('\n')[0],configHead:configPrompt.split('\n')[0]});
  } finally {
    p.settings.systemPrompt=old;
    await p.saveSettings();
  }
})()
"@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.loadedMatches) { throw "custom system prompt was reset on load: $($item.loadedHead)" }
    if (-not $item.configMatches) { throw "custom system prompt was not synced to config: $($item.configHead)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; loadedHead = $item.loadedHead }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.system-prompt-persistence'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.plan-manual-todo-separation'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldTodos=JSON.parse(JSON.stringify(v.manualTodos||[]));
  const manualId='smoke-manual-'+Date.now();
  try{
    v.manualTodos=[{id:manualId,text:'manual-smoke-todo',done:false,sendToModel:true,source:'manual',createdAt:new Date().toISOString()}];
    await v.executeAction({type:'todo',op:'set',items:[{text:'agent-plan-step-one'},{text:'agent-plan-step-two-'+('非常长的待办内容'.repeat(30))}]});
    const afterSet={manual:v.visibleManualTodos().length,agent:v.agentPlanTodos().length};
    await v.executeAction({type:'todo',op:'update',text:'agent-plan-step-one',done:true});
    v.renderQueueStatus();
    const livePlan={
      count:v.queueEl?.querySelectorAll('.obcc-live-plan-item').length||0,
      done:v.queueEl?.querySelectorAll('.obcc-live-plan-item.is-done').length||0,
      current:v.queueEl?.querySelectorAll('.obcc-live-plan-item.is-current').length||0,
      hidden:!!v.queueEl?.classList.contains('is-hidden'),
      bounded:(()=>{const box=v.queueEl?.getBoundingClientRect(),plan=v.queueEl?.querySelector('.obcc-live-plan')?.getBoundingClientRect(),rows=Array.from(v.queueEl?.querySelectorAll('.obcc-live-plan-item')||[]).map((el)=>el.getBoundingClientRect());return !!box&&!!plan&&getComputedStyle(v.queueEl).overflowX==='hidden'&&plan.left>=box.left-.5&&plan.right<=box.right+.5&&rows.every((rect)=>rect.left>=box.left-.5&&rect.right<=box.right+.5)})()
    };
    const manual=v.visibleManualTodos()[0]||null;
    const agentDone=!!v.agentPlanTodos().find((item)=>item.text==='agent-plan-step-one'&&item.done);
    await v.executeAction({type:'todo',op:'clear'});
    const afterClear={manual:v.visibleManualTodos().length,agent:v.agentPlanTodos().length,manualText:v.visibleManualTodos()[0]?.text||''};
    return JSON.stringify({id:'programmatic.plan-manual-todo-separation',elapsedMs:Date.now()-t,afterSet,agentDone,manualDone:!!manual?.done,livePlan,afterClear});
  } finally {
    v.manualTodos=oldTodos;
    if(typeof v.refreshPlanPanelIfOpen==='function')v.refreshPlanPanelIfOpen();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.afterSet.manual -ne 1) { throw "manual todo count after set expected 1 got $($item.afterSet.manual)" }
    if ([int]$item.afterSet.agent -ne 2) { throw "agent plan count after set expected 2 got $($item.afterSet.agent)" }
    if (-not $item.agentDone) { throw 'agent plan update did not mark the target item done' }
    if ($item.manualDone) { throw 'manual todo was modified by agent todo update' }
    if ([int]$item.livePlan.count -ne 2 -or [int]$item.livePlan.done -ne 1 -or [int]$item.livePlan.current -ne 1 -or $item.livePlan.hidden -or -not $item.livePlan.bounded) { throw "live plan strip did not reflect bounded completion state: $($item.livePlan | ConvertTo-Json -Compress)" }
    if ([int]$item.afterClear.manual -ne 1 -or [int]$item.afterClear.agent -ne 0) { throw "todo clear did not preserve manual todo: $($item.afterClear | ConvertTo-Json -Compress)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.plan-manual-todo-separation'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.task-control-continue-reset'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldTask=v.taskControl?JSON.parse(JSON.stringify(v.taskControl)):null;
  const oldMessages=JSON.parse(JSON.stringify(v.messages||[]));
  try{
    const now=new Date().toISOString();
    v.taskControl={originalPrompt:'old-task',taskGoal:'old-task',startedAt:now,updatedAt:now};
    v.messages=[
      {id:'u-old',role:'user',content:'old-task',createdAt:Date.now()-2000},
      {id:'u-new',role:'user',content:'new-task',createdAt:Date.now()-1000}
    ];
    v.noteTaskControlPrompt('new-task');
    v.ensureTaskControl('new-task','new-task');
    const afterNew=v.resolveTaskGoal('continue');
    v.noteTaskControlPrompt('continue');
    v.ensureTaskControl('continue',afterNew);
    const afterContinue=v.resolveTaskGoal('continue');
    return JSON.stringify({id:'programmatic.task-control-continue-reset',elapsedMs:Date.now()-t,afterNew,afterContinue,taskGoal:v.taskControl?.taskGoal||'',originalPrompt:v.taskControl?.originalPrompt||''});
  } finally {
    v.taskControl=oldTask;
    v.messages=oldMessages;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ($item.afterNew -ne 'new-task') { throw "continue after new task expected new-task got $($item.afterNew)" }
    if ($item.afterContinue -ne 'new-task') { throw "continue prompt changed task unexpectedly: $($item.afterContinue)" }
    if ($item.taskGoal -ne 'new-task') { throw "taskControl goal expected new-task got $($item.taskGoal)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.task-control-continue-reset'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.prompt-payload-priority-and-experience-skill'.Contains($Case)) {
  try {
    $started = Get-Date
    $null = Invoke-CancipEval -TimeoutSeconds 25 -Code @'
(()=>{const v=app.workspace.getLeavesOfType('cancip-view')[0]?.view;if(!v)throw new Error('Cancip view unavailable');const now=new Date().toISOString(),runs=Array.from({length:4},(_,i)=>({id:'payload-run-'+i,action:{type:'read',path:'Folder/File'+i+'.md'},summary:'read file '+i,status:'executed',createdAt:now,result:'x'.repeat(1800)}));window.__payloadSmoke={old:{messages:v.messages,manualTodos:v.manualTodos,queuedPrompts:v.queuedPrompts,taskControl:v.taskControl},runs};v.messages=[{id:'payload-user',role:'user',content:'previous user request',createdAt:Date.now()-3000},{id:'payload-answer',role:'assistant',content:'previous useful answer',createdAt:Date.now()-2000},{id:'payload-tools',role:'assistant',content:'<!-- cancip-process-message -->',createdAt:Date.now()-1000,toolRuns:runs}];v.manualTodos=[{id:'p1',text:'inspect target',done:true,sendToModel:true,source:'programmatic',createdAt:now},{id:'p2',text:'apply and verify',done:false,sendToModel:true,source:'programmatic',createdAt:now}];v.queuedPrompts=[{id:'send',prompt:'queued correction',createdAt:Date.now(),held:false},{id:'held',prompt:'HELD-MUST-NOT-BE-SENT',createdAt:Date.now(),held:true}];v.taskControl={originalPrompt:'fix target',taskGoal:'fix target',startedAt:now,updatedAt:now};return JSON.stringify({ready:true})})()
'@
    $routing = Invoke-CancipEval -TimeoutSeconds 25 -Code @'
(()=>{const v=app.workspace.getLeavesOfType('cancip-view')[0].view,runs=window.__payloadSmoke.runs,policy=v.promptPayloadPolicy('modify config and verify'),finalPolicyPrompt=v.modePrompt('modify config and verify'),block=v.taskControlBlockForModel('modify config and verify','modify config and verify'),continued=v.modelPromptForTurn('continue','fix target'),toolSummary=v.toolRunsForPrompt(runs,900,4);return JSON.stringify({includeWorkingState:policy.includeWorkingState,includeHistoryAnchors:policy.includeHistoryAnchors,finalOmitsEmpty:finalPolicyPrompt.includes('\u7a7a\u9879')&&finalPolicyPrompt.includes('\u4ec5\u8bfb\u53d6')&&finalPolicyPrompt.includes('\u4e0d\u89e3\u91ca'),blockLength:block.length,blockHasStatic:/Plan discipline|Need missing details/.test(block),blockHasHeld:block.includes('HELD-MUST-NOT-BE-SENT'),continueHasFullState:/Latest session state|Recent tool results/.test(continued),toolSummaryLength:toolSummary.length})})()
'@
    $packingCode = @'
(()=>{const v=app.workspace.getLeavesOfType('cancip-view')[0].view,nl=String.fromCharCode(10),memory='## Memory router index'+nl+('memory '.repeat(120)),packed=v.packPromptContext([memory,'## Active Skills'+nl+('skill instruction '.repeat(100)),'## @context:selected text'+nl+('selected '.repeat(100)),memory],700),single=['# Cancip Experience','','## 2026-07-12T00:00:00.000Z · executed','- Step: Workflow: one-off plugin setting','- Action: [{"type":"config","path":".cancip/config.json","set":{"enabled":true}}]','- Result: applied and verified'].join(nl),log=[single,'','## 2026-07-12T00:00:00.000Z · executed','- Step: Workflow: update plugin setting','- Action: [{"type":"config","path":".cancip/config.json","set":{"enabled":true}}]','- Result: applied and verified','','## 2026-07-12T00:01:00.000Z · executed','- Step: Workflow: update plugin setting','- Action: [{"type":"config","path":".cancip/config.json","set":{"enabled":true}}]','- Result: applied and verified again'].join(nl),recipes=v.buildExperienceSkillRecipes(log),singleRecipes=v.buildExperienceSkillRecipes(single);return JSON.stringify({packedLength:packed.length,packedHasSkill:packed.includes('Active Skills'),packedHasExplicit:packed.includes('@context:selected text'),memoryCount:(packed.match(/Memory router index/g)||[]).length,recipeCount:recipes.length,recipeHasAction:!!recipes[0]?.content?.includes('"type":"config"'),singleRecipeSkipped:singleRecipes.length===0})})()
'@
    $packing = Invoke-CancipEval -TimeoutSeconds 25 -Code (ConvertTo-CancipEvalBootstrap -Code $packingCode)
    $item = [pscustomobject]@{
      id = 'programmatic.prompt-payload-priority-and-experience-skill'
      elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds
      includeWorkingState = $routing.includeWorkingState
      includeHistoryAnchors = $routing.includeHistoryAnchors
      finalOmitsEmpty = $routing.finalOmitsEmpty
      blockLength = $routing.blockLength
      blockHasStatic = $routing.blockHasStatic
      blockHasHeld = $routing.blockHasHeld
      continueHasFullState = $routing.continueHasFullState
      toolSummaryLength = $routing.toolSummaryLength
      packedLength = $packing.packedLength
      packedHasSkill = $packing.packedHasSkill
      packedHasExplicit = $packing.packedHasExplicit
      memoryCount = $packing.memoryCount
      recipeCount = $packing.recipeCount
      recipeHasAction = $packing.recipeHasAction
      singleRecipeSkipped = $packing.singleRecipeSkipped
    }
    if (-not $item.includeWorkingState -or $item.includeHistoryAnchors) { throw "working state/history routing duplicated context: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.finalOmitsEmpty) { throw "final answer prompt does not omit empty/read-only/explanation sections: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.blockLength -gt 1400 -or $item.blockHasStatic -or $item.blockHasHeld) { throw "task state still contains repeated/static/held content: $($item | ConvertTo-Json -Compress)" }
    if ($item.continueHasFullState) { throw "continue prompt duplicated full session state: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.toolSummaryLength -gt 920) { throw "tool result batch exceeded total budget: $($item.toolSummaryLength)" }
    if ([int]$item.packedLength -gt 700 -or -not $item.packedHasSkill -or -not $item.packedHasExplicit -or [int]$item.memoryCount -ne 1) { throw "priority context packing failed: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.recipeCount -ne 1 -or -not $item.recipeHasAction -or -not $item.singleRecipeSkipped) { throw "experience recipe threshold/action template failed: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; packedLength = $item.packedLength; toolSummaryLength = $item.toolSummaryLength }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.prompt-payload-priority-and-experience-skill'; pass = $false; error = $_.Exception.Message }
  } finally {
    try {
      $null = Invoke-CancipEval -TimeoutSeconds 25 -Code @'
(()=>{const v=app.workspace.getLeavesOfType('cancip-view')[0]?.view,o=window.__payloadSmoke?.old;if(v&&o){v.messages=o.messages;v.manualTodos=o.manualTodos;v.queuedPrompts=o.queuedPrompts;v.taskControl=o.taskControl;v.renderMessages();v.renderQueueStatus()}delete window.__payloadSmoke;return JSON.stringify({restored:true})})()
'@
    } catch {
      Write-Host "Prompt payload smoke cleanup warning: $($_.Exception.Message)"
    }
  }
}

if (-not $Case -or 'programmatic.no-synthetic-empty-final'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldMessages=JSON.parse(JSON.stringify(v.messages||[]));
  try{
    v.messages=[];
    const emptyOk=v.ensurePlainFinalConclusion(Date.now(),'empty-final-smoke');
    const afterEmpty=v.messages.length;
    v.messages=[{id:'blank-assistant',role:'assistant',content:'',createdAt:Date.now()}];
    const blankOk=v.ensurePlainFinalConclusion(Date.now(),'empty-final-smoke');
    const synthetic=(v.messages||[]).some((m)=>String(m.content||'').includes('no visible answer'));
    return JSON.stringify({id:'programmatic.no-synthetic-empty-final',elapsedMs:Date.now()-t,emptyOk,afterEmpty,blankOk,synthetic,messageCount:v.messages.length});
  } finally {
    v.messages=oldMessages;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ($item.emptyOk) { throw 'empty message list was treated as final answer' }
    if ([int]$item.afterEmpty -ne 0) { throw "empty final synthesized a message count $($item.afterEmpty)" }
    if ($item.blankOk) { throw 'blank assistant message was treated as final answer' }
    if ($item.synthetic) { throw 'synthetic no-visible-final text was generated' }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.no-synthetic-empty-final'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.fuzzy-vault-path-resolution'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const path='Cancip验收-临时/Fuzzy-Path-Smoke.md';
  const typo='Cancip验收-临时/Fuzzy Path Smoke.md';
  if(v.readOnlyActionCache&&typeof v.readOnlyActionCache.clear==='function')v.readOnlyActionCache.clear();
  await app.vault.adapter.mkdir('Cancip验收-临时').catch(()=>{});
  await app.vault.adapter.write(path,'alpha old beta\n');
  try{
    const readRun=v.createToolRun({type:'read',path:typo,maxChars:200});
    const readText=await v.executeToolRun(readRun);
    const patchRun=v.createToolRun({type:'patch',path:typo,find:'old',replace:'new'});
    await v.executeToolRun(patchRun);
    const finalText=await app.vault.adapter.read(path);
    return JSON.stringify({id:'programmatic.fuzzy-vault-path-resolution',elapsedMs:Date.now()-t,readPath:readRun.action.path,patchPath:patchRun.action.path,readOk:readText.includes('alpha old beta'),finalText});
  } finally {
    await app.vault.adapter.remove(path).catch(()=>{});
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ($item.readPath -ne 'Cancip验收-临时/Fuzzy-Path-Smoke.md') { throw "read path not resolved: $($item.readPath)" }
    if ($item.patchPath -ne 'Cancip验收-临时/Fuzzy-Path-Smoke.md') { throw "patch path not resolved: $($item.patchPath)" }
    if (-not $item.readOk) { throw 'fuzzy read did not return expected content' }
    if (-not ([string]$item.finalText).Contains('alpha new beta')) { throw "fuzzy patch did not update file: $($item.finalText)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.fuzzy-vault-path-resolution'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.reasoning-filter'.Contains($Case)) {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const leaves=app.workspace.getLeavesOfType('cancip-view');
  const fallback=leaves&&leaves[0]?leaves[0].view:null;
  const v=p&&typeof p.activateView==='function'?p.activateView():fallback;
  return Promise.resolve(v).then((view)=>{
    if(!view)throw new Error('Cancip view unavailable');
    const id='smoke-reasoning-filter-'+Date.now();
    const sample=[
      '\uFF081\uFF09\u8FDC\u7A0B\u4F1A\u8BCA\u5BF9\u63A5\u6A21\u677F\u91CC\u9700\u8981\u66FF\u6362\u4EBA\u6570\uFF0C\u8FD9\u91CC\u5148\u5206\u6790\u7528\u6237\u610F\u56FE\u3002',
      '\u53E6\u5916\u6CE8\u610F\u201C\u8FDC\u7A0B\u4F1A\u8BCA\u5BF9\u63A5\u201D\u90E8\u5206\uFF0C\u65B0\u5185\u5BB9\u91CC\u6709\u591A\u4E2A\u6A21\u677F\u3002',
      '\u9700\u8981\u6570\u4E00\u4E0B\u79D1\u5BA4\u5408\u8BA1\uFF0C\u4FDD\u6301\u7528\u6237\u7ED9\u51FA\u7684\u987A\u5E8F\u3002',
      '',
      '\u6700\u7EC8\u8F93\u51FA\u683C\u5F0F\uFF1A',
      '1. \u8FDC\u7A0B\u4F1A\u8BCA\u5BF9\u63A5\uFF0C\u5580\u4E8C\u4EBA\uFF0C\u5957\u4F9D\u5DF4\u683C\u4E61\u4EBA\u3002',
      '2. \u767B\u8BB0\u8F6C\u9662\u75C5\u4EBA\u517123\u4EBA\uFF1A\u9AA8\u79D15\u4EBA\u3001\u773C\u8033\u9F3B\u5589\u79D14\u4EBA\u3002',
      '',
      '\u6CE8\u610F\u987A\u5E8F\uFF1A\u6309\u7528\u6237\u7ED9\u51FA\u7684\u987A\u5E8F\u3002',
      '\u6700\u7EC8\u56DE\u7B54\u76F4\u63A5\u8F93\u51FA\u6574\u7406\u540E\u7684\u5185\u5BB9\uFF0C\u4E0D\u9700\u8981\u89E3\u91CA\u3002'
    ].join('\n');
    view.messages.push({id,role:'assistant',content:sample,createdAt:new Date().toISOString()});
    view.renderMessages();
    const el=view.messagesEl?view.messagesEl.querySelector('[data-message-id="'+id+'"]'):null;
    const visible=String(el&&el.innerText?el.innerText:'');
    view.messages=view.messages.filter((m)=>m.id!==id);
    view.renderMessages();
    const hasFinal=visible.indexOf('\u8FDC\u7A0B\u4F1A\u8BCA\u5BF9\u63A5\uFF0C\u5580\u4E8C\u4EBA')>=0;
    const leaked=visible.indexOf('\u53E6\u5916\u6CE8\u610F')>=0||visible.indexOf('\u7528\u6237\u610F\u56FE')>=0||visible.indexOf('\u6700\u7EC8\u56DE\u7B54\u76F4\u63A5')>=0;
    return JSON.stringify({id:'programmatic.reasoning-filter',elapsedMs:Date.now()-t,hasFinal,leaked,visible:visible.slice(0,800)});
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.hasFinal) { throw "final answer disappeared: $($item.visible)" }
    if ($item.leaked) { throw "reasoning/meta leaked: $($item.visible)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.reasoning-filter'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.prose-approval-action-required'.Contains($Case)) {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const leaves=app.workspace.getLeavesOfType('cancip-view');
  const view=p&&typeof p.activateView==='function'?p.activateView():(leaves&&leaves[0]?leaves[0].view:null);
  return Promise.resolve(view).then((v)=>{
    if(!v)throw new Error('Cancip view unavailable');
    if(typeof v.proseApprovalRequiresToolAction!=='function')throw new Error('missing prose approval guard');
    const visible='\u9700\u8981\u6267\u884C\uFF1A\u6253\u5F00 Obsidian \u4ECA\u65E5\u65E5\u8BB0\u3002';
    const task='\u6253\u5F00\u4ECA\u65E5\u65E5\u8BB0';
    const blocked=v.proseApprovalRequiresToolAction(visible,task);
    const completed=v.proseApprovalRequiresToolAction('\u5DF2\u6267\u884C\uFF1A\u6253\u5F00 Obsidian \u4ECA\u65E5\u65E5\u8BB0\u3002',task);
    return JSON.stringify({id:'programmatic.prose-approval-action-required',elapsedMs:Date.now()-t,blocked,completed});
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.blocked) { throw 'prose approval request was not classified as missing action' }
    if ($item.completed) { throw 'completed execution text was misclassified as missing action' }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.prose-approval-action-required'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.obsidian-execute-unresolved-fails'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const leaves=app.workspace.getLeavesOfType('cancip-view');
  const v=p&&typeof p.activateView==='function'?await p.activateView():(leaves&&leaves[0]?leaves[0].view:null);
  if(!v)throw new Error('Cancip view unavailable');
  let failed=false;
  let message='';
  try{
    await v.executeCommandAction('obsidian.execute',{query:'__cancip_no_such_command__'});
  }catch(e){
    failed=true;
    message=String(e&&e.message?e.message:e);
  }
  return JSON.stringify({id:'programmatic.obsidian-execute-unresolved-fails',elapsedMs:Date.now()-t,failed,message});
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.failed) { throw 'unresolved obsidian.execute did not fail' }
    if (-not ([string]$item.message).Contains('Obsidian command not executed')) { throw "unexpected unresolved error: $($item.message)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.obsidian-execute-unresolved-fails'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.js-action-alias'.Contains($Case)) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldMode=p.settings.accessMode;
  p.settings.accessMode='full-access';
  try{
    const fence=String.fromCharCode(96,96,96);
    const answer=fence+'cancip-action\n'+JSON.stringify({action:'js.eval',expression:'({ok:true, pluginCount:Object.keys(plugins).length})'})+'\n'+fence;
    const result=await v.handleActionBlocks(answer, undefined);
    const run=result?.runs?.[0]||null;
    const summary=String(run?.result||run?.summary||'');
    return JSON.stringify({id:'programmatic.js-action-alias',elapsedMs:Date.now()-t,executed:!!result?.executed,runs:result?.runs?.length||0,summary});
  } finally {
    p.settings.accessMode=oldMode;
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 60
    if (-not $item.executed -or [int]$item.runs -lt 1) { throw 'js.eval action alias block was not executed' }
    if (-not ([string]$item.summary).Contains('pluginCount')) { throw "js.eval action result missing pluginCount: $($item.summary)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.js-action-alias'; pass = $false; error = $_.Exception.Message }
  }
}

if ($Write -and (-not $Case -or 'programmatic.action-alias-write'.Contains($Case))) {
  try {
    $code = @"
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!v)throw new Error('Cancip view unavailable');
  const oldMode=p.settings.accessMode;
  const path='.cancip/action-alias-'+Date.now()+'.md';
  const content='alias action write ok';
  p.settings.accessMode='full-access';
  try{
    const fence=String.fromCharCode(96,96,96);
    const answer=fence+'cancip-action\n'+JSON.stringify({action:'write',path,content})+'\n'+fence;
    const result=await v.handleActionBlocks(answer, undefined);
    const read=await v.executeAction({type:'read',path,maxChars:200});
    await v.executeAction({type:'delete',path,permanent:true});
    return JSON.stringify({id:'programmatic.action-alias-write',elapsedMs:Date.now()-t,executed:!!result?.executed,runs:result?.runs?.length||0,read});
  } finally {
    p.settings.accessMode=oldMode;
  }
})()
"@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 60
    if (-not $item.executed -or [int]$item.runs -lt 1) { throw 'action alias block was not executed' }
    if (-not ([string]$item.read).Contains('alias action write ok')) { throw "alias write readback missing: $($item.read)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.action-alias-write'; pass = $false; error = $_.Exception.Message }
  }
}

if ($Write -and (-not $Case -or 'programmatic.ai-vault-review-capture'.Contains($Case))) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!p||!v)throw new Error('Cancip plugin or view unavailable');
  const adapter=app.vault.adapter;
  const root='Cancip验收-临时/ai-review-'+Date.now();
  const note=root+'/note.md';
  const sourceDir=root+'/source';
  const sourceNote=sourceDir+'/nested.md';
  const copiedDir=root+'/copied';
  const copiedNote=copiedDir+'/nested.md';
  const handles=[];
  const cleanup=async()=>{
    while(handles.length){try{p.endAiVaultMutationCapture(handles.pop());}catch{}}
    for(const path of [copiedNote,sourceNote,note]){
      try{
        const file=app.vault.getAbstractFileByPath(path);
        if(file)await app.vault.delete(file,true);else if(await adapter.exists(path))await adapter.remove(path);
      }catch{}
    }
    for(const path of [copiedDir,sourceDir,root]){try{if(await adapter.exists(path))await adapter.rmdir(path,true);}catch{}}
  };
  try{
    await app.vault.createFolder(root);
    await app.vault.createFolder(sourceDir);
    const noteFile=await app.vault.create(note,'manual baseline\n');
    await app.vault.create(sourceNote,'source note\n');

    const direct=p.beginAiVaultMutationCapture('session:smoke:direct-api:scope:'+note);handles.push(direct);
    await app.vault.modify(noteFile,'AI direct edit\n');
    const directCapture=p.endAiVaultMutationCapture(direct);handles.pop();
    const directItems=await v.reviewItemsFromCapturedAiMutations(directCapture);

    await app.vault.modify(noteFile,'manual baseline\n');
    const automation=p.beginAiVaultMutationCapture('automation:smoke:background:scope:'+note);handles.push(automation);
    await adapter.write(note,'AI automation edit\n');
    const automationCapture=p.endAiVaultMutationCapture(automation);handles.pop();
    const automationItems=await v.reviewItemsFromCapturedAiMutations(automationCapture);

    await app.vault.modify(noteFile,'manual baseline\n');
    const outer=p.beginAiVaultMutationCapture('automation:smoke:outer:scope:'+note);handles.push(outer);
    const inner=p.beginAiVaultMutationCapture('session:smoke:inner-tool:scope:'+note);handles.push(inner);
    await adapter.write(note,'AI nested edit\n');
    const innerCapture=p.endAiVaultMutationCapture(inner);handles.pop();
    const outerCapture=p.endAiVaultMutationCapture(outer);handles.pop();

    const folderCopy=p.beginAiVaultMutationCapture('automation:smoke:folder-copy:scope:'+sourceDir+'|'+copiedDir);handles.push(folderCopy);
    await adapter.copy(sourceDir,copiedDir);
    const folderCopyCapture=p.endAiVaultMutationCapture(folderCopy);handles.pop();
    const folderCopyItems=await v.reviewItemsFromCapturedAiMutations(folderCopyCapture);

    await app.vault.modify(noteFile,'manual after capture\n');
    const stackDepth=p.aiVaultMutationCaptureStack.length;
    return JSON.stringify({
      id:'programmatic.ai-vault-review-capture',
      elapsedMs:Date.now()-t,
      direct:directItems.map((item)=>({path:item.path,old:item.old_text,new:item.new_text,changes:item.changes})),
      automation:automationItems.map((item)=>({path:item.path,old:item.old_text,new:item.new_text,changes:item.changes})),
      nested:{innerBefore:innerCapture.before.length,outerBefore:outerCapture.before.length},
      folderCopy:folderCopyItems.map((item)=>({path:item.path,changes:item.changes,structure:item.structure})),
      stackDepth
    });
  } finally {
    await cleanup();
  }
})().catch((error)=>JSON.stringify({id:'programmatic.ai-vault-review-capture',evalError:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''}))
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 90
    if ([string]$item.evalError) { throw "AI Vault review eval failed: $($item.evalError)`n$($item.stack)" }
    if (@($item.direct).Count -ne 1 -or -not ([string]$item.direct[0].old).Contains('manual baseline') -or -not ([string]$item.direct[0].new).Contains('AI direct edit')) {
      throw "direct Vault API edit was not captured correctly: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    if (@($item.automation).Count -ne 1 -or -not ([string]$item.automation[0].new).Contains('AI automation edit')) {
      throw "automation edit was not captured correctly: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    if ([int]$item.nested.innerBefore -ne 1 -or [int]$item.nested.outerBefore -ne 0) {
      throw "nested capture duplicated AI edits: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    if (@($item.folderCopy).Count -ne 1 -or -not ([string]$item.folderCopy[0].path).EndsWith('/copied/nested.md')) {
      throw "folder copy did not produce a per-note review item: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    if ([int]$item.stackDepth -ne 0) { throw "AI mutation capture stack leaked: $($item.stackDepth)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.ai-vault-review-capture'; pass = $false; error = $_.Exception.Message }
  }
}

if ($Write -and (-not $Case -or 'programmatic.ai-vault-review-registration'.Contains($Case))) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():null;
  if(!p||!v)throw new Error('Cancip plugin or view unavailable');
  const adapter=app.vault.adapter;
  const root='Cancip验收-临时/review-registration-'+Date.now();
  const path=root+'/note.md';
  const renamePath=root+'/rename-source.md';
  const renamedPath=root+'/rename-target.md';
  let handle=null;
  const reviewPaths=[];
  try{
    await app.vault.createFolder(root);
    await app.vault.create(path,'manual baseline\n');
    await app.vault.create(renamePath,'rename baseline\n');
    handle=p.beginAiVaultMutationCapture('automation:smoke:registration');
    await adapter.write(path,'AI automation edit\n');
    const captured=p.endAiVaultMutationCapture(handle);handle=null;
    const firstReviewPath=await v.registerCapturedAiMutationReview(captured,'Smoke automation first edit');
    reviewPaths.push(firstReviewPath);
    const firstManifest=JSON.parse(await adapter.read(firstReviewPath));

    handle=p.beginAiVaultMutationCapture('automation:smoke:registration-second');
    await adapter.write(path,'AI automation edit two\n');
    const secondCaptured=p.endAiVaultMutationCapture(handle);handle=null;
    const secondItems=await v.reviewItemsFromCapturedAiMutations(secondCaptured);
    const secondReviewPath=await v.registerCapturedAiMutationReview(secondCaptured,'Smoke automation second edit');
    reviewPaths.push(secondReviewPath);
    const secondManifest=JSON.parse(await adapter.read(secondReviewPath));
    const firstFolder=firstReviewPath.replace(/\/manifest\.json$/,'');
    const supersedeLog=await adapter.read(firstFolder+'/review-corrections/pending.jsonl');
    const superseded=supersedeLog.split(/\r?\n/).filter(Boolean).some((line)=>{try{return JSON.parse(line).superseded===true;}catch{return false;}});
    await adapter.write(path,'manual hand edit\n');
    handle=p.beginAiVaultMutationCapture('automation:smoke:registration-third');
    await adapter.write(path,'AI after hand edit\n');
    const thirdCaptured=p.endAiVaultMutationCapture(handle);handle=null;
    const thirdItems=await v.reviewItemsFromCapturedAiMutations(thirdCaptured);
    handle=p.beginAiVaultMutationCapture('automation:smoke:rename-only');
    await adapter.rename(renamePath,renamedPath);
    const renameCaptured=p.endAiVaultMutationCapture(handle);handle=null;
    const renameItems=await v.reviewItemsFromCapturedAiMutations(renameCaptured);
    return JSON.stringify({
      id:'programmatic.ai-vault-review-registration',
      elapsedMs:Date.now()-t,
      reviewPaths,
      itemPaths:(firstManifest.items||[]).map((item)=>item.path),
      secondOld:secondItems[0]?.old_text||'',
      secondNew:(secondManifest.items||[])[0]?.new_text||'',
      thirdOld:thirdItems[0]?.old_text||'',
      thirdNew:thirdItems[0]?.new_text||'',
      renameOnly:renameItems.map((item)=>({path:item.path,old:item.old_text,new:item.new_text,changes:item.changes,structure:item.structure})),
      superseded
    });
  } finally {
    if(handle)try{p.endAiVaultMutationCapture(handle);}catch{}
    for(const reviewPath of reviewPaths.reverse()){try{const folder=reviewPath.replace(/\/manifest\.json$/,'');if(await adapter.exists(folder))await adapter.rmdir(folder,true);}catch{}}
    for(const cleanupPath of [path,renamePath,renamedPath]){
      try{const file=app.vault.getFileByPath(cleanupPath);if(file)await app.vault.delete(file,true);else if(await adapter.exists(cleanupPath))await adapter.remove(cleanupPath);}catch{}
    }
    try{if(await adapter.exists(root))await adapter.rmdir(root,true);}catch{}
  }
})().catch((error)=>JSON.stringify({id:'programmatic.ai-vault-review-registration',evalError:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''}))
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 60
    if ([string]$item.evalError) { throw "AI Vault review registration eval failed: $($item.evalError)`n$($item.stack)" }
    if (@($item.reviewPaths).Count -ne 2 -or [string]$item.reviewPaths[0] -eq [string]$item.reviewPaths[1] -or @($item.itemPaths).Count -ne 1 -or -not ([string]$item.itemPaths[0]).EndsWith('/note.md')) {
      throw "automation edit did not enter the native review package: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    if (-not ([string]$item.secondOld).Contains('manual baseline') -or -not ([string]$item.secondNew).Contains('AI automation edit two') -or -not $item.superseded) {
      throw "repeated AI edits did not preserve one manual baseline and supersede the older review: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    if (-not ([string]$item.thirdOld).Contains('manual hand edit') -or -not ([string]$item.thirdNew).Contains('AI after hand edit')) {
      throw "manual edit after pending review was not used as the next baseline: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    if (@($item.renameOnly).Count -ne 1 -or [string]$item.renameOnly[0].old -ne [string]$item.renameOnly[0].new -or -not (@($item.renameOnly[0].changes) -contains 'rename')) {
      throw "rename-only review was incorrectly treated as content rewrite: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.ai-vault-review-registration'; pass = $false; error = $_.Exception.Message }
  }
}

if ($Write -and (-not $Case -or 'programmatic.ai-vault-review-rollback'.Contains($Case))) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():null;
  if(!p||!v)throw new Error('Cancip plugin or view unavailable');
  const adapter=app.vault.adapter;
  const root='Cancip验收-临时/review-rollback-'+Date.now();
  const path=root+'/note.md';
  let handle=null;
  try{
    await app.vault.createFolder(root);
    await app.vault.create(path,'manual baseline\n');
    handle=p.beginAiVaultMutationCapture('session:smoke:rollback');
    await adapter.write(path,'unregistered AI edit\n');
    const captured=p.endAiVaultMutationCapture(handle);handle=null;
    const items=await v.reviewItemsFromCapturedAiMutations(captured);
    await v.rollbackUnregisteredAiReviewItems(items);
    return JSON.stringify({id:'programmatic.ai-vault-review-rollback',elapsedMs:Date.now()-t,itemCount:items.length,text:await adapter.read(path)});
  } finally {
    if(handle)try{p.endAiVaultMutationCapture(handle);}catch{}
    try{const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file,true);if(await adapter.exists(root))await adapter.rmdir(root,true);}catch{}
  }
})().catch((error)=>JSON.stringify({id:'programmatic.ai-vault-review-rollback',evalError:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''}))
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 60
    if ([string]$item.evalError) { throw "AI Vault review rollback eval failed: $($item.evalError)`n$($item.stack)" }
    if ([int]$item.itemCount -ne 1 -or [string]$item.text -ne "manual baseline`n") {
      throw "unregistered AI edit was not rolled back: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.ai-vault-review-rollback'; pass = $false; error = $_.Exception.Message }
  }
}

if ($Write -and (-not $Case -or 'programmatic.ai-vault-command-review'.Contains($Case))) {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():null;
  if(!p||!v)throw new Error('Cancip plugin or view unavailable');
  const adapter=app.vault.adapter;
  const root='Cancip验收-临时/command-review-'+Date.now();
  const path=root+'/api-note.md';
  let reviewPath='';
  try{
    await app.vault.createFolder(root);
    const run=v.createToolRun({type:'command',command:'obsidian.eval',args:{code:`window.setTimeout(()=>{void vault.create(${JSON.stringify(path)}, 'AI command API edit\\n');},75); return 'scheduled';`}});
    await v.executeToolRun(run);
    reviewPath=run.reviewPath||'';
    const manifest=reviewPath?JSON.parse(await adapter.read(reviewPath)):null;
    return JSON.stringify({
      id:'programmatic.ai-vault-command-review',
      elapsedMs:Date.now()-t,
      status:run.status,
      reviewRequired:run.reviewRequired===true,
      reviewPath,
      itemPaths:(manifest?.items||[]).map((item)=>item.path),
      text:await adapter.read(path)
    });
  } finally {
    if(reviewPath){try{const folder=reviewPath.replace(/\/manifest\.json$/,'');if(await adapter.exists(folder))await adapter.rmdir(folder,true);}catch{}}
    try{const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file,true);else if(await adapter.exists(path))await adapter.remove(path);if(await adapter.exists(root))await adapter.rmdir(root,true);}catch{}
  }
})().catch((error)=>JSON.stringify({id:'programmatic.ai-vault-command-review',evalError:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''}))
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 60
    if ([string]$item.evalError) { throw "AI command review eval failed: $($item.evalError)`n$($item.stack)" }
    if ([string]$item.status -ne 'executed' -or -not $item.reviewRequired -or -not [string]$item.reviewPath -or @($item.itemPaths).Count -ne 1 -or -not ([string]$item.itemPaths[0]).EndsWith('/api-note.md')) {
      throw "Obsidian command/API edit did not enter review: $($item | ConvertTo-Json -Compress -Depth 12)"
    }
    if (-not ([string]$item.text).Contains('AI command API edit')) { throw "Obsidian command/API edit readback failed: $($item | ConvertTo-Json -Compress -Depth 12)" }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.ai-vault-command-review'; pass = $false; error = $_.Exception.Message }
  }
}

if ($Write -and (Should-RunProgrammaticCase 'programmatic.document-workbench-write')) {
  try {
    $code = @'
(async()=>{
  const t=Date.now(),p=app.plugins.plugins.cancip,root='Cancip验收-临时/document-workbench',sourcePath=`${root}/source.html`;
  if(!p||typeof p.saveDocumentTextSource!=='function'||typeof p.exportDocumentConversion!=='function')throw new Error('document write API unavailable');
  const created=[];
  try{
    if(!(await app.vault.adapter.exists(root)))await app.vault.createFolder(root);
    let source=app.vault.getFileByPath(sourcePath);
    if(source)await app.vault.delete(source,true);
    source=await app.vault.create(sourcePath,'<!doctype html><html><body><h1>Alpha</h1><p>One</p></body></html>');
    created.push(sourcePath);
    const snapshot=await p.loadDocumentSnapshot(source);
    await p.saveDocumentTextSource(source,'<!doctype html><html><body><h1>Beta</h1><p>Two</p></body></html>');
    const sourceReadback=await app.vault.read(source);
    const mdPath=await p.exportDocumentConversion(source,'# Converted\n\n- verified','md');
    const htmlPath=await p.exportDocumentConversion(source,'# Converted\n\n- verified','html');
    created.push(mdPath,htmlPath);
    const md=await app.vault.read(app.vault.getFileByPath(mdPath));
    const html=await app.vault.read(app.vault.getFileByPath(htmlPath));
    return JSON.stringify({id:'programmatic.document-workbench-write',elapsedMs:Date.now()-t,editable:snapshot.editableSource,kind:snapshot.kind,sourceVerified:sourceReadback.includes('<h1>Beta</h1>'),mdVerified:md.includes('# Converted')&&md.includes('verified'),htmlVerified:/<!doctype html>/i.test(html)&&html.includes('Converted')&&html.includes('verified'),paths:created.length});
  } finally {
    for(const path of created.reverse()){const file=app.vault.getFileByPath(path);if(file)await app.vault.delete(file,true);}
    const folder=app.vault.getFolderByPath(root);if(folder&&!folder.children.length)await app.vault.delete(folder,true);
    const parent=app.vault.getFolderByPath('Cancip验收-临时');if(parent&&!parent.children.length)await app.vault.delete(parent,true);
  }
})().catch((error)=>JSON.stringify({id:'programmatic.document-workbench-write',evalError:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''}))
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 90
    if ([string]$item.evalError) { throw "document write eval failed: $($item.evalError)`n$($item.stack)" }
    if (-not $item.editable -or [string]$item.kind -ne 'html' -or -not $item.sourceVerified -or -not $item.mdVerified -or -not $item.htmlVerified -or [int]$item.paths -ne 3) {
      throw "document save/conversion verification failed: $($item | ConvertTo-Json -Compress -Depth 8)"
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; paths = $item.paths }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.document-workbench-write'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.document-workbench-conversion') {
  try {
    $code = @'
(async()=>{
  const t=Date.now(),p=app.plugins.plugins.cancip,files=app.vault.getFiles();
  if(!p||typeof p.loadDocumentSnapshot!=='function')throw new Error('document conversion API unavailable');
  const safe=(ext)=>files.filter((file)=>file.extension.toLowerCase()===ext&&!file.path.toLowerCase().includes('/encript/')).sort((a,b)=>a.stat.size-b.stat.size)[0]||null;
  const expected={md:'markdown',html:'html',docx:'docx',xlsx:'xlsx',pdf:'pdf'};
  const samples=[];
  for(const [ext,kind] of Object.entries(expected)){
    const file=safe(ext);
    if(!file)continue;
    const snapshot=await p.loadDocumentSnapshot(file);
    samples.push({ext,kind:snapshot.kind,markdownLength:snapshot.markdown.length,editableSource:snapshot.editableSource,previewKind:snapshot.previewKind,warnings:snapshot.warnings.length,expectedKind:kind});
  }
  return JSON.stringify({id:'programmatic.document-workbench-conversion',elapsedMs:Date.now()-t,samples});
})().catch((error)=>JSON.stringify({id:'programmatic.document-workbench-conversion',evalError:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''}))
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 30
    if ([string]$item.evalError) { throw "document conversion eval failed: $($item.evalError)`n$($item.stack)" }
    foreach ($sample in @($item.samples)) {
      if ([string]$sample.kind -ne [string]$sample.expectedKind -or [int]$sample.markdownLength -le 0) { throw "document conversion failed for $($sample.ext): $($sample | ConvertTo-Json -Compress)" }
      if (@('docx','xlsx','pdf') -contains [string]$sample.ext -and $sample.editableSource) { throw "binary source became directly editable: $($sample | ConvertTo-Json -Compress)" }
    }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; samples = @($item.samples).Count }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.document-workbench-conversion'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.document-workbench-restore') {
  try {
    $code = @'
(async()=>{
  const t=Date.now(),p=app.plugins.plugins.cancip,type='cancip-document-workbench-view',workspace=app.workspace;
  if(!p||typeof p.restoreDocumentWorkbenchLeaf!=='function')throw new Error('document workbench restore API unavailable');
  let view=workspace.getLeavesOfType(type).find((leaf)=>leaf.view?.getIcon?.()==='panels-top-left')?.view??null,createdLeaf=null;
  try{
    if(!view){const file=app.vault.getFiles().find((entry)=>entry.extension.toLowerCase()==='md');view=await p.activateDocumentWorkbench(file,'preview');createdLeaf=workspace.getLeavesOfType(type).find((leaf)=>leaf.view===view)||null;}
    if(!view)throw new Error('real workbench fixture unavailable');
    const transitions=[],before=workspace.getLeavesOfType(type).length;
    const fakeLeaf={view:{getViewType:()=>type},getViewState:()=>({type,state:{filePath:'fixture.md',mode:'preview'},active:true}),setViewState:async(next)=>{transitions.push(next.type);fakeLeaf.view=next.type===type?view:{getViewType:()=>next.type};}};
    const restored=await p.restoreDocumentWorkbenchLeaf(fakeLeaf,true),after=workspace.getLeavesOfType(type).length;
    return JSON.stringify({id:'programmatic.document-workbench-restore',elapsedMs:Date.now()-t,restored,transitions,before,after});
  }finally{createdLeaf?.detach();}
})().catch((error)=>JSON.stringify({id:'programmatic.document-workbench-restore',evalError:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''}))
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 30
    if ([string]$item.evalError) { throw "document restore eval failed: $($item.evalError)`n$($item.stack)" }
    if (-not $item.restored -or (@($item.transitions) -join ',') -ne 'empty,cancip-document-workbench-view' -or [int]$item.after -ne [int]$item.before) { throw "stale workbench leaf was not restored in place: $($item | ConvertTo-Json -Compress -Depth 10)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; transitions = @($item.transitions) }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.document-workbench-restore'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.document-workbench-layout') {
  try {
    $mainSource = Get-Content -Raw -LiteralPath (Join-Path $Root 'src/main.ts') -Encoding UTF8
    if ($mainSource -notmatch 'id:\s*"workbench"' -or $mainSource -notmatch 'displayDocumentWorkbenchSettings' -or $mainSource -notmatch 'restoreDocumentWorkbenchLeaves' -or $mainSource -notmatch 'documentWorkbenchReuseSingleLeaf') { throw 'document workbench settings, reuse, or leaf restoration source is missing' }
    $code = @'
(async()=>{
  const t=Date.now(),p=app.plugins.plugins.cancip,type='cancip-document-workbench-view',workspace=app.workspace,sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
  if(!p)throw new Error('document workbench API unavailable');
  const leaves=[...workspace.getLeavesOfType(type)],leaf=leaves.find((candidate)=>candidate.view?.getIcon?.()==='panels-top-left')||null,activeBefore=workspace.getMostRecentLeaf();
  if(!leaf)throw new Error('visible workbench fixture unavailable');
  const view=leaf.view,root=view.contentEl,compactBefore=root.classList.contains('is-compact-header'),metadataHiddenBefore=root.classList.contains('is-metadata-hidden');
  try{
    root.addClass('is-compact-header');root.removeClass('is-metadata-hidden');await workspace.revealLeaf(leaf);await sleep(60);
    const body=root.querySelector('.obcc-document-body'),meta=root.querySelector('.obcc-document-meta'),toolbar=root.querySelector('.obcc-document-toolbar'),rootBox=root.getBoundingClientRect(),bodyBox=body?.getBoundingClientRect(),toolbarBox=toolbar?.getBoundingClientRect();
    const buttons=[...root.querySelectorAll('.obcc-document-mode,.obcc-document-action')].filter((button)=>button.getBoundingClientRect().width>0),rects=buttons.map((button)=>button.getBoundingClientRect());let overlaps=0;
    for(let i=0;i<rects.length;i+=1)for(let j=i+1;j<rects.length;j+=1)if(Math.min(rects[i].right,rects[j].right)-Math.max(rects[i].left,rects[j].left)>1&&Math.min(rects[i].bottom,rects[j].bottom)-Math.max(rects[i].top,rects[j].top)>1)overlaps+=1;
    const toolbarScrollable=toolbar&&['auto','scroll'].includes(getComputedStyle(toolbar).overflowX),outOfBounds=toolbarScrollable?0:rects.filter((rect)=>rect.left<rootBox.left-1||rect.right>rootBox.right+1).length;
    root.addClass('is-metadata-hidden');const metadataHidden=!meta||getComputedStyle(meta).display==='none',bodyTop=Math.round((bodyBox?.top??rootBox.bottom)-rootBox.top),compact=root.classList.contains('is-compact-header');
    return JSON.stringify({id:'programmatic.document-workbench-layout',elapsedMs:Date.now()-t,afterFirst:leaves.length,afterSecond:workspace.getLeavesOfType(type).length,reused:true,buttons:buttons.length,overlaps,outOfBounds,viewType:view.getViewType(),compact,bodyTop,toolbarHeight:Math.round(toolbarBox?.height??0),rootWidth:Math.round(rootBox.width),metaVisible:Boolean(meta),metadataHidden});
  }finally{
    root.toggleClass('is-compact-header',compactBefore);root.toggleClass('is-metadata-hidden',metadataHiddenBefore);
    if(activeBefore&&workspace.getMostRecentLeaf()!==activeBefore)workspace.setActiveLeaf(activeBefore,{focus:true});
  }
})().catch((error)=>JSON.stringify({id:'programmatic.document-workbench-layout',evalError:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''}))
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 40
    if ([string]$item.evalError) { throw "document workbench eval failed: $($item.evalError)`n$($item.stack)" }
    if ([string]$item.viewType -ne 'cancip-document-workbench-view' -or -not $item.reused -or [int]$item.afterSecond -ne [int]$item.afterFirst) { throw "document workbench did not reuse its file leaf: $($item | ConvertTo-Json -Compress -Depth 10)" }
    if ([int]$item.overlaps -ne 0 -or [int]$item.outOfBounds -ne 0 -or [int]$item.buttons -lt 6) { throw "document workbench controls overlap or overflow: $($item | ConvertTo-Json -Compress -Depth 10)" }
    if (-not $item.compact -or [int]$item.bodyTop -ge 130 -or [int]$item.toolbarHeight -gt 32 -or -not $item.metaVisible -or -not $item.metadataHidden) { throw "document workbench compact layout or metadata toggle failed: $($item | ConvertTo-Json -Compress -Depth 10)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; buttons = $item.buttons; bodyTop = $item.bodyTop; toolbarHeight = $item.toolbarHeight; rootWidth = $item.rootWidth }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.document-workbench-layout'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.mobile.layout-bounds') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!p||!v)throw new Error('Cancip plugin/view unavailable');
  await new Promise((resolve)=>setTimeout(resolve,100));
  const doc=v.contentEl.ownerDocument,win=doc.defaultView||window;
  const root=v.contentEl.matches('.obcc-root')?v.contentEl:v.contentEl.querySelector('.obcc-root');
  const header=root?.querySelector('.obcc-header');
  const messages=root?.querySelector('.obcc-messages');
  const footer=v.footerEl||doc.querySelector('.obcc-footer');
  const input=v.inputEl||root?.querySelector('.obcc-input');
  const send=v.sendButtonEl||root?.querySelector('.obcc-send');
  if(!root||!header||!messages||!footer||!input||!send)throw new Error('mobile layout element missing');
  const viewport={left:0,top:0,right:win.innerWidth,bottom:win.innerHeight};
  const rect=(el)=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
  const rr=rect(root),hr=rect(header),mr=rect(messages),fr=rect(footer),ir=rect(input),sr=rect(send);
  const visibleButtons=Array.from(root.querySelectorAll('button')).filter((el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).display!=='none'});
  const outOfBounds=visibleButtons.filter((el)=>{const r=el.getBoundingClientRect();return r.left<rr.left-1||r.right>rr.right+1||r.top<viewport.top-1||r.bottom>viewport.bottom+1}).length;
  const textOverflow=visibleButtons.filter((el)=>el.scrollWidth>el.clientWidth+2).length;
  return JSON.stringify({
    id:'programmatic.mobile.layout-bounds',elapsedMs:Date.now()-t,mobile:app.isMobile===true,
    viewport,root:rr,header:hr,messages:mr,footer:fr,input:ir,send:sr,
    outOfBounds,textOverflow,buttonCount:visibleButtons.length,
    headerMessagesOverlap:Math.max(0,hr.bottom-mr.top),messagesFooterOverlap:Math.max(0,mr.bottom-fr.top),
    bodyOverflow:doc.documentElement.scrollWidth>win.innerWidth+2
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 30
    if (-not $item.mobile) { throw "Obsidian mobile emulation is not enabled: $($item | ConvertTo-Json -Compress)" }
    if ([double]$item.root.width -le 0 -or [double]$item.input.height -le 0 -or [double]$item.send.height -le 0) { throw "mobile composer is not visible: $($item | ConvertTo-Json -Compress)" }
    if ([int]$item.outOfBounds -ne 0 -or [int]$item.textOverflow -ne 0 -or $item.bodyOverflow) { throw "mobile controls overflow viewport: $($item | ConvertTo-Json -Compress)" }
    if ([double]$item.headerMessagesOverlap -gt 1 -or [double]$item.messagesFooterOverlap -gt 1) { throw "mobile layout regions overlap: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; buttons = $item.buttonCount }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.mobile.layout-bounds'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.mobile.keyboard-composer-scroll') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!p||!v||!v.inputEl||!v.footerEl||!v.messagesEl)throw new Error('Cancip mobile composer unavailable');
  const doc=v.contentEl.ownerDocument,win=doc.defaultView||window,root=v.contentEl;
  const oldValue=v.inputEl.value;
  const sentinel=doc.createElement('div');
  sentinel.className='obcc-mobile-keyboard-sentinel';
  sentinel.textContent='keyboard-scroll-end';
  sentinel.style.minHeight='2px';
  v.messagesEl.appendChild(sentinel);
  try{
    v.prepareInputFocus?.();
    v.inputEl.focus();
    win.dispatchEvent(new win.CustomEvent('keyboardDidShow',{detail:{keyboardHeight:300}}));
    v.inputEl.value='@';
    v.inputEl.setSelectionRange(1,1);
    v.inputEl.dispatchEvent(new win.Event('input',{bubbles:true}));
    const mentionDeadline=Date.now()+2500;
    while(Date.now()<mentionDeadline){
      const candidate=doc.querySelector('.obcc-mention-popover:not(.is-hidden)');
      if(candidate?.getBoundingClientRect().height>0)break;
      await new Promise((resolve)=>setTimeout(resolve,80));
    }
    v.messagesEl.scrollTop=v.messagesEl.scrollHeight;
    await new Promise((resolve)=>setTimeout(resolve,80));
    const footerRect=v.footerEl.getBoundingClientRect();
    const inputRect=v.inputEl.getBoundingClientRect();
    const sentinelRect=sentinel.getBoundingClientRect();
    const mention=doc.querySelector('.obcc-mention-popover:not(.is-hidden)');
    const mentionRect=mention?.getBoundingClientRect()||null;
    const messagesRect=v.messagesEl.getBoundingClientRect();
    const footerBottom=Math.max(0,Math.round(win.innerHeight-footerRect.bottom));
    const messageOcclusion=Math.round(parseFloat(getComputedStyle(root).getPropertyValue('--obcc-keyboard-occlusion'))||0);
    const messageClearance=Math.round(parseFloat(getComputedStyle(root).getPropertyValue('--obcc-message-footer-clearance'))||0);
    const lifted=root.classList.contains('has-visual-keyboard')&&v.footerEl.classList.contains('is-viewport-floating');
    const lastVisible=sentinelRect.bottom<=footerRect.top+2;
    const mentionVisible=!!mentionRect&&mentionRect.height>0&&mentionRect.bottom<=inputRect.top+2&&mentionRect.top>=-1;
    win.dispatchEvent(new win.CustomEvent('keyboardDidHide'));
    v.inputEl.blur();
    await new Promise((resolve)=>setTimeout(resolve,280));
    return JSON.stringify({
      id:'programmatic.mobile.keyboard-composer-scroll',elapsedMs:Date.now()-t,lifted,lastVisible,mentionVisible,
      footerBottom,messageOcclusion,footerTop:footerRect.top,inputTop:inputRect.top,sentinelBottom:sentinelRect.bottom,
      mentionBottom:mentionRect?.bottom??0,messageClearance,messagesBottom:messagesRect.bottom,
      messageScrollTop:v.messagesEl.scrollTop,messageScrollMax:v.messagesEl.scrollHeight-v.messagesEl.clientHeight,
      restored:!root.classList.contains('has-visual-keyboard')&&!v.footerEl.classList.contains('is-viewport-floating')
    });
  } finally {
    v.inputEl.value=oldValue;
    sentinel.remove();
    v.closeMentionPopup?.();
    win.dispatchEvent(new win.CustomEvent('keyboardDidHide'));
    v.inputEl.blur();
  }
})().catch((error)=>JSON.stringify({id:'programmatic.mobile.keyboard-composer-scroll',evalError:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''}))
'@
    $item = Invoke-CancipEval -Code (ConvertTo-CancipEvalBootstrap -Code $code) -TimeoutSeconds 45
    if ([string]$item.evalError) { throw "mobile keyboard eval failed: $($item.evalError)`n$($item.stack)" }
    if (-not $item.lifted -or [int]$item.footerBottom -lt 295) { throw "composer did not lift above native keyboard: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.lastVisible) { throw "last chat record remains behind keyboard/composer: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.mentionVisible) { throw "mention popover did not follow the lifted composer: $($item | ConvertTo-Json -Compress)" }
    if ([Math]::Abs([int]$item.messageOcclusion - [int]$item.footerBottom) -gt 3) { throw "message clearance does not match keyboard overlay: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.restored) { throw "composer did not dock after keyboard hide: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; keyboardInset = $item.footerBottom }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.mobile.keyboard-composer-scroll'; pass = $false; error = $_.Exception.Message }
  }
}

if (Should-RunProgrammaticCase 'programmatic.mobile.history-no-blank-leaf') {
  try {
    $code = @'
(async()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;
  if(!p||!v)throw new Error('Cancip plugin/view unavailable');
  const snapshot=()=>{const types=[];app.workspace.iterateAllLeaves((leaf)=>types.push(leaf.view?.getViewType?.()||''));return types};
  const before=snapshot(),activePath=app.workspace.getActiveFile()?.path||'';
  for(let index=0;index<4;index+=1)await p.getOrCreateChatView({reveal:false,focus:false});
  if(typeof v.openHistoryMenu==='function')await v.openHistoryMenu();
  if(typeof v.closeHeaderMenu==='function')v.closeHeaderMenu();
  const after=snapshot(),afterPath=app.workspace.getActiveFile()?.path||'';
  return JSON.stringify({
    id:'programmatic.mobile.history-no-blank-leaf',elapsedMs:Date.now()-t,
    beforeCount:before.length,afterCount:after.length,
    beforeCancip:before.filter((type)=>type==='cancip-view').length,afterCancip:after.filter((type)=>type==='cancip-view').length,
    beforeBlank:before.filter((type)=>!type||type==='empty').length,afterBlank:after.filter((type)=>!type||type==='empty').length,
    activePath,afterPath,historyClosed:!v.headerMenuEl||v.headerMenuEl.classList.contains('is-hidden')
  });
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ([int]$item.afterCount -ne [int]$item.beforeCount -or [int]$item.afterCancip -ne [int]$item.beforeCancip -or [int]$item.afterBlank -ne [int]$item.beforeBlank) { throw "history/view reuse created a new or blank leaf: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.activePath -ne [string]$item.afterPath -or -not $item.historyClosed) { throw "history inspection changed active file or remained overlaid: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; leaves = $item.afterCount }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.mobile.history-no-blank-leaf'; pass = $false; error = $_.Exception.Message }
  }
}

foreach ($test in $WriteCases) {
  if (-not $Write) {
    Add-CaseResult 'writeCases' @{ id = $test.id; skip = $true; reason = 'write tests require -Write' }
    continue
  }
  try {
    $testJson = ConvertTo-CompactJson $test
    $code = "(async()=>{const test=$testJson;const p=app.plugins.plugins.cancip;const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;if(!v)throw new Error('Cancip view unavailable');const t=Date.now();let text=String(await v.executeAction(test.action));let verifyText='';if(test.verify&&test.verify.action){verifyText=String(await v.executeAction(test.verify.action));}return JSON.stringify({id:test.id,elapsedMs:Date.now()-t,text:text.slice(0,1200),verifyText:verifyText.slice(0,1200)});})()"
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 60
    if ($test.verify -and $test.verify.contains) {
      foreach ($token in @($test.verify.contains)) {
        if (-not ([string]$item.verifyText).Contains([string]$token)) { throw "verify missing text: $token" }
      }
    }
    Add-CaseResult 'writeCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; text = $item.text; verifyText = $item.verifyText }
  } catch {
    Add-CaseResult 'writeCases' @{ id = $test.id; pass = $false; error = $_.Exception.Message }
  }
}

Write-FinalReport ($(if ($Report.ok) { 0 } else { 1 }))
