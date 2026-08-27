import { type PropsWithChildren, useMemo, useState } from "react";
import { AlertCircle, Bell, CheckCircle2, Info, X } from "lucide-react";
import { FeedbackContext, type FeedbackType, type NotificationInput, type ToastInput } from "./feedback-context";
import styles from "./FeedbackProvider.module.css";

type Item<T> = T & { id: string };
const Icon = ({ type }: { type: FeedbackType }) => type === "success" ? <CheckCircle2 /> : type === "error" ? <AlertCircle /> : <Info />;

export function FeedbackProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Item<ToastInput>[]>([]);
  const [notifications, setNotifications] = useState<Item<NotificationInput>[]>([]);
  const value = useMemo(() => ({
    toast(input: ToastInput) {
      if (!input.message.trim()) return;
      const id = crypto.randomUUID();
      setToasts((items) => [...items, { ...input, id }]);
      window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), input.duration ?? 3000);
    },
    notify(input: NotificationInput) { setNotifications((items) => [...items, { ...input, id: crypto.randomUUID() }]); },
  }), []);
  return <FeedbackContext.Provider value={value}>
    {children}
    <div className={styles.toasts} aria-live="polite">{toasts.map((item) => <div key={item.id} className={`${styles.toast} ${styles[item.type]}`}><Icon type={item.type} /><span>{item.message}</span></div>)}</div>
    <aside className={styles.notifications} aria-live="polite">{notifications.map((item) => <article key={item.id} className={styles.notification}><div className={styles.notificationIcon}><Bell /></div><div><strong>{item.title}</strong><p>{item.message}</p></div><button aria-label="Close" onClick={() => setNotifications((items) => items.filter((entry) => entry.id !== item.id))}><X /></button></article>)}</aside>
  </FeedbackContext.Provider>;
}
