import { useContext, useEffect, useState } from "react";
import { ImagePreview } from "./ImagePreview";
import { ImageScopeContext } from "./image-scope";
import { imageReference } from "./image-reference";

export function MarkdownImage({ src, name }: { src: string; name: string }) {
  const scope = useContext(ImageScopeContext);
  const conversationId = scope && "conversationId" in scope ? scope.conversationId : undefined;
  const taskId = scope && "taskId" in scope ? scope.taskId : undefined;
  const [resolved, setResolved] = useState<{ reference: string; source?: string }>();
  useEffect(() => {
    let disposed = false;
    async function resolve() {
      try {
        const image = imageReference(src, window.location.href);
        const context = conversationId ? { conversationId } : taskId ? { taskId } : undefined;
        const source = image.local ? await window.ohmycode.previewImage(context, image.source) : image.source;
        if (!disposed) setResolved({ reference: src, source });
      } catch {
        if (!disposed) setResolved({ reference: src });
      }
    }
    void resolve();
    return () => { disposed = true; };
  }, [src, conversationId, taskId]);
  const current = resolved?.reference === src ? resolved : undefined;
  return <ImagePreview src={current?.source} name={name} loading={!current} />;
}
