// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sources = [
  "src/runtime/background.ts",
  "src/runtime/browser-capabilities.ts",
  "src/runtime/cloud-gdrive.ts",
  "src/runtime/cloud-webdav.ts",
  "src/runtime/diagnostics.ts",
  "src/runtime/legacy-crypto.ts",
  "src/runtime/schema.ts",
  "src/runtime/storage.ts",
  "src/runtime/sync-core.ts",
  "src/runtime/types.ts",
];

const builtins = new Set([
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "fetch",
  "require",
  "atob",
  "btoa",
  "escape",
  "unescape",
  "encodeURIComponent",
  "decodeURIComponent",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "structuredClone",
  "alert",
  "confirm",
  "prompt",
  "eval",
  "queueMicrotask",
  "postMessage",
  "addEventListener",
  "removeEventListener",
  "requestAnimationFrame",
  "String",
  "Number",
  "Boolean",
  "Object",
  "Array",
  "Date",
  "BigInt",
  "Symbol",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "Map",
  "Set",
  "WeakMap",
  "Promise",
]);

const failures = [];
for (const file of sources) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(full, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
  const declared = new Set();
  const called = [];
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name
    )
      declared.add(node.name.text);
    if (ts.isClassDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      declared.add(node.name.text);
    if (ts.isImportClause(node) && node.name) declared.add(node.name.text);
    if (ts.isImportSpecifier(node)) declared.add(node.name.text);
    if (ts.isParameter(node) && ts.isIdentifier(node.name))
      declared.add(node.name.text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const line =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      called.push({ name, line });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const call of called) {
    if (declared.has(call.name) || builtins.has(call.name)) continue;
    failures.push(`${file}(${call.line}): call to undefined '${call.name}'`);
  }
}

if (failures.length) {
  console.error("Undefined call check failed:");
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`Undefined call check passed: ${sources.length} sources.`);
