import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { normalizePresenterUrl } from "./presenter-details";

export const qrOptions = {
  errorCorrectionLevel: "M",
  margin: 2,
  color: { dark: "#231f20ff", light: "#ffffffff" },
} as const;

export function useLocalQr(url: string) {
  const [image, setImage] = useState<{ url: string; src: string } | null>(null);
  useEffect(() => {
    const safe = normalizePresenterUrl(url);
    if (!safe) return;
    let current = true;
    void QRCode.toString(safe, { type: "svg", ...qrOptions })
      .then((svg) => {
        if (current)
          setImage({
            url: safe,
            src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          });
      })
      .catch(() => {
        if (current) setImage(null);
      });
    return () => {
      current = false;
    };
  }, [url]);
  return image?.url === normalizePresenterUrl(url) ? image.src : null;
}
