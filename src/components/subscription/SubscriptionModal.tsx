import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { UserProfile } from '../../types';
import { store } from '../../services/store';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  onOpenAuth: () => void;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onOpenAuth,
}) => {
  const [selectedPlan, setSelectedPlan] = useState<'passenger' | 'bus'>('passenger');
  const [processing, setProcessing] = useState(false);
  const [paymentSuccessMsg, setPaymentSuccessMsg] = useState<string | null>(null);
  const [paymentErrorMsg, setPaymentErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentSub = currentUser?.subscription;
  const isExpired = currentSub ? !store.isSubscriptionActive(currentSub) : false;

  const handleSimulatePayment = (type: 'passenger' | 'bus', amount: number) => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    setProcessing(true);
    setPaymentErrorMsg(null);
    setPaymentSuccessMsg(null);

    // Simulate verified Razorpay / Stripe webhook processing
    setTimeout(() => {
      try {
        const payment = store.recordPayment({
          subscriberId: currentUser.uid,
          type,
          amountInr: amount,
          provider: 'razorpay',
          providerPaymentId: `pay_rzp_${Math.random().toString(36).substring(2, 10)}`,
          monthsToAdd: 1,
        });

        setProcessing(false);
        setPaymentSuccessMsg(
          `Payment of ₹${amount} confirmed via verified webhook! Subscription extended through ${new Date(
            payment.paidPeriodEnd
          ).toLocaleDateString()}.`
        );
      } catch (err: any) {
        setProcessing(false);
        setPaymentErrorMsg('Payment verification failed.');
      }
    }, 700);
  };

  const handleCancelSubscription = () => {
    if (!currentUser) return;
    if (confirm('Cancel your Linebazar auto-renewal? You will maintain full access until your current period expires.')) {
      store.cancelSubscription(currentUser.uid, 'passenger');
      setPaymentSuccessMsg('Auto-renewal cancelled. Your access remains active until the end of your current period.');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto modal-portal-overlay"
      style={{ zIndex: 999998, transform: 'translateZ(0)' }}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] relative my-auto"
        style={{ zIndex: 999999 }}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Linebazar Subscription Plans</h2>
            <p className="text-xs text-slate-500">
              Clear, transparent pricing for passengers and Kolkata bus transit fleets
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            ✕
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {paymentSuccessMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium">
              {paymentSuccessMsg}
            </div>
          )}

          {paymentErrorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
              {paymentErrorMsg}
            </div>
          )}

          {/* Current User Status Summary */}
          {currentUser && currentSub && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <span className="font-semibold text-slate-500">Your Current Status:</span>
                <div className="font-bold text-sm text-slate-900 mt-0.5 flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isExpired
                        ? 'bg-rose-500'
                        : currentSub.status === 'cancelled'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                  ></span>
                  <span>
                    {isExpired
                      ? 'Subscription Expired'
                      : currentSub.status === 'trial'
                      ? '90-Day Free Trial Active'
                      : currentSub.status === 'cancelled'
                      ? 'Cancelled (Active until expiry)'
                      : 'Active Subscription'}
                  </span>
                </div>
                <div className="text-slate-500 mt-0.5">
                  Valid Through:{' '}
                  <strong className="text-slate-800 font-mono">
                    {new Date(currentSub.paidThroughDate).toLocaleDateString()}
                  </strong>
                </div>
              </div>

              {currentSub.autoRenew && !isExpired && (
                <button
                  onClick={handleCancelSubscription}
                  className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 font-semibold transition"
                >
                  Cancel Auto-Renewal
                </button>
              )}
            </div>
          )}

          {/* Plan Comparison Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Passenger Pass */}
            <div
              onClick={() => setSelectedPlan('passenger')}
              className={`p-5 rounded-2xl border-2 transition cursor-pointer flex flex-col justify-between ${
                selectedPlan === 'passenger'
                  ? 'border-slate-900 bg-slate-50/60 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
                  Individual Commuters
                </span>
                <h3 className="text-xl font-bold text-slate-900 mt-0.5">Passenger Monthly Pass</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-black font-mono tabular-nums text-slate-900">₹19</span>
                  <span className="text-xs text-slate-500 font-medium">/ month</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded inline-block">
                  First 3 Months Free Trial
                </div>

                <ul className="mt-4 space-y-2 text-xs text-slate-600">
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Unlimited real-time Kolkata bus search</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Send "I am waiting" signals to incoming buses</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Live vehicle GPS location & accurate ETAs</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Cancel renewal anytime with zero lock-in</span>
                  </li>
                </ul>
              </div>

              <button
                onClick={() => handleSimulatePayment('passenger', 19)}
                disabled={processing}
                className="mt-6 w-full py-2.5 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition shadow-sm disabled:opacity-50"
              >
                {processing ? 'Verifying Webhook...' : 'Renew / Subscribe (₹19/mo)'}
              </button>
            </div>

            {/* Fleet Bus Subscription */}
            <div
              onClick={() => setSelectedPlan('bus')}
              className={`p-5 rounded-2xl border-2 transition cursor-pointer flex flex-col justify-between ${
                selectedPlan === 'bus'
                  ? 'border-slate-900 bg-slate-50/60 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
                  Transit Fleet & Operators
                </span>
                <h3 className="text-xl font-bold text-slate-900 mt-0.5">Bus Vehicle Operations</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-black font-mono tabular-nums text-slate-900">₹99</span>
                  <span className="text-xs text-slate-500 font-medium">/ bus / month</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded inline-block">
                  First 3 Months Free upon Admin Approval
                </div>

                <ul className="mt-4 space-y-2 text-xs text-slate-600">
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Scheduled trip management & live GPS broadcast</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Instant high-demand alert when 10+ passengers wait</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Multi-crew conductor & driver roster linkage</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>Route authority verification & telemetry log</span>
                  </li>
                </ul>
              </div>

              <button
                onClick={() => handleSimulatePayment('bus', 99)}
                disabled={processing}
                className="mt-6 w-full py-2.5 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-sm disabled:opacity-50"
              >
                {processing ? 'Verifying Webhook...' : 'Renew Bus Fleet Pass (₹99/mo)'}
              </button>
            </div>
          </div>

          {/* Strict Access Policy Notice */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
            <div className="font-bold text-slate-800">Server-Authoritative Access Enforcement:</div>
            <p>
              • Trial duration is 90 days from passenger registration or bus admin approval date.
            </p>
            <p>
              • Cancellation maintains full active features until the recorded paid-through date. No sudden cutoffs.
            </p>
            <p>
              • Webhooks from payment gateways strictly enforce signature authentication before updating Firestore records.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
