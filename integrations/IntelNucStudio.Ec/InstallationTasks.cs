using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Principal;
using System.Xml.Linq;

namespace IntelNucStudio.Ec
{
    internal sealed class LogonTaskRegistration
    {
        internal string Name { get; }
        internal string Xml { get; }
        internal LogonTaskRegistration(string name, string xml) { Name = name; Xml = xml; }
    }

    internal interface IInstallationTaskStore : ILogonTaskStore
    {
        IReadOnlyList<LogonTaskRegistration> Enumerate();
    }

    internal static class InstallationTasks
    {
        internal const string ProductId = "3D74045B-4D41-4E8D-9AF5-B40F0EC7B712";
        internal const string MarkerFile = "installation-mode.ini";

        internal static int Migrate(string directory, string previousDirectory, string currentSid, IInstallationTaskStore store)
        {
            var exe = Path.Combine(Path.GetFullPath(directory), "NucSoftwareStudio.exe");
            if (!File.Exists(exe)) throw new FileNotFoundException("安装文件不完整。", exe);
            var oldExe = string.IsNullOrWhiteSpace(previousDirectory) ? null : Path.Combine(Path.GetFullPath(previousDirectory), "NucSoftwareStudio.exe");
            var updated = 0;
            foreach (var entry in store.Enumerate())
            {
                if (!TryOwned(entry, out var task, out var exec, out var sid)) continue;
                var command = (string)exec.Element(AutoStartSettings.TaskNamespace + "Command");
                // Migrate this user's portable copy, or other users' tasks only
                // when they point to the previously registered installation.
                if (sid != currentSid && (oldExe == null || !SamePath(command, oldExe))) continue;
                if (SamePath(command, exe)) continue;
                exec.Element(AutoStartSettings.TaskNamespace + "Command").Value = exe;
                var working = exec.Element(AutoStartSettings.TaskNamespace + "WorkingDirectory");
                if (working == null) exec.Add(new XElement(AutoStartSettings.TaskNamespace + "WorkingDirectory", Path.GetDirectoryName(exe)));
                else working.Value = Path.GetDirectoryName(exe);
                store.Register(entry.Name, task.ToString());
                updated++;
            }
            return updated;
        }

        internal static int Remove(string directory, IInstallationTaskStore store)
        {
            var exe = Path.Combine(Path.GetFullPath(directory), "NucSoftwareStudio.exe");
            var removed = 0;
            foreach (var entry in store.Enumerate())
            {
                if (!TryOwned(entry, out var task, out var exec, out var sid)) continue;
                if (!SamePath((string)exec.Element(AutoStartSettings.TaskNamespace + "Command"), exe)) continue;
                store.Delete(entry.Name);
                removed++;
            }
            return removed;
        }

        private static bool TryOwned(LogonTaskRegistration entry, out XElement task, out XElement exec, out string sid)
        {
            task = null; exec = null; sid = null;
            if (!entry.Name.StartsWith(AutoStartSettings.TaskPrefix, StringComparison.Ordinal)) return false;
            var ns = AutoStartSettings.TaskNamespace;
            task = XElement.Parse(entry.Xml);
            if (task.Name != ns + "Task" || (string)task.Element(ns + "RegistrationInfo")?.Element(ns + "Source") != AutoStartSettings.Source) return false;
            sid = (string)task.Element(ns + "Principals")?.Element(ns + "Principal")?.Element(ns + "UserId");
            if (string.IsNullOrWhiteSpace(sid) || entry.Name != AutoStartSettings.TaskPrefix + sid) return false;
            try { if (new SecurityIdentifier(sid).Value != sid) return false; } catch (ArgumentException) { return false; }
            var actions = task.Element(ns + "Actions");
            if (actions == null || new List<XElement>(actions.Elements()).Count != 1) return false;
            exec = actions.Element(ns + "Exec");
            var command = (string)exec?.Element(ns + "Command");
            return !string.IsNullOrWhiteSpace(command)
                && string.Equals(Path.GetFileName(command), "NucSoftwareStudio.exe", StringComparison.OrdinalIgnoreCase)
                && (string)exec.Element(ns + "Arguments") == "tray";
        }

        private static bool SamePath(string first, string second) => !string.IsNullOrWhiteSpace(first)
            && string.Equals(Path.GetFullPath(first), Path.GetFullPath(second), StringComparison.OrdinalIgnoreCase);

        internal static bool IsInstallDirectoryAllowed(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path)) return false;
            var suppliedRoot = Path.GetPathRoot(path);
            if (!suppliedRoot.EndsWith("\\", StringComparison.Ordinal) && !suppliedRoot.EndsWith("/", StringComparison.Ordinal)) return false;
            var full = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var root = Path.GetPathRoot(full).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (string.Equals(full, root, StringComparison.OrdinalIgnoreCase)) return false;
            if (!Directory.Exists(full)) return true;
            if (HasInstallationMarker(full)) return true;
            using (var files = Directory.EnumerateFileSystemEntries(full).GetEnumerator()) return !files.MoveNext();
        }

        internal static bool HasInstallationMarker(string directory)
        {
            var marker = Path.Combine(directory, MarkerFile);
            if (!File.Exists(marker)) return false;
            var section = false;
            foreach (var raw in File.ReadAllLines(marker))
            {
                var line = raw.Trim();
                if (line.StartsWith("[")) section = line.Equals("[Installation]", StringComparison.OrdinalIgnoreCase);
                if (section && line.Equals("ProductId=" + ProductId, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
    }
}
