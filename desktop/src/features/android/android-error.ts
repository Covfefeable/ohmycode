export function androidErrorKey(error: unknown): string {
  const code = error instanceof Error ? error.message.match(/\bandroid_[a-z_]+\b/)?.[0] : undefined;
  return `android.errors.${code ?? "android_operation_failed"}`;
}
