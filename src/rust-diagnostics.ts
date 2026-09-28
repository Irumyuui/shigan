import * as vscode from 'vscode';
import { DiagnosticRangeLike, isInactiveCodeDiagnostic } from './core/match/rust/diagnostics';

export interface RustDiagnosticState {
  ranges: DiagnosticRangeLike[];
  authoritative: boolean;
}

const RUST_ANALYZER_IDS = ['rust-lang.rust-analyzer', 'matklad.rust-analyzer'];

/**
 * rust-analyzer's inactive-code diagnostics for a document.
 *
 * `authoritative` is true when a matching diagnostic was seen OR the
 * rust-analyzer extension is installed and active — in the latter case the
 * absence of a diagnostic is meaningful. If rust-analyzer is missing or
 * disabled, diagnostics are only ever additive (see `mergeRustInactiveLines`).
 */
export function readRustDiagnostics(document: vscode.TextDocument): RustDiagnosticState {
  const ranges: DiagnosticRangeLike[] = [];
  for (const diagnostic of vscode.languages.getDiagnostics(document.uri)) {
    if (!isInactiveCodeDiagnostic(diagnostic.source, diagnostic.code)) continue;
    ranges.push({ startLine: diagnostic.range.start.line, endLine: diagnostic.range.end.line });
  }

  return { ranges, authoritative: ranges.length > 0 || isRustAnalyzerActive() };
}

function isRustAnalyzerActive(): boolean {
  return RUST_ANALYZER_IDS.some((id) => vscode.extensions.getExtension(id)?.isActive === true);
}
