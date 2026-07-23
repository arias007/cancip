import { readFile } from "node:fs/promises";
import process from "node:process";
import ts from "typescript";

const sourceText = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const runtimeText = await readFile(new URL("../outputs/cancip/main.js", import.meta.url), "utf8");

function namedMethods(text, kind, label) {
  const ast = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true, kind);
  if (ast.parseDiagnostics.length) {
    throw new Error(`${label} has ${ast.parseDiagnostics.length} parse diagnostic(s)`);
  }
  const methods = new Set();
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && node.name) methods.add(node.name.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return methods;
}

const sourceMethods = namedMethods(sourceText, ts.ScriptKind.TS, "src/main.ts");
const runtimeMethods = namedMethods(runtimeText, ts.ScriptKind.JS, "outputs/cancip/main.js");

const intentionallyRemovedRuntimeMethods = new Set([
  "applyPersonalizedDiaryButtons",
  "activateNativeNoteDrawSurface",
  "clearPersonalizedDiaryButtons",
  "close",
  "createPlanButton",
  "createNoteDrawWorkbenchStage",
  "globalFinalAnswerTemplatePrompt",
  "insertPersonalizedDiary",
  "installReviewTreeTouchScroll",
  "noteDrawControllerForStage",
  "noteDrawRuntime",
  "schedulePersonalizedDiaryButtons",
  "scheduleNativeNoteDrawSurfaceSync",
  "shouldPreferPluginDataSettings",
  "syncNativeNoteDrawSurface"
]);
const removedFromRuntime = [...runtimeMethods]
  .filter((name) => intentionallyRemovedRuntimeMethods.has(name) && !sourceMethods.has(name))
  .sort();
const missingFromSource = [...runtimeMethods]
  .filter((name) => !sourceMethods.has(name) && !intentionallyRemovedRuntimeMethods.has(name))
  .sort();
const extraInSource = [...sourceMethods].filter((name) => !runtimeMethods.has(name)).sort();
const result = {
  sourceMethodCount: sourceMethods.size,
  runtimeMethodCount: runtimeMethods.size,
  missingFromSourceCount: missingFromSource.length,
  extraInSourceCount: extraInSource.length,
  intentionallyRemovedRuntimeMethodCount: removedFromRuntime.length,
  missingFromSource,
  extraInSource,
  intentionallyRemovedRuntimeMethods: removedFromRuntime
};

if (missingFromSource.length) {
  console.error(JSON.stringify(result, null, 2));
  console.error("Build blocked: TypeScript source does not yet cover the protected runtime feature inventory.");
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result, null, 2));
}
