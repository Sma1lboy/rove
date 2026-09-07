import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

// Inventory candidates for semantic review; a path-looking name is not proof of a bug.
const pathName = /(?:path|cwd|repo|root|directory|home)/i
const comparison = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken])

function scanDirectory(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      scanDirectory(file)
      continue
    }
    if (!/\.tsx?$/.test(file)) continue
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
    function visit(node: ts.Node): void {
      const directCompare = ts.isBinaryExpression(node) && comparison.has(node.operatorToken.kind)
      const stringOperation =
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        /^(startsWith|split|lastIndexOf|includes|has|get)$/.test(node.expression.name.text)
      if ((directCompare || stringOperation) && pathName.test(node.getText(source))) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
        const text = node.getText(source).replace(/\s+/g, " ")
        process.stdout.write(`${file.replaceAll("\\", "/")}\t${line + 1}\t${text}\n`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}

for (const root of ["packages/kobe/src", "packages/kobe-daemon/src"]) scanDirectory(root)
