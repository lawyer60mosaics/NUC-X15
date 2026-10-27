using System;
using System.IO;
using System.Reflection;
using System.Collections.Generic;
using System.Resources;
using System.Windows;
using System.Windows.Markup;

namespace IntelNucStudio.Ec.Tests
{
    // Loads resource dictionaries only; never constructs the vendor App, view
    // models, services or hardware controllers.
    internal sealed class OfficialThemeFixture : IDisposable
    {
        private readonly ResolveEventHandler _resolver;
        private readonly string _directory;
        internal OfficialThemeFixture(string directory)
        {
            _directory = directory;
            _resolver = (sender, args) =>
            {
                var candidate = Path.Combine(directory, new AssemblyName(args.Name).Name + ".dll");
                return File.Exists(candidate) ? Assembly.LoadFrom(candidate) : null;
            };
            AppDomain.CurrentDomain.AssemblyResolve += _resolver;
            Assembly.LoadFrom(Path.Combine(directory, "Infrastructure.dll"));
        }

        internal ResourceDictionary Load(string name) => (ResourceDictionary)Application.LoadComponent(
            new Uri("/Infrastructure;component/Styles/" + name + ".xaml", UriKind.Relative));

        internal void LoadControls(Application application)
        {
            foreach (var name in new[] { "Colors", "Brushes", "General", "Icons", "ScrollBarStyles", "TextStyles", "ButtonStyles", "ToggleButtonStyles", "CheckBoxStyles", "SliderStyles", "ComboBoxStyles", "CardGridStyles", "RadioButtonStyles", "TextBoxStyles", "TabControlStyles" })
                application.Resources.MergedDictionaries.Add(Load(name));
        }

        internal FrameworkElement[] LoadHomeCards(Application application)
        {
            // Disable Prism's view-model factory in this isolated test process.
            // Original view constructors below only call InitializeComponent and
            // assign their supplied (null) model; no vendor service is created.
            var prism = Assembly.LoadFrom(Path.Combine(_directory, "Prism.Wpf.dll"));
            var provider = prism.GetType("Prism.Mvvm.ViewModelLocationProvider")
                ?? Assembly.LoadFrom(Path.Combine(_directory, "Prism.dll")).GetType("Prism.Mvvm.ViewModelLocationProvider", true);
            provider.GetMethod("SetDefaultViewModelFactory", new[] { typeof(Func<Type, object>) })
                .Invoke(null, new object[] { new Func<Type, object>(type => null) });
            var assemblies = new List<Assembly> { Assembly.LoadFrom(Path.Combine(_directory, "Infrastructure.dll")) };
            foreach (var name in new[] { "SystemMonitorMgr", "FeatureMgr", "MobileKeyboardSettingsMgr", "MobileBatterySettingsMgr", "MobilePerformanceMgr", "MobileDisplayModeMgr", "MobileKeyboardLedMgr", "MobileLightBarLedMgr" })
                assemblies.Add(Assembly.LoadFrom(Path.Combine(_directory, name + ".dll")));
            foreach (var assembly in assemblies)
            {
                var names = new List<string>();
                var stream = assembly.GetManifestResourceStream(assembly.GetName().Name + ".g.resources");
                if (stream == null) continue;
                using (stream)
                using (var reader = new ResourceReader(stream))
                {
                    var iterator = reader.GetEnumerator();
                    while (iterator.MoveNext()) names.Add((string)iterator.Key);
                }
                foreach (var group in new[] { "styles/", "en-us.baml", "/zh-cn/" })
                    foreach (var name in names)
                        if (name.EndsWith(".baml") && (group == "styles/" ? name.StartsWith(group) : name.Contains(group)))
                            application.Resources.MergedDictionaries.Add((ResourceDictionary)Application.LoadComponent(new Uri(
                                "/" + assembly.GetName().Name + ";component/" + name.Substring(0, name.Length - 5) + ".xaml", UriKind.Relative)));
            }
            var result = new List<FrameworkElement>();
            foreach (var name in new[] { "MobileKeyboardSettingsMgr.Views.MobileSystemSettingsView", "MobilePerformanceMgr.Views.MobilePerformanceSummaryView",
                "MobileDisplayModeMgr.Views.MobileDisplayModeSummaryView", "MobileKeyboardLedMgr.Views.KeyboardSummaryView", "MobileLightBarLedMgr.Views.LightbarSummaryView" })
            {
                var type = assemblies.Find(assembly => assembly.GetType(name) != null).GetType(name);
                var constructor = type.GetConstructors()[0];
                result.Add((FrameworkElement)constructor.Invoke(new object[constructor.GetParameters().Length]));
            }
            return result.ToArray();
        }

        internal FrameworkElement LoadProfilesView() => (FrameworkElement)Activator.CreateInstance(
            Assembly.LoadFrom(Path.Combine(_directory, "FeatureMgr.dll")).GetType("FeatureMgr.Views.ProfilesView", true));

        internal void Inspect(Application app, string output)
        {
            Directory.CreateDirectory(output);
            foreach (var name in new[] { "Colors", "Brushes", "General", "Icons", "ScrollBarStyles", "TextStyles", "ButtonStyles", "ToggleButtonStyles", "CheckBoxStyles", "SliderStyles", "ComboBoxStyles", "CardGridStyles", "RadioButtonStyles", "TextBoxStyles", "TabControlStyles" })
            {
                try
                {
                    var dictionary = Load(name);
                    app.Resources.MergedDictionaries.Add(dictionary);
                    foreach (var key in dictionary.Keys)
                    {
                        Console.WriteLine(name + ": " + key + " = " + dictionary[key]?.GetType().FullName);
                        if (dictionary[key] is Style style)
                        {
                            foreach (var setter in style.Setters)
                                if (setter is Setter value) Console.WriteLine("  " + value.Property + "=" + value.Value);
                            try { File.WriteAllText(Path.Combine(output, name + "-" + key + ".xaml"), XamlWriter.Save(style)); } catch { }
                        }
                    }
                    try { File.WriteAllText(Path.Combine(output, name + ".xaml"), XamlWriter.Save(dictionary)); } catch { }
                }
                catch (Exception error) { Console.WriteLine(name + " ERROR: " + error.Message); }
            }
        }

        public void Dispose() { AppDomain.CurrentDomain.AssemblyResolve -= _resolver; }
    }
}
