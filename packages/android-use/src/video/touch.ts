import type { AndroidTouch } from "../types.js";

/** scrcpy 3.3.4 INJECT_TOUCH_EVENT, using its generic finger pointer. */
export function encodeTouch(touch: AndroidTouch): Buffer {
  const actions = { down: 0, up: 1, move: 2 };
  if (!touch || !Object.hasOwn(actions, touch.action) ||
    ![touch.x, touch.y, touch.width, touch.height].every(Number.isInteger) ||
    touch.width < 1 || touch.height < 1 || touch.width > 65535 || touch.height > 65535 ||
    touch.x < 0 || touch.y < 0 || touch.x >= touch.width || touch.y >= touch.height) throw new Error("android_invalid_touch");
  const packet = Buffer.alloc(32);
  packet[0] = 2;
  packet[1] = actions[touch.action];
  packet.writeBigInt64BE(-2n, 2);
  packet.writeUInt32BE(touch.x, 10); packet.writeUInt32BE(touch.y, 14);
  packet.writeUInt16BE(touch.width, 18); packet.writeUInt16BE(touch.height, 20);
  packet.writeUInt16BE(touch.action === "up" ? 0 : 65535, 22);
  return packet;
}
