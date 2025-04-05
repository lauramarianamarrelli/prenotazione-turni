// src/lib/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyCY6X17rq5xn5HZYnX_D3rawsQydkJi7Wg",
    authDomain: "turni-sala-operatoria.firebaseapp.com",
    projectId: "turni-sala-operatoria",
    storageBucket: "turni-sala-operatoria.firebasestorage.app",
    messagingSenderId: "137148561786",
    appId: "1:137148561786:web:3a1fd1de1677b484643ec3",
    measurementId: "G-DZFG8EDJN8"
  };

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
