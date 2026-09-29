import { LanguageKind } from './language';
import { PairKind, Trigger } from './types';

/** C / C++ settings: one independent group per language. */
export interface CLanguageSettings {
  /** Evaluate `#define`/`#undef` found in the current file. */
  trackFileDefines: boolean;
  /** Compiler-style flags, e.g. `-DFOO=1`. */
  compileFlags: string[];
  /** Also read `-D`/`-I`/`-std` from the nearest compile_commands.json. */
  inheritCompileCommands: boolean;
}

/** C# settings. C# never reads compile_commands.json. */
export interface CSharpLanguageSettings {
  /** Evaluate `#define`/`#undef` found in the current file. */
  trackFileDefines: boolean;
  /** Compiler-style flags used as the highest-precedence C# symbols. */
  compileFlags: string[];
  /** Extra C# preprocessor symbols supplied by the user. */
  define: string[];
  /** Whether to read C# symbols from the nearest project file. */
  inheritProject: boolean;
  /** `$(Configuration)` used when evaluating a C# project file. */
  configuration: string;
  /** Target framework override used to derive implicit C# symbols. */
  targetFramework: string;
}

/** Rust settings. */
export interface RustLanguageSettings {
  /** Extra Rust cfg entries (`shigan.rust.cfg`) for `#[cfg]` evaluation. */
  cfg: string[];
  /** Whether to read feature facts from the nearest Cargo.toml. */
  inheritCargo: boolean;
}

export interface ShiganConfig {
  enable: boolean;
  languages: string[];
  trigger: Trigger;
  show: PairKind[];
  skipInactiveBrackets: boolean;
  skipInactiveDirectives: boolean;
  markInactive: boolean;
  showRange: boolean;
  rangeHideThreshold: number;
  showLabel: boolean;
  c: CLanguageSettings;
  cpp: CLanguageSettings;
  csharp: CSharpLanguageSettings;
  rust: RustLanguageSettings;
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
    languages: get<string[]>('languages', ['c', 'cpp', 'csharp', 'rust']),
    trigger: get<Trigger>('trigger', 'cursor'),
    show: get<PairKind[]>('show', ['brackets', 'macros']),
    skipInactiveBrackets: get<boolean>('inactive.skipBrackets', true),
    skipInactiveDirectives: get<boolean>('inactive.skipDirectives', false),
    markInactive: get<boolean>('inactive.markInactive', true),
    showRange: get<boolean>('showRange', true),
    rangeHideThreshold: get<number>('showRangeThreshold', 0),
    showLabel: get<boolean>('showLabel', true),
    c: {
      trackFileDefines: get<boolean>('c.trackFileDefines', true),
      compileFlags: get<string[]>('c.compileFlags', []),
      inheritCompileCommands: get<boolean>('c.inheritCompileCommands', false),
    },
    cpp: {
      trackFileDefines: get<boolean>('cpp.trackFileDefines', true),
      compileFlags: get<string[]>('cpp.compileFlags', []),
      inheritCompileCommands: get<boolean>('cpp.inheritCompileCommands', false),
    },
    csharp: {
      trackFileDefines: get<boolean>('csharp.trackFileDefines', true),
      compileFlags: get<string[]>('csharp.compileFlags', []),
      define: get<string[]>('csharp.define', []),
      inheritProject: get<boolean>('csharp.inheritProject', true),
      configuration: get<string>('csharp.configuration', 'Debug'),
      targetFramework: get<string>('csharp.targetFramework', ''),
    },
    rust: {
      cfg: get<string[]>('rust.cfg', []),
      inheritCargo: get<boolean>('rust.inheritCargo', true),
    },
  };
}

/**
 * The three C-family consumption values, resolved for one language kind.
 * C# carries no `inheritCompileCommands`: it never reads compile_commands.json,
 * so the field is always `false` there.
 */
export interface LanguageSettings {
  trackFileDefines: boolean;
  compileFlags: string[];
  inheritCompileCommands: boolean;
}

/**
 * Picks the per-language group a C-family consumer should use.
 *
 * Rust is not a C-family kind and never consumes these settings; the C group is
 * returned as the fallback (mirroring `syntaxFor`) so a caller that dispatches
 * on {@link LanguageKind} can pass the kind through without narrowing.
 */
export function languageSettingsFor(config: ShiganConfig, kind: LanguageKind): LanguageSettings {
  switch (kind) {
    case 'cpp':
      return config.cpp;
    case 'csharp':
      return {
        trackFileDefines: config.csharp.trackFileDefines,
        compileFlags: config.csharp.compileFlags,
        // C# deliberately has no compile_commands.json support.
        inheritCompileCommands: false,
      };
    case 'c':
    case 'rust':
    default:
      return config.c;
  }
}
