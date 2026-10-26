using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Xml.Linq;
using IntelNucStudio.Ec;
using Forms = System.Windows.Forms;

namespace IntelNucStudio.Ec.Tests
{
    internal static class AutoStartScenarios
    {
        internal static async Task RunAsync(Action<string> pass, bool checkWindowsScheduler)
        {
            const string sid = "S-1-5-21-101-102-103-1001";
            const string spacedPath = @"C:\Program Files\NUC 软件 & 工具\NucSoftwareStudio.exe";
            var ns = AutoStartSettings.TaskNamespace;
            var definition = XElement.Parse(AutoStartSettings.BuildDefinition(spacedPath, sid));
            var principal = definition.Element(ns + "Principals").Element(ns + "Principal");
            var exec = definition.Element(ns + "Actions").Element(ns + "Exec");
            Assert((string)exec.Element(ns + "Command") == spacedPath && (string)exec.Element(ns + "Arguments") == "tray"
                && (string)exec.Element(ns + "WorkingDirectory") == Path.GetDirectoryName(spacedPath), "Startup paths must preserve spaces/Unicode/XML metacharacters");
            Assert((string)principal.Element(ns + "UserId") == sid && (string)principal.Element(ns + "LogonType") == "InteractiveToken"
                && (string)principal.Element(ns + "RunLevel") == "HighestAvailable", "Startup must use only the current interactive user without passwords");
            var settings = definition.Element(ns + "Settings");
            Assert((string)settings.Element(ns + "MultipleInstancesPolicy") == "IgnoreNew"
                && (string)settings.Element(ns + "ExecutionTimeLimit") == "PT0S"
                && (string)settings.Element(ns + "DisallowStartIfOnBatteries") == "false"
                && (string)settings.Element(ns + "StopIfGoingOnBatteries") == "false"
                && (string)definition.Element(ns + "Triggers").Element(ns + "LogonTrigger").Element(ns + "Delay") == "PT15S",
                "Startup should not duplicate a running scheduled instance or stop it on battery/time limits");
            pass("Logon definition preserves quoted paths, current-user elevation, tray startup and battery operation");
            Assert(EcDomainManager.IsBackgroundStartup(new[] { "app.exe", "tray" })
                && !EcDomainManager.IsBackgroundStartup(new[] { "app.exe" })
                && !EcDomainManager.IsBackgroundStartup(new[] { "app.exe", "other", "tray" }), "Background mode must match the original first argument");
            var backgroundWindow = new System.Windows.Window
            {
                Content = new System.Windows.Controls.Grid(), Width = 300, Height = 200,
                Left = -15000, Top = -15000, Opacity = 0.75, ShowInTaskbar = true
            };
            EcDomainManager.PrepareBackgroundWindow(backgroundWindow);
            await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.ApplicationIdle);
            Assert(backgroundWindow.IsLoaded && !backgroundWindow.IsVisible && backgroundWindow.Opacity == 0.75 && backgroundWindow.ShowInTaskbar,
                "Tray startup must load WPF templates without leaving a visible window or changing normal restore settings");
            backgroundWindow.Close();
            pass("Original tray startup can initialize the extension invisibly before the first window Open");

            var exe = typeof(AutoStartScenarios).Assembly.Location;
            var store = new MemoryLogonTasks();
            var admin = true;
            var manager = new AutoStartSettings(exe, sid, store, () => admin);
            Assert(!(await manager.ReadAsync()).Enabled && store.RegisterCalls == 0, "Reading settings must not opt into startup");
            await manager.SetEnabledAsync(true);
            Assert((await manager.ReadAsync()).Enabled && store.LastName == manager.TaskName, "Enable must be confirmed by scheduler readback");
            await manager.SetEnabledAsync(true);
            Assert(store.RegisterCalls == 2 && (await manager.ReadAsync()).Enabled, "Re-enable must update the same task instead of adding duplicates");
            await manager.SetEnabledAsync(false);
            await manager.SetEnabledAsync(false);
            Assert(!(await manager.ReadAsync()).Enabled && store.DeleteCalls == 1, "Disable must remove exactly the owned task and be idempotent");
            pass("Startup is off by default, enables with readback, updates in place and removes cleanly");

            store.Xml = AutoStartSettings.BuildDefinition(spacedPath, sid);
            Assert(!(await manager.ReadAsync()).Enabled, "An old executable path must not be reported as this version being enabled");
            await manager.SetEnabledAsync(true);
            Assert((await manager.ReadAsync()).Enabled, "Explicit enable should replace an older version's path");
            var disabled = XElement.Parse(store.Xml);
            disabled.Element(ns + "Settings").Element(ns + "Enabled").Value = "false";
            store.Xml = disabled.ToString();
            Assert(!(await manager.ReadAsync()).Enabled, "Externally disabled tasks must be shown as disabled");
            pass("Older-version paths and external scheduler disablement are reflected accurately");

            store.Xml = null;
            var writes = store.RegisterCalls;
            admin = false;
            await ExpectFailure(() => manager.SetEnabledAsync(true), "管理员");
            Assert(store.RegisterCalls == writes && !(await manager.ReadAsync()).Enabled, "Permission failure must not falsely enable startup");
            admin = true;
            store.Xml = AutoStartSettings.BuildDefinition(exe, "S-1-5-21-999");
            await ExpectFailure(() => manager.SetEnabledAsync(true), "不属于");
            await ExpectFailure(() => manager.SetEnabledAsync(false), "不属于");
            Assert(store.RegisterCalls == writes && store.DeleteCalls == 1, "Foreign tasks must not be replaced or deleted");
            store.Xml = null;
            var missing = new AutoStartSettings(Path.Combine(Path.GetDirectoryName(exe), Guid.NewGuid() + ".exe"), sid, store, () => true);
            await ExpectFailure(() => missing.SetEnabledAsync(true), "不存在");
            pass("Missing admin rights, unrelated tasks and missing executables are rejected before writes");

