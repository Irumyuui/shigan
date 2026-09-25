import * as vscode from 'vscode';
import { ShiganConfig } from '../config';
import { Hint } from '../core/types';
import { computeDocumentHints, DecorationTrigger } from '../service';
import { buildJumpTooltip, TooltipLabels } from './tooltip';

export const JUMP_COMMAND = 'shigan.jumpToMatch';

/**
 * Renders hints as inlay hints. Inlay hints are the only decoration-like UI
 * that supports a click action (`InlayHintLabelPart.command`), which is how
 * clicking a hint jumps to the matching bracket / directive.
 *
 * The downside is that inlay hint colors come from the theme
 * (`editorInlayHint.foreground`), not from a setting.
 */
export class ShiganInlayHintsProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly registration: vscode.Disposable;
  private disposed = false;

  constructor(private readonly getConfig: () => ShiganConfig) {
    this.registration = vscode.languages.registerInlayHintsProvider('*', this);
  }

  readonly onDidChangeInlayHints = this.emitter.event;

  /** Ask VSCode to re-request hints (caret moved, document changed, settings). */
  refresh(): void {
    this.emitter.fire();
  }

  provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
    const config = this.getConfig();
    if (config.trigger !== 'cursor' && config.trigger !== 'always') return [];

    const hints = computeDocumentHints(
      document,
      config,
      config.trigger as DecorationTrigger,
      cursorOffset(document)
    );

    const visible = hints.filter(
      (hint) => hint.line >= range.start.line && hint.line <= range.end.line
    );
    if (visible.length === 0) return [];

    const sourceLines = document.getText().split(/\r?\n/);
    return visible.map((hint) => toInlayHint(document, hint, sourceLines, tooltipLabels()));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.registration.dispose();
    this.emitter.dispose();
  }
}

function toInlayHint(
  document: vscode.TextDocument,
  hint: Hint,
  sourceLines: string[],
  labels: TooltipLabels
): vscode.InlayHint {
  const line = Math.min(Math.max(hint.line, 0), document.lineCount - 1);
  const position = document.lineAt(line).range.end;

  const source = hint.parts ?? [{ text: hint.text, target: hint.target }];
  const labelParts = source.map((part, index) => {
    // The first segment is separated from the code by `paddingLeft`.
    let text = index === 0 ? part.text.trimStart() : part.text;
    if (hint.inactive && index === source.length - 1) {
      text += ` ${vscode.l10n.t('(inactive)')}`;
    }

    const labelPart = new vscode.InlayHintLabelPart(text);
    if (part.target) {
      labelPart.command = {
        command: JUMP_COMMAND,
        title: vscode.l10n.t('Jump to match'),
        arguments: [document.uri.toString(), part.target.line, part.target.col],
      };
      labelPart.tooltip = new vscode.MarkdownString(
        buildJumpTooltip(part.title, part.target.line, sourceLines, labels)
      );
    }
    return labelPart;
  });

  const inlay = new vscode.InlayHint(position, labelParts);
  inlay.paddingLeft = true;
  return inlay;
}

/** Localized strings for the jump tooltip. */
function tooltipLabels(): TooltipLabels {
  return {
    fallbackTitle: vscode.l10n.t('jump target'),
    lineSuffix: (line) => vscode.l10n.t('— line {0}', line),
  };
}

/** Caret offset when this document is the active editor, otherwise `-1`. */
function cursorOffset(document: vscode.TextDocument): number {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== document.uri.toString()) return -1;
  return document.offsetAt(editor.selection.active);
}
