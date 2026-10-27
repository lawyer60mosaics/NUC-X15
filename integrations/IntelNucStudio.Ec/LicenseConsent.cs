using System;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Threading;

namespace IntelNucStudio.Ec
{
    // The unpackaged official app cannot persist ApplicationData.LocalSettings.
    // Preserve its dialog and command; record consent only after an actual click.
    internal static class LicenseConsent
    {
        internal const string Revision = "Intel-NSS-1A38CB964989CCD082D4438BF40AC34C3CE531E30BE15EF24FC86CC8F59F708A";

        internal static void Attach(Window window)
        {
            var model = window.DataContext;
            if (model?.GetType().FullName != "NucSoftwareStudio.ViewModels.MainWindowViewModel") return;
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "NUCtool", "StudioEC", "license-consent.txt");
            Attach(window, model, () => File.Exists(path) && File.ReadAllText(path) == Revision,
                () => { Directory.CreateDirectory(Path.GetDirectoryName(path)); File.WriteAllText(path, Revision); },
                error => MessageBox.Show(window, "无法保存许可确认，下次启动可能再次提示：" + error.Message,
                    "许可确认", MessageBoxButton.OK, MessageBoxImage.Warning));
        }

        internal static void Attach(Window window, object model, Func<bool> read, Action save, Action<Exception> report)
        {
            var visible = model.GetType().GetProperty("ShowEula", BindingFlags.Instance | BindingFlags.Public);
            var accept = model.GetType().GetProperty("AcceptEula", BindingFlags.Instance | BindingFlags.Public)?.GetValue(model) as ICommand;
            if (visible?.PropertyType != typeof(bool) || !visible.CanWrite || accept == null) return;
            try { if (read()) visible.SetValue(model, false); }
            catch (Exception error) { report(error); }
            var pending = false;
            window.AddHandler(ButtonBase.ClickEvent, new RoutedEventHandler((sender, args) =>
            {
                if (pending || !(args.OriginalSource is ButtonBase button) || !ReferenceEquals(button.Command, accept)
                    || !(bool)visible.GetValue(model) || !accept.CanExecute(button.CommandParameter)) return;
                pending = true;
                window.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
                {
                    try { if (!(bool)visible.GetValue(model)) save(); }
                    catch (Exception error) { report(error); }
                    finally { pending = false; }
                }));
            }), true);
        }
    }
}
