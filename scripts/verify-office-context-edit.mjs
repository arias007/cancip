import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const sourceText = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("main.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const requiredFunctions = new Set([
  "decodeXmlEntities",
  "normalizedDocumentTextValue",
  "escapeOfficeXmlText",
  "officeXmlTextBlockReplacement"
]);
const snippets = [];

for (const node of sourceFile.statements) {
  if (ts.isTypeAliasDeclaration(node) && node.name.text === "OfficeContextualTextAnchor") {
    snippets.push(node.getFullText(sourceFile));
  }
  if (ts.isFunctionDeclaration(node) && node.name && requiredFunctions.has(node.name.text)) {
    snippets.push(node.getFullText(sourceFile));
    requiredFunctions.delete(node.name.text);
  }
}

assert.equal(requiredFunctions.size, 0, `Missing source functions: ${[...requiredFunctions].join(", ")}`);
const compiled = ts.transpileModule(
  `${snippets.join("\n")}\nglobalThis.__officeReplace = officeXmlTextBlockReplacement;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
).outputText;
const context = {};
vm.runInNewContext(compiled, context);
const replace = context.__officeReplace;
assert.equal(typeof replace, "function");

const splitRuns = '<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:t>Beta</w:t></w:r></w:p>';
const partial = replace(splitRuns, "haBe", "X", {
  contextText: "AlphaBeta",
  startOffset: 3,
  endOffset: 7,
  sourceHash: "0".repeat(64)
});
assert.match(partial, /<w:t>AlpX<\/w:t>/);
assert.match(partial, /<w:t>ta<\/w:t>/);
assert.doesNotMatch(partial, /AlphaBetaX|XAlphaBeta/);

const caret = replace(splitRuns, "", "-", {
  contextText: "AlphaBeta",
  startOffset: 5,
  endOffset: 5,
  sourceHash: "0".repeat(64)
});
assert.match(caret, /<w:t>Alpha-<\/w:t>/);
assert.match(caret, /<w:t>Beta<\/w:t>/);

const entity = replace('<w:p><w:r><w:t>A&amp;B</w:t></w:r></w:p>', "&", " and ", {
  contextText: "A&B",
  startOffset: 1,
  endOffset: 2,
  sourceHash: "0".repeat(64)
});
assert.match(entity, /<w:t>A and B<\/w:t>/);

assert.equal(replace(splitRuns, "Beta", "X", {
  contextText: "AlphaBeta",
  startOffset: 0,
  endOffset: 4,
  sourceHash: "0".repeat(64)
}), null);
assert.equal(replace('<w:p><w:r><w:t>AlphaAlpha</w:t></w:r></w:p>', "Alpha", "X", {
  contextText: "Alpha",
  startOffset: 0,
  endOffset: 5,
  sourceHash: "0".repeat(64)
}), null);

console.log(JSON.stringify({
  cases: 5,
  partialReplacementPreservesRuns: true,
  caretInsertionStaysInline: true,
  changedOrAmbiguousAnchorsRejected: true
}, null, 2));
