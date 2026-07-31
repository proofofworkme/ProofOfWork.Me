import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const targetPaths = [
  fileURLToPath(
    new URL("../server/proof-api.mjs", import.meta.url),
  ),
  fileURLToPath(
    new URL("./backfill-proof-indexer.mjs", import.meta.url),
  ),
];
const compilerOptions = {
  allowJs: true,
  checkJs: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
};
const program = ts.createProgram(targetPaths, compilerOptions);
const sourceFiles = targetPaths.map((targetPath) => ({
  sourceFile: program.getSourceFile(targetPath),
  targetPath,
}));
const missingSources = sourceFiles.filter(
  ({ sourceFile }) => !sourceFile,
);
for (const { targetPath } of missingSources) {
  console.error(`Runtime source was not loaded: ${targetPath}`);
}
if (missingSources.length > 0) {
  process.exitCode = 1;
}
const missingIdentifierCodes = new Set([2304, 2552]);
const diagnostics = sourceFiles.flatMap(({ sourceFile }) =>
  sourceFile
    ? program
        .getSemanticDiagnostics(sourceFile)
        .filter(
          (diagnostic) =>
            missingIdentifierCodes.has(diagnostic.code) &&
            diagnostic.file === sourceFile,
        )
    : []
);

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
} else if (missingSources.length === 0) {
  console.log("Server and indexer free-identifier check passed.");
}
