import { useState } from "react";
import { PhotoSlider } from "react-photo-view";
import { LoaderCircle, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../icon-button";
import { Tooltip } from "../tooltip";
import "react-photo-view/dist/react-photo-view.css";
import styles from "./ImagePreview.module.css";

export function ImagePreview({ src, name, loading = false }: { src?: string; name: string; loading?: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [failedSource, setFailedSource] = useState<string>();
  if (loading) return <span className={styles.status} role="status"><LoaderCircle className={styles.spinner} />{t("agent.loadingImage")}</span>;
  if (!src || failedSource === src) return <span className={styles.status} role="status">{t("agent.imagePreviewFailed")}</span>;
  return <>
    <button className={styles.thumbnail} type="button" aria-label={t("agent.enlargeImage", { name })} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setExpanded(true); }}>
      <img src={src} alt={name} loading="lazy" onError={() => setFailedSource(src)} />
    </button>
    <PhotoSlider
      images={[{ src, key: src }]}
      visible={expanded}
      onClose={() => setExpanded(false)}
      bannerVisible={false}
      className={styles.lightbox}
      brokenElement={<span className={styles.status}>{t("agent.imagePreviewFailed")}</span>}
      overlayRender={({ scale, onScale, rotate, onRotate, onClose }) => <div className={styles.controls} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
        <Tooltip content={t("agent.zoomIn")}><IconButton aria-label={t("agent.zoomIn")} onClick={() => onScale(scale + 1)}><ZoomIn /></IconButton></Tooltip>
        <Tooltip content={t("agent.zoomOut")}><IconButton aria-label={t("agent.zoomOut")} disabled={scale <= 1} onClick={() => onScale(Math.max(1, scale - 1))}><ZoomOut /></IconButton></Tooltip>
        <Tooltip content={t("agent.rotateImage")}><IconButton aria-label={t("agent.rotateImage")} onClick={() => onRotate(rotate + 90)}><RotateCw /></IconButton></Tooltip>
        <Tooltip content={t("agent.resetImage")}><IconButton aria-label={t("agent.resetImage")} onClick={() => { onScale(1); onRotate(0); }}><RotateCcw /></IconButton></Tooltip>
        <Tooltip content={t("common.close")}><IconButton aria-label={t("common.close")} onClick={() => onClose()}><X /></IconButton></Tooltip>
      </div>}
    />
  </>;
}
