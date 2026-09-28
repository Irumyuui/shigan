import { PairKind, Trigger } from './types';

export interface ShiganConfig {
  enable: boolean;
  languages: string[];
  trigger: Trigger;
  show: PairKind[];
  compileFlags: string[];
  inheritCompileCommands: boolean;
  /** Extra C# preprocessor symbols supplied by the user. */
  csharpDefine: string[];
  /** Whether to read C# symbols from the nearest project file. */
  csharpInheritProject: boolean;
  /** `$(Configuration)` used when evaluating a C# project file. */
  csharpConfiguration: string;
  /** Target framework override used to derive implicit C# symbols. */
  csharpTargetFramework: string;
  /** Extra Rust cfg entries (`shigan.rust.cfg`) for `#[cfg]` evaluation. */
  rustCfg: string[];
  /** Whether to read feature facts from the nearest Cargo.toml. */
  rustInheritCargo: boolean;
  trackFileDefines: boolean;
  skipInactiveBrackets: boolean;
  skipInactiveDirectives: boolean;
  markInactive: boolean;
  showRange: boolean;
  rangeHideThreshold: number;
  showLabel: boolean;
}

/**
 * Reads one setting, returning `fallback` when it is unset.
 * `vscode.WorkspaceConfiguration.get` has this shape; a plain object can be
 * adapted to it in tests.
 */
export interface SettingReader {
  <T>(key: string, fallback: T): T;
}

/**
 * Maps the `shigan.*` settings onto {@link ShiganConfig}.
 *
 * Kept free of `vscode` imports so every setting can be unit tested; the
 * integration suite additionally verifies the effect of each one end to end.
 */
export function readConfigFrom(get: SettingReader): ShiganConfig {
  return {
    enable: get<boolean>('enable', true),
    languages: get<string[]>('languages', ['c', 'cpp', 'csharp']),
    trigger: get<Trigger>('trigger', 'cursor'),
    show: get<PairKind[]>('show', ['brackets', 'macros']),
    compileFlags: get<string[]>('compileFlags', []),
    inheritCompileCommands: get<boolean>('inheritCompileCommands', false),
    csharpDefine: get<string[]>('csharp.define', []),
    csharpInheritProject: get<boolean>('csharp.inheritProject', true),
    csharpConfiguration: get<string>('csharp.configuration', 'Debug'),
    csharpTargetFramework: get<string>('csharp.targetFramework', ''),
    rustCfg: get<string[]>('rust.cfg', []),
    rustInheritCargo: get<boolean>('rust.inheritCargo', true),
    trackFileDefines: get<boolean>('preprocessor.trackFileDefines', true),
    skipInactiveBrackets: get<boolean>('preprocessor.skipInactiveBrackets', true),
    skipInactiveDirectives: get<boolean>('preprocessor.skipInactiveDirectives', false),
    markInactive: get<boolean>('preprocessor.markInactive', true),
    showRange: get<boolean>('showRange', true),
    rangeHideThreshold: get<number>('showRangeThreshold', 0),
    showLabel: get<boolean>('showLabel', true),
  };
}
