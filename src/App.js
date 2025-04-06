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
    } finally {
      setLoading(false);
    }
  };

  const chiediNomeCognomeEmail = async () => {
    const nome = prompt("Inserisci il tuo nome completo:");
    const emailNotifiche = prompt("Inserisci l'email su cui ricevere le notifiche:");
    if (!nome || !emailNotifiche) return null;
    const dati = { nome, emailNotifiche };
    await setDoc(doc(db, 'utenti', user.uid), dati);
    setUserInfo(dati);
    return dati;
  };

  const inviaEmail = (to_email, nome, data) => {
    if (!to_email) return;
    emailjs
      .send(SERVICE_ID, TEMPLATE_ID, { to_email, nome, data }, USER_ID)
      .then((res) => {
        console.log("📧 Email inviata:", res.status);
      })
      .catch((err) => {
        console.error("❌ Errore invio email:", err);
      });
  };

  const oreMancanti = (dataTurno) => {
    const data = new Date(dataTurno);
    const now = new Date();
    return (data - now) / (1000 * 60 * 60);
  };

  const gestisciPrenotazione = async (turnoId) => {
    const turnoRef = doc(db, 'turni', turnoId);
    const turnoSnap = await getDoc(turnoRef);
    const turno = turnoSnap.data();
    const oreAllaData = oreMancanti(turno.data);

    let datiUtente = userInfo;
    if (!datiUtente?.nome || !datiUtente?.emailNotifiche) {
      datiUtente = await chiediNomeCognomeEmail();
      if (!datiUtente) return;
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
      alert("Sei già prenotato altrove e non puoi unirti ad altre liste.");
      return;
    }

    if (isInPartecipanti) {
      if (oreAllaData < 48) {
        alert("Non puoi annullare la prenotazione nelle 48h precedenti.");
        return;
      }

      const nuoviPartecipanti = partecipanti.filter(p => p.uid !== user.uid);
      let nuovoPartecipante = null;

      if (attesa.length > 0) {
        nuovoPartecipante = attesa[0];
        nuoviPartecipanti.push(nuovoPartecipante);
        inviaEmail(nuovoPartecipante.emailNotifiche, nuovoPartecipante.nome, turno.data);

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

      alert("Prenotazione annullata.");

    } else if (isInAttesa) {
      await updateDoc(turnoRef, {
        attesa: attesa.filter(p => p.uid !== user.uid)
      });
      alert("Rimosso dalla lista d'attesa.");

    } else if (partecipanti.length < 3) {
      const nuovo = { uid: user.uid, ...datiUtente };
      await updateDoc(turnoRef, {
        partecipanti: [...partecipanti, nuovo]
      });
      inviaEmail(datiUtente.emailNotifiche, datiUtente.nome, turno.data);

      for (const t of tuttePrenotazioni) {
        if (t.id !== turnoId && t.dati.attesa?.some(p => p.uid === user.uid)) {
          const nuovaLista = t.dati.attesa.filter(p => p.uid !== user.uid);
          await updateDoc(t.ref, { attesa: nuovaLista });
        }
      }

      alert("Prenotazione effettuata!");

    } else if (attesa.length < 5 && !giàPrenotatoAltrove) {
      const nuovo = { uid: user.uid, ...datiUtente };
      await updateDoc(turnoRef, {
        attesa: [...attesa, nuovo]
      });
      alert("Sei stato aggiunto alla lista d'attesa.");

    } else {
      alert("Turno pieno e lista completa.");
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#8C1515] text-white p-6">
        <h1 className="text-4xl font-bold mb-4">Prenotazione Turni</h1>
        <p className="mb-4">Accedi con la tua email UniRoma1 per continuare</p>
        {loading ? <p>Caricamento...</p> : (
          <button
            onClick={login}
            className="px-6 py-2 bg-white text-[#8C1515] rounded-lg shadow-md hover:bg-gray-200"
          >
            Login con email UniRoma1
          </button>
        )}
        {error && <p className="text-red-300 mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f7f7] p-6">
      <h1 className="titolo-principale">Prenotazione Turni Sala Operatoria</h1>

      {turniPrenotati.length > 0 && (
        <div className="lista-turni mb-8">
          <h2>I tuoi turni prenotati:</h2>
          <ul>
            {turniPrenotati.map(t => (
              <li key={t.id}>{t.data}</li>
            ))}
          </ul>
        </div>
      )}

      {turniAttesa.length > 0 && (
        <div className="lista-turni mb-8 border-purple-600 border-l-4">
          <h2>Turni in cui sei in lista d'attesa:</h2>
          <ul>
            {turniAttesa.map(t => (
              <li key={t.id}>{t.data}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 max-w-3xl mx-auto">
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
              className={`card-turno ${isInPartecipanti ? 'border-green-500 bg-green-100' : isInAttesa ? 'border-purple-500 bg-purple-100' : ''}`}
            >
              <div className="text-lg font-semibold">📅 {turno.data}</div>
              <div className="text-sm">👥 Posti: {posti}/3</div>
              <div className="text-sm mb-2">🕓 Lista d’attesa: {attesa.length}/5</div>

              <div className="text-sm"><strong>Prenotati:</strong> {partecipanti.map(p => p.nome).join(', ') || 'Nessuno'}</div>
              <div className="text-sm mb-4"><strong>In attesa:</strong> {attesa.map(p => p.nome).join(', ') || 'Nessuno'}</div>

              <button
                onClick={() => gestisciPrenotazione(turno.id)}
                className={`w-full py-2 rounded-md text-white font-semibold ${
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
