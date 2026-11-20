import { useEffect, useState } from "react";
import { Package } from "lucide-react";

interface ItemThumbnailProps {
  src: string | null | undefined;
  alt: string;
  sizeClass?: string;
}

export function ItemThumbnail({
  src,
  alt,
  sizeClass = "w-9 h-9",
}: ItemThumbnailProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`${sizeClass} shrink-0 rounded-lg bg-[#0a0e14] border border-white/[0.08] flex items-center justify-center text-[#64748b]`}
        aria-hidden="true"
      >
        <Package className="w-4 h-4" />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} shrink-0 rounded-lg bg-[#0a0e14] border border-white/[0.08] flex items-center justify-center overflow-hidden p-1`}
    >
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-contain"
      />
    </div>
  );
}
