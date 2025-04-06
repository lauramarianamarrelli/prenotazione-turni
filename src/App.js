import { useEffect, useState } from 'react';
import { auth, db } from './lib/firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  getDoc,
  setDoc
} from 'firebase/firestore';
import emailjs from 'emailjs-com';
import './App.css';

const SERVICE_ID = 'service_y5m4wln';
const TEMPLATE_ID = 'template_tr6ki6k';
const USER_ID = 'QfkVcpGyLwU8m5EiY';

function App() {
  const [user, setUser] = useState(null);
  const [turni, setTurni] = useState([]);
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (u) => {
      if (u && u.email.endsWith('@studenti.uniroma1.it')) {
        setUser(u);
        const docSnap = await getDoc(doc(db, 'utenti', u.uid));
        if (docSnap.exists()) {
          setUserInfo(docSnap.data());
        }
      } else {
        setUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'turni'), (snapshot) => {
      const dati = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setTurni(dati);
    }, (error) => {
      console.error('❌ Errore nel caricamento dei turni:', error);
    });
    return () => unsub();
  }, [user]);

  const login = async () => {
    setLoading(true);
    setError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setLoading(false);
    } catch (err) {
      console.error("Errore durante il login:", err);
      setError("Si è verificato un errore durante il login. Per favore riprova.");
      setLoading(false);
    }
  };

  const chiediDatiUtente = async () => {
    const nome = prompt("Inserisci il tuo nome completo:");
    const emailNotifiche = prompt("Inserisci la tua email per ricevere notifiche:");
    if (!nome || !emailNotifiche) return null;
    const info = { nome, emailNotifiche };
    await setDoc(doc(db, 'utenti', user.uid), info);
    setUserInfo(info);
    return info;
  };

  const inviaEmail = (email, nome, data) => {
    if (!email) return;
    emailjs
      .send(SERVICE_ID, TEMPLATE_ID, {
        to_email: email,
        nome,
        data
      }, USER_ID)
      .then((response) => {
        console.log("✅ Email inviata:", response.status);
      })
      .catch((error) => {
        console.error("❌ Email fallita:", error);
      });
  };

  const entroLeOre = (data, oreLimite) => {
    const oraTurno = new Date(data + 'T00:00:00');
    const oraLimite = new Date();
    oraLimite.setHours(oraLimite.getHours() + oreLimite);
    return oraTurno <= oraLimite;
  };

  const gestisciPrenotazione = async (turnoId) => {
    const turnoRef = doc(db, 'turni', turnoId);
    const turnoSnap = await getDoc(turnoRef);
    const turno = turnoSnap.data();

    let infoUtente = userInfo;
    if (!infoUtente?.nome || !infoUtente?.emailNotifiche) {
      const dati = await chiediDatiUtente();
      if (!dati) return;
      infoUtente = dati;
    }

    const partecipanti = turno.partecipanti || [];
    const attesa = turno.attesa || [];
    const isInPartecipanti = partecipanti.some(p => p.uid === user.uid);
    const isInAttesa = attesa.some(p => p.uid === user.uid);
    const dataTurno = turno.data;

    const tuttePrenotazioni = await Promise.all(
      turni.map(async (t) => {
        const ref = doc(db, 'turni', t.id);
        const snap = await getDoc(ref);
        return { id: t.id, ref, dati: snap.data() };
      })
    );

    const giàPrenotatoAltrove = tuttePrenotazioni.some(t =>
      t.id !== turnoId && t.dati.partecipanti?.some(p => p.uid === user.uid)
    );

    if (!isInPartecipanti && giàPrenotatoAltrove) {
      alert("Sei già prenotato in un altro turno e non puoi metterti in lista.");
      return;
    }

    // annulla prenotazione
    if (isInPartecipanti) {
      if (entroLeOre(dataTurno, 48)) {
        alert("Non puoi annullare la prenotazione nelle 48 ore precedenti.");
        return;
      }

      const nuoviPartecipanti = partecipanti.filter(p => p.uid !== user.uid);
      let nuovoPartecipante = null;

      if (attesa.length > 0) {
        nuovoPartecipante = attesa[0];
        nuoviPartecipanti.push(nuovoPartecipante);
        inviaEmail(nuovoPartecipante.email, nuovoPartecipante.nome, dataTurno);

        for (const t of tuttePrenotazioni) {
          if (t.id !== turnoId && t.dati.attesa?.some(p => p.uid === nuovoPartecipante.uid)) {
            const nuovaLista = t.dati.attesa.filter(p => p.uid !== nuovoPartecipante.uid);
            await updateDoc(t.ref, { attesa: nuovaLista });
          }
        }
      }

      await updateDoc(turnoRef, {
        partecipanti: nuoviPartecipanti,
        attesa: attesa.slice(nuovoPartecipante ? 1 : 0)
      });

      alert('Prenotazione annullata.');

    } else if (isInAttesa) {
      if (entroLeOre(dataTurno, 24)) {
        alert("Non puoi uscire dalla lista nelle 24 ore precedenti.");
        return;
      }

      await updateDoc(turnoRef, {
        attesa: attesa.filter(p => p.uid !== user.uid)
      });
      alert('Sei stato rimosso dalla lista.');

    } else if (partecipanti.length < 3) {
      const nuovo = { uid: user.uid, nome: infoUtente.nome, email: infoUtente.emailNotifiche };
      await updateDoc(turnoRef, {
        partecipanti: [...partecipanti, nuovo]
      });
      inviaEmail(infoUtente.emailNotifiche, infoUtente.nome, dataTurno);
      alert('Prenotazione effettuata.');

      for (const t of tuttePrenotazioni) {
        if (t.id !== turnoId && t.dati.attesa?.some(p => p.uid === user.uid)) {
          const nuovaLista = t.dati.attesa.filter(p => p.uid !== user.uid);
          await updateDoc(t.ref, { attesa: nuovaLista });
        }
      }

    } else if (attesa.length < 5) {
      const nuovo = { uid: user.uid, nome: infoUtente.nome, email: infoUtente.emailNotifiche };
      await updateDoc(turnoRef, {
        attesa: [...attesa, nuovo]
      });
      alert('Sei stato aggiunto alla lista.');

    } else {
      alert('Turno pieno e lista completa.');
    }
  };

  const turniPrenotati = turni.filter(t =>
    t.partecipanti?.some(p => p.uid === user?.uid)
  );
  const turniAttesa = turni.filter(t =>
    t.attesa?.some(p => p.uid === user?.uid)
  );

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-tr from-white to-blue-100">
        <h1 className="text-4xl font-bold mb-6 text-[#8C1515] tracking-tight">Prenotazione Turni</h1>
        <p className="text-gray-600 mb-4">Accedi con la tua email UniRoma1 per prenotarti</p>
        {loading ? (
          <p>Caricamento...</p>
        ) : (
          <button
            onClick={login}
            className="px-6 py-3 bg-[#8C1515] text-white rounded-lg text-lg font-medium hover:bg-[#6d1010] transition shadow"
          >
            Login con email UniRoma1
          </button>
        )}
        {error && <p className="text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-gray-50 p-6">
      <h1 className="titolo-principale">Prenotazione Turni Sala Operatoria</h1>

      {turniPrenotati.length > 0 && (
        <div className="lista-turni max-w-xl mx-auto mb-8">
          <h2 className="text-lg font-semibold text-green-700 mb-2">I tuoi turni prenotati:</h2>
          <ul className="list-disc list-inside text-gray-700">
            {turniPrenotati.map(t => (
              <li key={t.id}>{t.data}</li>
            ))}
          </ul>
        </div>
      )}

      {turniAttesa.length > 0 && (
        <div className="lista-turni max-w-xl mx-auto mb-8 border-l-4 border-purple-600 bg-purple-50 p-4 rounded">
          <h2 className="text-lg font-semibold text-purple-700 mb-2">Turni in cui sei in lista d’attesa:</h2>
          <ul className="list-disc list-inside text-gray-700">
            {turniAttesa.map(t => (
              <li key={t.id}>{t.data}</li>
            ))}
          </ul>
        </div>
      )}

      {turni.length === 0 && (
        <p className="text-center text-gray-500 text-lg">Nessun turno disponibile.</p>
      )}

      <div className="grid gap-8 max-w-3xl mx-auto">
        {turni.map((turno) => {
          const partecipanti = turno.partecipanti || [];
          const attesa = turno.attesa || [];
          const posti = partecipanti.length;
          const isInPartecipanti = partecipanti.some(p => p.uid === user.uid);
          const isInAttesa = attesa.some(p => p.uid === user.uid);
          const pieno = posti >= 3;

          return (
            <div
              key={turno.id}
              className={`card-turno mt-4 ${
                isInPartecipanti ? 'border-green-500' : isInAttesa ? 'border-purple-500 bg-purple-50' : ''
              }`}
            >
              <div className="text-xl font-semibold text-gray-800 mb-1">📅 {turno.data}</div>
              <div className="text-sm text-gray-600">👥 Posti: {posti}/3</div>
              <div className="text-sm text-gray-600 mb-3">🕓 Lista d’attesa: {attesa.length}/5</div>

              <div className="text-sm mb-1 text-gray-700">
                <strong>Prenotati:</strong> {partecipanti.map(p => p.nome).join(', ') || 'Nessuno'}
              </div>
              <div className="text-sm mb-4 text-gray-700">
                <strong>In attesa:</strong> {attesa.map(p => p.nome).join(', ') || 'Nessuno'}
              </div>

              <button
                onClick={() => gestisciPrenotazione(turno.id)}
                className={`w-full py-2 rounded-md text-white font-semibold shadow-sm ${
                  isInPartecipanti || isInAttesa
                    ? 'bg-red-500 hover:bg-red-600'
                    : pieno
                    ? attesa.length < 5
                      ? 'bg-yellow-500 hover:bg-yellow-600'
                      : 'bg-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700'
                } transition`}
                disabled={pieno && attesa.length >= 5 && !isInPartecipanti && !isInAttesa}
              >
                {isInPartecipanti
                  ? 'Annulla prenotazione'
                  : isInAttesa
                  ? 'Esci dalla lista'
                  : pieno
                  ? attesa.length < 5
                    ? 'Unisciti alla lista'
                    : 'Pieno'
                  : 'Prenota'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;
