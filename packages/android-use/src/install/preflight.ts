import { runCommand, type CommandRunner } from "../command.js";

/** Read-only checks; never elevate, enable Windows features, or change firmware settings. */
export async function checkVirtualization(platform: string = process.platform, run: CommandRunner = runCommand): Promise<void> {
  try {
    if (platform === "darwin") {
      const output = await run("/usr/sbin/sysctl", ["-n", "kern.hv_support"]);
      if (output.toString().trim() !== "1") throw new Error("unavailable");
    } else if (platform === "win32") {
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $c=Get-CimInstance Win32_ComputerSystem; $p=Get-CimInstance Win32_Processor | Select-Object -First 1; if ($c.HypervisorPresent -or ($p.VirtualizationFirmwareEnabled -and $p.SecondLevelAddressTranslationExtensions)) { exit 0 }; exit 2"]);
    } else throw new Error("unsupported");
  } catch (error) { throw new Error("android_install_virtualization", { cause: error }); }
}
