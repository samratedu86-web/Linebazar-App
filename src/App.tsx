import React, { useEffect, useState } from 'react';
import { Header } from './components/common/Header';
import { PassengerView } from './components/passenger/PassengerView';
import { CrewView } from './components/crew/CrewView';
import { AdminView } from './components/admin/AdminView';
import { AdminUserManagementDashboard } from './components/admin/AdminUserManagementDashboard';
import { SubscriptionModal } from './components/subscription/SubscriptionModal';
import { PhoneAuthModal } from './components/auth/PhoneAuthModal';
import { KolkataTransitMap } from './components/map/KolkataTransitMap';
import { store } from './services/store';
import { firestoreSync } from './services/firestoreSync';
import {
  AdminAuditLog,
  BusRegistration,
  BusRoute,
  BusStand,
  Trip,
  UserProfile,
  WaitSignal,
  OnboardPassenger,
  DESIGNATED_ADMIN_UID,
  DESIGNATED_ADMIN_EMAIL,
  DESIGNATED_ADMIN_RAW_PHONE,
} from './types';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(store.getCurrentUser());
  const [buses, setBuses] = useState<BusRegistration[]>(store.getBuses());
  const [routes, setRoutes] = useState<BusRoute[]>(store.getRoutes());
  const [stands, setStands] = useState<BusStand[]>(store.getStands());
  const [trips, setTrips] = useState<Trip[]>(store.getTrips());
  const [waitSignals, setWaitSignals] = useState<WaitSignal[]>(store.getWaitSignals());
  const [onboardPassengers, setOnboardPassengers] = useState<OnboardPassenger[]>(store.getOnboardPassengers());
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>(store.getAuditLogs());

  const [activeTab, setActiveTab] = useState<'passenger' | 'crew' | 'admin' | 'subscription' | 'live-map'>('passenger');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [showDemoRoleBar, setShowDemoRoleBar] = useState(false);

  // Subscribe to store updates and Firebase auth state
  useEffect(() => {
    const unsubscribeStore = store.subscribe(() => {
      setCurrentUser(store.getCurrentUser());
      setBuses([...store.getBuses()]);
      setRoutes([...store.getRoutes()]);
      setStands([...store.getStands()]);
      setTrips([...store.getTrips()]);
      setWaitSignals([...store.getWaitSignals()]);
      setOnboardPassengers([...store.getOnboardPassengers()]);
      setAuditLogs([...store.getAuditLogs()]);
    });

    const unsubscribeAuth = firestoreSync.listenToAuth(async (fbUser) => {
      if (fbUser) {
        const profile = await firestoreSync.getUserProfile(fbUser.uid);
        if (profile) {
          store.setUser(profile);
        }
      }
    });

    return () => {
      unsubscribeStore();
      unsubscribeAuth();
    };
  }, []);

  const isDesignatedAdmin = Boolean(
    currentUser &&
    (currentUser.uid === DESIGNATED_ADMIN_UID ||
     currentUser.email?.toLowerCase() === DESIGNATED_ADMIN_EMAIL ||
     currentUser.phone?.replace(/\D/g, '').slice(-10) === DESIGNATED_ADMIN_RAW_PHONE)
  );

  const isAdmin = Boolean(
    isDesignatedAdmin ||
    (currentUser && currentUser.roles?.includes('admin'))
  );

  // Auto-switch to admin view when designated admin logs in
  useEffect(() => {
    if (isDesignatedAdmin) {
      setActiveTab('admin');
    }
  }, [isDesignatedAdmin]);

  const handleRoleQuickSwitch = (role: 'passenger' | 'driver') => {
    store.switchRole(role);
    if (role === 'passenger') setActiveTab('passenger');
    else if (role === 'driver') setActiveTab('crew');
  };

  const handleSignOut = () => {
    store.signOut();
  };

  const isExpired = currentUser?.subscription
    ? !store.isSubscriptionActive(currentUser.subscription)
    : false;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans selection:bg-amber-400 selection:text-slate-950">
      {/* Top Header Bar */}
      <Header
        currentUser={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onSignOut={handleSignOut}
      />

      {/* Subscription Expiry Alert Bar */}
      {isExpired && (
        <div className="bg-rose-600 text-white text-xs font-semibold px-4 py-2 text-center flex items-center justify-center gap-2">
          <span>Your Linebazar pass has expired. Paid features are blocked until renewed.</span>
          <button
            onClick={() => setIsSubModalOpen(true)}
            className="underline font-bold hover:text-amber-200"
          >
            Renew Subscription Now →
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-12">
        {/* WHEN DESIGNATED ADMIN LOGS IN:
            Show the Admin User Management Dashboard */}
        {isDesignatedAdmin && (activeTab === 'admin' || activeTab === 'passenger' || activeTab === 'crew') && (
          <AdminUserManagementDashboard
            currentUser={currentUser}
            buses={buses}
            routes={routes}
            trips={trips}
            waitSignals={waitSignals}
            auditLogs={auditLogs}
          />
        )}

        {/* FOR REGULAR COMMUTERS / USERS: Standard Personal Dashboard */}
        {!isDesignatedAdmin && activeTab === 'passenger' && (
          <PassengerView
            currentUser={currentUser}
            routes={routes}
            trips={trips}
            buses={buses}
            stands={stands}
            waitSignals={waitSignals}
            onboardPassengers={onboardPassengers}
            onOpenAuth={() => setIsAuthModalOpen(true)}
            onOpenSubscription={() => setIsSubModalOpen(true)}
          />
        )}

        {/* CREW & DRIVER VIEW */}
        {!isDesignatedAdmin && activeTab === 'crew' && (
          <CrewView
            currentUser={currentUser}
            buses={buses}
            routes={routes}
            trips={trips}
            waitSignals={waitSignals}
            onboardPassengers={onboardPassengers}
            onOpenAuth={() => setIsAuthModalOpen(true)}
            onOpenSubscription={() => setIsSubModalOpen(true)}
          />
        )}

        {/* REGULAR ADMIN VIEW (if role is admin but not designated superadmin) */}
        {!isDesignatedAdmin && isAdmin && activeTab === 'admin' && (
          <AdminView
            currentUser={currentUser}
            buses={buses}
            routes={routes}
            stands={stands}
            trips={trips}
            waitSignals={waitSignals}
            auditLogs={auditLogs}
          />
        )}

        {/* ACCESS DENIED FOR NON-ADMIN VISITING ADMIN TAB */}
        {!isAdmin && activeTab === 'admin' && (
          <div className="max-w-md mx-auto my-12 bg-white rounded-2xl border border-slate-200 p-8 shadow-sm text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-2xl shadow-xs">
              🔒
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-4">
              অ্যাডমিন অ্যাক্সেস সুরক্ষিত
            </h2>
            <p className="text-xs font-semibold text-rose-600 mt-1 uppercase tracking-wide">
              Admin Access Restricted
            </p>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              এই কন্ট্রোল প্যানেল কেবলমাত্র লাইনবাজারের অনুমোদিত প্রশাসকের জন্য সংরক্ষিত। অযাচিত বা সাধারণ ইউজার আইডি দিয়ে এতে প্রবেশ করা সম্ভব নয়।
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition"
              >
                প্রশাসক ইমেইল দিয়ে সাইন-ইন করুন (Admin Sign-In)
              </button>
              <button
                onClick={() => setActiveTab('passenger')}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition"
              >
                বাস ট্র্যাকিং ও যাত্রী হোমে ফিরে যান
              </button>
            </div>
          </div>
        )}

        {/* STANDALONE SUBSCRIPTION VIEW */}
        {activeTab === 'subscription' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs max-w-3xl mx-auto">
              <div className="border-b border-slate-100 pb-4 mb-6">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">
                  Fair Transit Economics
                </span>
                <h1 className="text-2xl font-black text-slate-950 mt-1">
                  Linebazar Subscriptions & Access Rules
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Server-enforced access policy for passengers and Kolkata bus transit fleets.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-base text-slate-900">Passenger Commuter Pass</h3>
                    <div className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                      ₹19 <span className="text-xs font-normal text-slate-500">/ month</span>
                    </div>
                    <div className="mt-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded inline-block">
                      First 3 Months Free Trial
                    </div>
                    <p className="text-xs text-slate-600 mt-3">
                      Trial initiates automatically from your first verified phone OTP sign-in.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsSubModalOpen(true)}
                    className="mt-6 w-full py-2.5 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition"
                  >
                    Open Billing Checkout
                  </button>
                </div>

                <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-base text-slate-900">Bus Vehicle Operations Pass</h3>
                    <div className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
                      ₹99 <span className="text-xs font-normal text-slate-500">/ bus / month</span>
                    </div>
                    <div className="mt-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded inline-block">
                      First 3 Months Free upon Admin Approval
                    </div>
                    <p className="text-xs text-slate-600 mt-3">
                      Trial begins on the day Admin verifies and approves the bus vehicle application.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsSubModalOpen(true)}
                    className="mt-6 w-full py-2.5 text-xs font-bold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 transition"
                  >
                    Manage Bus Fleet Billing
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LIVE MAP TAB */}
        {activeTab === 'live-map' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
              <h2 className="text-base font-bold text-slate-900 mb-1">
                Kolkata Real-Time Transit Map
              </h2>
              <p className="text-xs text-slate-500 mb-3">
                Tracking government, private, and AC express buses across Kolkata and Howrah.
              </p>
              <KolkataTransitMap
                routes={routes}
                trips={trips}
                buses={buses}
                stands={stands}
                waitSignals={waitSignals}
                className="h-[600px] w-full rounded-xl overflow-hidden border border-slate-200"
              />
            </div>
          </div>
        )}
      </main>

      {/* Floating Role Quick Switcher: Strictly restricted to Admin only */}
      {isAdmin && (
        <aside aria-label="Demo Role Simulator" className="fixed bottom-3 right-3 z-40 print:hidden">
          {showDemoRoleBar ? (
            <div className="bg-white/95 backdrop-blur-md border border-slate-300 rounded-full shadow-lg p-1.5 flex items-center gap-1 text-xs">
              <span className="text-[11px] font-bold text-slate-500 px-2 uppercase tracking-wider">Admin Role:</span>
              <button
                onClick={() => handleRoleQuickSwitch('passenger')}
                className={`px-3 py-1 rounded-full font-semibold transition ${
                  activeTab === 'passenger'
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Passenger
              </button>
              <button
                onClick={() => handleRoleQuickSwitch('driver')}
                className={`px-3 py-1 rounded-full font-semibold transition ${
                  activeTab === 'crew'
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Drivers/Conductor
              </button>
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-3 py-1 rounded-full font-semibold transition flex items-center gap-1 ${
                  activeTab === 'admin'
                    ? 'bg-slate-900 text-amber-300 font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>👑 Admin</span>
              </button>
              <button
                onClick={() => setShowDemoRoleBar(false)}
                className="w-5 h-5 ml-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center font-bold text-xs"
                title="Minimize Demo Bar"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDemoRoleBar(true)}
              className="bg-white/90 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-300 rounded-full shadow-md px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
              title="Open Admin Role Switcher"
            >
              <span>👑</span>
              <span>Admin Switch</span>
            </button>
          )}
        </aside>
      )}

      {/* Auth Modal */}
      <PhoneAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => setIsAuthModalOpen(false)}
      />

      {/* Subscription Modal */}
      <SubscriptionModal
        isOpen={isSubModalOpen}
        onClose={() => setIsSubModalOpen(false)}
        currentUser={currentUser}
        onOpenAuth={() => {
          setIsSubModalOpen(false);
          setIsAuthModalOpen(true);
        }}
      />

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-xs text-slate-500 text-center print:hidden">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-amber-500 text-slate-950 font-bold text-[10px] flex items-center justify-center">
              LB
            </span>
            <span className="font-semibold text-slate-700">Linebazar</span>
            <span>·</span>
            <span>Kolkata Urban Bus Coordination Platform</span>
          </div>

          <div className="flex items-center gap-4 text-[11px] text-slate-500">
            <span>linebazar.com</span>
            <span>·</span>
            <a
              href="https://github.com/samratedu86-web/Linebazar-Web-App"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-950 font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              <span>samratedu86-web/Linebazar-Web-App</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
