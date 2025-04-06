import { useEffect, useState } from 'react';
import { auth, db } from './lib/firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import {
  collection, onSnapshot, doc, updateDoc, arrayUnion, getDoc
} from 'firebase/firestore';

function App() {
  const [user, setUser] = useState(null);
  const [turni, setTurni] = useState([]);
  const [prenotazione, setPrenotazione] = useState(null);

  useEffect(() => {
    auth.onAuthStateChanged((u) => {
      if (u && u.email.endsWith("@studenti.uniroma1.it")) {
        setUser(u);
      } else {
        setUser(null);
      }
    });

    const unsub = onSnapshot(collection(db, "turni"), (snapshot) => {
      const dati = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log("Turni caricati:", dati);
      setTurni(dati);
    });
    return () => unsub();
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const prenota = async (turnoId) => {
    const turnoRef = doc(db, "turni", turnoId);
    const turnoSnap = await getDoc(turnoRef);
    const turno = turnoSnap.data();

    if (turno.partecipanti?.includes(user.uid) || prenotazione) return;

    if ((turno.partecipanti?.length || 0) < 3) {
      await updateDoc(turnoRef, {
        partecipanti: arrayUnion(user.uid)
      });
      setPrenotazione(turnoId);
    } else if ((turno.attesa?.length || 0) < 5) {
      await updateDoc(turnoRef, {
        attesa: arrayUnion(user.uid)
      });
    }
  };

  if (!user) {
    return <div style={{ padding: "20px" }}>
      <button onClick={login}>Login con email UniRoma1</button>
    </div>;
  }

  return (
    <div style={{ padding: "20px" }}>
      <h1>Prenotazione Turni Sala Operatoria</h1>
      {turni.length === 0 && <p>Nessun turno disponibile.</p>}
      {turni.map(turno => {
        const posti = turno.partecipanti?.length || 0;
        const attesa = turno.attesa?.length || 0;
        const pieno = posti >= 3;

        return (
          <div key={turno.id} style={{ border: '1px solid #ccc', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <div><strong>Data:</strong> {turno.data}</div>
            <div><strong>Posti:</strong> {posti}/3</div>
            <div><strong>Lista d’attesa:</strong> {attesa}/5</div>
            <button
              disabled={prenotazione || (pieno && attesa >= 5)}
              onClick={() => prenota(turno.id)}
            >
              {pieno ? (attesa < 5 ? "Unisciti alla lista" : "Pieno") : "Prenota"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default App;
