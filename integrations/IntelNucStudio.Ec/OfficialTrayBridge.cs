using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using Forms = System.Windows.Forms;

namespace IntelNucStudio.Ec
{
    // Rebind only the official exit delegate. The original callback accesses
    // ApplicationData.Current before Shutdown and throws in an unpackaged process.
    internal sealed class OfficialTrayBridge : IDisposable
    {
        private readonly object _tray;
        private readonly Forms.NotifyIcon _icon;
        private readonly Func<Task> _exit;
        private readonly AutoStartMenu _autoStart;
        private readonly Dictionary<Forms.ToolStripItem, bool> _locked = new Dictionary<Forms.ToolStripItem, bool>();
        private readonly HashSet<Forms.ToolStripItem> _rebound = new HashSet<Forms.ToolStripItem>();
        private Forms.ContextMenuStrip _menu;
        private bool _ecActive;
        private bool _disposed;
        private static readonly PropertyInfo EventsProperty = typeof(Component).GetProperty("Events", BindingFlags.Instance | BindingFlags.NonPublic);
        private static readonly object ClickKey = typeof(Forms.ToolStripItem).GetField("EventClick", BindingFlags.Static | BindingFlags.NonPublic)?.GetValue(null);

        internal OfficialTrayBridge(object tray, Forms.NotifyIcon icon, Func<Task> exit, AutoStartMenu autoStart = null)
        {
            _tray = tray; _icon = icon; _exit = exit; _autoStart = autoStart;
            if (ClickKey == null || EventsProperty == null) throw new InvalidOperationException("无法识别托盘菜单事件结构。");
            _icon.MouseDown += OnMouseDown;
            Sync(false);
        }

        internal static OfficialTrayBridge TryAttach(Application app, Func<Task> exit)
        {
            try
            {
                var contract = app.GetType().Assembly.GetType("NucSoftwareStudio.Interfaces.ITrayApp");
                if (contract == null) return null;
                var container = app.GetType().GetProperty("Container")?.GetValue(app);
                if (container == null) return null;
                var provider = container.GetType().GetInterfaces().FirstOrDefault(type => type.FullName == "Prism.Ioc.IContainerProvider");
                var resolve = provider?.GetMethod("Resolve", new[] { typeof(Type) });
                if (resolve == null) return null;
                var tray = resolve.Invoke(container, new object[] { contract });
                var icon = tray?.GetType().GetField("_trayIcon", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(tray) as Forms.NotifyIcon;
                if (icon == null) return null;
                return new OfficialTrayBridge(tray, icon, exit, new AutoStartMenu(AutoStartSettings.ForCurrentApplication(),
                    error => MessageBox.Show(app.MainWindow, error.Message, "开机自启动", MessageBoxButton.OK, MessageBoxImage.Warning)));
            }
            catch (Exception error) { IntegrationDiagnostics.Write("Tray binding unavailable: " + error); return null; }
        }

        private void OnMouseDown(object sender, Forms.MouseEventArgs args) => Sync(_ecActive);
        private void OnMenuOpening(object sender, CancelEventArgs args)
        {
            Sync(_ecActive);
            _ = _autoStart?.RefreshAsync();
        }

        internal void Sync(bool ecActive)
        {
            if (_disposed) return;
            _ecActive = ecActive;
            if (!ReferenceEquals(_menu, _icon.ContextMenuStrip))
            {
                if (_menu != null) _menu.Opening -= OnMenuOpening;
                _menu = _icon.ContextMenuStrip;
                _rebound.Clear();
                if (_menu != null)
                {
                    _menu.Opening += OnMenuOpening;
                    _autoStart?.Attach(_menu);
                    _ = _autoStart?.RefreshAsync();
                }
            }
            if (!ecActive)
            {
                foreach (var item in _locked) if (!item.Key.IsDisposed) item.Key.Enabled = item.Value;
                _locked.Clear();
            }
            if (_menu == null) return;
            // Some original menu rebuilds reuse the same ContextMenuStrip.
            _autoStart?.Attach(_menu);
            var presets = _tray.GetType().GetField("_performancePresets", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_tray) as IDictionary;
            foreach (Forms.ToolStripItem item in _menu.Items)
            {
                var events = (EventHandlerList)EventsProperty.GetValue(item);
                var handlers = events[ClickKey] as EventHandler;
                if (handlers == null) continue;
                var invocationList = handlers.GetInvocationList();
                var originalExit = invocationList.OfType<EventHandler>().Where(handler =>
                    handler.Method.Name == "Exit_Click" && handler.Method.DeclaringType == _tray.GetType()).ToArray();
                if (originalExit.Length > 0 && _rebound.Add(item))
                {
                    foreach (var handler in originalExit) item.Click -= handler;
                    item.Click += OnExit;
                    IntegrationDiagnostics.Write("Official tray exit rebound to EC-safe shutdown.");
                }
                // Only the official performance-preset closures conflict with EC.
                // LED profile callbacks and the Open/Exit items stay available.
                if (ecActive && presets?.Contains(item.Text) == true && invocationList.Any(handler =>
                    handler.Method.Name.Contains("ReformatMenu") &&
                    handler.Method.DeclaringType?.FullName.StartsWith(_tray.GetType().FullName + "+", StringComparison.Ordinal) == true))
                {
                    if (!_locked.ContainsKey(item)) _locked.Add(item, item.Enabled);
                    item.Enabled = false;
                }
            }
        }

        private async void OnExit(object sender, EventArgs args)
        {
            try { await _exit(); }
            catch (Exception error) { IntegrationDiagnostics.Write("Tray safe exit failed: " + error); }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _icon.MouseDown -= OnMouseDown;
            if (_menu != null) _menu.Opening -= OnMenuOpening;
            _autoStart?.Dispose();
            _icon.Visible = false;
            _icon.Dispose();
            _locked.Clear();
            _rebound.Clear();
        }
    }
}
