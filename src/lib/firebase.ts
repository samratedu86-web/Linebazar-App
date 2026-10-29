import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth
export const auth = getAuth(app);

// Initialize Cloud Firestore using firestoreDatabaseId from the config
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Initialize Firebase Realtime Database
export const rtdb = getDatabase(app);

// Initialize Firebase Storage explicitly targeting configured bucket
export const storage = getStorage(app, firebaseConfig.storageBucket);

export { firebaseConfig };
export default app;
