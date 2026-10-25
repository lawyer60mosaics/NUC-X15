# Intel NUC Software Studio WPF host proof of concept

For the deliverable that runs **inside the official Intel program**, use
[`integrations/IntelNucStudio.Ec`](../../integrations/IntelNucStudio.Ec/README.md)
and `scripts/package-intel-nss-ec.ps1`. This experiment is retained for its shared
C# EC implementation; its standalone EXE is not the official integration package.

This isolated WPF prototype has two parts: metadata-only inspection of the original display-mode module, and an in-process EC fan module using the same `ROOT\\WMI / AcpiTest_MULong.GetSetULong` path as the existing Rust EC implementation. It does not modify or repackage the installed Intel application, and it does not bundle vendor binaries in this repository.

## Build and launch

Set `NSS_SOURCE_DIR` to the directory containing `MobileDisplayModeMgr.dll` and its sibling dependencies, then run:

```powershell
$env:NSS_SOURCE_DIR = "C:\\path\\to\\extracted\\NucSoftwareStudio"
dotnet run --project experiments/NssWpfHost/NssWpfHost.csproj
```

The EC module can read fan/temperature registers, request manual control, request per-fan speed, run a default Office/Balance temperature curve, and return control to EC auto. It runs WMI calls on a dedicated MTA worker, refreshes real temperature/RPM readback during curve control, and applies profile interpolation, a 20% floor, 78°C boost, 88°C protection, 95°C emergency behavior, and two-sample high-temperature stall response. Invalid temperature and partial-write failures request EC auto recovery. It requests administrator elevation, matching the current app's EC access requirement. Writes are marked as requests because the firmware does not provide a confirmed setpoint readback.

The original-module action loads only the display DLL and reads constructor dependency metadata. It deliberately does not instantiate the original module or view. Static inspection found module initialization calls the vendor client's `EnableDisplayModeManagement`; runtime side effects have not been independently validated. The view is compiled into WPF BAML resources and still needs original Prism registrations and services to render correctly.

The Rust watchdog/sentinel, sensor filters, power-source-specific curves, custom curve editing, and complete recovery policy have not yet been ported. This provides a basic in-process EC curve controller, not feature parity with the existing NUCtool fan controller.

## Runtime requirements

The original module targets the .NET Framework WPF runtime. The host targets .NET Framework 4.8 for compatibility with the shipped 4.x assemblies. It requires a Windows machine with the .NET Framework 4.8 runtime.
