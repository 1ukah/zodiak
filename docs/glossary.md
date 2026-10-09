# Media and Linux portability glossary

| Term | Meaning in Zodiak |
| --- | --- |
| LiveKit server / SFU | Routes participants' media/data; joining does not itself start a desktop capture |
| Room | Named session containing participants and publications |
| Participant | One connected identity; Zodiak stores a persistent local UUID |
| Participant token | Room-scoped JWT issued by the Electron main process with the configured server credentials |
| Publisher / viewer role | App metadata/intent; both token roles currently grant screen, screen-audio, microphone, and data publication plus subscription |
| Publication | Metadata for a published track; it may exist before a viewer subscribes |
| Subscription / watch | Requests delivery of a remote screen and its paired audio; Zodiak subscribes when the user watches |
| ScreenShare | Video track source for a screen or window; independent of screen audio |
| ScreenShareAudio | Audio publication paired with a screen; receiving it does not require local loopback capture |
| Microphone | Voice-chat track; independent of whole-system audio |
| Capture source | OS-granted screen/window selected for a local video stream |
| Capture capability | Main-process description of supported picker/audio features, proposed for the port |
| Wayland | Linux display protocol; desktop capture normally uses compositor-mediated consent |
| X11 / XWayland | X11 display system or its compatibility server under Wayland; an app running there is not proof of native Wayland capture |
| Desktop portal | Desktop service handling a consent/selection request; KDE provides a ScreenCast backend |
| PipeWire | Linux media graph used for desktop video streams and audio routing |
| WASAPI process loopback | Windows helper captures audio with Zodiak/Discord process exclusions |
| Sink monitor | Captures audio sent to an output sink; can include remote playback and cause feedback |
| H.264 | Current outgoing video codec requested in production; software encoding/decoding worked on this host |
| AppImage | Portable Linux application file; often mounted read-only at runtime |
| pacman package | Native Arch installable package with package-manager lifecycle |
| User profile | Writable persistent settings/UUID/preferences plus associated cache/session paths |
| Update manifest | Platform/channel metadata such as `latest-linux.yml` describing downloadable release artifacts |

## Relationships and invariants

One server contains rooms; each room contains participants; each participant
owns publications. A remote publication can be visible in the UI without
being subscribed. Watching subscribes its video and paired screen audio;
hiding removes both deliveries and playback attachments.

A local capture creates a video track, then the session publishes it as
`ScreenShare`. Optional system audio is separately published as
`ScreenShareAudio`. Stopping video must stop its paired audio and capture
resources. A screen may therefore be watched with sound even when the viewer's
platform cannot capture system audio itself.

Capture consent/source handles are scoped to the OS capture flow; reusable
enumeration IDs must not be assumed on the portal path. Cancelling selection
must not leave armed capture state or a running helper.

An identity/profile survives app restart and package replacement. Installation
resources must not be used as the Linux writable profile. Packaging and updater
support are independent of LiveKit media interoperability.
