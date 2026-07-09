"use client";

import { useState, useCallback, DragEvent } from "react";
import { Upload, FileWarning } from "lucide-react";

export default function FileUpload({
  onUpload,
  disabled,
}: {
  onUpload: (file: File) => Promise<void>;
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".stl")) {
        setError("Please upload a .stl file");
        return;
      }
      setError(null);
      setUploading(true);
      try {
        await onUpload(file);
      } catch (e: any) {
        setError(e.message || "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onUpload]
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    },
    [handleFile]
  );

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById("stl-input")?.click()}
        className={`
          border-2 border-dashed rounded-xl p-10 text-center cursor-pointer
          transition-all duration-200
          ${dragOver ? "border-violet-400 bg-violet-400/5" : "border-zinc-700 hover:border-zinc-500"}
          ${disabled ? "opacity-40 pointer-events-none" : ""}
        `}
      >
        <input
          id="stl-input"
          type="file"
          accept=".stl"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          disabled={disabled}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">Uploading & processing...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-10 h-10 text-zinc-500" />
            <p className="text-zinc-400 text-sm">
              Drag & drop an <span className="text-violet-400 font-medium">.stl</span> file here
            </p>
            <p className="text-zinc-600 text-xs">or click to browse</p>
          </div>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm px-2">
          <FileWarning className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  );
}
