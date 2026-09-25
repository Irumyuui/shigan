/**
 * Detects the first activation after an install or an update.
 *
 * The extension cannot run while it is disabled or uninstalled, so the only
 * moment we can offer a reload is when we come back up. Keeping the last
 * activated version in `globalState` makes the prompt appear once per version.
 */
export interface VersionChange {
  kind: 'installed' | 'updated';
  version: string;
}

export function versionChange(
  previous: string | undefined,
  current: string
): VersionChange | undefined {
  if (current.length === 0) return undefined;
  if (previous === current) return undefined;
  return { kind: previous ? 'updated' : 'installed', version: current };
}
