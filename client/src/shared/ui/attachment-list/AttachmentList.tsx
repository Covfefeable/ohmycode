import { File, X } from "lucide-react";
import { Tooltip } from "../tooltip";
import styles from "./AttachmentList.module.css";

type AttachmentListProps = {
  attachments: MessageAttachment[];
  removeLabel?: string;
  onRemove?(id: string): void;
};

function fileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function AttachmentList({ attachments, removeLabel, onRemove }: AttachmentListProps) {
  if (!attachments.length) return null;
  return <div className={styles.list}>
    {attachments.map((attachment) => <div className={styles.attachment} key={attachment.id} title={attachment.path}>
      <span className={styles.icon}><File /></span>
      <span className={styles.details}>
        <span className={styles.name}>{attachment.name}</span>
        <span className={styles.size}>{fileSize(attachment.size)}</span>
      </span>
      {onRemove && <Tooltip content={removeLabel ?? "Remove"}><button type="button" aria-label={removeLabel ?? "Remove"} onClick={() => onRemove(attachment.id)}><X /></button></Tooltip>}
    </div>)}
  </div>;
}
