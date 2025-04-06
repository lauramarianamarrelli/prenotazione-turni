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
    } catch (err) {
      console.error("Errore durante il login:", err);
      setError("Si è verificato un errore durante il login. Per favore riprova.");
    }
    setLoading(false);
  };

  const chiediNomeCognome = async () => {
    const nome = prompt("Inserisci il tuo nome completo (es. Giulia Rossi):");
    const emailNotifiche = prompt("Inserisci l'email su cui ricevere conferme:");
    if (!nome || !emailNotifiche) return null;
    const data = { nome, emailNotifiche };
    await setDoc(doc(db, 'utenti', user.uid), data);
    setUserInfo(data);
    return data;
  };

  const inviaEmail = (email, nome, data) => {
    if (!email) return;
    emailjs
      .send(SERVICE_ID, TEMPLATE_ID, { to_email: email, nome, data }, USER_ID)
      .then((res) => console.log('📨 Email inviata', res))
      .catch((err) => console.error('❌ Errore email:', err));
  };

  const entroLeOre = (dataTurno, ore) => {
    const now = new Date();
    const turnoData = new Date(`${dataTurno}T00:00:00`);
    const diffOre = (turnoData - now) / (1000 * 60 * 60);
    return diffOre <= ore;
  };

  const gestisciPrenotazione = async (turnoId) => {
    const turnoRef = doc(db, 'turni', turnoId);
    const turnoSnap = await getDoc(turnoRef);
    const turno = turnoSnap.data();

    if (!userInfo?.nome || !userInfo?.emailNotifiche) {
      const info = await chiediNomeCognome();
      if (!info) return;
    }

    const partecipanti = turno.partecipanti || [];
    const attesa = turno.attesa || [];

    const isInPartecipanti = partecipanti.some(p => p.uid === user.uid);
    const isInAttesa = attesa.some(p => p.uid === user.uid);

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
      alert("Sei già prenotato in un altro turno e non puoi iscriverti alla lista d'attesa.");
      return;
    }

    if (isInPartecipanti) {
      if (entroLeOre(turno.data, 48)) {
        alert("Non puoi annullare la prenotazione nelle 48 ore precedenti.");
        return;
      }

      const nuoviPartecipanti = partecipanti.filter(p => p.uid !== user.uid);
      let nuovoPartecipante = null;

      if (attesa.length > 0) {
        nuovoPartecipante = attesa[0];
        nuoviPartecipanti.push(nuovoPartecipante);
        inviaEmail(nuovoPartecipante.email, nuovoPartecipante.nome, turno.data);

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

      alert('Hai annullato la prenotazione.');

    } else if (isInAttesa) {
      await updateDoc(turnoRef, {
        attesa: attesa.filter(p => p.uid !== user.uid)
      });
      alert('Sei stato rimosso dalla lista d’attesa.');

    } else if (partecipanti.length < 3) {
      const nuovo = { uid: user.uid, nome: userInfo.nome, email: userInfo.emailNotifiche };
      await updateDoc(turnoRef, {
        partecipanti: [...partecipanti, nuovo]
      });
      alert('Prenotazione effettuata con successo!');
      inviaEmail(userInfo.emailNotifiche, userInfo.nome, turno.data);

      for (const t of tuttePrenotazioni) {
        if (t.id !== turnoId && t.dati.attesa?.some(p => p.uid === user.uid)) {
          const nuovaLista = t.dati.attesa.filter(p => p.uid !== user.uid);
          await updateDoc(t.ref, { attesa: nuovaLista });
        }
      }

    } else if (attesa.length < 5 && !giàPrenotatoAltrove) {
      const nuovo = { uid: user.uid, nome: userInfo.nome, email: userInfo.emailNotifiche };
      await updateDoc(turnoRef, {
        attesa: [...attesa, nuovo]
      });
      alert('Il turno è pieno. Sei stato inserito in lista d’attesa.');

    } else {
      alert('Turno pieno e lista d’attesa completa, oppure sei già prenotato.');
    }
  };

  const turniPrenotati = turni.filter(t =>
    t.partecipanti?.some(p => p.uid === user?.uid)
  );

  const turniInAttesa = turni.filter(t =>
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
            {turniPrenotati.map(t => <li key={t.id}>{t.data}</li>)}
          </ul>
        </div>
      )}

      {turniInAttesa.length > 0 && (
        <div className="lista-turni max-w-xl mx-auto mb-8 border-purple-500">
          <h2 className="text-lg font-semibold text-purple-700 mb-2">Sei in lista d’attesa per:</h2>
          <ul className="list-disc list-inside text-gray-700">
            {turniInAttesa.map(t => <li key={t.id}>{t.data}</li>)}
          </ul>
        </div>
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
              className={`card-turno mt-6 ${
                isInPartecipanti ? 'border-green-500' : isInAttesa ? 'border-purple-500 bg-purple-100' : ''
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
                      ? 'bg-purple-600 hover:bg-purple-700'
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
