# ADR 0002: Add Linux packaging alongside the Windows installer

Date: 2026-10-08

Status: Accepted. Directory, AppImage, archive, and Arch package targets added.

## Context

The user prefers an installer but accepts terminal launch initially. Current
pack/release commands invoke PowerShell and publish a WPF/NSIS executable.
Electron-builder already supports Linux directory, AppImage, and pacman targets;
the directory target built successfully during research.

The original packaged Zodiak placed its state alongside the executable. Linux system installs
and read-only AppImage mounts require a writable user profile instead.

## Decision

Preserve the Windows installer. Add a Linux build path using electron-builder,
with Windows native resources scoped to Windows. First validate the source and
directory build, then an AppImage distribution. Use Electron's per-user storage
paths on Linux for settings, UUID, preferences, cache, logs, and crash dumps.

AppImage provides a downloadable graphical app, but does not reproduce the
Windows installation wizard. If native installation on Arch is required,
validate a pacman package with desktop integration as a separate artifact. The
current builder docs describe the pacman target as beta.

Use manual updates for the first Linux delivery until artifact selection,
Linux channel manifests, download/replacement, and persistence are verified.
Keep unsupported update actions disabled. The Linux CI/release job is added.
Later add platform-aware beta validation and Linux updater manifests.

## Consequences

Linux does not require PowerShell, WPF, or a Windows .NET SDK to run the core app.
Source launch remains a usable early milestone. Distribution validation must
cover normal-user access, FUSE/extraction behavior for AppImage, persistent
identity/settings, install/uninstall for native packages, and updates.

The installer appearance can differ between operating systems while the app
experience remains shared. No Linux release has been published or installed by
this research. See [assessment](../linux-port.md) for current validation limits.
