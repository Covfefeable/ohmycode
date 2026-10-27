import { expectTypeOf, it } from "vitest";
import type { DesktopBridge } from "../../contracts/bridge";
import type { DesktopInvocations } from "../../contracts/invocations";
import type { handleInvoke } from "../../electron/ipc/handle-invoke";

it("IPC 通道、handler 和 Renderer 共用方法签名", () => {
  expectTypeOf<DesktopInvocations["android:act"]>().toEqualTypeOf<DesktopBridge["android"]["act"]>();
  type AndroidHandler = Parameters<typeof handleInvoke<"android:act">>[1];
  expectTypeOf<ReturnType<AndroidHandler>>().toEqualTypeOf<void | Promise<void>>();
  expectTypeOf<() => { ok: true }>().not.toExtend<AndroidHandler>();
  expectTypeOf<"android:unknown">().not.toExtend<keyof DesktopInvocations>();
  expectTypeOf<Awaited<ReturnType<DesktopInvocations["auth:bootstrap"]>>>().not.toBeAny();
});
