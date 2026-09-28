import * as assert from 'assert';
import * as vscode from 'vscode';

const MAIN = 'int main(void) {\n}\n';
const CHAIN = '#if X\n\n#else\n\n#endif\n';

interface ComputedHint {
  line: number;
  text: string;
  kind: string;
  inactive: boolean;
  target?: { line: number; col: number };
  parts?: { text: string; target?: { line: number; col: number }; title?: string }[];
}

async function setTrigger(value: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration('shigan')
    .update('trigger', value, vscode.ConfigurationTarget.Workspace);
}

/** Writes `shigan.show` and waits past the config-change debounce. */
async function setShow(value: string[]): Promise<void> {
  await vscode.workspace
    .getConfiguration('shigan')
    .update('show', value, vscode.ConfigurationTarget.Workspace);
  await delay(150);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('Shigan integration', () => {
  test('activates for a C document', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'c', content: MAIN });
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(doc.languageId, 'c');
  });

  test('provides a bracket hover in hover mode', async () => {
    await setTrigger('hover');
    try {
      const doc = await vscode.workspace.openTextDocument({ language: 'c', content: MAIN });
      await vscode.window.showTextDocument(doc);
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        doc.uri,
        new vscode.Position(0, 15)
      );
      assert.ok(hovers && hovers.length > 0, 'expected at least one hover');
      assert.match(textOf(hovers), /:1-2/);
    } finally {
      await setTrigger(undefined);
    }
  });

  test('provides a preprocessor hover in hover mode', async () => {
    await setTrigger('hover');
    try {
      const doc = await vscode.workspace.openTextDocument({ language: 'c', content: CHAIN });
      await vscode.window.showTextDocument(doc);
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        doc.uri,
        new vscode.Position(2, 1)
      );
      assert.ok(hovers && hovers.length > 0, 'expected a hover on #else');
      assert.match(textOf(hovers), /:1-3/);
    } finally {
      await setTrigger(undefined);
    }
  });

  test('computes clickable hints in always mode', async () => {
    await setTrigger('always');
    try {
      const doc = await vscode.workspace.openTextDocument({ language: 'c', content: MAIN });
      await vscode.window.showTextDocument(doc);
      const hints = await vscode.commands.executeCommand<ComputedHint[]>(
        'shigan.internal.computedHints'
      );
      assert.strictEqual(hints.length, 1, `unexpected hints: ${JSON.stringify(hints)}`);
      assert.match(hints[0].text, /:1-2/);
      assert.deepStrictEqual(hints[0].target, { line: 0, col: 15 });
    } finally {
      await setTrigger(undefined);
    }
  });

  test('shows directive hints for inactive blocks and marks them', async () => {
    await setTrigger('always');
    try {
      const doc = await vscode.workspace.openTextDocument({
        language: 'c',
        content: '#if 0\nint g(void) {\n}\n#endif\nint f(void) {\n}\n',
      });
      await vscode.window.showTextDocument(doc);
      const hints = await vscode.commands.executeCommand<ComputedHint[]>(
        'shigan.internal.computedHints'
      );
      // The dead function's brackets are not matched; the `#endif` hint is
      // kept (a directive line is live code) and flagged inactive.
      assert.deepStrictEqual(
        hints.map((hint) => [hint.kind, hint.line, hint.inactive]),
        [
          ['macro', 3, true],
          ['bracket', 5, false],
        ],
        `unexpected hints: ${JSON.stringify(hints)}`
      );
    } finally {
      await setTrigger(undefined);
    }
  });

  test('splits the #endif hint into two clickable segments', async () => {
    await setTrigger('always');
    try {
      const doc = await vscode.workspace.openTextDocument({ language: 'c', content: CHAIN });
      await vscode.window.showTextDocument(doc);

      const hints = await vscode.commands.executeCommand<ComputedHint[]>(
        'shigan.internal.computedHints'
      );
      const endif = hints.find((hint) => hint.line === 4);
      assert.ok(endif, `expected an #endif hint: ${JSON.stringify(hints)}`);
      assert.strictEqual(endif.text, ' <- :3-5 #else <= :1-5 #if X');
      assert.deepStrictEqual(endif.parts, [
        { text: ' <- :3-5 #else', target: { line: 2, col: 0 }, title: '#else' },
        { text: ' <= :1-5 #if X', target: { line: 0, col: 0 }, title: '#if X' },
      ]);

      // The first segment jumps to the preceding branch ...
      const previous = endif.parts?.[0]?.target;
      assert.ok(previous, 'expected a target on the <- segment');
      await vscode.commands.executeCommand(
        'shigan.jumpToMatch',
        doc.uri.toString(),
        previous.line,
        previous.col
      );
      assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 2);

      // ... and the second one to the opening #if.
      const opener = endif.parts?.[1]?.target;
      assert.ok(opener, 'expected a target on the <= segment');
      await vscode.commands.executeCommand(
        'shigan.jumpToMatch',
        doc.uri.toString(),
        opener.line,
        opener.col
      );
      assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 0);
    } finally {
      await setTrigger(undefined);
    }
  });

  test('renders clickable inlay hints with tooltips', async () => {
    await setTrigger('always');
    try {
      const doc = await vscode.workspace.openTextDocument({ language: 'c', content: CHAIN });
      await vscode.window.showTextDocument(doc);

      const hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
        'vscode.executeInlayHintProvider',
        doc.uri,
        new vscode.Range(0, 0, doc.lineCount, 0)
      );
      assert.ok(Array.isArray(hints), 'vscode.executeInlayHintProvider returned no array');

      const endif = hints.find((hint) => hint.position.line === 4);
      assert.ok(endif, `expected an #endif hint: ${JSON.stringify(hints)}`);

      const label = endif.label;
      assert.ok(Array.isArray(label), 'expected the label to be split into parts');
      assert.strictEqual(label.length, 2);
      assert.strictEqual(label[0].value, '<- :3-5 #else');
      assert.strictEqual(label[1].value, ' <= :1-5 #if X');

      const tooltip = label[1].tooltip;
      assert.ok(tooltip, 'expected a tooltip on the <= segment');
      const markdown = tooltip instanceof vscode.MarkdownString ? tooltip.value : String(tooltip);
      assert.match(markdown, /`#if X` — line 1/);
      assert.match(markdown, /```c\n#if X/);
    } finally {
      await setTrigger(undefined);
    }
  });

  test('jump command moves the caret to the match', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'c', content: MAIN });
    await vscode.window.showTextDocument(doc);

    await vscode.commands.executeCommand('shigan.jumpToMatch', doc.uri.toString(), 0, 15);

    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, 'expected an active editor');
    assert.strictEqual(editor.selection.active.line, 0);
    assert.strictEqual(editor.selection.active.character, 15);
  });

  test('re-renders inlay hints after a settings change without reopening', async () => {
    await setTrigger('always');
    await setShow(['brackets', 'macros']);
    try {
      const doc = await vscode.workspace.openTextDocument({ language: 'c', content: CHAIN });
      await vscode.window.showTextDocument(doc);
      const range = new vscode.Range(0, 0, doc.lineCount, 0);

      const before = await vscode.commands.executeCommand<vscode.InlayHint[]>(
        'vscode.executeInlayHintProvider',
        doc.uri,
        range
      );
      assert.ok(
        before.some((hint) => hint.position.line === 4),
        `expected the #endif hint before the change: ${JSON.stringify(before.map((h) => h.position.line))}`
      );

      // Dropping macros must be picked up by the config listener and the
      // provider must render the new output for the SAME, still-open document.
      await setShow(['brackets']);
      const after = await vscode.commands.executeCommand<vscode.InlayHint[]>(
        'vscode.executeInlayHintProvider',
        doc.uri,
        range
      );
      assert.ok(
        !after.some((hint) => hint.position.line === 4),
        `macro hint should be gone after disabling macros: ${JSON.stringify(after.map((h) => h.position.line))}`
      );

      // ...and turning them back on restores it, still without reopening.
      await setShow(['brackets', 'macros']);
      const restored = await vscode.commands.executeCommand<vscode.InlayHint[]>(
        'vscode.executeInlayHintProvider',
        doc.uri,
        range
      );
      assert.ok(
        restored.some((hint) => hint.position.line === 4),
        `expected the #endif hint back: ${JSON.stringify(restored.map((h) => h.position.line))}`
      );
    } finally {
      await setShow(['brackets', 'macros']);
      await setTrigger(undefined);
    }
  });

  test('provides a conditional hint for an untitled Rust document', async () => {
    await setTrigger('always');
    try {
      const doc = await vscode.workspace.openTextDocument({
        language: 'rust',
        content: '#[cfg(feature = "x")]\nmod m {\n}\n',
      });
      await vscode.window.showTextDocument(doc);
      const hints = await vscode.commands.executeCommand<ComputedHint[]>(
        'shigan.internal.computedHints'
      );
      const conditional = hints.find((hint) => hint.kind === 'conditional');
      assert.ok(conditional, `expected a Rust conditional hint: ${JSON.stringify(hints)}`);
      assert.strictEqual(conditional.inactive, false);
    } finally {
      await setTrigger(undefined);
    }
  });
});

function textOf(hovers: vscode.Hover[]): string {
  return hovers
    .map((hover) =>
      hover.contents
        .map((part) => (typeof part === 'string' ? part : (part as vscode.MarkdownString).value))
        .join('\n')
    )
    .join('\n');
}
