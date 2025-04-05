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
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
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
    emailjs
      .send(SERVICE_ID, TEMPLATE_ID, {
        to_email: email,
        nome,
        data
      }, USER_ID)
      .then((response) => {
        console.log("✅ Email inviata con successo:", response.status, response.text);
      })
      .catch((error) => {
        console.error("❌ Errore nell'invio dell'email:", error);
      });
  };

  const gestisciPrenotazione = async (turnoId) => {
    const turnoRef = doc(db, 'turni', turnoId);
    const turnoSnap = await getDoc(turnoRef);
    const turno = turnoSnap.data();

    let nomeUtente = userInfo?.nome;
    if (!nomeUtente) {
      nomeUtente = await chiediNomeCognome();
      if (!nomeUtente) return;
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
      const nuovo = { uid: user.uid, nome: nomeUtente, email: user.email };
      await updateDoc(turnoRef, {
        partecipanti: [...partecipanti, nuovo]
      });
      alert('Prenotazione effettuata con successo!');
      inviaEmail(user.email, nomeUtente, turno.data);

      for (const t of tuttePrenotazioni) {
        if (t.id !== turnoId && t.dati.attesa?.some(p => p.uid === user.uid)) {
          const nuovaLista = t.dati.attesa.filter(p => p.uid !== user.uid);
          await updateDoc(t.ref, { attesa: nuovaLista });
        }
      }

    } else if (attesa.length < 5 && !giàPrenotatoAltrove) {
      const nuovo = { uid: user.uid, nome: nomeUtente, email: user.email };
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

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-tr from-white to-blue-100">
        <h1 className="text-4xl font-bold mb-6 text-[#8C1515] tracking-tight">Prenotazione Turni</h1>
        <p className="text-gray-600 mb-4">Accedi con la tua email UniRoma1 per prenotarti</p>
        <button
          onClick={login}
          className="px-6 py-3 bg-[#8C1515] text-white rounded-lg text-lg font-medium hover:bg-[#6d1010] transition shadow"
        >
          Login con email UniRoma1
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-gray-50 p-6">
      <h1 className="titolo-principale">
        Prenotazione Turni Sala Operatoria
      </h1>


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
              className={`card-turno ${isInPartecipanti ? 'border-green-500' : ''}`}
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
