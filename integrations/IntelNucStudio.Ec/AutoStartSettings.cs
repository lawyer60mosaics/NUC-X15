using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Xml.Linq;

namespace IntelNucStudio.Ec
{
    internal sealed class AutoStartStatus
    {
        public bool Enabled { get; }
        public string Description { get; }
        public AutoStartStatus(bool enabled, string description) { Enabled = enabled; Description = description; }
    }

    internal interface IAutoStartSettings
    {
        Task<AutoStartStatus> ReadAsync();
        Task SetEnabledAsync(bool enabled);
    }

    internal interface ILogonTaskStore
    {
        string Read(string name);
        void Register(string name, string xml);
        void Delete(string name);
    }

    internal sealed class AutoStartSettings : IAutoStartSettings
    {
        internal const string Source = "NUCtool.IntelNucStudio.Ec.AutoStart";
        internal static readonly XNamespace TaskNamespace = "http://schemas.microsoft.com/windows/2004/02/mit/task";
        private readonly string _exe;
        private readonly string _sid;
        private readonly ILogonTaskStore _store;
        private readonly Func<bool> _isAdministrator;
        internal string TaskName => "NUCtool.IntelNucStudio.EC." + _sid;

        internal AutoStartSettings(string exe, string sid, ILogonTaskStore store, Func<bool> isAdministrator)
        {
            _exe = Path.GetFullPath(exe);
            _sid = sid;
            _store = store;
            _isAdministrator = isAdministrator;
        }

        internal static AutoStartSettings ForCurrentApplication() => new AutoStartSettings(
            Process.GetCurrentProcess().MainModule.FileName, WindowsIdentity.GetCurrent().User.Value,
            new WindowsLogonTaskStore(), () => new WindowsPrincipal(WindowsIdentity.GetCurrent())
                .IsInRole(WindowsBuiltInRole.Administrator));

        public Task<AutoStartStatus> ReadAsync() => Task.Run(() => Read());

        private AutoStartStatus Read()
        {
            var xml = _store.Read(TaskName);
            if (xml == null) return new AutoStartStatus(false, "未开启。开启后，登录 Windows 时自动运行到托盘，不会自动接管 EC 风扇。");
            var task = VerifyOwnership(xml);
            var ns = TaskNamespace;
            var exec = task.Element(ns + "Actions")?.Element(ns + "Exec");
            var enabled = !string.Equals((string)task.Element(ns + "Settings")?.Element(ns + "Enabled"), "false", StringComparison.OrdinalIgnoreCase);
            var current = string.Equals((string)exec?.Element(ns + "Command"), _exe, StringComparison.OrdinalIgnoreCase)
                && (string)exec?.Element(ns + "Arguments") == "tray"
                && (string)task.Element(ns + "Principals")?.Element(ns + "Principal")?.Element(ns + "RunLevel") == "HighestAvailable"
                && (string)task.Element(ns + "Triggers")?.Element(ns + "LogonTrigger")?.Element(ns + "UserId") == _sid
                && !string.Equals((string)task.Element(ns + "Triggers")?.Element(ns + "LogonTrigger")?.Element(ns + "Enabled"), "false", StringComparison.OrdinalIgnoreCase);
            return new AutoStartStatus(enabled && current,
                enabled && !current ? "自启动配置与当前版本不一致。点击可更新为当前程序。"
                : enabled ? "已开启：登录 Windows 后以管理员权限运行到托盘；EC 风扇需手动开启。"
                : "自启动任务已停用。点击可为当前程序重新开启。");
        }

        public Task SetEnabledAsync(bool enabled) => Task.Run(() =>
        {
            // Never replace/delete an unrelated task even if its name collides.
            var previous = _store.Read(TaskName);
            if (previous != null) VerifyOwnership(previous);
            if (!enabled && previous == null) return;
            if (!_isAdministrator()) throw new InvalidOperationException("请先以管理员身份运行 NucSoftwareStudio.exe，再更改开机自启动。");
            if (enabled)
            {
                if (!File.Exists(_exe)) throw new FileNotFoundException("程序文件不存在，请解压完整程序后重试。", _exe);
                _store.Register(TaskName, BuildDefinition(_exe, _sid));
            }
            else _store.Delete(TaskName);
        });

