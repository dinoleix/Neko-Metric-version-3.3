
import { initializeApp } from '@firebase/app';
// Use @firebase/auth for modular imports to avoid missing export errors in this environment.
import { getAuth } from '@firebase/auth';
import { getFirestore } from '@firebase/firestore';
import { getStorage } from '@firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyB3j7skPl-ykXVLxFQEvCZLrQEYslc0e5w",
  authDomain: "nekometrics-b38b9.firebaseapp.com",
  projectId: "nekometrics-b38b9",
  storageBucket: "nekometrics-b38b9.firebasestorage.app",
  messagingSenderId: "330123207916",
  appId: "1:330123207916:web:fb2f2a21e66229fe73f1c9"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);