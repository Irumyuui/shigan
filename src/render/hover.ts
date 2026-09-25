import * as vscode from 'vscode';
import { ShiganConfig } from '../config';
import { computeDocumentHints } from '../service';

/**
 * Hover provider used by the `hover` trigger mode. It only contributes when
 * `shigan.trigger` is `hover`; brackets and directives are not symbols, so it
 * does not clash with clangd's hover on identifiers.
 */
export function registerHoverProvider(
  context: vscode.ExtensionContext,
  getConfig: () => ShiganConfig
): void {
  const provider: vscode.HoverProvider = {
    provideHover(document, position) {
      const config = getConfig();
      if (!config.enable || !config.languages.includes(document.languageId)) return undefined;
      if (config.trigger !== 'hover' || config.show.length === 0) return undefined;

      const hints = computeDocumentHints(document, config, 'cursor', document.offsetAt(position));
      if (hints.length === 0) return undefined;

      const markdown = new vscode.MarkdownString();
      for (const hint of hints) {
        const kind = hint.kind === 'macro' ? vscode.l10n.t('preprocessor') : vscode.l10n.t('bracket');
        const inactive = hint.inactive ? ` *${vscode.l10n.t('(inactive)')}*` : '';
        const text = hint.text.trim().replace(/`/g, "'");
        markdown.appendMarkdown(`\`${text}\` — *${kind}*${inactive}`);
        markdown.appendMarkdown('\n\n');
      }
      return new vscode.Hover(markdown);
    },
  };

  context.subscriptions.push(vscode.languages.registerHoverProvider('*', provider));
}
