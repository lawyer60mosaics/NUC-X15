# EC module inside the official Intel NUC Software Studio application

This project builds a .NET Framework 4.8 extension DLL. The supplied Intel
`NucSoftwareStudio.exe` remains the entry point and retains its original bytes.
Its configuration loads `EcDomainManager`, which waits for the actual
`NucSoftwareStudio.App` and `NucSoftwareStudio.Views.MainWindow`, then adds an EC
entry and page to that window. The original WPF controls, Prism modules, BAML,
resources, bindings, and service client assemblies remain in use.

The EC page calls the shared C# WMI controller in-process. Its entry appears only
on the official home view, matching the native System Monitor shortcut's icon-above-caption
layout, font size and icon dimensions. Opening the page only reads hardware. During EC control,
only the official performance summary/detail is disabled and covered by a mask with red
`EC控制中` text. Other functions such as keyboard, lighting, display and system
configuration remain usable. Returning home retains EC and the performance mask;
stopping EC hands back to firmware before unlocking performance. Failed handoff
retains the lock. Fixed speed requests recheck temperature protection every second. The
original close glyph and Alt+F4 hide to tray while EC continues running;
only explicit Exit commands hand off before exiting. This version does not provide an out-of-process crash
watchdog; forced termination cannot execute exit cleanup.

Version 0.1.6 applies an industrial WPF theme to the actual official home and
detail controls: matte navy surfaces, precise thin card frames/header separators,
consistent typography, rectangular buttons and slider grips, dark dropdowns and
explicit keyboard focus. The five home modules retain their original grouping.
Original named styles are extended at runtime while preserving command/state
bindings and editable dropdown template parts. Decorative frames cannot capture
input and render below EC pages/masks. The EC page reflows below 900 DIP, uses dark
scrollbars and keeps recovery controls reachable. See `docs/industrial-ui-design.md`.

Version 0.1.5 adds a checked **开机自启动** item to the original tray menu.
It creates/removes one current-user logon task through Windows `schtasks.exe`,
runs the current official EXE with `tray` after 15 seconds, uses the interactive
user's highest available privileges without storing a password, and allows battery
operation without a runtime limit. Startup does not enable EC control. State is
read back from Task Scheduler; failures remain visible and retryable. A moved/new
copy can explicitly update the task path. Tray startup initializes WPF templates
invisibly so the extension and safe exit can attach before the first Open.

Version 0.1.2 adds Quiet / Balanced / Performance EC fan presets using the existing
repository's 35–85°C CPU/GPU curves. Selecting a preset starts it; selecting another
while running atomically replaces the profile without handing off EC ownership.
Ramp rates and thermal overrides remain active, and these presets do not alter
the official vendor CPU/GPU performance settings.

Version 0.1.4 sizes the home EC shortcut from its own caption instead of the
official monitor button's fixed allocation. It follows the native icon scale,
keeps text at least 12 DIP, and preserves the full caption above the window edge.
The cyan caption stays independent of inherited default foregrounds.
The WPF harness covers 15 window-width/home-scale combinations and hide/restore
with EC active. Titlebar X and Alt+F4 hide to tray; explicit Exit first releases EC.

Version 0.1.3 replaces the official tray `Exit_Click` delegate because it reads
`ApplicationData.Current` without a package-identity fallback before shutdown.
The safe exit callback also survives original menu rebuilds. Tray performance
presets are disabled during EC control, while tray lighting/open/exit stay usable.

The copied EXE configuration explicitly registers WCF `netHttpBinding` and opts
into .NET Framework 4.8. Without this compatibility configuration, the original
`ProfilesView` fails to initialize before connecting to Uniwill Service. The
original root and Prism regions must never be detached or reparented.

Build a local copy and ZIP from the user-supplied official MSIX:

```powershell
rtk proxy pwsh -NoProfile -File scripts/package-intel-nss-ec.ps1 -MsixPath 'C:\path\Intel NUC Software Studio.msix'
```

Run the resulting **official `NucSoftwareStudio.exe`** as administrator. The
original installed app and all other EC controllers must be exited first. No
vendor binaries are committed by this project. The original EXE configuration is
backed up alongside the extension, and its EXE hash is recorded in the integration
manifest. Optional development startup diagnostics are enabled only when
`NSS_EC_DIAGNOSTICS` points to a local file.

Verification: REA identified the actual App, MainWindow, ProfilesView and official
close handler. Runtime diagnostics confirmed the EC DLL loaded in the original
`NucSoftwareStudio.exe` and its MainWindow; the original five modules and service
telemetry became available after the WCF fix. The test executable covers 34 startup, theme, shortcut-style, curve,
production-loop hot-swap, thermal, input validation, WPF navigation, interlock,
failure-recovery, partial-mask and tray scenarios with simulated EC boundaries.
An optional original-artifact fixture binds and reproduces the actual shipped
`TrayApp.Exit_Click` before verifying its replacement:

```powershell
rtk proxy dotnet build integrations/IntelNucStudio.Ec.Tests -c Release
rtk proxy integrations/IntelNucStudio.Ec.Tests/bin/Release/net48/IntelNucStudio.Ec.Tests.exe
rtk proxy integrations/IntelNucStudio.Ec.Tests/bin/Release/net48/IntelNucStudio.Ec.Tests.exe --exit-via-tray --official-dir 'C:\path\extracted\NucSoftwareStudio'
```

Adding `--task-scheduler-check` validates the generated XML with the installed
Windows scheduler and tests missing-task lookup without registration. With both
optional checks, 39 scenarios run, including real vendor control-style contracts
and all five original home BAML views with null models (no vendor services).
Tests use a memory task store for writes;
elevated task registration and an actual sign-in/reboot remain device checks.

These tests perform no hardware writes. Real EC actuation is a separate device
check and must not be inferred from passing UI tests or successful compilation.
