import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import ts from "typescript";

const sourceText = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("main.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const requiredTypes = new Set(["OfficeContextualTextAnchor", "DocumentPreviewSourceLocator"]);
const requiredFunctions = new Set([
  "decodeXmlEntities",
  "normalizedDocumentTextValue",
  "escapeOfficeXmlText",
  "officeXmlTextBlockReplacement",
  "officeXmlBlocks",
  "officePreviewLocatorKey",
  "mobilePdfExporterEditedLocatorKeys",
  "markMobilePdfExporterPreviewLocators",
  "mobilePdfExporterMovePreviewLocators",
  "replaceOfficeArchiveTextAtLocator",
  "moveOfficeArchiveBlock",
  "zipEpubArchive",
  "documentHtmlPreviewBridgeScript",
  "inlineWorkbenchPreviewWithHeightReporter"
]);
const snippets = [];

for (const node of sourceFile.statements) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(sourceFile) === "DOCUMENT_HTML_PREVIEW_CHANNEL")) {
    snippets.push(node.getFullText(sourceFile));
  }
  if (ts.isTypeAliasDeclaration(node) && requiredTypes.has(node.name.text)) {
    snippets.push(node.getFullText(sourceFile));
    requiredTypes.delete(node.name.text);
  }
  if (ts.isFunctionDeclaration(node) && node.name && requiredFunctions.has(node.name.text)) {
    snippets.push(node.getFullText(sourceFile));
    requiredFunctions.delete(node.name.text);
  }
}