        private XElement VerifyOwnership(string xml)
        {
            var task = XElement.Parse(xml);
            var ns = TaskNamespace;
            if (task.Name != ns + "Task" || (string)task.Element(ns + "RegistrationInfo")?.Element(ns + "Source") != Source
                || (string)task.Element(ns + "Principals")?.Element(ns + "Principal")?.Element(ns + "UserId") != _sid)
                throw new InvalidOperationException("同名自启动任务不属于本程序，未作更改。请在任务计划程序中检查。");
            return task;
        }

        internal static string BuildDefinition(string exe, string sid)
        {
            var ns = TaskNamespace;
            return new XElement(ns + "Task", new XAttribute("version", "1.2"),
                new XElement(ns + "RegistrationInfo", new XElement(ns + "Description", "Intel NUC Software Studio · EC 扩展，当前用户登录后启动到托盘"), new XElement(ns + "Source", Source)),
                new XElement(ns + "Triggers", new XElement(ns + "LogonTrigger", new XElement(ns + "Enabled", true), new XElement(ns + "UserId", sid), new XElement(ns + "Delay", "PT15S"))),
                new XElement(ns + "Principals", new XElement(ns + "Principal", new XAttribute("id", "CurrentUser"),
                    new XElement(ns + "UserId", sid), new XElement(ns + "LogonType", "InteractiveToken"), new XElement(ns + "RunLevel", "HighestAvailable"))),
                new XElement(ns + "Settings", new XElement(ns + "MultipleInstancesPolicy", "IgnoreNew"),
                    new XElement(ns + "DisallowStartIfOnBatteries", false), new XElement(ns + "StopIfGoingOnBatteries", false),
                    new XElement(ns + "StartWhenAvailable", true), new XElement(ns + "Enabled", true),
                    new XElement(ns + "ExecutionTimeLimit", "PT0S")),
                new XElement(ns + "Actions", new XAttribute("Context", "CurrentUser"), new XElement(ns + "Exec",
                    new XElement(ns + "Command", Path.GetFullPath(exe)), new XElement(ns + "Arguments", "tray"),
                    new XElement(ns + "WorkingDirectory", Path.GetDirectoryName(Path.GetFullPath(exe)))))).ToString();
        }
    }

    // COM is used only to query an exact task with an unambiguous not-found HRESULT.
    // Mutations use Windows' installed schtasks.exe, with no shell or password.
    internal sealed class WindowsLogonTaskStore : ILogonTaskStore
    {
        public string Read(string name)
        {
            object service = null, folder = null, task = null;
            try
            {
                service = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service", true));
                ((dynamic)service).Connect();
                folder = ((dynamic)service).GetFolder("\\");
                try { task = ((dynamic)folder).GetTask(name); }
                catch (Exception error) when (error.HResult == unchecked((int)0x80070002)) { return null; }
                return (string)((dynamic)task).Xml;
            }
            finally { Release(task); Release(folder); Release(service); }
        }

        public void Register(string name, string xml)
        {
            var path = Path.GetTempFileName();
            try
            {
                File.WriteAllText(path, xml, System.Text.Encoding.Unicode);
                RunSchtasks("/Create /TN " + Quote(name) + " /XML " + Quote(path) + " /F");
            }
            finally { File.Delete(path); }
        }

        public void Delete(string name) => RunSchtasks("/Delete /TN " + Quote(name) + " /F");

        private static string Quote(string value) => "\"" + value + "\"";
        private static void RunSchtasks(string arguments)
        {
            using (var process = Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "schtasks.exe"),
                Arguments = arguments, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true, RedirectStandardError = true
            }))
            {
                var stdout = process.StandardOutput.ReadToEndAsync();
                var stderr = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(15000))
                {
                    process.Kill();
                    throw new TimeoutException("更改自启动超时，请在任务计划程序中检查后重试。");
                }
                Task.WaitAll(stdout, stderr);
                if (process.ExitCode != 0) throw new InvalidOperationException("更改自启动失败：" + (stderr.Result + " " + stdout.Result).Trim());
            }
        }

        private static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); }
    }
}