            var fake = new MemoryAutoStartSettings();
            Exception reported = null;
            using (var tray = new TestOfficialTray())
            using (var menu = new AutoStartMenu(fake, error => reported = error))
            using (var bridge = new OfficialTrayBridge(tray, tray.Icon, () => Task.CompletedTask, menu))
            {
                await menu.RefreshAsync();
                var item = Find(tray);
                Assert(!item.Checked && item.Enabled, "Tray must show actual initial startup state");
                bridge.Sync(true);
                await menu.ToggleAsync();
                Assert(item.Checked && fake.Enabled && !tray.PerformanceItem.Enabled && tray.LightItem.Enabled,
                    "Startup toggle must stay usable while EC locks performance only");
                tray.ReformatMenu();
                bridge.Sync(true);
                await menu.RefreshAsync();
                item = Find(tray);
                Assert(item.Checked && item.Enabled, "Native menu replacement must retain startup state");
                tray.Icon.ContextMenuStrip.Items.Clear();
                bridge.Sync(true);
                await menu.RefreshAsync();
                Assert(Find(tray).Checked, "In-place native menu rebuild must retain the shortcut");
                pass("Startup toggle survives native menu rebuilds and remains usable during EC control");

                fake.FailSet = true;
                await menu.ToggleAsync();
                Assert(reported != null && item.Checked && item.Enabled && fake.Enabled, "Failed disable must retain the actual checked state and show an error");
                fake.FailSet = false;
                await menu.ToggleAsync();
                Assert(!item.Checked && !fake.Enabled, "Successful disable should clear the check only after readback");
                fake.FailRead = true;
                await menu.RefreshAsync();
                Assert(item.Text.Contains("未读取") && item.Enabled, "Read failures must be visible and permit retry");
                fake.FailRead = false;
                pass("Tray toggle handles write/read failures truthfully and supports retry");

                fake.PendingSet = new TaskCompletionSource<bool>();
                var first = menu.ToggleAsync();
                var count = fake.SetCalls;
                await menu.ToggleAsync();
                Assert(!item.Enabled && fake.SetCalls == count, "A second click must not race an in-flight settings write");
                fake.PendingSet.SetResult(true);
                await first;
                Assert(item.Checked && fake.Enabled && item.Enabled, "Pending settings write did not complete correctly");
                pass("Repeated startup clicks cannot issue concurrent settings changes");
            }
            if (checkWindowsScheduler)
            {
                await Task.Run(() => VerifyWindowsDefinition(AutoStartSettings.BuildDefinition(exe, System.Security.Principal.WindowsIdentity.GetCurrent().User.Value)));
                pass("Windows Task Scheduler accepts the definition and exact missing-task reads; no task registered");
            }
        }

        private static void VerifyWindowsDefinition(string xml)
        {
            object service = null, definition = null;
            try
            {
                service = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service", true));
                ((dynamic)service).Connect();
                definition = ((dynamic)service).NewTask(0);
                ((dynamic)definition).XmlText = xml; // validates schema without registering/running anything
                Assert(new WindowsLogonTaskStore().Read("NUCtool.Ec.ReadOnlyProbe." + Guid.NewGuid().ToString("N")) == null,
                    "Exact absent-task lookup should report disabled instead of a scheduler failure");
                foreach (var entry in new WindowsLogonTaskStore().Enumerate())
                    Assert(entry.Name.StartsWith(AutoStartSettings.TaskPrefix, StringComparison.Ordinal), "Installer enumeration must project only this product's task names");
            }
            finally
            {
                if (definition != null) Marshal.FinalReleaseComObject(definition);
                if (service != null) Marshal.FinalReleaseComObject(service);
            }
        }

        private static Forms.ToolStripMenuItem Find(TestOfficialTray tray) =>
            (Forms.ToolStripMenuItem)tray.Icon.ContextMenuStrip.Items["NssEcAutoStart"];
        private static async Task ExpectFailure(Func<Task> action, string message)
        {
            try { await action(); } catch (Exception error) { if (error.Message.Contains(message)) return; throw; }
            throw new Exception("Expected failure: " + message);
        }
        private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    }

    internal sealed class MemoryLogonTasks : ILogonTaskStore
    {
        public string Xml;
        public string LastName;
        public int RegisterCalls;
        public int DeleteCalls;
        public string Read(string name) { LastName = name; return Xml; }
        public void Register(string name, string xml) { LastName = name; Xml = xml; RegisterCalls++; }
        public void Delete(string name) { LastName = name; Xml = null; DeleteCalls++; }
    }

    internal sealed class MemoryAutoStartSettings : IAutoStartSettings
    {
        public bool Enabled;
        public bool FailSet;
        public bool FailRead;
        public int SetCalls;
        public TaskCompletionSource<bool> PendingSet;
        public Task<AutoStartStatus> ReadAsync() => FailRead ? Task.FromException<AutoStartStatus>(new Exception("Simulated read failure"))
            : Task.FromResult(new AutoStartStatus(Enabled, "TEST"));
        public async Task SetEnabledAsync(bool enabled)
        {
            SetCalls++;
            if (FailSet) throw new Exception("Simulated write failure");
            if (PendingSet != null) await PendingSet.Task;
            Enabled = enabled;
        }
    }
}
