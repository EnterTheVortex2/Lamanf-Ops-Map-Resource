import { useState } from "react";
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

  if (!src || failed) {
    return (
      <div
        className={`${sizeClass} shrink-0 rounded-md bg-[#090d13] border border-slate-800 flex items-center justify-center text-slate-500`}
        aria-hidden="true"
      >
        <Package className="w-4 h-4" />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} shrink-0 rounded-md bg-[#090d13] border border-slate-800 flex items-center justify-center overflow-hidden p-1`}
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
