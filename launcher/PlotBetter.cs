using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class PlotBetterLauncher
{
    private const string ShortcutName = "PlotBetter.lnk";

    [STAThread]
    private static int Main(string[] args)
    {
        bool quiet = HasArg(args, "--quiet");

        if (HasArg(args, "--install-shortcut") || HasArg(args, "--create-shortcut") || HasArg(args, "-s"))
        {
            return CreateShortcuts(quiet);
        }

        if (HasArg(args, "--remove-shortcut") || HasArg(args, "--delete-shortcut"))
        {
            return RemoveShortcuts(quiet);
        }

        if (HasArg(args, "--help") || HasArg(args, "-h"))
        {
            MessageBox.Show(
                "PlotBetter.exe\r\n\r\n"
                    + "No arguments: launch PlotBetter.\r\n"
                    + "--install-shortcut: create desktop and Start Menu shortcuts.\r\n"
                    + "--remove-shortcut: remove those shortcuts.",
                "PlotBetter Launcher",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return 0;
        }

        return Launch(args);
    }

    private static bool HasArg(string[] args, string name)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    private static int Launch(string[] args)
    {
        string root = GetRoot();
        string electron = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");

        if (!File.Exists(electron))
        {
            DialogResult answer = MessageBox.Show(
                "PlotBetter 的依赖还没有安装。是否现在自动安装（需要网络）？",
                "PlotBetter",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question,
                MessageBoxDefaultButton.Button1);
            if (answer != DialogResult.Yes)
            {
                return 1;
            }

            if (!InstallDependencies(root))
            {
                MessageBox.Show(
                    "安装失败。请安装 Node.js 后运行 run.bat 完成首次安装，然后再使用 PlotBetter.exe。",
                    "PlotBetter",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 2;
            }
        }

        if (!File.Exists(electron))
        {
            MessageBox.Show(
                "找不到 Electron。请安装 Node.js 并先运行一次 run.bat。",
                "PlotBetter",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 3;
        }

        try
        {
            string arguments = QuotePath(root.TrimEnd('\\', '/'));
            string startup = Array.Find(args, delegate (string arg)
            {
                return string.Equals(arg, "--startup", StringComparison.OrdinalIgnoreCase);
            });
            if (startup != null)
            {
                arguments += " --startup";
            }

            ProcessStartInfo info = new ProcessStartInfo
            {
                FileName = electron,
                Arguments = arguments,
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            Process.Start(info);
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "PlotBetter 启动失败：" + ex.Message,
                "PlotBetter",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 4;
        }
    }

    private static bool InstallDependencies(string root)
    {
        try
        {
            ProcessStartInfo info = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "cmd.exe"),
                Arguments = "/d /c npm install",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using (Process process = Process.Start(info))
            {
                if (process != null)
                {
                    process.WaitForExit();
                    return process.ExitCode == 0;
                }
            }
            return false;
        }
        catch
        {
            return false;
        }
    }

    private static int CreateShortcuts(bool quiet)
    {
        int created = 0;
        created += CreateShortcut(Path.Combine(GetDesktopFolder(), ShortcutName));
        created += CreateShortcut(Path.Combine(GetStartMenuFolder(), ShortcutName));
        if (!quiet)
        {
            MessageBox.Show(
                created > 0
                    ? "已创建 " + created + " 个 PlotBetter 快捷方式。"
                    : "快捷方式已存在或创建失败。",
                "PlotBetter",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        return 0;
    }

    private static int RemoveShortcuts(bool quiet)
    {
        int removed = 0;
        removed += DeleteShortcut(Path.Combine(GetDesktopFolder(), ShortcutName)) ? 1 : 0;
        removed += DeleteShortcut(Path.Combine(GetStartMenuFolder(), ShortcutName)) ? 1 : 0;
        if (!quiet)
        {
            MessageBox.Show(
                removed > 0
                    ? "已删除 " + removed + " 个 PlotBetter 快捷方式。"
                    : "没有找到可删除的快捷方式。",
                "PlotBetter",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        return 0;
    }

    private static int CreateShortcut(string shortcutPath)
    {
        try
        {
            object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            object shortcut = Invoke(shell, "CreateShortcut", new object[] { shortcutPath });
            SetProperty(shortcut, "TargetPath", Application.ExecutablePath);
            SetProperty(shortcut, "WorkingDirectory", GetRoot());
            SetProperty(shortcut, "Description", "Launch PlotBetter");
            SetProperty(shortcut, "IconLocation", Application.ExecutablePath + ",0");
            Invoke(shortcut, "Save", null);
            return 1;
        }
        catch
        {
            return 0;
        }
    }

    private static bool DeleteShortcut(string shortcutPath)
    {
        try
        {
            if (File.Exists(shortcutPath))
            {
                File.Delete(shortcutPath);
                return true;
            }
            return false;
        }
        catch
        {
            return false;
        }
    }

    private static string GetRoot()
    {
        string exeDirectory = Path.GetDirectoryName(Application.ExecutablePath);
        if (string.IsNullOrEmpty(exeDirectory))
        {
            return Directory.GetCurrentDirectory();
        }
        return exeDirectory;
    }

    private static string GetDesktopFolder()
    {
        return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
    }

    private static string GetStartMenuFolder()
    {
        return Environment.GetFolderPath(Environment.SpecialFolder.Programs);
    }

    private static string QuotePath(string path)
    {
        return "\"" + path + "\"";
    }

    private static object Invoke(object target, string methodName, object[] args)
    {
        return target.GetType().InvokeMember(
            methodName,
            BindingFlags.InvokeMethod,
            null,
            target,
            args ?? new object[0]);
    }

    private static void SetProperty(object target, string propertyName, object value)
    {
        target.GetType().InvokeMember(
            propertyName,
            BindingFlags.SetProperty,
            null,
            target,
            new object[] { value });
    }
}
