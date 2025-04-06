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
      console.error(err);
      setError("Errore durante il login.");
    } finally {
      setLoading(false);
    }
  };

  const chiediNomeCognome = async () => {
    const nome = prompt("Inserisci il tuo nome completo (es. Giulia Rossi):");
    if (!nome) return null;
    await setDoc(doc(db, 'utenti', user.uid), { nome });
    setUserInfo({ nome });
    return nome;
  };

  const inviaEmail = (email, nome, data) => {
    if (!email) return;
    emailjs.send(SERVICE_ID, TEMPLATE_ID, {
      to_email: email,
      nome,
      data
    }, USER_ID).catch(console.error);
  };

  const entroOre = (dataString, ore) => {
    const now = new Date();
    const dataTurno = new Date(dataString + "T00:00");
    const diffOre = (dataTurno - now) / (1000 * 60 * 60);
    return diffOre <= ore;
  };

  const gestisciPrenotazione = async (turnoId) => {
    const turnoRef = doc(db, 'turni', turnoId);
    const turnoSnap = await getDoc(turnoRef);
    const turno = turnoSnap.data();
    const partecipanti = turno.partecipanti || [];
    const attesa = turno.attesa || [];
    let nomeUtente = userInfo?.nome;

    if (!nomeUtente) {
      nomeUtente = await chiediNomeCognome();
      if (!nomeUtente) return;
    }

    const isInPartecipanti = partecipanti.some(p => p.uid === user.uid);
    const isInAttesa = attesa.some(p => p.uid === user.uid);

    if (isInPartecipanti && entroOre(turno.data, 48)) {
      alert("Non puoi annullare la prenotazione nelle 48h precedenti al turno.");
      return;
    }
    if (isInAttesa && entroOre(turno.data, 24)) {
      alert("Non puoi uscire dalla lista d’attesa nelle 24h precedenti al turno.");
      return;
    }

    const tuttePrenotazioni = await Promise.all(
      turni.map(async t => {
        const ref = doc(db, 'turni', t.id);
        const snap = await getDoc(ref);
        return { id: t.id, ref, dati: snap.data() };
      })
    );

    if (!isInPartecipanti && tuttePrenotazioni.some(t =>
      t.id !== turnoId && t.dati.partecipanti?.some(p => p.uid === user.uid))) {
      alert("Sei già prenotato in un altro turno.");
      return;
    }

    if (isInPartecipanti) {
      const nuoviPartecipanti = partecipanti.filter(p => p.uid !== user.uid);
      let nuovoPartecipante = null;

      if (attesa.length > 0) {
        nuovoPartecipante = attesa[0];
        nuoviPartecipanti.push(nuovoPartecipante);
        inviaEmail(nuovoPartecipante.email, nuovoPartecipante.nome, turno.data);

        for (const t of tuttePrenotazioni) {
          if (t.id !== turnoId) {
            const nuovaLista = t.dati.attesa?.filter(p => p.uid !== nuovoPartecipante.uid) || [];
            await updateDoc(t.ref, { attesa: nuovaLista });
          }
        }
      }

      await updateDoc(turnoRef, {
        partecipanti: nuoviPartecipanti,
        attesa: attesa.slice(nuovoPartecipante ? 1 : 0)
      });

      alert("Hai annullato la prenotazione.");

    } else if (isInAttesa) {
      await updateDoc(turnoRef, {
        attesa: attesa.filter(p => p.uid !== user.uid)
      });
      alert("Sei stato rimosso dalla lista d’attesa.");

    } else if (partecipanti.length < 3) {
      const nuovo = { uid: user.uid, nome: nomeUtente, email: user.email };
      await updateDoc(turnoRef, {
        partecipanti: [...partecipanti, nuovo]
      });
      inviaEmail(user.email, nomeUtente, turno.data);

      for (const t of tuttePrenotazioni) {
        if (t.id !== turnoId) {
          const nuovaLista = t.dati.attesa?.filter(p => p.uid !== user.uid) || [];
          await updateDoc(t.ref, { attesa: nuovaLista });
        }
      }

      alert("Prenotazione effettuata!");

    } else if (attesa.length < 5) {
      const nuovo = { uid: user.uid, nome: nomeUtente, email: user.email };
      await updateDoc(turnoRef, {
        attesa: [...attesa, nuovo]
      });
      alert("Turno pieno. Sei stato inserito in lista d’attesa.");
    } else {
      alert("Turno pieno e lista d’attesa completa.");
    }
  };

  const turniPrenotati = turni.filter(t =>
    t.partecipanti?.some(p => p.uid === user?.uid));
  const turniInAttesa = turni.filter(t =>
    t.attesa?.some(p => p.uid === user?.uid));

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-tr from-white to-blue-100">
        <h1 className="text-4xl font-bold mb-6 text-[#8C1515]">Prenotazione Turni</h1>
        <p className="text-gray-600 mb-4">Accedi con la tua email UniRoma1</p>
        {loading ? <p>Caricamento...</p> : (
          <button onClick={login} className="px-6 py-3 bg-[#8C1515] text-white rounded-lg text-lg">
            Login con email UniRoma1
          </button>
        )}
        {error && <p className="text-red-500 mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-gray-50 p-6">
      <h1 className="titolo-principale">Prenotazione Turni Sala Operatoria</h1>

      {turniPrenotati.length > 0 && (
        <div className="lista-turni max-w-xl mx-auto mb-6">
          <h2 className="text-lg font-semibold text-green-700 mb-2">📌 Turni prenotati</h2>
          <ul className="list-disc list-inside text-gray-700">
            {turniPrenotati.map(t => <li key={t.id}>{t.data}</li>)}
          </ul>
        </div>
      )}

      {turniInAttesa.length > 0 && (
        <div className="lista-attesa max-w-xl mx-auto mb-6">
          <h2 className="text-lg font-semibold text-purple-700 mb-2">🔄 In lista d’attesa per:</h2>
          <ul className="list-disc list-inside text-gray-700">
            {turniInAttesa.map(t => <li key={t.id}>{t.data}</li>)}
          </ul>
        </div>
      )}

      {turni.length === 0 ? (
        <p className="nessun-turno">Nessun turno disponibile.</p>
      ) : (
        <div className="grid gap-8 max-w-3xl mx-auto">
          {turni.map(turno => {
            const partecipanti = turno.partecipanti || [];
            const attesa = turno.attesa || [];
            const isInPartecipanti = partecipanti.some(p => p.uid === user.uid);
            const isInAttesa = attesa.some(p => p.uid === user.uid);
            const pieno = partecipanti.length >= 3;

            return (
              <div
                key={turno.id}
                className={`card-turno ${isInPartecipanti ? 'border-green-500' : isInAttesa ? 'border-purple-500' : ''}`}
              >
                <div className="text-xl font-semibold text-gray-800 mb-1">📅 {turno.data}</div>
                <div className="text-sm text-gray-600">👥 Posti: {partecipanti.length}/3</div>
                <div className="text-sm text-gray-600 mb-2">🕓 Lista d’attesa: {attesa.length}/5</div>
                <div className="text-sm text-gray-700 mb-1"><strong>Prenotati:</strong> {partecipanti.map(p => p.nome).join(', ') || 'Nessuno'}</div>
                <div className="text-sm text-gray-700 mb-4"><strong>In attesa:</strong> {attesa.map(p => p.nome).join(', ') || 'Nessuno'}</div>
                <button
                  onClick={() => gestisciPrenotazione(turno.id)}
                  disabled={pieno && attesa.length >= 5 && !isInPartecipanti && !isInAttesa}
                  className={`w-full py-2 rounded-md text-white font-semibold shadow-sm transition ${
                    isInPartecipanti || isInAttesa
                      ? 'bg-red-500 hover:bg-red-600'
                      : pieno
                      ? attesa.length < 5
                        ? 'bg-yellow-500 hover:bg-yellow-600'
                        : 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
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
      )}
    </div>
  );
}

export default App;
