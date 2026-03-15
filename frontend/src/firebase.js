// src/firebase.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

const firebaseConfig = {
  apiKey:     import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:  import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:      import.meta.env.VITE_FIREBASE_APP_ID,
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// ── Phone auth helpers ─────────────────────────────────────────────
export function setupRecaptcha(containerId) {
  // invisible recaptcha — user never sees it
  window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
    callback: () => {},
  });
  return window.recaptchaVerifier;
}

export async function sendOTP(phoneNumber) {
  const verifier = window.recaptchaVerifier;
  const result   = await signInWithPhoneNumber(auth, phoneNumber, verifier);
  window.confirmationResult = result;
  return result;
}

export async function verifyOTP(code) {
  const result = await window.confirmationResult.confirm(code);
  return result.user;
}

export { signOut, onAuthStateChanged };
