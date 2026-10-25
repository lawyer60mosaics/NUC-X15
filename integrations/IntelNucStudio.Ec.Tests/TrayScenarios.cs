using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Threading.Tasks;
using IntelNucStudio.Ec;
using Forms = System.Windows.Forms;

namespace IntelNucStudio.Ec.Tests
{
    internal static class TrayScenarios
    {
        internal static void Run(Action<string> pass, string officialDirectory)
        {
            using (var tray = new TestOfficialTray())
            {
                var originalFailed = false;
                try { tray.ExitItem.PerformClick(); }
                catch (COMException error) { originalFailed = error.HResult == unchecked((int)0x80073D54); }
                Assert(originalFailed, "Original broken exit should reproduce package-identity failure");
                var requests = 0;
                using (var bridge = new OfficialTrayBridge(tray, tray.Icon, () => { requests++; return Task.CompletedTask; }))
                {
                    tray.ExitItem.PerformClick();
                    Assert(requests == 1 && tray.BrokenExitCalls == 1, "Safe callback must replace original package-dependent exit");
                    pass("Tray exit replaces the failing package-identity callback");
                    bridge.Sync(true);
                    Assert(!tray.PerformanceItem.Enabled && tray.LightItem.Enabled && tray.ExitItem.Enabled,
                        "Only tray performance presets should lock during EC control");
                    tray.LightItem.PerformClick();
                    Assert(tray.LightCalls == 1, "Tray lighting must remain usable");
                    pass("EC locks tray performance presets and preserves lighting/exit");
                    tray.ReformatMenu();
                    bridge.Sync(true);
                    tray.ExitItem.PerformClick();
                    Assert(requests == 2 && tray.BrokenExitCalls == 1 && !tray.PerformanceItem.Enabled,
                        "Rebuilt official menu must retain safe exit and EC interlock");
                    pass("Rebuilt tray menus retain the exit fix and performance lock");
                    bridge.Sync(false);
                    Assert(tray.PerformanceItem.Enabled && !tray.UnsupportedItem.Enabled,
                        "Handoff must restore original enabled states");
                    pass("Tray handoff restores supported presets without enabling unsupported ones");
                }
            }
            if (!string.IsNullOrWhiteSpace(officialDirectory)) VerifyOriginalExit(officialDirectory, pass);
        }

        private static void VerifyOriginalExit(string directory, Action<string> pass)
        {
            ResolveEventHandler resolver = (sender, args) =>
            {
                var candidate = Path.Combine(directory, new AssemblyName(args.Name).Name + ".dll");
                return File.Exists(candidate) ? Assembly.LoadFrom(candidate) : null;
            };
            AppDomain.CurrentDomain.AssemblyResolve += resolver;
            try
            {
                // No original constructor or application entry point runs. This
                // fixture binds only the exact TrayApp.Exit_Click delegate.
                var assembly = Assembly.LoadFrom(Path.Combine(directory, "NucSoftwareStudio.exe"));
                var type = assembly.GetType("NucSoftwareStudio.TrayApp", true);
                var instance = FormatterServices.GetUninitializedObject(type);
                using (var icon = new Forms.NotifyIcon())
                using (var menu = new Forms.ContextMenuStrip())
                {
                    icon.ContextMenuStrip = menu;
                    type.GetField("_trayIcon", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(instance, icon);
                    type.GetField("_performancePresets", BindingFlags.Instance | BindingFlags.NonPublic)
                        .SetValue(instance, new Dictionary<string, EventHandler>());
                    var item = new Forms.ToolStripMenuItem("Original exit");
                    var original = (EventHandler)Delegate.CreateDelegate(typeof(EventHandler), instance,
                        type.GetMethod("Exit_Click", BindingFlags.Instance | BindingFlags.NonPublic));
                    item.Click += original;
                    menu.Items.Add(item);
                    var reproduced = false;
                    try { item.PerformClick(); }
                    catch (Exception error) { reproduced = error.HResult == unchecked((int)0x80073D54); }
                    Assert(reproduced, "Exact original exit handler did not reproduce 0x80073D54");
                    var requests = 0;
                    using (var bridge = new OfficialTrayBridge(instance, icon, () => { requests++; return Task.CompletedTask; }))
                    {
                        item.PerformClick();
                        Assert(requests == 1, "Exact official handler was not replaced");
                    }
                    pass("Original shipped Exit_Click reproduces 0x80073D54 and succeeds after rebinding");
                }
            }
            finally { AppDomain.CurrentDomain.AssemblyResolve -= resolver; }
        }

        private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    }

    internal sealed class TestOfficialTray : IDisposable
    {
        private readonly Dictionary<string, EventHandler> _performancePresets = new Dictionary<string, EventHandler>
            { { "Performance", (sender, args) => { } }, { "Unsupported", (sender, args) => { } } };
        public readonly Forms.NotifyIcon Icon = new Forms.NotifyIcon();
        public Forms.ToolStripMenuItem ExitItem;
        public Forms.ToolStripMenuItem LightItem;
        public Forms.ToolStripMenuItem PerformanceItem;
        public Forms.ToolStripMenuItem UnsupportedItem;
        public int BrokenExitCalls;
        public int LightCalls;

        public TestOfficialTray() { ReformatMenu(); }
        public void ReformatMenu()
        {
            var menu = new Forms.ContextMenuStrip();
            foreach (var preset in _performancePresets)
            {
                var item = new Forms.ToolStripMenuItem(preset.Key);
                item.Click += (sender, args) => preset.Value(sender, args);
                if (preset.Key == "Performance") PerformanceItem = item;
                else { UnsupportedItem = item; item.Enabled = false; }
                menu.Items.Add(item);
            }
            LightItem = new Forms.ToolStripMenuItem("Lighting");
            LightItem.Click += (sender, args) => LightCalls++;
            menu.Items.Add(LightItem);
            ExitItem = new Forms.ToolStripMenuItem("Exit");
            ExitItem.Click += Exit_Click;
            menu.Items.Add(ExitItem);
            Icon.ContextMenuStrip = menu;
        }
        private void Exit_Click(object sender, EventArgs args)
        {
            BrokenExitCalls++;
            throw new COMException("No package identity", unchecked((int)0x80073D54));
        }
        public void Dispose() { Icon.Dispose(); }
    }
}
