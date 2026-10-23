export type AndroidVideoPacket = { configuration: boolean; keyframe: boolean; timestamp: number; data: Uint8Array };

/** scrcpy 3.3.4: dummy byte, H.264 codec/size, then length-prefixed packets. */
export class ScrcpyProtocol {
  private buffer = Buffer.alloc(0);
  private initialized = false;
  constructor(private readonly packet: (packet: AndroidVideoPacket) => void) {}
  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.initialized) {
      if (this.buffer.length < 13) return;
      if (this.buffer[0] !== 0 || this.buffer.readUInt32BE(1) !== 0x68323634) throw new Error("android_video_protocol");
      this.buffer = this.buffer.subarray(13);
      this.initialized = true;
    }
    while (this.buffer.length >= 12) {
      const size = this.buffer.readUInt32BE(8);
      if (size > 16 * 1024 * 1024) throw new Error("android_video_protocol");
      if (this.buffer.length < 12 + size) return;
      const pts = this.buffer.readBigUInt64BE(0);
      this.packet({ configuration: Boolean(pts & (1n << 63n)), keyframe: Boolean(pts & (1n << 62n)), timestamp: Number(pts & ((1n << 62n) - 1n)), data: Uint8Array.from(this.buffer.subarray(12, 12 + size)) });
      this.buffer = this.buffer.subarray(12 + size);
    }
  }
}
