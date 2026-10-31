import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import {SceneModuleError} from '../errors';
import type {LoadedSceneModule, SceneModuleConfig} from '../config/types';
import {isInside, resolveProjectRelativePath} from '../workspace/guard';

const MAX_MODULE_BYTES = 512 * 1024;
const MODULE_PATH = /\.(ts|tsx)$/i;

const BANNED_GLOBALS = new Set([
  'fetch',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'importScripts',
  'navigator',
  'document',
  'window',
  'self',
  'globalThis',
  'process',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'Date',
  'performance',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'requestAnimationFrame',
  'queueMicrotask',
  'eval',
  'Function',
  'crypto',
  'Atomics',
  'SharedArrayBuffer',
]);

// Scheme check for string literals. It intentionally does not parse or fetch.
const NETWORK_SCHEME = /^(?:https?|wss?|data|blob|file):/i;

const fail = (message: string): never => {
  throw new SceneModuleError(message);
};

const location = (sourceFile: ts.SourceFile, node: ts.Node): string => {
  const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${line + 1}:${character + 1}`;
};

const checkStringValue = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
  value: string,
  moduleId: string,
): void => {
  if (NETWORK_SCHEME.test(value)) {
    fail(
      `Scene module ${moduleId} contains a network or data URL at ${location(sourceFile, node)}; network references are not permitted`,
    );
  }
};

/**
 * Static source policy for trusted project modules. This is a rejection policy,
 * not a sandbox: it removes imports and common network, clock and randomness
 * entry points, but it cannot prove arbitrary TypeScript is benign.
 */
export const assertProjectSceneModuleSource = (
  sourceText: string,
  fileName: string,
  moduleId: string,
): void => {
  const scriptKind = path.extname(fileName).toLowerCase() === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind);

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      fail(`Scene module ${moduleId} must be self-contained; import declarations are not permitted`);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      fail(`Scene module ${moduleId} must be self-contained; re-exports are not permitted`);
    }
    if (ts.isMetaProperty(node)) {
      fail(`Scene module ${moduleId} must not use import.meta`);
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        fail(`Scene module ${moduleId} must not use dynamic import`);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        fail(`Scene module ${moduleId} must not use require()`);
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
      fail(`Scene module ${moduleId} must not construct functions from strings`);
    }
    if (ts.isIdentifier(node)) {
      if (BANNED_GLOBALS.has(node.text) || node.text.toLowerCase().endsWith('httprequest')) {
        fail(
          `Scene module ${moduleId} references forbidden global ${node.text} at ${location(sourceFile, node)}`,
        );
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Math' &&
      node.name.text === 'random'
    ) {
      fail(`Scene module ${moduleId} must not use Math.random; animation must be frame-derived`);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      checkStringValue(sourceFile, node, node.text, moduleId);
    }
    if (ts.isTemplateExpression(node)) {
      checkStringValue(sourceFile, node, node.head.text, moduleId);
      for (const span of node.templateSpans) {
        checkStringValue(sourceFile, span.literal, span.literal.text, moduleId);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
};

const assertUnlinkedPath = (projectDir: string, relativePath: string, moduleId: string): void => {
  const projectRoot = realpathSync(projectDir);
  const segments = relativePath.split('/');
  let current = projectRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      fail(`Scene module ${moduleId} path does not exist: ${relativePath}`);
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      fail(`Scene module ${moduleId} path must not contain symlinks or junctions: ${relativePath}`);
    }
    const real = realpathSync(current);
    if (!isInside(projectRoot, real)) {
      fail(`Scene module ${moduleId} path escapes the project: ${relativePath}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      fail(`Scene module ${moduleId} path component is not a directory: ${relativePath}`);
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      fail(`Scene module ${moduleId} path is not a regular file: ${relativePath}`);
    }
  }
};

const hashBytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export const loadProjectSceneModules = (
  projectDir: string,
  modules: readonly SceneModuleConfig[],
  options: {engineRoot?: string} = {},
): LoadedSceneModule[] => {
  return modules.map((module) => {
    if (!MODULE_PATH.test(module.path)) {
      fail(`Scene module ${module.id} must use a .ts or .tsx implementation file`);
    }
    assertUnlinkedPath(projectDir, module.path, module.id);
    const absolutePath = resolveProjectRelativePath(projectDir, module.path, {
      engineRoot: options.engineRoot,
      mustExist: true,
    });
    if (!statSync(absolutePath).isFile()) {
      fail(`Scene module ${module.id} path is not a regular file: ${module.path}`);
    }
    const bytes = readFileSync(absolutePath);
    if (bytes.length === 0 || bytes.length > MAX_MODULE_BYTES) {
      fail(
        `Scene module ${module.id} must be between 1 and ${MAX_MODULE_BYTES} bytes`,
      );
    }
    const computedSha256 = hashBytes(bytes);
    if (computedSha256 !== module.sha256) {
      fail(
        `Scene module ${module.id} SHA256 mismatch: expected ${module.sha256}, received ${computedSha256}`,
      );
    }
    const sourceText = bytes.toString('utf8');
    if (sourceText.includes('\0')) fail(`Scene module ${module.id} contains NUL bytes`);
    assertProjectSceneModuleSource(sourceText, absolutePath, module.id);
    return {
      ...module,
      absolutePath,
      computedSha256,
      sourceText,
      sourceBytes: Uint8Array.from(bytes),
    };
  });
};
