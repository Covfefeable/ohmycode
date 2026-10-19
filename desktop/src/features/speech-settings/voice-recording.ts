export function wavRecording(frames: ArrayBuffer[], sampleRate: number): Blob {
  const length = frames.reduce((size, frame) => size + frame.byteLength, 0);
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, length, true);
  let offset = 44;
  for (const frame of frames) {
    new Uint8Array(buffer, offset, frame.byteLength).set(new Uint8Array(frame));
    offset += frame.byteLength;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function audioBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
