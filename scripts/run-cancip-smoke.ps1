param(
  [switch]$Full,
  [switch]$Write,
  [string]$Case = '',
  [switch]$VerboseReport,
  [switch]$FailFast
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$CasesPath = Join-Path $Root 'tests/cancip-regression-cases.json'
$ObqPath = 'C:/Users/35007/Documents/Codex/tools/ob-cli-queue/obq.ps1'
$OutDir = Join-Path $Root 'reports'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$AllCases = Get-Content -Raw -LiteralPath $CasesPath -Encoding UTF8 | ConvertFrom-Json
$DefaultCommandIds = @(
  'command.tools.index',
  'command.memory.read.profile',
  'command.obsidian.currentView',
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
  'command.plugins.route.notedraw',
  'command.annotate.help',
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
  caseFilter = $Case
  probe = $null
  promptCases = @()
  commandCases = @()
  programmaticCases = @()
  writeCases = @()
  totals = [ordered]@{ pass = 0; fail = 0; skip = 0; elapsedMs = 0 }
}
$Started = Get-Date

function ConvertTo-CompactJson {
  param([object]$Value)
  $Value | ConvertTo-Json -Compress -Depth 40
}

function Invoke-CancipEval {
  param(
    [string]$Code,
    [int]$TimeoutSeconds = 25
  )
  $out = & $ObqPath `
    -CommandTimeoutSeconds $TimeoutSeconds `
    -WaitTimeoutSeconds ([Math]::Max(80, $TimeoutSeconds + 45)) `
    eval "code=$Code" 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "obq exited $LASTEXITCODE`: $($out -join "`n")"
  }
  $raw = ($out -join "`n")
  $matches = [regex]::Matches($raw, '(?m)^=>\s*(.+?)\s*$')
  if ($matches.Count -gt 0) {
    $text = $matches[$matches.Count - 1].Groups[1].Value.Trim()
  } else {
    $text = $raw.Trim() -replace '^=>\s*', ''
  }
  try {
    return $text | ConvertFrom-Json
  } catch {
    $preview = if ($text.Length -gt 1200) { $text.Substring(0, 1200) + "`n...[truncated]" } else { $text }
    throw "invalid eval JSON: $preview"
  }
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
  Write-Host "$Group/$($Item.id) ... FAIL $($Item.error)"
  if ($VerboseReport -and $Item.debug) { Write-Host $Item.debug }
  if ($FailFast) { Write-FinalReport 1 }
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
  $Report.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  $Report.totals.elapsedMs = [int]((Get-Date) - $Started).TotalMilliseconds
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
  $path = Join-Path $OutDir "cancip-smoke-$stamp.json"
  $Report | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $path -Encoding UTF8
  $status = if ($Report.ok) { 'PASS' } else { 'FAIL' }
  Write-Host "Cancip smoke $status / version $($Report.version) / pass $($Report.totals.pass) / fail $($Report.totals.fail) / skip $($Report.totals.skip) / $($Report.totals.elapsedMs)ms"
  Write-Host "Report: $path"
  exit $Code
}

try {
  $ProbeCode = "(async()=>{const p=app.plugins.plugins.cancip;const v=p&&typeof p.activateView==='function'?await p.activateView():app.workspace.getLeavesOfType('cancip-view')[0]?.view??null;const m=app.plugins.manifests.cancip;return JSON.stringify({ok:!!(p&&v),version:m?.version??'',promptHead:String(p?.settings?.systemPrompt||'').split('\n')[0],views:app.workspace.getLeavesOfType('cancip-view').length,devErrors:(p?.devErrors||[]).slice(-5)});})()"
  $probe = Invoke-CancipEval -Code $ProbeCode -TimeoutSeconds 25
  $Report.probe = $probe
  $Report.version = [string]$probe.version
  $Report.promptHead = [string]$probe.promptHead
  if (-not $probe.ok) { throw 'Cancip plugin/view is not loaded' }
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
(()=>{
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
