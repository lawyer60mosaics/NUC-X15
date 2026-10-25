# EC module inside the official Intel NUC Software Studio application

This project builds a .NET Framework 4.8 extension DLL. The supplied Intel
`NucSoftwareStudio.exe` remains the entry point and retains its original bytes.
Its configuration loads `EcDomainManager`, which waits for the actual
`NucSoftwareStudio.App` and `NucSoftwareStudio.Views.MainWindow`, then adds an EC
entry and page to that window. The original WPF controls, Prism modules, BAML,
resources, bindings, and service client assemblies remain in use.

The EC page calls the shared C# WMI controller in-process. Its entry appears only
on the official home view. Opening the page only reads hardware. During EC control,
the official content region is disabled and covered by a mask with red
`EC控制中` text. Returning home retains EC control and the mask; stopping EC hands
back to firmware before unlocking official settings. Failed handoff retains the
lock. Fixed speed requests recheck temperature protection every second. The
original close glyph and Alt+F4 hand off before exiting instead of only hiding
the window. This first version does not provide an out-of-process crash
watchdog; forced termination cannot execute exit cleanup.

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
telemetry became available after the WCF fix. The WPF test executable covers seven
navigation, interlock, failure-recovery and exit scenarios with a fake EC boundary:

```powershell
rtk proxy dotnet build integrations/IntelNucStudio.Ec.Tests -c Release
rtk proxy integrations/IntelNucStudio.Ec.Tests/bin/Release/net48/IntelNucStudio.Ec.Tests.exe
```

These tests perform no hardware writes. Real EC actuation is a separate device
check and must not be inferred from passing UI tests or successful compilation.
