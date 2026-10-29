import React, { useState, useRef } from 'react';
import { uploadFileToStorage, StorageUploadProgress } from '../../services/firestoreSync';
import { firebaseConfig, auth } from '../../lib/firebase';

interface FileUploadProps {
  label?: string;
  helperText?: string;
  storagePathPrefix: string; // e.g. "bus_photos" or "user_profiles"
  currentUrl?: string;
  onUploadSuccess: (downloadUrl: string) => void;
  maxSizeMb?: number;
  accept?: string;
  onRequireAuth?: () => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  label = 'Upload Vehicle Photo',
  helperText = 'PNG, JPG or WebP up to 10MB. Uploads directly to Firebase Storage bucket.',
  storagePathPrefix,
  currentUrl,
  onUploadSuccess,
  maxSizeMb = 10,
  accept = 'image/jpeg,image/png,image/webp',
  onRequireAuth,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string>(currentUrl || '');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileSelected = async (file: File) => {
    setErrorMessage(null);
    setSuccessInfo(null);

    // Validate type
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Only image files (JPEG, PNG, WebP) are supported.');
      return;
    }

    // Validate size
    if (file.size > maxSizeMb * 1024 * 1024) {
      setErrorMessage(`File size exceeds maximum limit of ${maxSizeMb}MB.`);
      return;
    }

    // Instant local preview
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);

    try {
      setIsUploading(true);
      setUploadProgress(10);

      const timestamp = Date.now();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const targetPath = `${storagePathPrefix}/${timestamp}_${sanitizedName}`;

      const downloadUrl = await uploadFileToStorage(
        file,
        targetPath,
        (progress: StorageUploadProgress) => {
          setUploadProgress(Math.max(10, progress.progressPercent));
        }
      );

      setPreviewUrl(downloadUrl);
      setIsUploading(false);
      setSuccessInfo('File uploaded and synced with Firebase Storage bucket.');
      onUploadSuccess(downloadUrl);
    } catch (err: any) {
      setIsUploading(false);
      console.error('File upload error:', err);

      if (err.code === 'storage/unauthorized') {
        setErrorMessage(
          'Firebase Storage (Production Mode) requires you to be signed in. Please sign in or create an account first.'
        );
      } else if (err.code === 'storage/quota-exceeded') {
        setErrorMessage('Firebase Storage quota limit reached. Please check Spark plan usage.');
      } else {
        setErrorMessage(
          err.message || 'Firebase Storage upload failed. Please verify storage permissions.'
        );
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleClear = () => {
    setPreviewUrl('');
    setUploadProgress(0);
    setErrorMessage(null);
    setSuccessInfo(null);
    onUploadSuccess('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isSignedIn = !!auth.currentUser;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-slate-700">
          {label}
        </label>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>{firebaseConfig.storageBucket || 'Firebase Storage'}</span>
        </div>
      </div>

      {!isSignedIn && (
        <div className="p-2 rounded-lg bg-amber-50/70 border border-amber-200 text-[11px] text-amber-900 flex items-center justify-between">
          <span>Production Storage bucket requires authentication before upload.</span>
          {onRequireAuth && (
            <button
              type="button"
              onClick={onRequireAuth}
              className="font-bold underline text-amber-800 hover:text-amber-950 ml-2"
            >
              Sign In
            </button>
          )}
        </div>
      )}

      {previewUrl ? (
        <div className="relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50 p-2.5">
          <div className="flex items-center gap-3">
            <div className="w-20 h-16 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
              <img
                src={previewUrl}
                alt="Uploaded Asset"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {isUploading ? 'Uploading to Firebase Storage...' : 'Firebase Storage Asset Ready'}
              </div>
              <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                {previewUrl.startsWith('http') ? previewUrl : 'Staged Asset'}
              </div>

              {isUploading ? (
                <div className="mt-2 w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-amber-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium mt-1">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Uploaded to Firebase Storage</span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1 shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition shadow-2xs"
              >
                Change
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={isUploading}
                className="px-2.5 py-1 text-[11px] font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-md transition"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition ${
            isDragging
              ? 'border-amber-500 bg-amber-50/50'
              : 'border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50'
          }`}
        >
          <div className="flex flex-col items-center justify-center gap-1.5">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.75}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div className="text-xs font-semibold text-slate-800">
              Click to select photo or drag & drop here
            </div>
            <p className="text-[11px] text-slate-500 max-w-sm">
              {helperText}
            </p>
          </div>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleFileSelected(e.target.files[0]);
          }
        }}
        className="hidden"
      />

      {errorMessage && (
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-bold hover:text-rose-900 ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {successInfo && (
        <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center justify-between">
          <span>{successInfo}</span>
          <button
            type="button"
            onClick={() => setSuccessInfo(null)}
            className="text-xs font-bold hover:text-emerald-900 ml-2"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
