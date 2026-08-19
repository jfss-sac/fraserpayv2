
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, setDoc, doc, getDoc, query, collection, where, getDocs, addDoc } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY2,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN2,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID2,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET2,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID2,
    appId: import.meta.env.VITE_FIREBASE_APP_ID2
}


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);
const functions = getFunctions(app);
const storage = getStorage(app);

const parsePort = (value: string | undefined, fallback: number): number => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
};

// Create Google Auth Provider with domain restriction
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  hd: 'pdsb.net' // Restrict to this specific domain
});

// Enable local emulators only when explicitly requested by the local env file.
// This keeps deployed builds pointed at their configured Firebase project.
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_USE_EMULATORS === "true") {
  try {
    const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || "127.0.0.1";
    const authPort = parsePort(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT, 9199);
    const firestorePort = parsePort(import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT, 8180);

    console.log(`Using Firebase emulators at ${host} (Auth ${authPort}, Firestore ${firestorePort})`);
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(firestore, host, firestorePort);
  } catch (error) {
    console.error("Error connecting to Firebase emulators:", error);
  }
} else {
  console.log("Firebase emulators are disabled");
}

// Function to clear Firebase auth state (useful for troubleshooting)
export const clearFirebaseAuth = async () => {
  try {
    await auth.signOut();
    localStorage.removeItem('firebase:authUser');
    console.log('Firebase auth cleared');
  } catch (error) {
    console.error('Error clearing auth:', error);
  }
};

export { app, auth, firestore, functions, storage };
