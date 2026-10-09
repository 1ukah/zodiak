# ADR 0001: Start Linux support with receiving media and publishing video

Date: 2026-10-08

Status: Accepted and implemented; release validation is in progress.

## Context

Zodiak's Electron shell, LiveKit room/token code, and renderer media session
already run on Linux. Local integration testing demonstrated production H.264
publication and playback. Desktop selection and outgoing shared audio have
platform assumptions: the picker uses two source-enumeration calls, while audio
always uses a Windows WASAPI helper.

The user chose Arch Linux x86_64/KDE Wayland first, with both watching and
broadcasting video required. Outgoing shared audio and Discord exclusion may be
delivered later. See [assessment and evidence](../linux-port.md).

## Decision

Retain Electron, the current LiveKit SDKs, room grants, and remote media paths.
Expose platform capabilities through the existing typed IPC/preload boundary.
Disable outgoing shared audio and Discord exclusion on Linux initially, and
enforce that restriction in the main process as well as the controls.

Use a single portal-driven capture request on the Linux Wayland path, initiated
by the share action after quality selection. Grant the returned source object.
Keep reusable desktop source selection for platforms that support it. Treat
cancellation as an expected outcome and keep stop/leave cleanup effective.

Receiving screen audio must not depend on local system-audio capture. Microphone
voice is another independent capability and should not be disabled merely
because outgoing screen audio is unsupported.

## Consequences

The first Linux version can reach the requested workflow without a .NET audio
port. Linux users initially publish silent video and may still hear remote
screens/voice. KDE owns screen/window selection; the custom thumbnail picker
cannot be assumed to list desktop sources on Wayland.

The canvas-backed integration test validates transport and decode, while real
desktop capture, microphone behavior, a Windows publisher, and the full server
settings/room UI remain release gates. Missing Linux audio functionality is
visible in capabilities rather than a runtime helper error.

## Alternatives

- Rewriting the UI/native shell adds work without addressing a LiveKit blocker.
- Running the Windows build under Wine leaves capture/WASAPI behavior uncertain.
- Requiring Linux audio parity delays the accepted video milestone.
- A browser-only client would need a separate backend for the current main-
  process server APIs and token issuance; it is not a zero-change fallback.
