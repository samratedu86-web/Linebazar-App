import React, { useState } from 'react';
import {
  UserProfile,
  UserRole,
  DESIGNATED_ADMIN_UID,
  DESIGNATED_ADMIN_RAW_PHONE,
  DESIGNATED_ADMIN_EMAIL,
} from '../../types';
import { FileUpload } from './FileUpload';
import { auth, firebaseConfig } from '../../lib/firebase';
import { updateProfile } from 'firebase/auth';
import { store } from '../../services/store';
import { firestoreSync } from '../../services/firestoreSync';

interface HeaderProps {
  currentUser: UserProfile | null;
  activeTab: 'passenger' | 'crew' | 'admin' | 'subscription' | 'live-map';
  setActiveTab: (tab: 'passenger' | 'crew' | 'admin' | 'subscription' | 'live-map') => void;
  onOpenAuthModal: () => void;
  onSignOut: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  activeTab,
  setActiveTab,
  onOpenAuthModal,
  onSignOut,
}) => {
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string>(currentUser?.photoURL || '');
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);

  const handleAvatarUploaded = async (downloadUrl: string) => {
    setProfilePhotoUrl(downloadUrl);
    if (!currentUser) return;

    try {
      setIsUpdatingAvatar(true);
      // Update Firebase Auth user if authenticated
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { photoURL: downloadUrl }).catch(() => {});
      }

      // Update store and sync to Firestore
      const updatedUser: UserProfile = {
        ...currentUser,
        photoURL: downloadUrl,
      };
      store.setUser(updatedUser);
      await firestoreSync.syncUserProfile(updatedUser).catch(() => {});
      setIsUpdatingAvatar(false);
    } catch (e) {
      setIsUpdatingAvatar(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark */}
        <button
          onClick={() => setActiveTab('passenger')}
          className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2 text-left whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity"
        >
          <span className="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 font-black flex items-center justify-center text-sm shadow-sm">
            LB
          </span>
          <span>Linebazar</span>
        </button>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <button
            onClick={() => setActiveTab('passenger')}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'passenger'
                ? 'text-slate-950 font-semibold'
                : 'hover:text-slate-950'
            }`}
          >
            Passenger
          </button>

          <button
            onClick={() => setActiveTab('crew')}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'crew'
                ? 'text-slate-950 font-semibold'
                : 'hover:text-slate-950'
            }`}
          >
            Drivers/Conductor
          </button>

          {/* Admin Panel Link: Only visible to authorized administrator */}
          {Boolean(
            currentUser && (
              currentUser.uid === DESIGNATED_ADMIN_UID ||
              currentUser.email?.toLowerCase() === DESIGNATED_ADMIN_EMAIL ||
              currentUser.phone?.replace(/\D/g, '').slice(-10) === DESIGNATED_ADMIN_RAW_PHONE ||
              currentUser.roles?.includes('admin')
            )
          ) && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'admin'
                  ? 'text-slate-950 font-bold'
                  : 'hover:text-slate-950 text-slate-700'
              }`}
            >
              <span className="text-amber-500">👑</span>
              <span>Admin Panel</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('subscription')}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'subscription'
                ? 'text-slate-950 font-semibold'
                : 'hover:text-slate-950'
            }`}
          >
            Subscriptions
          </button>
        </nav>

        {/* Zone 3: Primary Action / User Account */}
        <div className="flex items-center gap-2.5 shrink-0">


          {currentUser ? (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(true)}
                title="Manage Account & Cloud Storage Avatar"
                className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-100 transition group text-left"
              >
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt={currentUser.displayName}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full border border-amber-300 object-cover group-hover:ring-2 group-hover:ring-amber-400"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-amber-100 border border-amber-200 text-amber-900 font-bold text-xs flex items-center justify-center group-hover:ring-2 group-hover:ring-amber-400">
                    {currentUser.displayName ? currentUser.displayName[0].toUpperCase() : 'U'}
                  </div>
                )}
                <div className="hidden sm:block">
                  <div className="text-xs font-semibold text-slate-900 truncate max-w-[130px]">
                    {currentUser.displayName}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                    {currentUser.currentRole.toUpperCase()}
                  </div>
                </div>
              </button>

              {(currentUser.uid === DESIGNATED_ADMIN_UID ||
                currentUser.email?.toLowerCase() === DESIGNATED_ADMIN_EMAIL ||
                currentUser.phone?.replace(/\D/g, '').slice(-10) === DESIGNATED_ADMIN_RAW_PHONE ||
                currentUser.roles?.includes('admin')) && (
                <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 text-amber-300 text-[11px] font-bold tracking-wide shadow-xs border border-amber-400/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>👑 Verified Admin</span>
                </div>
              )}

              <button
                onClick={onSignOut}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuthModal}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg shadow-sm transition-colors whitespace-nowrap shrink-0"
            >
              Sign In / Sign Up
            </button>
          )}
        </div>
      </div>

      {/* Mobile Secondary Navigation Row (Below 768px) */}
      <div className="md:hidden flex items-center justify-around border-t border-slate-100 px-2 py-2 bg-slate-50/80 text-xs font-medium text-slate-600">
        <button
          onClick={() => setActiveTab('passenger')}
          className={`py-1 px-2.5 rounded transition ${
            activeTab === 'passenger' ? 'bg-white text-slate-950 font-semibold shadow-xs' : ''
          }`}
        >
          Passenger
        </button>
        <button
          onClick={() => setActiveTab('crew')}
          className={`py-1 px-2.5 rounded transition ${
            activeTab === 'crew' ? 'bg-white text-slate-950 font-semibold shadow-xs' : ''
          }`}
        >
          Drivers/Conductor
        </button>
        <button
          onClick={() => setActiveTab('admin')}
          className={`py-1 px-2.5 rounded transition ${
            activeTab === 'admin' ? 'bg-white text-slate-950 font-semibold shadow-xs' : ''
          }`}
        >
          Admin
        </button>
        <button
          onClick={() => setActiveTab('subscription')}
          className={`py-1 px-2.5 rounded transition ${
            activeTab === 'subscription' ? 'bg-white text-slate-950 font-semibold shadow-xs' : ''
          }`}
        >
          Plans
        </button>
      </div>

      {/* User Profile & Firebase Storage Upload Modal */}
      {isProfileModalOpen && currentUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-slate-900">Your Transit Profile</h3>
                <p className="text-xs text-slate-500">Firebase Auth & Storage Connected</p>
              </div>
              <button
                onClick={() => setIsProfileModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Account Name:</span>
                  <span className="font-semibold text-slate-900">{currentUser.displayName}</span>
                </div>
                {currentUser.email && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Email:</span>
                    <span className="font-mono text-slate-800">{currentUser.email}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Phone:</span>
                  <span className="font-mono text-slate-800">{currentUser.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Role:</span>
                  <span className="capitalize font-semibold text-amber-700">{currentUser.currentRole}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Pass / Subscription:</span>
                  <span className="font-medium text-emerald-600">3-Month Free Trial Active</span>
                </div>
              </div>

              {/* Profile Photo Uploader directly connected to Firebase Storage */}
              <div className="pt-1">
                <FileUpload
                  label="Profile Avatar (Firebase Storage)"
                  helperText="Upload your official avatar to Firebase Storage. Synced with your transit account."
                  storagePathPrefix="user_profiles"
                  currentUrl={currentUser.photoURL || profilePhotoUrl}
                  onUploadSuccess={handleAvatarUploaded}
                  onRequireAuth={onOpenAuthModal}
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsProfileModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