assert.equal(requiredTypes.size, 0, `Missing source types: ${[...requiredTypes].join(", ")}`);
assert.equal(requiredFunctions.size, 0, `Missing source functions: ${[...requiredFunctions].join(", ")}`);
const bootstrap = `
const normalizeDocumentArchiveEntryPath = value => String(value ?? "").replace(/\\\\/g, "/").replace(/^\\/+/, "");
const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const MOBILE_PDF_EXPORTER_PREVIEW_MANIFEST_PATH = "mpe/preview/manifest.json";
const MOBILE_PDF_EXPORTER_EDITED_LOCATOR_LIMIT = 1000;
globalThis.__replaceAt = replaceOfficeArchiveTextAtLocator;
globalThis.__moveOffice = moveOfficeArchiveBlock;
globalThis.__markMpe = markMobilePdfExporterPreviewLocators;
globalThis.__mpeKeys = mobilePdfExporterEditedLocatorKeys;
globalThis.__mpeMoveLocators = mobilePdfExporterMovePreviewLocators;
globalThis.__zipEpub = zipEpubArchive;
globalThis.__bridge = documentHtmlPreviewBridgeScript;
globalThis.__inlineHeight = inlineWorkbenchPreviewWithHeightReporter;
`;
const compiled = ts.transpileModule(
  `${snippets.join("\n")}\n${bootstrap}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
).outputText;
const context = { strFromU8, strToU8, zipSync };
vm.runInNewContext(compiled, context);

const docxXml = '<w:document><w:body><w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>';
const docxArchive = { "word/document.xml": strToU8(docxXml) };
const changed = context.__replaceAt(docxArchive, {
  officePart: "word/document.xml",
  officeTag: "p",
  officeIndex: 1
}, "Second", "Updated");
assert.equal(changed.changed, true);
assert.match(strFromU8(changed.archive["word/document.xml"]), /<w:t>Updated<\/w:t>/);
assert.match(strFromU8(changed.archive["word/document.xml"]), /<w:t>First<\/w:t>/);

const moved = context.__moveOffice(docxArchive, "docx", {
  officePart: "word/document.xml",
  officeMoveTag: "p",
  officeMoveIndex: 1
}, {
  officePart: "word/document.xml",
  officeMoveTag: "p",
  officeMoveIndex: 0
}, false);
assert.equal(moved.changed, true);
assert.ok(strFromU8(moved.archive["word/document.xml"]).indexOf("Second") < strFromU8(moved.archive["word/document.xml"]).indexOf("First"));

const anchoredDocxXml = '<w:document><w:body><w:p><w:r><w:drawing><wp:anchor><wp:positionH><wp:posOffset>10</wp:posOffset></wp:positionH><wp:positionV><wp:posOffset>20</wp:posOffset></wp:positionV><wp:extent cx="100" cy="200"/><wps:txbx><w:txbxContent><w:p><w:r><w:t>A</w:t></w:r></w:p></w:txbxContent></wps:txbx></wp:anchor></w:drawing></w:r></w:p><w:p><w:r><w:drawing><wp:anchor><wp:positionH><wp:posOffset>30</wp:posOffset></wp:positionH><wp:positionV><wp:posOffset>40</wp:posOffset></wp:positionV><wp:extent cx="300" cy="400"/><wps:txbx><w:txbxContent><w:p><w:r><w:t>B</w:t></w:r></w:p></w:txbxContent></wps:txbx></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>';
const anchoredDocxArchive = { "word/document.xml": strToU8(anchoredDocxXml) };
const anchoredMove = context.__moveOffice(anchoredDocxArchive, "docx", {
  officePart: "word/document.xml",
  officeMoveTag: "anchor",
  officeMoveIndex: 0
}, {
  officePart: "word/document.xml",
  officeMoveTag: "anchor",
  officeMoveIndex: 1
}, true);
assert.equal(anchoredMove.changed, true);
const anchoredMoveXml = strFromU8(anchoredMove.archive["word/document.xml"]);
assert.match(anchoredMoveXml, /<wp:anchor>[\s\S]*?<wp:posOffset>30<\/wp:posOffset>[\s\S]*?<wp:posOffset>40<\/wp:posOffset>[\s\S]*?<w:t>A<\/w:t>/);
assert.match(anchoredMoveXml, /<wp:anchor>[\s\S]*?<wp:posOffset>10<\/wp:posOffset>[\s\S]*?<wp:posOffset>20<\/wp:posOffset>[\s\S]*?<w:t>B<\/w:t>/);
assert.match(anchoredMoveXml, /<wp:extent cx="100" cy="200"/);
assert.match(anchoredMoveXml, /<wp:extent cx="300" cy="400"/);

const slideXml = '<p:sld><p:sp><p:spPr><a:xfrm><a:off x="10" y="20"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>A</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:xfrm><a:off x="30" y="40"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>B</a:t></a:r></a:p></p:txBody></p:sp></p:sld>';
const slideArchive = { "ppt/slides/slide1.xml": strToU8(slideXml) };
const swapped = context.__moveOffice(slideArchive, "pptx", {
  officePart: "ppt/slides/slide1.xml",
  officeMoveTag: "sp",
  officeMoveIndex: 0
}, {
  officePart: "ppt/slides/slide1.xml",
  officeMoveTag: "sp",
  officeMoveIndex: 1
}, true);
assert.equal(swapped.changed, true);
const swappedXml = strFromU8(swapped.archive["ppt/slides/slide1.xml"]);
assert.match(swappedXml, /<p:sp>[\s\S]*?<a:off x="30" y="40"\/>[\s\S]*?<a:t>A<\/a:t>/);
assert.match(swappedXml, /<p:sp>[\s\S]*?<a:off x="10" y="20"\/>[\s\S]*?<a:t>B<\/a:t>/);

const mpeArchive = {
  "mpe/preview/manifest.json": strToU8(JSON.stringify({
    schemaVersion: 1,
    generator: "Obsidian Mobile PDF Exporter",
    pageCount: 1,
    pageWidthPt: 612,
    pageHeightPt: 792
  }))
};
assert.equal(context.__markMpe(mpeArchive, [{
  locator: { officePart: "word/document.xml", officeTag: "p", officeIndex: 1 },
  mode: "text"
}]), true);
assert.equal(context.__markMpe(mpeArchive, [{
  locator: { officePart: "word/document.xml", officeTag: "p", officeIndex: 1 },
  mode: "text"
}]), true);
const markedManifest = JSON.parse(strFromU8(mpeArchive["mpe/preview/manifest.json"]));
assert.equal(markedManifest.pageCount, 1);
assert.deepEqual([...context.__mpeKeys(markedManifest)], ["text:word/document.xml:p:1"]);
const movePreviewLocators = context.__mpeMoveLocators("docx", {
  officePart: "word/document.xml",
  officeMoveTag: "p",
  officeMoveIndex: 1
}, {
  officePart: "word/document.xml",
  officeMoveTag: "p",
  officeMoveIndex: 3
});
assert.equal(movePreviewLocators.filter((entry) => entry.mode === "text").map((entry) => entry.locator.officeIndex).join(","), "1,2,3");

const epubBytes = context.__zipEpub({
  "OEBPS/chapter.xhtml": strToU8("<html><body><p>Text</p></body></html>"),
  mimetype: strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8("<container/>")
});
assert.equal(new DataView(epubBytes.buffer, epubBytes.byteOffset, epubBytes.byteLength).getUint32(0, true), 0x04034b50);
assert.equal(new DataView(epubBytes.buffer, epubBytes.byteOffset, epubBytes.byteLength).getUint16(8, true), 0);
const firstNameLength = new DataView(epubBytes.buffer, epubBytes.byteOffset, epubBytes.byteLength).getUint16(26, true);
assert.equal(strFromU8(epubBytes.subarray(30, 30 + firstNameLength)), "mimetype");
assert.equal(strFromU8(unzipSync(epubBytes).mimetype), "application/epub+zip");

const bridgeMarkup = context.__bridge();
const bridgeScript = bridgeMarkup.match(/<script data-cancip-bridge>([\s\S]*)<\/script>$/)?.[1] ?? "";
assert.ok(bridgeScript.includes('post("move",{moving,target:destination,placeAfter})'));
assert.doesNotThrow(() => new vm.Script(bridgeScript));

const inlineHeightMarkup = context.__inlineHeight("<html><body><p>Preview</p></body></html>", "height-token");
const inlineHeightScript = inlineHeightMarkup.match(/<script data-cancip-inline-height>([\s\S]*?)<\/script>/)?.[1] ?? "";
assert.ok(inlineHeightScript.includes("cancip-inline-workbench-height-v1"));
assert.ok(inlineHeightScript.includes("height-token"));
assert.doesNotThrow(() => new vm.Script(inlineHeightScript));

console.log(JSON.stringify({
  cases: 8,
  exactOfficeLocatorWriteback: true,
  docxFlowAnchorAndPptxBlockMovement: true,
  editedOfficeBlocksOverrideStalePageImages: true,
  epubMimetypeStoredFirst: true,
  iframeBridgeSyntaxValid: true,
  inlineHeightReporterSyntaxValid: true
}, null, 2));
