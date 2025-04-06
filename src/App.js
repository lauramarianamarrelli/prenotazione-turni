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
    });
    return () => unsub();
  }, [user]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const chiediNomeCognome = async () => {
    const nome = prompt("Inserisci il tuo nome completo:");
    if (!nome) return null;
    await setDoc(doc(db, 'utenti', user.uid), { nome });
    setUserInfo({ nome });
    return nome;
  };

  const inviaEmail = (email, nome, data) => {
    emailjs.send(SERVICE_ID, TEMPLATE_ID, {
      to_email: email,
      nome,
      data
    }, USER_ID).then((res) => {
      console.log("Email inviata", res);
    }).catch(console.error);
  };

  const gestisciPrenotazione = async (turnoId) => {
    const turnoRef = doc(db, 'turni', turnoId);
    const turnoSnap = await getDoc(turnoRef);
    const turno = turnoSnap.data();
    const dataTurno = new Date(turno.data + "T00:00:00");
    const now = new Date();
    const oreDiff = (dataTurno - now) / (1000 * 60 * 60);

    let nomeUtente = userInfo?.nome;
    if (!nomeUtente) {
      nomeUtente = await chiediNomeCognome();
      if (!nomeUtente) return;
    }

    const partecipanti = turno.partecipanti || [];
    const attesa = turno.attesa || [];

    const isInPartecipanti = partecipanti.some(p => p.uid === user.uid);
    const isInAttesa = attesa.some(p => p.uid === user.uid);

    const tuttePrenotazioni = await Promise.all(turni.map(async (t) => {
      const ref = doc(db, 'turni', t.id);
      const snap = await getDoc(ref);
      return { id: t.id, ref, dati: snap.data() };
    }));

    const giàPrenotatoAltrove = tuttePrenotazioni.some(t =>
      t.id !== turnoId && t.dati.partecipanti?.some(p => p.uid === user.uid)
    );

    if (isInPartecipanti && oreDiff < 48) {
      alert("Non puoi annullare la prenotazione nelle 48 ore precedenti al turno.");
      return;
    }

    if (isInAttesa && oreDiff < 24) {
      alert("Non puoi uscire dalla lista d’attesa nelle 24 ore precedenti al turno.");
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
      alert('Prenotazione annullata.');

    } else if (isInAttesa) {
      await updateDoc(turnoRef, {
        attesa: attesa.filter(p => p.uid !== user.uid)
      });
      alert('Rimosso dalla lista d’attesa.');

    } else if (partecipanti.length < 3) {
      const nuovo = { uid: user.uid, nome: nomeUtente, email: user.email };
      await updateDoc(turnoRef, { partecipanti: [...partecipanti, nuovo] });
      alert('Prenotazione confermata!');
      inviaEmail(user.email, nomeUtente, turno.data);

      for (const t of tuttePrenotazioni) {
        if (t.id !== turnoId && t.dati.attesa?.some(p => p.uid === user.uid)) {
          const nuovaLista = t.dati.attesa.filter(p => p.uid !== user.uid);
          await updateDoc(t.ref, { attesa: nuovaLista });
        }
      }

    } else if (attesa.length < 5 && !giàPrenotatoAltrove) {
      const nuovo = { uid: user.uid, nome: nomeUtente, email: user.email };
      await updateDoc(turnoRef, { attesa: [...attesa, nuovo] });
      alert('Aggiunto alla lista d’attesa.');
    } else {
      alert('Turno pieno, lista completa o sei già prenotato.');
    }
  };

  const turniPrenotati = turni.filter(t => t.partecipanti?.some(p => p.uid === user?.uid));
  const turniInAttesa = turni.filter(t => t.attesa?.some(p => p.uid === user?.uid));

  if (!user) {
    return (
      <div className="login">
        <h1>Prenotazione Turni Sala Operatoria</h1>
        <p>Accedi con la tua email UniRoma1</p>
        <button onClick={login}>Login con Google</button>
      </div>
    );
  }

  return (
    <div className="app">
      <h1 className="titolo-principale">Prenotazione Turni Sala Operatoria</h1>

      {turniPrenotati.length > 0 && (
        <div className="lista-turni">
          <h2>📌 I tuoi turni prenotati</h2>
          <ul>{turniPrenotati.map(t => <li key={t.id}>{t.data}</li>)}</ul>
        </div>
      )}

      {turniInAttesa.length > 0 && (
        <div className="lista-turni-attesa">
          <h2>⌛ Liste d’attesa</h2>
          <ul>{turniInAttesa.map(t => <li key={t.id}>{t.data}</li>)}</ul>
        </div>
      )}

      <div className="grid-turni">
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
              className={`card-turno ${isInPartecipanti ? 'prenotato' : isInAttesa ? 'attesa' : ''}`}
            >
              <div><strong>📅</strong> {turno.data}</div>
              <div><strong>👥</strong> {posti}/3</div>
              <div><strong>🕓</strong> {attesa.length}/5</div>

              <div><strong>Prenotati:</strong> {partecipanti.map(p => p.nome).join(', ') || '—'}</div>
              <div><strong>Attesa:</strong> {attesa.map(p => p.nome).join(', ') || '—'}</div>

              <button
                onClick={() => gestisciPrenotazione(turno.id)}
                disabled={pieno && attesa.length >= 5 && !isInAttesa && !isInPartecipanti}
              >
                {isInPartecipanti
                  ? 'Annulla'
                  : isInAttesa
                  ? 'Esci dalla lista'
                  : pieno
                  ? 'Lista d’attesa'
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

  );
}

export default App;
