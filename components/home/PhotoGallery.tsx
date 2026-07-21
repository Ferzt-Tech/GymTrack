"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { supabase, compressImage, getStorageUrl } from "@/lib/supabase";
import { todayISO, formatDate } from "@/lib/utils";
import { enqueue } from "@/lib/offlineQueue";
import { resolveUserId } from "@/lib/auth-utils";
import { useOnlineSync } from "@/lib/hooks/useOnlineSync";
import type { ProgressPhoto } from "@/types";
import { useT } from "@/lib/context/LanguageContext";

interface Props {
  photos:     ProgressPhoto[];
  onUploaded: (photo: ProgressPhoto) => void;
}

export default function PhotoGallery({ photos, onUploaded }: Props) {
  const [uploading,    setUploading]    = useState(false);
  const [uploadError,  setUploadError]  = useState<string | null>(null);
  const [lightbox,     setLightbox]     = useState<ProgressPhoto | null>(null);
  const [notes,        setNotes]        = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const { triggerSync } = useOnlineSync();

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);

    const userId = await resolveUserId();
    if (!userId) { setUploading(false); return; }

    try {
      const base64Data = await compressImage(file, 1024, 1024, 0.8);
      const fakeId = crypto.randomUUID();
      const photoData = {
        id:           fakeId,
        user_id:      userId,
        photo_date:   todayISO(),
        storage_path: base64Data,
        notes:        notes || null,
        created_at:   new Date().toISOString(),
      };

      try {
        const { error } = await supabase.from("progress_photos").insert(photoData);
        if (error) throw error;
      } catch (err) {
        // Online save failed — queue the photo so it syncs later instead of losing it
        console.error("Photo save failed, falling back to offline queue:", err);
        await enqueue({ type: "upsert", table: "progress_photos", payload: photoData });
        triggerSync();
      }

      onUploaded({ ...photoData, publicUrl: base64Data });
      setNotes("");
    } catch (err) {
      console.error(err);
      setUploadError(t.photoGallery.uploadFailed);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const sorted = [...photos].sort((a, b) => b.photo_date.localeCompare(a.photo_date));

  return (
    <div className="card-glass p-4">
      <p className="section-label">{t.photoGallery.progressPhotos}</p>

      <div className="space-y-2 mb-4">
        <input
          type="text"
          placeholder={t.photoGallery.notesOptional}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="input-base"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn-outline w-full"
        >
          {uploading ? t.photoGallery.uploading : t.photoGallery.uploadPhoto}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="hidden"
        />
        {uploadError && (
          <p className="text-[11px] text-red-400">{uploadError}</p>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-[var(--muted)] text-sm border border-dashed border-[var(--border)] rounded-xl">
          {t.photoGallery.noPhotosYet}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {sorted.map(photo => (
            <button
              key={photo.id}
              onClick={() => setLightbox(photo)}
              className="relative aspect-square rounded-lg overflow-hidden ring-1 ring-[var(--border)] hover:ring-[var(--muted)] transition-all"
            >
              <Image
                src={photo.publicUrl ?? getStorageUrl("progress-photos", photo.storage_path)}
                alt={t.photoGallery.progressAlt(photo.photo_date)}
                fill
                className="object-cover"
                sizes="120px"
              />
              <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-[#aaa] text-center py-1 leading-none">
                {formatDate(photo.photo_date)}
              </div>
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-5 right-5 text-[#555] hover:text-white transition-colors text-sm"
            onClick={() => setLightbox(null)}
          >
            {t.photoGallery.close}
          </button>
          <div className="relative w-full max-w-sm aspect-[3/4] rounded-2xl overflow-hidden">
            <Image
              src={lightbox.publicUrl ?? getStorageUrl("progress-photos", lightbox.storage_path)}
              alt={t.photoGallery.progressPhotoAlt}
              fill
              className="object-contain"
              sizes="384px"
            />
          </div>
          <p className="text-[#555] mt-4 text-[13px]">{formatDate(lightbox.photo_date)}</p>
          {lightbox.notes && (
            <p className="text-[#333] text-[12px] mt-1">{lightbox.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}
