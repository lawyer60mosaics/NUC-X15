using System;
using System.Collections.Generic;
using System.IO;
using System.Xml.Linq;
using System.Threading.Tasks;
using IntelNucStudio.Ec;

namespace IntelNucStudio.Ec.Tests
{
    internal static class InstallationScenarios
    {
        internal static void Run(Action<string> pass)
        {
            var parent = Path.Combine(Path.GetTempPath(), "NucStudioInstallerTests");
            var directory = Path.GetFullPath(Path.Combine(parent, Guid.NewGuid().ToString("N")));
            Directory.CreateDirectory(directory);
            try
            {
                const string current = "S-1-5-21-101-102-103-1001";
                const string other = "S-1-5-21-101-102-103-1002";
                const string portableUser = "S-1-5-21-101-102-103-1003";
                var installed = Path.Combine(directory, "installed");
                var previous = Path.Combine(directory, "old-install");
                Directory.CreateDirectory(installed);
                var exe = Path.Combine(installed, "NucSoftwareStudio.exe");
                File.WriteAllText(exe, "TEST-NOT-EXECUTABLE");
                var store = new InstallerMemoryTasks();
                var disabled = XElement.Parse(AutoStartSettings.BuildDefinition(Path.Combine(directory, "portable", "NucSoftwareStudio.exe"), current));
                var ns = AutoStartSettings.TaskNamespace;
                disabled.Element(ns + "Settings").Element(ns + "Enabled").Value = "false";
                store.Add(current, disabled.ToString());
                store.Add(other, AutoStartSettings.BuildDefinition(Path.Combine(previous, "NucSoftwareStudio.exe"), other));
                store.Add(portableUser, AutoStartSettings.BuildDefinition(Path.Combine(directory, "other-portable", "NucSoftwareStudio.exe"), portableUser));
                const string foreignSid = "S-1-5-21-101-102-103-1004";
                var unrelatedName = AutoStartSettings.TaskPrefix + foreignSid;
                var foreign = XElement.Parse(AutoStartSettings.BuildDefinition(Path.Combine(previous, "NucSoftwareStudio.exe"), current));
                foreign.Element(ns + "RegistrationInfo").Element(ns + "Source").Value = "Other product";
                foreign.Element(ns + "Principals").Element(ns + "Principal").Element(ns + "UserId").Value = foreignSid;
                store.Entries.Add(unrelatedName, foreign.ToString());
                Assert(InstallationTasks.Migrate(installed, previous, current, store) == 2, "Only own-user portable or previous-install tasks may migrate");
                Assert(store.Registrations == 2 && store.Deletions == 0, "Migration should update existing tasks without deleting them");
                var actual = XElement.Parse(store.Read(AutoStartSettings.TaskPrefix + current));
                Assert((string)actual.Element(ns + "Settings").Element(ns + "Enabled") == "false"
                    && (string)actual.Element(ns + "Actions").Element(ns + "Exec").Element(ns + "Command") == exe
                    && (string)actual.Element(ns + "Actions").Element(ns + "Exec").Element(ns + "WorkingDirectory") == installed,
                    "Migration must preserve disabled state and update both executable and working directory");
                Assert(InstallationTasks.Migrate(installed, previous, current, store) == 0, "Reinstalling at the same path should not rewrite already-correct tasks");
                pass("Installer migrates owned startup paths while preserving users, enabled states and unrelated portable copies");

                Assert(InstallationTasks.Remove(installed, store) == 2 && store.Deletions == 2,
                    "Uninstall must clean all owned tasks targeting this installed executable");
                Assert(store.Read(AutoStartSettings.TaskPrefix + portableUser) != null && store.Read(unrelatedName) != null,
                    "Uninstall must leave unrelated tasks and other installed/portable paths untouched");
                Assert(InstallationTasks.Remove(installed, store) == 0, "Repeated cleanup must be harmless");
                pass("Uninstall task cleanup is scoped to this installation and is idempotent");

                var blocked = new InstallerMemoryTasks { FailWrite = true };
                blocked.Add(current, disabled.ToString());
                var failed = false;
                try { InstallationTasks.Migrate(installed, previous, current, blocked); } catch (IOException) { failed = true; }
                Assert(failed && XElement.Parse(blocked.Read(AutoStartSettings.TaskPrefix + current)).ToString() == disabled.ToString(),
                    "Failed migration must report failure and retain the previous definition");
                pass("Installer task update failures remain visible and retain the existing startup definition");

                Assert(!InstallationTasks.IsInstallDirectoryAllowed(Path.GetPathRoot(directory))
                    && !InstallationTasks.IsInstallDirectoryAllowed("relative-path") && !InstallationTasks.IsInstallDirectoryAllowed("C:relative-path"),
                    "Drive roots and relative paths cannot be installation targets");
                var empty = Path.Combine(directory, "空目录 with spaces");
                Directory.CreateDirectory(empty);
                Assert(InstallationTasks.IsInstallDirectoryAllowed(empty), "Empty Unicode paths should be allowed");
                File.WriteAllText(Path.Combine(empty, "my-notes.txt"), "KEEP");
                Assert(!InstallationTasks.IsInstallDirectoryAllowed(empty), "Unrelated non-empty directories must be refused");
                File.WriteAllText(Path.Combine(empty, InstallationTasks.MarkerFile), "[Installation]\r\nProductId=" + InstallationTasks.ProductId + "\r\n");
                Assert(InstallationTasks.IsInstallDirectoryAllowed(empty), "Owned installation should permit upgrade without deleting user files");
                pass("Installer validates directory ownership and rejects unsafe or unrelated destinations");
            }
            finally
            {
                if (!directory.StartsWith(Path.GetFullPath(parent) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("Unsafe test cleanup path");
                Directory.Delete(directory, true);
            }
        }

        private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    }

    internal sealed class InstallerMemoryTasks : IInstallationTaskStore
    {
        internal readonly Dictionary<string, string> Entries = new Dictionary<string, string>();
        internal int Registrations;
        internal int Deletions;
        internal bool FailWrite;
        internal void Add(string sid, string xml) => Entries.Add(AutoStartSettings.TaskPrefix + sid, xml);
        public string Read(string name) => Entries.TryGetValue(name, out var value) ? value : null;
        public void Register(string name, string xml) { if (FailWrite) throw new IOException("Simulated scheduler denial"); Entries[name] = xml; Registrations++; }
        public void Delete(string name) { Entries.Remove(name); Deletions++; }
        public IReadOnlyList<LogonTaskRegistration> Enumerate()
        {
            var result = new List<LogonTaskRegistration>();
            foreach (var item in Entries) result.Add(new LogonTaskRegistration(item.Key, item.Value));
            return result;
        }
    }
}
