import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const targetPath = fileURLToPath(
  new URL("../server/proof-api.mjs", import.meta.url),
);
const compilerOptions = {
  allowJs: true,
  checkJs: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
};
const program = ts.createProgram([targetPath], compilerOptions);
const sourceFile = program.getSourceFile(targetPath);
if (!sourceFile) {
  console.error(`Server source was not loaded: ${targetPath}`);
  process.exitCode = 1;
}
const missingIdentifierCodes = new Set([2304, 2552]);
const diagnostics = sourceFile
  ? program
      .getSemanticDiagnostics(sourceFile)
      .filter(
        (diagnostic) =>
          missingIdentifierCodes.has(diagnostic.code) &&
          diagnostic.file === sourceFile,
      )
  : [];

if (diagnostics.length > 0) {
  const host = {
    getCanonicalFileName: ts.sys.useCaseSensitiveFileNames
      ? (fileName) => fileName
      : (fileName) => fileName.toLowerCase(),
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  };
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, host).trimEnd(),
  );
  process.exitCode = 1;
} else if (sourceFile) {
  console.log("Server free-identifier check passed.");
}
