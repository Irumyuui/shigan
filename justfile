# Shigan — dev, test and packaging recipes.
#
# Requires: bun (https://bun.sh). Everything here can also be run directly,
# e.g. `bun run test:unit`, if you do not have `just` installed.
#
#   just            list recipes
#   just ci         typecheck + unit tests + integration tests
#   just package    build and produce a development VSIX in artifacts/

# PowerShell only on Windows; other platforms use just's default `sh -cu`.
[windows]
set shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# List available recipes
_default:
    @just --list

# Install dependencies
setup:
    bun install

# Bundle dist/extension.js (development build, with sourcemap)
build:
    bun run build

# Rebuild on change
watch:
    bun run watch

# Type-check the whole repository
typecheck:
    bun run typecheck

# Unit tests and golden fixtures (fast, no VS Code)
test-unit:
    bun run test:unit

# Typecheck + unit tests
test: typecheck test-unit

# Integration tests in an isolated VS Code instance (first run downloads VS Code)
test-integration:
    bun run test:integration

# What CI should run
ci: typecheck test-unit test-integration

# Remove dist/, out/ and artifacts/
clean:
    bun run clean

# Build and package a development VSIX into artifacts/
package:
    bun run package

# Build and package a minimal production VSIX (minified, no sourcemap)
package-min:
    bun run package:min

# Package and install the VSIX into the local VS Code
install:
    bun run install:vsix

# Bump the version, commit and tag a release (needs a CHANGELOG.md entry)
release version:
    bun run scripts/release.ts {{version}}
