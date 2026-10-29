import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  UserRole,
  DESIGNATED_ADMIN_UID,
  DESIGNATED_ADMIN_PHONE,
  DESIGNATED_ADMIN_RAW_PHONE,
  DESIGNATED_ADMIN_EMAIL,
} from '../../types';
import { store } from '../../services/store';
import { auth, googleProvider } from '../../services/firebase';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
} from 'firebase/auth';
import { firestoreSync } from '../../services/firestoreSync';

interface PhoneAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
    confirmationResult?: ConfirmationResult;
  }
}

type AuthMethod = 'phone' | 'email';

interface DiagnosticLogItem {
  timestamp: string;
  type: 'info' | 'warn' | 'error';
  phase: string;
  code?: string;
  message: string;
  details?: any;
}

export const PhoneAuthModal: React.FC<PhoneAuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  // Modal State
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('phone');

  // Email / Password Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isResetMode, setIsResetMode] = useState(false);

  // Phone Form State
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('9804154302');
  const [otpCode, setOtpCode] = useState('123456');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [countdown, setCountdown] = useState(30);
  const [recaptchaType, setRecaptchaType] = useState<'invisible' | 'normal'>('invisible');

  // Common Profile State
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('passenger');

  // UI Feedback State
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTestingGuide, setShowTestingGuide] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Diagnostics Logging State
  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagnosticLogItem[]>([]);

  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const countdownTimerRef = useRef<any>(null);

  // Internal Diagnostic Logger
  const addDiagnosticLog = (
    type: 'info' | 'warn' | 'error',
    phase: string,
    message: string,
    code?: string,
    details?: any
  ) => {
    const item: DiagnosticLogItem = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      phase,
      code,
      message,
      details,
    };

    setDiagnosticLogs((prev) => [item, ...prev.slice(0, 20)]);

    if (type === 'error') {
      if (code === 'auth/operation-not-allowed') {
        console.info(`[Firebase Phone Auth Setup Note] Phone authentication is not enabled in Firebase Console for project ${auth.app.options.projectId}. Fallback verification active.`);
      } else {
        console.warn(`[Firebase Phone Auth Warn] [${phase}] ${code || ''}: ${message}`, details || '');
      }
    } else if (type === 'warn') {
      console.warn(`[Firebase Phone Auth Warn] [${phase}] ${code || ''}: ${message}`, details || '');
    } else {
      console.log(`[Firebase Phone Auth Info] [${phase}]: ${message}`, details || '');
    }
  };

  // Reset state whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setInfoNotice(null);
      setSuccessMessage(null);
      setStep('phone');
      setOtpCode('');
      setIsResetMode(false);
      setLoading(false);
      setConfirmationResult(null);
      setShowTestingGuide(false);
      addDiagnosticLog('info', 'modal-open', 'Auth modal opened with clean state');
    }
  }, [isOpen]);

  // Clean up reCAPTCHA verifier and countdown timer on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      if (window.recaptchaVerifier) {
        try {
          window.recaptchaVerifier.clear();
        } catch {
          // ignore
        }
        window.recaptchaVerifier = undefined;
      }
    };
  }, []);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (step === 'otp') {
      setCountdown(30);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [step]);

  if (!isOpen) return null;

  // Initialize or safely reset RecaptchaVerifier
  const setupRecaptcha = (type: 'invisible' | 'normal' = recaptchaType): RecaptchaVerifier => {
    const container = recaptchaContainerRef.current || document.getElementById('phone-auth-recaptcha-container');

    if (container) {
      // Clear previous injected iframe to avoid "reCAPTCHA has already been rendered" error
      container.innerHTML = '';
    }

    if (window.recaptchaVerifier) {
      try {
        window.recaptchaVerifier.clear();
      } catch (clearErr) {
        addDiagnosticLog('warn', 'recaptcha-clear', 'Could not clear existing verifier', undefined, clearErr);
      }
      window.recaptchaVerifier = undefined;
    }

    addDiagnosticLog('info', 'recaptcha-setup', `Initializing new RecaptchaVerifier with mode: ${type}`);

    const verifier = new RecaptchaVerifier(auth, container || 'phone-auth-recaptcha-container', {
      size: type,
      callback: (token: any) => {
        addDiagnosticLog('info', 'recaptcha-solved', 'reCAPTCHA challenge successfully solved', undefined, {
          tokenPreview: token ? `${String(token).substring(0, 12)}...` : 'token-ok',
        });
      },
      'expired-callback': () => {
        addDiagnosticLog('warn', 'recaptcha-expired', 'reCAPTCHA token expired. Prompting user retry.');
        setError('reCAPTCHA verification expired. Please retry sending the SMS code.');
      },
      'error-callback': (err: any) => {
        addDiagnosticLog('error', 'recaptcha-error-callback', 'reCAPTCHA widget error event', undefined, err);
      },
    });

    window.recaptchaVerifier = verifier;
    return verifier;
  };

  // Helper to sync or create profile in store & Firestore
  const handleUserPostAuth = async (
    fbUser: any,
    chosenRole: UserRole,
    overrideName?: string,
    overridePhone?: string
  ) => {
    const cleanPhone = (fbUser.phoneNumber || overridePhone || phone || '').replace(/\D/g, '').slice(-10);
    const isBootstrappedAdmin =
      fbUser.email?.toLowerCase() === DESIGNATED_ADMIN_EMAIL ||
      cleanPhone === DESIGNATED_ADMIN_RAW_PHONE ||
      fbUser.uid === DESIGNATED_ADMIN_UID;
    let profile = null;

    try {
      profile = await firestoreSync.getUserProfile(fbUser.uid);
    } catch (e) {
      addDiagnosticLog('warn', 'profile-fetch', 'Firestore profile fetch offline or pending', undefined, e);
    }

    if (profile) {
      if (isBootstrappedAdmin) {
        if (!profile.roles.includes('admin')) {
          profile.roles.push('admin');
        }
        profile.currentRole = 'admin';
        profile.email = fbUser.email;
        firestoreSync.syncUserProfile(profile).catch(() => {});
      }
      store.setUser(profile);
      addDiagnosticLog('info', 'profile-synced', `Existing user profile activated: ${profile.uid}`);
    } else {
      const effectiveRole = isBootstrappedAdmin ? 'admin' : chosenRole;
      const formattedPhone =
        fbUser.phoneNumber ||
        (overridePhone
          ? `+91${overridePhone.replace(/\D/g, '').slice(-10)}`
          : '+919830112233');

      store.signIn(
        formattedPhone,
        overrideName || fbUser.displayName || (isBootstrappedAdmin ? 'Linebazar Admin' : 'Transit User'),
        effectiveRole,
        fbUser.uid,
        fbUser.email || undefined,
        fbUser.photoURL || undefined
      );
      addDiagnosticLog('info', 'profile-created', `New user profile created with role ${effectiveRole}`);
    }
  };

  // ----------------------------------------------------
  // 1. EMAIL & PASSWORD: Sign In
  // ----------------------------------------------------
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('ইমেইল এবং পাসওয়ার্ড দুটিই পূরণ করুন (Please enter both email and password).');
      return;
    }

    try {
      setLoading(true);
      addDiagnosticLog('info', 'email-signin-start', `Attempting email sign-in for: ${cleanEmail}`);
      const res = await signInWithEmailAndPassword(auth, cleanEmail, password);
      await handleUserPostAuth(res.user, 'passenger');
      setLoading(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      setLoading(false);
      addDiagnosticLog('error', 'email-signin-failed', err.message, err.code, err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError('ভুল ইমেইল বা পাসওয়ার্ড। অনুগ্রহ করে পুনরায় যাচাই করুন। (Incorrect email or password).');
      } else if (err.code === 'auth/user-not-found') {
        setError('এই ইমেইলে কোনো অ্যাকাউন্ট পাওয়া যায়নি। অনুগ্রহ করে Sign Up ট্যাবে গিয়ে নতুন অ্যাকাউন্ট তৈরি করুন।');
      } else if (err.code === 'auth/invalid-email') {
        setError('সঠিক ইমেইল ঠিকানা প্রদান করুন (Invalid email address format).');
      } else if (err.code === 'auth/too-many-requests') {
        setError('অতিরিক্ত ভুল চেষ্টার কারণে সাময়িকভাবে বন্ধ। একটু পর আবার চেষ্টা করুন বা পাসওয়ার্ড রিসেট করুন।');
      } else {
        setError(err.message || 'ইমেইল সাইন-ইন সম্পন্ন করা সম্ভব হয়নি।');
      }
    }
  };

  // ----------------------------------------------------
  // 2. EMAIL & PASSWORD: Sign Up
  // ----------------------------------------------------
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();
    const cleanName = displayName.trim();

    if (!cleanName) {
      setError('অনুগ্রহ করে আপনার পুরো নাম লিখুন (Please enter your full name).');
      return;
    }
    if (!cleanEmail) {
      setError('সঠিক ইমেইল ঠিকানা দিন (Please enter a valid email address).');
      return;
    }
    if (password.length < 6) {
      setError('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে (Password must be at least 6 characters).');
      return;
    }
    if (password !== confirmPassword) {
      setError('দুটি পাসওয়ার্ড মেলেনি। পুনরায় চেক করুন (Passwords do not match).');
      return;
    }

    try {
      setLoading(true);
      addDiagnosticLog('info', 'email-signup-start', `Creating user account for: ${cleanEmail}`);
      const res = await createUserWithEmailAndPassword(auth, cleanEmail, password);

      try {
        await updateProfile(res.user, { displayName: cleanName });
      } catch {
        // non-fatal
      }

      await handleUserPostAuth(res.user, role, cleanName, phone);
      setLoading(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      setLoading(false);
      addDiagnosticLog('error', 'email-signup-failed', err.message, err.code, err);
      if (err.code === 'auth/email-already-in-use') {
        setError('এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট তৈরি রয়েছে। অনুগ্রহ করে Sign In ট্যাবে ক্লিক করে লগইন করুন।');
      } else if (err.code === 'auth/weak-password') {
        setError('পাসওয়ার্ডটি দুর্বল। কমপক্ষে ৬ অক্ষরের মিশ্রণ ব্যবহার করুন।');
      } else if (err.code === 'auth/invalid-email') {
        setError('ইমেইল ফরম্যাট সঠিক নয়।');
      } else {
        setError(err.message || 'অ্যাকাউন্ট তৈরি সম্পন্ন করা সম্ভব হয়নি।');
      }
    }
  };

  // ----------------------------------------------------
  // 3. PASSWORD RESET EMAIL
  // ----------------------------------------------------
  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('পাসওয়ার্ড রিসেটের জন্য আপনার ইমেইল ঠিকানা লিখুন।');
      return;
    }

    try {
      setLoading(true);
      addDiagnosticLog('info', 'password-reset', `Sending reset email to ${cleanEmail}`);
      await sendPasswordResetEmail(auth, cleanEmail);
      setLoading(false);
      setSuccessMessage(`${cleanEmail} ঠিকানায় পাসওয়ার্ড রিসেট লিঙ্ক পাঠানো হয়েছে। আপনার ইনবক্স বা স্প্যাম ফোল্ডার চেক করুন।`);
    } catch (err: any) {
      setLoading(false);
      addDiagnosticLog('error', 'password-reset-failed', err.message, err.code, err);
      if (err.code === 'auth/user-not-found') {
        setError('এই ইমেইলে কোনো অ্যাকাউন্ট নিবন্ধিত নেই।');
      } else {
        setError(err.message || 'পাসওয়ার্ড রিসেট ইমেইল পাঠানো যায়নি।');
      }
    }
  };

  // ----------------------------------------------------
  // 4. GOOGLE AUTH (One-Click)
  // ----------------------------------------------------
  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setError(null);
      setInfoNotice(null);

      addDiagnosticLog('info', 'google-signin-start', 'Opening Google Sign-In popup...');
      const res = await signInWithPopup(auth, googleProvider);
      const user = res.user;

      await handleUserPostAuth(user, role, user.displayName || displayName);
      setLoading(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      setLoading(false);
      addDiagnosticLog('error', 'google-signin-failed', err.message, err.code, err);
      if (err.code === 'auth/popup-blocked') {
        setError('ব্রাউজারের পপ-আপ ব্লক করা রয়েছে। অনুগ্রহ করে পপ-আপ অনুমতি দিন।');
      } else if (err.code === 'auth/unauthorized-domain') {
        setError('Firebase Authorized Domains-এ এই ডোমেনটি অনুমতি পাওয়ার প্রক্রিয়ায় রয়েছে।');
      } else if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        // user closed popup cleanly
      } else {
        setError(err.message || 'গুগল অ্যাকাউন্ট দিয়ে সাইন-ইন সম্পন্ন করা যায়নি।');
      }
    }
  };

  // ----------------------------------------------------
  // 5. PHONE AUTH: Send OTP (with detailed diagnostic logging)
  // ----------------------------------------------------
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setError('অনুগ্রহ করে সঠিক ১০ ডিজিটের ভারতীয় মোবাইল নম্বর লিখুন (Valid 10-digit number required).');
      return;
    }

    if (authMode === 'signup' && !displayName.trim()) {
      setError('অনুগ্রহ করে আপনার পুরো নাম লিখুন (Please enter your name).');
      return;
    }

    setLoading(true);
    setError(null);
    setInfoNotice(null);

    const fullPhoneNumber = `+91${cleanPhone.slice(-10)}`;

    addDiagnosticLog('info', 'otp-dispatch-start', `Initiating SMS verification for ${fullPhoneNumber}`, undefined, {
      fullPhoneNumber,
      authDomain: auth.app.options.authDomain,
      projectId: auth.app.options.projectId,
      apiKeyPrefix: auth.app.options.apiKey?.substring(0, 8),
      currentOrigin: window.location.origin,
      recaptchaType,
    });

    try {
      const appVerifier = setupRecaptcha(recaptchaType);

      // Pre-render reCAPTCHA to catch DOM or script errors early
      try {
        await appVerifier.render();
        addDiagnosticLog('info', 'recaptcha-render-ok', 'reCAPTCHA rendered successfully into DOM');
      } catch (renderErr) {
        addDiagnosticLog('warn', 'recaptcha-render-warn', 'reCAPTCHA pre-render warning', undefined, renderErr);
      }

      const confirmation = await signInWithPhoneNumber(auth, fullPhoneNumber, appVerifier);
      setConfirmationResult(confirmation);
      window.confirmationResult = confirmation;

      addDiagnosticLog('info', 'otp-dispatched-success', 'Firebase accepted SMS dispatch request', undefined, {
        verificationId: confirmation.verificationId,
      });

      setInfoNotice(
        `Firebase Authentication থেকে ${fullPhoneNumber} নম্বরে OTP পাঠানো হয়েছে। টেলিকম ক্যারিয়ার বা DLT ফিল্টারে SMS আটকে গেলে নিচে দেওয়া টেস্ট কোড (123456) ব্যবহার করে তৎক্ষণাৎ লগইন করতে পারবেন।`
      );
      setLoading(false);
      setStep('otp');
    } catch (phoneErr: any) {
      setLoading(false);
      setConfirmationResult(null);

      // Deep error diagnostics logging
      addDiagnosticLog('error', 'otp-dispatch-failed', phoneErr.message || 'Unknown SMS dispatch error', phoneErr.code, {
        code: phoneErr.code,
        message: phoneErr.message,
        phoneNumber: fullPhoneNumber,
        authDomain: auth.app.options.authDomain,
        projectId: auth.app.options.projectId,
        origin: window.location.origin,
        rawError: phoneErr,
      });

      // Context-aware error mapping
      if (phoneErr.code === 'auth/too-many-requests') {
        setError(
          'Firebase Rate Limit: অতিরিক্ত SMS রিকোয়েস্টের কারণে Firebase এই নম্বর বা ডিভাইসে সাময়িক নিষেধাজ্ঞা দিয়েছে। কিছুক্ষণ অপেক্ষা করুন অথবা টেস্ট কোড (123456) ব্যবহার করে সরাসরি লগইন করুন।'
        );
        setInfoNotice('রেট-লিমিট বাইপাস করতে নিচে দেওয়া টেস্ট কোড (123456) ব্যবহার করুন।');
      } else if (phoneErr.code === 'auth/quota-exceeded') {
        setError(
          'Firebase SMS Quota Exceeded: Firebase Spark ফ্রি প্ল্যানের দৈনিক ১০টি SMS কোটা পূর্ণ হয়ে গেছে।'
        );
        setInfoNotice(
          'কোটা শেষ হলেও টেস্টিং বন্ধ হবে না। নিচের টেস্ট কোড (123456) ব্যবহার করে অনায়াসে প্রবেশ করুন।'
        );
      } else if (phoneErr.code === 'auth/invalid-app-credential') {
        setError(
          'reCAPTCHA Credential Error: ব্রাউজার অথবা আইফ্রেমের কারণে reCAPTCHA ভেরিফিকেশন বাধাগ্রস্ত হয়েছে। নিচে স্ট্যান্ডার্ড reCAPTCHA ট্রাই করতে পারেন অথবা টেস্ট কোড ব্যবহার করুন।'
        );
      } else if (phoneErr.code === 'auth/unauthorized-domain') {
        setError(
          `Unauthorized Domain: বর্তমান ঠিকানা (${window.location.hostname}) Firebase Console > Authentication > Settings > Authorized domains-এ অনুমতি থাকা প্রয়োজন।`
        );
      } else if (phoneErr.code === 'auth/operation-not-allowed') {
        setError(
          'Firebase Console-এ Phone Authentication এনেবল করা নেই (Operation Not Allowed)। আপনি নিচে দেওয়া টেস্ট কোড (123456) ব্যবহার করে অথবা Google দিয়ে এখনই অনায়াসে লগইন করতে পারেন।'
        );
        setInfoNotice(
          'তাত্ক্ষণিক প্রবেশের জন্য টেস্ট কোড (123456) স্বয়ংক্রিয়ভাবে বসানো হয়েছে। নিচের বাটনে ক্লিক করলেই লগইন হয়ে যাবে।'
        );
        setOtpCode('123456');
      } else if (phoneErr.code === 'auth/captcha-check-failed') {
        setError('reCAPTCHA সিকিউরিটি চেক সম্পন্ন হয়নি। পুনরায় চেষ্টা করুন।');
      } else {
        setError(`Firebase Auth এরর (${phoneErr.code || 'UNKNOWN'}): ${phoneErr.message || 'SMS কোড পাঠানো সম্ভব হয়নি'}`);
        setInfoNotice('টেলিকম বা কনফিগারেশন সমস্যা এড়াতে টেস্ট কোড (123456) প্রস্তুত রাখা হয়েছে।');
      }

      // Transition to OTP step so user can use test code fallback even if network SMS failed!
      setStep('otp');
    }
  };

  // ----------------------------------------------------
  // 6. PHONE AUTH: Verify OTP
  // ----------------------------------------------------
  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);

    const cleanPhone = phone.trim().replace(/\D/g, '');
    const fullPhoneNumber = `+91${cleanPhone.slice(-10)}`;
    const enteredCode = otpCode.trim() || '123456';

    addDiagnosticLog('info', 'otp-verify-start', `Verifying code for ${fullPhoneNumber}`, undefined, {
      codeLength: enteredCode.length,
      hasConfirmationResult: !!confirmationResult,
    });

    let authSuccess = false;

    // 1st Attempt: If Firebase confirmationResult exists and code is NOT 123456, try real Firebase confirm
    if (confirmationResult && enteredCode !== '123456') {
      try {
        const userCredential = await confirmationResult.confirm(enteredCode);
        addDiagnosticLog('info', 'otp-verify-firebase-ok', 'Real Firebase Phone Auth verification succeeded', undefined, {
          uid: userCredential.user.uid,
        });
        await handleUserPostAuth(userCredential.user, role, displayName, fullPhoneNumber);
        authSuccess = true;
      } catch (confirmErr: any) {
        addDiagnosticLog('warn', 'otp-verify-firebase-failed', confirmErr.message, confirmErr.code, confirmErr);
        if (confirmErr.code === 'auth/invalid-verification-code') {
          setError(
            'ভুল ওটিপি কোড (Invalid Code)। যদি ফোনে SMS না এসে থাকে, তবে 123456 কোডটি দিন অথবা "টেস্ট কোড দিয়ে লগইন" বাটনে চাপুন।'
          );
          setLoading(false);
          return;
        }
      }
    }

    // 2nd Attempt: Standard or Instant Test Code (123456) Verification
    if (!authSuccess) {
      if (enteredCode === '123456' || !confirmationResult) {
        try {
          const testUid = `pax-${cleanPhone.slice(-6)}`;
          let existingProfile = null;
          try {
            existingProfile = await firestoreSync.getUserProfile(testUid);
          } catch {
            // offline cache
          }

          if (existingProfile) {
            store.setUser(existingProfile);
          } else {
            store.signIn(
              fullPhoneNumber,
              displayName || (authMode === 'signup' ? 'Linebazar Member' : 'Transit Passenger'),
              role,
              testUid
            );
          }

          addDiagnosticLog('info', 'otp-verify-test-ok', 'Verified via static test code', undefined, {
            testUid,
          });
          authSuccess = true;
        } catch (e: any) {
          addDiagnosticLog('error', 'otp-verify-fallback-error', e.message, undefined, e);
          setError(e.message || 'ভেরিফিকেশন সম্পন্ন করা যায়নি।');
          setLoading(false);
          return;
        }
      }
    }

    setLoading(false);
    if (authSuccess) {
      onSuccess();
      onClose();
    }
  };

  // Instant 1-Click Test Login Helper (Strictly Passenger Only)
  const handleInstantBypass = () => {
    addDiagnosticLog('info', 'instant-bypass', 'User triggered 1-click test passenger login');
    setOtpCode('123456');
    const cleanPhone = phone.trim().replace(/\D/g, '') || '9830112233';
    const fullPhoneNumber = `+91${cleanPhone.slice(-10)}`;
    const testUid = `pax-${cleanPhone.slice(-6)}`;

    // Instant test bypass strictly limited to passenger (NO admin bypass)
    store.signIn(
      fullPhoneNumber,
      displayName || 'Transit Passenger',
      'passenger',
      testUid
    );
    onSuccess();
    onClose();
  };

  // Demo Credentials Pre-fill (Passenger only - Admin credentials removed for security)
  const fillDemoCredentials = () => {
    setEmail('passenger.kolkata@linebazar.in');
    setPassword('Passenger@123');
    setDisplayName('Sourav Ganguly');
    setRole('passenger');
    setPhone('9830198765');
  };

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm overflow-y-auto modal-portal-overlay"
      style={{ zIndex: 999999, transform: 'translateZ(0)' }}
    >
      {/* Container for Firebase reCAPTCHA */}
      <div id="phone-auth-recaptcha-container" ref={recaptchaContainerRef} className="absolute opacity-0 pointer-events-none w-0 h-0 overflow-hidden" />

      <div
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-auto relative animate-in fade-in zoom-in-95 duration-150"
        style={{ zIndex: 1000000 }}
      >
        {/* Modal Header */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-amber-50/30">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500">
                Firebase Project: linebazar-47669
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-1">
              {isResetMode
                ? 'পাসওয়ার্ড রিসেট করুন'
                : authMode === 'signin'
                ? 'লাইনবাজারে সাইন ইন (Sign In)'
                : 'নতুন অ্যাকাউন্ট তৈরি (Sign Up - ৩ মাস ফ্রি)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              লাইভ বাস ট্র্যাকিং, প্যাসেঞ্জার সিগন্যাল ও ট্রানজিট কনসোল
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition"
          >
            ✕
          </button>
        </div>

        {/* Mode Switcher: Sign In vs Sign Up */}
        {!isResetMode && (
          <div className="flex border-b border-slate-200 bg-slate-100/70 p-1.5 gap-1.5">
            <button
              type="button"
              onClick={() => {
                setAuthMode('signin');
                setError(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                authMode === 'signin'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In (লগইন)
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('signup');
                setError(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                authMode === 'signup'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign Up (৩ মাসের ফ্রি পাস)
            </button>
          </div>
        )}

        {/* Auth Method Selector (Phone OTP vs Email & Password) */}
        {!isResetMode && (
          <div className="px-6 pt-3 pb-1 flex items-center justify-center gap-2 border-b border-slate-100">
            <button
              type="button"
              onClick={() => {
                setAuthMethod('phone');
                setError(null);
                setStep('phone');
              }}
              className={`flex-1 pb-2 text-xs font-semibold border-b-2 transition flex items-center justify-center gap-1.5 ${
                authMethod === 'phone'
                  ? 'border-amber-500 text-slate-950 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
              <span>ফোন নম্বর (Mobile OTP)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMethod('email');
                setError(null);
              }}
              className={`flex-1 pb-2 text-xs font-semibold border-b-2 transition flex items-center justify-center gap-1.5 ${
                authMethod === 'email'
                  ? 'border-amber-500 text-slate-950 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <span>ইমেইল ও পাসওয়ার্ড</span>
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <span className="text-rose-500 font-bold shrink-0 text-sm">⚠️</span>
              <div className="flex-1 leading-relaxed space-y-1">
                <div>{error}</div>
                <div className="text-[11px] text-rose-900/80 font-mono">
                  প্রয়োজনে নিচের টেস্ট কোড (123456) ব্যবহার করতে পারেন।
                </div>
              </div>
            </div>
          )}

          {infoNotice && (
            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
              <span className="text-amber-600 font-bold shrink-0 text-sm">ℹ️</span>
              <span className="flex-1 leading-relaxed">{infoNotice}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
              <span className="text-emerald-600 font-bold shrink-0 text-sm">✓</span>
              <span className="flex-1 leading-relaxed">{successMessage}</span>
            </div>
          )}

          {/* ------------------------------------------- */}
          {/* VIEW: FORGOT PASSWORD FLOW                  */}
          {/* ------------------------------------------- */}
          {isResetMode ? (
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  নিবন্ধিত ইমেইল ঠিকানা
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. yourname@example.com"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  আমরা এই ইমেইল ঠিকানায় একটি নিরাপদ পাসওয়ার্ড রিসেট লিঙ্ক পাঠাব।
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsResetMode(false)}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
                >
                  সাইন ইনে ফিরুন
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition disabled:opacity-50"
                >
                  {loading ? 'পাঠানো হচ্ছে...' : 'রিসেট লিঙ্ক পাঠান'}
                </button>
              </div>
            </form>
          ) : authMethod === 'phone' ? (
            /* ------------------------------------------- */
            /* VIEW: PHONE NUMBER & OTP (SIGN IN/SIGN UP)  */
            /* ------------------------------------------- */
            step === 'phone' ? (
              <form onSubmit={handleSendOtp} className="space-y-3.5">
                {authMode === 'signup' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      আপনার পুরো নাম (Full Name) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Sourav Ganguly"
                      className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    মোবাইল ফোন নম্বর (Mobile Number) <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 text-slate-600 text-xs font-mono font-semibold">
                      +91
                    </span>
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="9830112233"
                      className="w-full px-3.5 py-2 text-sm rounded-r-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 font-mono tabular-nums font-semibold"
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                    <span>
                      {authMode === 'signup'
                        ? 'ভেরিফিকেশনের সাথে সাথে ৩ মাসের ফ্রি ট্রায়াল পাস সক্রিয় হবে।'
                        : 'লগইন করার জন্য আপনার নম্বরে SMS কোড পাঠানো হবে।'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRecaptchaType(recaptchaType === 'invisible' ? 'normal' : 'invisible')}
                      className="text-amber-700 hover:underline font-mono text-[10px]"
                      title="reCAPTCHA Mode toggle"
                    >
                      reCAPTCHA: {recaptchaType}
                    </button>
                  </div>
                </div>

                {authMode === 'signup' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      ভূমিকা নির্বাচন করুন (Select Account Role)
                    </label>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {[
                        { id: 'passenger', label: 'Passenger', desc: 'Signal & Track Buses' },
                        { id: 'driver', label: 'Driver', desc: 'GPS & Bus Trip Console' },
                        { id: 'conductor', label: 'Conductor', desc: 'Passenger Demand Alarm' },
                      ].map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRole(r.id as UserRole)}
                          className={`p-2 rounded-lg border text-left transition ${
                            role === r.id
                              ? 'border-amber-500 bg-amber-50/70 text-slate-900 shadow-xs ring-1 ring-amber-400'
                              : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="font-bold text-slate-900 text-xs">{r.label}</div>
                          <div className="text-[10px] text-slate-500">{r.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-2.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && (
                    <svg className="w-4 h-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  )}
                  <span>{loading ? 'SMS পাঠানো হচ্ছে...' : 'SMS Verification Code পাঠান'}</span>
                </button>

                {/* Instant 1-Click Passenger Test Bypass */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleInstantBypass}
                    className="w-full py-2 px-3 text-xs font-medium text-amber-900 bg-amber-100/70 hover:bg-amber-200/80 rounded-lg border border-amber-300/60 transition flex items-center justify-center gap-1.5"
                  >
                    <span>⚡ সাধারণ যাত্রী টেস্ট লগইন (SMS কোড ছাড়া)</span>
                  </button>
                </div>
              </form>
            ) : (
              /* OTP VERIFICATION STEP */
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700">
                      ৬ ডিজিটের SMS ভেরিফিকেশন কোড
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setStep('phone');
                        setError(null);
                      }}
                      className="text-xs text-amber-600 hover:underline font-medium"
                    >
                      নম্বর পরিবর্তন করুন
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="123456"
                    className="w-full tracking-widest text-center py-2.5 text-xl font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 tabular-nums font-bold"
                  />
                </div>

                {/* Clear Test OTP info box */}
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-900">ডিফল্ট টেস্ট কোড:</span>
                    <button
                      type="button"
                      onClick={() => setOtpCode('123456')}
                      className="px-2 py-0.5 font-mono font-bold bg-amber-200 hover:bg-amber-300 rounded text-amber-950 tracking-wider transition"
                      title="Click to auto-fill"
                    >
                      123456
                    </button>
                  </div>
                  <div className="text-[11px] text-amber-800/90 leading-tight">
                    টেলিকম ক্যারিয়ার বা DLT ফিল্টারের কারণে ফোনে আন্তর্জাতিক SMS না এলে উপরের কোডটি (123456) ব্যবহার করে তৎক্ষণাৎ ভেরিফাই করুন।
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 transition shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading && (
                      <svg className="w-4 h-4 animate-spin text-slate-950" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    <span>{loading ? 'ভেরিফাই করা হচ্ছে...' : 'Verify Code & Sign In'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleInstantBypass}
                    className="w-full py-2 px-3 text-xs font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 rounded-lg border border-amber-300 transition flex items-center justify-center gap-1.5"
                  >
                    <span>⚡ কোড ছাড়াই সরাসরি লগইন করুন (+91 {phone.slice(-10)})</span>
                  </button>

                  <div className="flex items-center justify-between text-xs text-slate-500 px-1 pt-1">
                    <span>
                      {countdown > 0 ? `পুনরায় SMS পাঠানোর সময়: ${countdown}s` : 'কোড আসেনি?'}
                    </span>
                    <button
                      type="button"
                      disabled={countdown > 0 || loading}
                      onClick={() => handleSendOtp()}
                      className="text-amber-600 font-semibold hover:underline disabled:opacity-40"
                    >
                      Resend SMS
                    </button>
                  </div>
                </div>
              </form>
            )
          ) : (
            /* ------------------------------------------- */
            /* VIEW: EMAIL & PASSWORD (SIGN IN / SIGN UP)  */
            /* ------------------------------------------- */
            <form onSubmit={authMode === 'signin' ? handleEmailSignIn : handleEmailSignUp} className="space-y-3.5">
              {authMode === 'signup' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    আপনার পুরো নাম (Full Name) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Sourav Ganguly"
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ইমেইল ঠিকানা (Email Address) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. user@example.com"
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">
                    পাসওয়ার্ড (Password - কমপক্ষে ৬ অক্ষর) <span className="text-rose-500">*</span>
                  </label>
                  {authMode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsResetMode(true);
                        setError(null);
                      }}
                      className="text-[11px] text-amber-700 hover:text-amber-800 font-medium hover:underline"
                    >
                      পাসওয়ার্ড ভুলে গেছেন?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 pr-12 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 hover:text-slate-700 px-1"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {authMode === 'signup' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      পাসওয়ার্ড নিশ্চিত করুন (Confirm Password) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      ভূমিকা নির্বাচন করুন (Select Account Role)
                    </label>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {[
                        { id: 'passenger', label: 'Passenger', desc: 'Signal & Track Buses' },
                        { id: 'driver', label: 'Driver', desc: 'GPS & Bus Trip Console' },
                        { id: 'conductor', label: 'Conductor', desc: 'Passenger Demand Alarm' },
                      ].map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRole(r.id as UserRole)}
                          className={`p-2 rounded-lg border text-left transition ${
                            role === r.id
                              ? 'border-amber-500 bg-amber-50/70 text-slate-900 shadow-xs ring-1 ring-amber-400'
                              : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="font-bold text-slate-900 text-xs">{r.label}</div>
                          <div className="text-[10px] text-slate-500">{r.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Quick Fill Demo Helper (Passenger Commuter Only) */}
              <div className="flex items-center justify-between text-[11px] pt-1 text-slate-500">
                <span>টেস্ট ক্রেডেনশিয়াল:</span>
                <button
                  type="button"
                  onClick={fillDemoCredentials}
                  className="text-amber-700 underline hover:text-amber-900"
                >
                  ডেমো প্যাসেঞ্জার টেস্ট পূরণ
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && (
                  <svg className="w-4 h-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                )}
                <span>
                  {loading
                    ? 'Processing...'
                    : authMode === 'signin'
                    ? 'Sign In with Email'
                    : 'Create Account with Email (3-Mo Free Pass)'}
                </span>
              </button>
            </form>
          )}

          {/* ------------------------------------------- */}
          {/* DIVIDER & GOOGLE SINGLE-CLICK AUTH          */}
          {/* ------------------------------------------- */}
          {!isResetMode && (
            <>
              <div className="relative my-4 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <span className="relative bg-white px-2 text-[11px] text-slate-400 uppercase font-medium">
                  অথবা অন্য মাধ্যমে
                </span>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full py-2.5 px-4 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition flex items-center justify-center gap-2.5 shadow-xs disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Continue with Google Account</span>
              </button>

              {/* Troubleshooting Accordion for Firebase Phone Auth */}
              <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                <button
                  type="button"
                  onClick={() => setShowTestingGuide(!showTestingGuide)}
                  className="w-full flex items-center justify-between text-[11px] text-slate-500 hover:text-slate-700 font-medium"
                >
                  <span>💡 কেন ফোনে SMS কোড আসতে দেরি হতে পারে? (গাইড)</span>
                  <span>{showTestingGuide ? '▲' : '▼'}</span>
                </button>

                {showTestingGuide && (
                  <div className="p-2.5 bg-slate-50 rounded-lg text-[11px] text-slate-600 space-y-1.5 border border-slate-200">
                    <p>
                      <strong>১. টেলিকম DLT ফিল্টারিং:</strong> ভারতে (Airtel, Jio, Vi) আন্তর্জাতিক SMS প্রায়শই ক্যারিয়ার দ্বারা ফিল্টার বা ড্রপ হয়।
                    </p>
                    <p>
                      <strong>২. Firebase Spark প্ল্যান কোটা:</strong> ফ্রি টায়ারে দৈনিক সর্বোচ্চ ১০টি বাস্তব SMS সীমাবদ্ধ।
                    </p>
                    <p>
                      <strong>৩. সেরা সমাধান:</strong> Firebase Console &gt; Authentication &gt; Sign-in method &gt; Phone-এ গিয়ে <strong>"Phone numbers for testing"</strong> অপশনে আপনার নম্বর (যেমন: <code>+919830112233</code>) ও টেস্ট কোড (যেমন: <code>123456</code>) যোগ করুন। তাহলে কোনো SMS খরচ বা ব্যর্থতা ছাড়াই আসল Firebase Auth লগইন হবে।
                    </p>
                  </div>
                )}

                {/* Diagnostics Panel Toggle */}
                <button
                  type="button"
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  className="w-full flex items-center justify-between text-[10px] font-mono text-slate-400 hover:text-slate-600"
                >
                  <span>🔍 Firebase Phone Auth ডায়াগনস্টিক লগ ({diagnosticLogs.length} টি ইভেন্ট)</span>
                  <span>{showDiagnostics ? '▲' : '▼'}</span>
                </button>

                {showDiagnostics && (
                  <div className="p-2.5 bg-slate-900 text-slate-100 rounded-lg text-[10px] font-mono max-h-48 overflow-y-auto space-y-1.5">
                    <div className="text-amber-400 font-bold border-b border-slate-800 pb-1 flex justify-between">
                      <span>Project: linebazar-47669</span>
                      <span>Domain: {window.location.hostname}</span>
                    </div>
                    {diagnosticLogs.length === 0 ? (
                      <div className="text-slate-500 py-1">কোনো এরর বা ইভেন্ট রেকর্ড হয়নি।</div>
                    ) : (
                      diagnosticLogs.map((log, idx) => (
                        <div key={idx} className="border-b border-slate-800/60 pb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">[{log.timestamp}]</span>
                            <span
                              className={
                                log.type === 'error'
                                  ? 'text-rose-400 font-bold'
                                  : log.type === 'warn'
                                  ? 'text-amber-300 font-bold'
                                  : 'text-emerald-400'
                              }
                            >
                              [{log.phase.toUpperCase()}]
                            </span>
                            {log.code && <span className="text-rose-300">({log.code})</span>}
                          </div>
                          <div className="text-slate-300 pl-2 mt-0.5 break-all">{log.message}</div>
                          {log.details && (
                            <pre className="text-[9px] text-slate-500 pl-2 mt-0.5 overflow-x-auto">
                              {JSON.stringify(log.details)}
                            </pre>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export const AuthModal = PhoneAuthModal;
export default PhoneAuthModal;
