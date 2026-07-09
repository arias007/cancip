param(
  [switch]$Full,
  [switch]$Write,
  [switch]$DirectEval,
  [string]$Case = '',
  [switch]$VerboseReport,
  [switch]$FailFast
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$CasesPath = Join-Path $Root 'tests/cancip-regression-cases.json'
$ObqPath = 'C:/Users/35007/Documents/Codex/tools/ob-cli-queue/obq.ps1'
$ObsidianCliPath = 'C:/Program Files/Obsidian/Obsidian.com'
$InstalledCancipDataPath = 'E:/note/.obsidian/plugins/cancip/data.json'
$OutDir = Join-Path $Root 'reports'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Script:OriginalSessionId = ''
$Script:SmokeSessionId = ''
$Script:SkipSmokeSessionRestore = $false
$Script:SmokeSettingsSnapshotPath = ''

$AllCases = Get-Content -Raw -LiteralPath $CasesPath -Encoding UTF8 | ConvertFrom-Json
$RunProfile = if ($Case -like '*ui-button*') { 'ui-button' } elseif ($Write) { 'write' } elseif ($Full) { 'full' } else { 'core' }
$DefaultCommandIds = @(
  'command.tools.index',
  'command.memory.read.profile',
  'command.obsidian.currentView',
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
  'command.attachment.help'
)

$Report = [ordered]@{
  ok = $true
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  version = ''
  promptHead = ''
  writeEnabled = [bool]$Write
  full = [bool]$Full
  directEval = [bool]$DirectEval
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

if (Test-Path -LiteralPath $InstalledCancipDataPath) {
  $snapshotName = "cancip-smoke-data-before-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')).json"
  $Script:SmokeSettingsSnapshotPath = Join-Path $OutDir $snapshotName
  Copy-Item -LiteralPath $InstalledCancipDataPath -Destination $Script:SmokeSettingsSnapshotPath -Force
}

function ConvertTo-CompactJson {
  param([object]$Value)
  $Value | ConvertTo-Json -Compress -Depth 40
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
  return -not ($Id -like 'programmatic.ui-button-*')
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
    return 'Inspect approval/write execution and cleanup behavior under .cancip/test-lab.'
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
    $ProbeCode = "(()=>{const p=app.plugins.plugins.cancip;const leaves=app.workspace.getLeavesOfType('cancip-view');const v=leaves[0]?.view??null;const m=app.plugins.manifests.cancip;return JSON.stringify({ok:!!p,version:m?.version??'',promptHead:String(p?.settings?.systemPrompt||'').split('\n')[0],views:leaves.length,sessionId:v?.sessionId||'',devErrors:(p?.devErrors||[]).slice(-5)});})()"
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
    $StartSmokeSessionCode = "(async()=>{const p=app.plugins.plugins.cancip;const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;if(!v)throw new Error('Cancip view unavailable');await v.newChat();v.sessionTitleOverride='Cancip smoke';await v.saveCurrentSession();return JSON.stringify({ok:true,sessionId:v.sessionId});})()"
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
    review:'AI/Cancip/Review/smoke/manifest.json',
    hiddenReview:'.cancip/review-gates/smoke/manifest.json',
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
      review = 'review'
      hiddenReview = 'review'
      versions = 'versions'
    }
    foreach ($key in $expect.Keys) {
      if (-not (@($item.result.$key) -contains $expect[$key])) {
        throw "$key expected $($expect[$key]) got $(@($item.result.$key) -join ',')"
      }
    }
    Add-CaseResult 'programmaticCases' @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; result = $item.result }
  } catch {
    Add-CaseResult 'programmaticCases' @{ id = 'programmatic.vault-state-sync-classifier'; pass = $false; error = $_.Exception.Message }
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
    v.ensureFinalConclusion(result,Date.now(),false,'programmatic smoke');
    const noFinalAdded=v.messages.length===before;
    const reviewItems=await v.reviewItemsForPendingAction({type:'move',path:'AI/Cancip/Memory/PROFILE.md',newPath:'AI/Cancip/Memory/PROFILE-test-move.md'});
    const structure=reviewItems[0]?.structure?.[0]||null;
    const run=v.createToolRun({type:'write',path:'.cancip/test-lab/delta-preview-'+Date.now()+'.md',content:['a','b',''].join('\n')});
    await v.refreshToolRunLineDeltasFromAction(run);
    const lineDelta=run.lineDeltas?.[0]||null;
    return JSON.stringify({id:'programmatic.approval-review-line-delta',elapsedMs:Date.now()-t,pending,noFinalAdded,structureKind:structure?.kind||'',lineDelta});
  } finally {
    p.settings.accessMode=oldMode;
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.pending) { throw 'write action did not stay pending in approval mode' }
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
  const path='.cancip/test-lab/approval-continue-smoke.md';
  p.settings.accessMode='ask-for-approval';
  p.settings.autoContinueAfterTools=true;
  try{
    await app.vault.adapter.mkdir('.cancip/test-lab').catch(()=>{});
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
    if ($fallbackText -notmatch '\.cancip/config\.json') { throw "fallback missing config path: $fallbackText" }
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
    if ($fallbackText -notmatch '\.obsidian/plugins/cancip/manifest\.json') { throw "fallback missing manifest path: $fallbackText" }
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
        finalHasDetail:/Step details|步骤详情|<details>/.test(finalContent),
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
    if (-not $item.finalHasDetail) { throw 'final progress missing folded detail' }
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

if (-not $Case -or 'programmatic.specialist-routing'.Contains($Case)) {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  if(typeof p.specialistApiProfileForPrompt!=='function')throw new Error('missing specialist route helper');
  const old={
    enabled:p.settings.specialistRoutingEnabled,
    activeProfile:p.settings.activeApiProfileId,
    apiProfiles:[...(p.settings.apiProfiles||[])],
    profile:p.settings.mechanicalTaskApiProfileId,
    model:p.settings.mechanicalTaskModel,
    options:[...(p.settings.modelOptions||[])],
    routes:{...(p.settings.mechanicalTaskRoutes||{})}
  };
  try{
    p.settings.specialistRoutingEnabled=true;
    const explicitProfile={...(p.settings.apiProfiles||[])[0],id:'cancip-smoke-explicit-profile',name:'Smoke explicit profile',model:'cancip-smoke-explicit-profile-model'};
    p.settings.apiProfiles=[...(p.settings.apiProfiles||[]).filter((x)=>x&&x.id!=='cancip-smoke-explicit-profile'),explicitProfile];
    p.settings.mechanicalTaskApiProfileId='';
    p.settings.modelOptions=['gpt-5.5','qwen-plus','deepseek-chat','gpt-4o-mini'];
    p.settings.mechanicalTaskRoutes={contentRename:true,markdownBeautify:true,folderCleanup:true,frontmatterTags:true};
    p.settings.mechanicalTaskModel='cancip-smoke-mechanical';
    const routePrompt='rename Markdown notes based on file content';
    const hit=p.specialistApiProfileForPrompt(routePrompt);
    const miss=p.specialistApiProfileForPrompt('fix Cancip sidebar status bar button styles and plugin source code');
    p.settings.mechanicalTaskModel='';
    const auto=p.specialistApiProfileForPrompt(routePrompt);
    p.settings.mechanicalTaskRoutes={contentRename:false,markdownBeautify:true,folderCleanup:true,frontmatterTags:true};
    const disabled=p.specialistApiProfileForPrompt(routePrompt);
    const disabledKinds=p.mechanicalTaskRouteKindsForPrompt(routePrompt);
    return JSON.stringify({
      id:'programmatic.specialist-routing',
      elapsedMs:Date.now()-t,
      hitModel:hit&&hit.model,
      miss:miss===null,
      autoModel:auto&&auto.model,
      disabled:disabled===null,
      disabledKindCount:disabledKinds.length
    });
  } finally {
    p.settings.specialistRoutingEnabled=old.enabled;
    p.settings.activeApiProfileId=old.activeProfile;
    p.settings.apiProfiles=old.apiProfiles;
    p.settings.mechanicalTaskApiProfileId=old.profile;
    p.settings.mechanicalTaskModel=old.model;
    p.settings.modelOptions=old.options;
    p.settings.mechanicalTaskRoutes=old.routes;
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ($item.hitModel -ne 'cancip-smoke-mechanical') { throw "mechanical prompt did not route to specialist model: $($item.hitModel)" }
    if (-not $item.miss) { throw 'engineering prompt was incorrectly routed to specialist model' }
    if ($item.autoModel -ne 'qwen-plus') { throw "empty specialist model did not auto-pick cheap model: $($item.autoModel)" }
    if (-not $item.disabled -or [int]$item.disabledKindCount -ne 0) { throw "disabled contentRename route still matched: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; hitModel = $item.hitModel; autoModel = $item.autoModel }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.specialist-routing'; pass = $false; error = $_.Exception.Message }
  }
}

if (-not $Case -or 'programmatic.automation-mechanical-routing'.Contains($Case)) {
  try {
    $code = @'
(()=>{
  const t=Date.now();
  const p=app.plugins.plugins.cancip;
  if(!p)throw new Error('Cancip plugin unavailable');
  if(typeof p.automationApiProfile!=='function'||typeof p.automationModelPromptForTask!=='function')throw new Error('missing automation mechanical route helpers');
  const old={
    enabled:p.settings.specialistRoutingEnabled,
    activeProfile:p.settings.activeApiProfileId,
    apiProfiles:[...(p.settings.apiProfiles||[])],
    profile:p.settings.mechanicalTaskApiProfileId,
    model:p.settings.mechanicalTaskModel,
    options:[...(p.settings.modelOptions||[])],
    routes:{...(p.settings.mechanicalTaskRoutes||{})}
  };
  try{
    p.settings.specialistRoutingEnabled=true;
    const explicitProfile={...(p.settings.apiProfiles||[])[0],id:'cancip-smoke-explicit-profile',name:'Smoke explicit profile',model:'cancip-smoke-explicit-profile-model'};
    p.settings.apiProfiles=[...(p.settings.apiProfiles||[]).filter((x)=>x&&x.id!=='cancip-smoke-explicit-profile'),explicitProfile];
    p.settings.mechanicalTaskApiProfileId='';
    p.settings.modelOptions=['gpt-5.5','qwen-plus','deepseek-chat','gpt-4o-mini'];
    p.settings.mechanicalTaskRoutes={contentRename:true,markdownBeautify:true,folderCleanup:true,frontmatterTags:true};
    p.settings.mechanicalTaskModel='cancip-smoke-mechanical';
    const base={
      id:'auto-smoke-mechanical',
      title:'Batch content rename Markdown notes',
      prompt:'rename Markdown notes in this folder based on file content',
      schedule:'manual',
      enabled:true,
      intervalMinutes:60,
      hour:9,
      minute:0,
      sessionMode:'current',
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    const autoTask={...base,mechanical:'auto'};
    const autoProfile=p.automationApiProfile(autoTask);
    const autoPrompt=p.automationModelPromptForTask(autoTask).prompt;
    const offProfile=p.automationApiProfile({...base,mechanical:'off'});
    const offPrompt=p.automationModelPromptForTask({...base,mechanical:'off'}).prompt;
    const forcedTask={...base,title:'Daily exact task',prompt:'Review these files',mechanical:'on'};
    const forcedProfile=p.automationApiProfile(forcedTask);
    const forcedPrompt=p.automationModelPromptForTask(forcedTask).prompt;
    const routeOffTask={...base,mechanical:'auto',mechanicalRoutes:{contentRename:false,markdownBeautify:false,folderCleanup:false,frontmatterTags:false}};
    const routeOffProfile=p.automationApiProfile(routeOffTask);
    const explicitModelProfile=p.automationApiProfile({...base,mechanical:'auto',model:'cancip-smoke-explicit-model'});
    const explicitApiProfile=p.automationApiProfile({...base,mechanical:'auto',apiProfileId:'cancip-smoke-explicit-profile'});
    const explicitBothProfile=p.automationApiProfile({...base,mechanical:'auto',apiProfileId:'cancip-smoke-explicit-profile',model:'cancip-smoke-explicit-both-model'});
    return JSON.stringify({
      id:'programmatic.automation-mechanical-routing',
      elapsedMs:Date.now()-t,
      autoModel:autoProfile&&autoProfile.model,
      offModel:offProfile&&offProfile.model,
      forcedModel:forcedProfile&&forcedProfile.model,
      routeOffModel:routeOffProfile&&routeOffProfile.model,
      explicitModel:explicitModelProfile&&explicitModelProfile.model,
      explicitApiModel:explicitApiProfile&&explicitApiProfile.model,
      explicitBothModel:explicitBothProfile&&explicitBothProfile.model,
      autoGuard:/cancip-action JSON/.test(autoPrompt),
      offGuard:/cancip-action JSON/.test(offPrompt),
      forcedGuard:/cancip-action JSON/.test(forcedPrompt)
    });
  } finally {
    p.settings.specialistRoutingEnabled=old.enabled;
    p.settings.activeApiProfileId=old.activeProfile;
    p.settings.apiProfiles=old.apiProfiles;
    p.settings.mechanicalTaskApiProfileId=old.profile;
    p.settings.mechanicalTaskModel=old.model;
    p.settings.modelOptions=old.options;
    p.settings.mechanicalTaskRoutes=old.routes;
  }
})()
'@
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if ($item.autoModel -ne 'cancip-smoke-mechanical') { throw "automation auto task did not route to specialist model: $($item.autoModel)" }
    if ($item.offModel -eq 'cancip-smoke-mechanical') { throw "automation off task still routed to specialist model: $($item.offModel)" }
    if ($item.forcedModel -ne 'cancip-smoke-mechanical') { throw "automation forced task did not route to specialist model: $($item.forcedModel)" }
    if ($item.routeOffModel -eq 'cancip-smoke-mechanical') { throw "automation per-task route disabled but still routed: $($item | ConvertTo-Json -Compress)" }
    if ($item.explicitModel -ne 'cancip-smoke-explicit-model') { throw "automation explicit model was overridden by mechanical routing: $($item | ConvertTo-Json -Compress)" }
    if ($item.explicitApiModel -ne 'cancip-smoke-explicit-profile-model') { throw "automation explicit API profile was not honored: $($item | ConvertTo-Json -Compress)" }
    if ($item.explicitBothModel -ne 'cancip-smoke-explicit-both-model') { throw "automation explicit API+model override was not honored: $($item | ConvertTo-Json -Compress)" }
    if (-not $item.autoGuard -or $item.offGuard -or -not $item.forcedGuard) { throw "automation mechanical prompt guard mismatch: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs; autoModel = $item.autoModel; forcedModel = $item.forcedModel; explicitModel = $item.explicitModel }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.automation-mechanical-routing'; pass = $false; error = $_.Exception.Message }
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
  try{
    v.activeRequest=null;
    const decodeBase64=(text)=>new TextDecoder().decode(Uint8Array.from(atob(text),(char)=>char.charCodeAt(0)));
    v.callChoiceSuggestionModel=async()=>decodeBase64('__MODEL_CHOICE_PAYLOAD_BASE64__');
    v.messages=[
      {id:'smoke-user-model-choice',role:'user',content:decodeBase64('__MODEL_CHOICE_PROMPT_BASE64__'),createdAt:Date.now()-1000},
      {id:'smoke-assistant-model-choice',role:'assistant',createdAt:Date.now(),content:decodeBase64('__MODEL_CHOICE_ANSWER_BASE64__')}
    ];
    v.renderMessages();
    await new Promise((resolve)=>setTimeout(resolve,120));
    const choices=Array.from(v.messagesEl?.querySelectorAll('.obcc-choice-card')||[]).map((el)=>String(el.textContent||'').trim()).filter(Boolean);
    return JSON.stringify({id:'programmatic.choice-cards-model-generated',elapsedMs:Date.now()-t,choices,status:v.messages[1]?.choiceOptionsStatus||''});
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
    if (@($item.choices).Count -ne 3) { throw "model-generated choices did not render exactly three buttons: $($item | ConvertTo-Json -Compress)" }
    if ([string]$item.status -ne 'ready') { throw "model-generated choices did not set ready status: $($item | ConvertTo-Json -Compress)" }
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
  try{
    const progress='<!-- cancip-progress-step -->\\n<!-- cancip-process-message -->\\n已执行 · 正在读取文件...';
    v.messages=[{id:'smoke-process-live',role:'assistant',createdAt:Date.now(),content:progress}];
    v.activeRequest={};
    if(v.detailsOpenState instanceof Map)v.detailsOpenState.clear();
    v.renderMessages();
    const liveOpen=!!v.messagesEl?.querySelector('.obcc-process-record-details')?.open;
    v.messages=[
      {id:'smoke-process-live',role:'assistant',createdAt:Date.now()-1000,content:progress},
      {id:'smoke-process-final',role:'assistant',createdAt:Date.now(),content:__PROCESS_FINAL_CONTENT__}
    ];
    v.activeRequest=null;
    if(v.detailsOpenState instanceof Map)v.detailsOpenState.set('process-record:smoke-process-live',true);
    v.renderMessages();
    const finalOpen=!!v.messagesEl?.querySelector('.obcc-process-record-details')?.open;
    return JSON.stringify({id:'programmatic.process-record-live-open-final-collapsed',elapsedMs:Date.now()-t,liveOpen,finalOpen});
  } finally {
    v.messages=oldMessages;
    v.activeRequest=oldActive;
    if(oldDetails)v.detailsOpenState=oldDetails;
    if(typeof v.renderMessages==='function')v.renderMessages();
  }
})()
'@
    $code = $code.Replace('__PROCESS_FINAL_CONTENT__', $processFinalJson)
    $item = Invoke-CancipEval -Code $code -TimeoutSeconds 45
    if (-not $item.liveOpen) { throw "live process record did not open one level: $($item | ConvertTo-Json -Compress)" }
    if ($item.finalOpen) { throw "process record did not auto-collapse after final answer: $($item | ConvertTo-Json -Compress)" }
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = $item.id; pass = $true; elapsedMs = $item.elapsedMs }
  } catch {
    Add-CaseResult -Group 'programmaticCases' -Item @{ id = 'programmatic.process-record-live-open-final-collapsed'; pass = $false; error = $_.Exception.Message }
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
    await v.executeAction({type:'todo',op:'set',items:[{text:'agent-plan-step-one'},{text:'agent-plan-step-two'}]});
    const afterSet={manual:v.visibleManualTodos().length,agent:v.agentPlanTodos().length};
    await v.executeAction({type:'todo',op:'update',text:'agent-plan-step-one',done:true});
    const manual=v.visibleManualTodos()[0]||null;
    const agentDone=!!v.agentPlanTodos().find((item)=>item.text==='agent-plan-step-one'&&item.done);
    await v.executeAction({type:'todo',op:'clear'});
    const afterClear={manual:v.visibleManualTodos().length,agent:v.agentPlanTodos().length,manualText:v.visibleManualTodos()[0]?.text||''};
    return JSON.stringify({id:'programmatic.plan-manual-todo-separation',elapsedMs:Date.now()-t,afterSet,agentDone,manualDone:!!manual?.done,afterClear});
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
  const path='.cancip/test-lab/Fuzzy-Path-Smoke.md';
  const typo='.cancip/test-lab/Fuzzy Path Smoke.md';
  if(v.readOnlyActionCache&&typeof v.readOnlyActionCache.clear==='function')v.readOnlyActionCache.clear();
  await app.vault.adapter.mkdir('.cancip/test-lab').catch(()=>{});
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
    if ($item.readPath -ne '.cancip/test-lab/Fuzzy-Path-Smoke.md') { throw "read path not resolved: $($item.readPath)" }
    if ($item.patchPath -ne '.cancip/test-lab/Fuzzy-Path-Smoke.md') { throw "patch path not resolved: $($item.patchPath)" }
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
