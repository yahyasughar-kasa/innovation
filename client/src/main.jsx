import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function Auth({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "STUDENT" });
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault(); setError("");
    try {
      const data = await api("/auth/" + mode, { method: "POST", body: JSON.stringify(form) });
      onAuth(data.user);
    } catch (e) { setError(e.message); }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <p className="eyebrow">ClassTrack</p>
      <h1>GPS Attendance</h1>
      <p className="muted">Attendance is accepted only inside the configured classroom geofence.</p>
      <form onSubmit={submit}>
        {mode === "register" && <input required placeholder="Full name" value={form.name} onChange={e => setForm({...form,name:e.target.value})} />}
        <input required type="email" placeholder="Email" value={form.email} onChange={e => setForm({...form,email:e.target.value})} />
        <input required type="password" placeholder="Password" value={form.password} onChange={e => setForm({...form,password:e.target.value})} />
        {mode === "register" && <select value={form.role} onChange={e => setForm({...form,role:e.target.value})}><option value="STUDENT">Student</option><option value="TEACHER">Teacher</option></select>}
        {error && <div className="error">{error}</div>}
        <button>{mode === "login" ? "Sign in" : "Create account"}</button>
      </form>
      <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Create an account" : "Back to sign in"}
      </button>
    </section>
  </main>;
}

function StudentDashboard() {
  const [sessions, setSessions] = useState([]);
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState("");

  async function load() {
    const [s, h] = await Promise.all([api("/sessions/active"), api("/attendance/mine")]);
    setSessions(s.sessions); setHistory(h.attendance);
  }
  useEffect(() => { load().catch(e => setMessage(e.message)); }, []);

  function attend(sessionId) {
    setMessage("Requesting your location…");
    if (!navigator.geolocation) return setMessage("Geolocation is not supported by this browser.");
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const result = await api("/attendance", {
          method: "POST",
          body: JSON.stringify({
            sessionId,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyM: pos.coords.accuracy
          })
        });
        setMessage(`Attendance recorded. You are ${Math.round(result.attendance.distanceM)}m from the classroom.`);
        load();
      } catch (e) { setMessage(e.message); }
    }, error => setMessage(`Location unavailable: ${error.message}`), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }

  return <Dashboard title="Student dashboard">
    <section className="panel"><h2>Active classes</h2>
      {sessions.length === 0 ? <p className="muted">No active attendance sessions.</p> : sessions.map(s =>
        <article className="item" key={s.id}><div><strong>{s.title}</strong><p>{s.classroom.name} · radius {s.classroom.radiusM}m</p></div><button onClick={() => attend(s.id)}>Log attendance</button></article>
      )}
    </section>
    <section className="panel"><h2>My attendance</h2>
      {history.map(a => <article className="item" key={a.id}><div><strong>{a.session.title}</strong><p>{a.session.classroom.name}</p></div><span>{new Date(a.recordedAt).toLocaleString()}</span></article>)}
    </section>
  </Dashboard>;
}

function TeacherDashboard() {
  const [classrooms, setClassrooms] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [form, setForm] = useState({name:"",latitude:"0.3476",longitude:"32.5825",radiusM:"30",title:"",startsAt:"",endsAt:""});
  const [message, setMessage] = useState("");

  async function load() { const d = await api("/classrooms"); setClassrooms(d.classrooms); }
  useEffect(() => { load().catch(e => setMessage(e.message)); }, []);

  async function createClassroom(e) {
    e.preventDefault();
    try { await api("/classrooms",{method:"POST",body:JSON.stringify({...form,latitude:Number(form.latitude),longitude:Number(form.longitude),radiusM:Number(form.radiusM)})}); setMessage("Classroom created."); load(); }
    catch(e){setMessage(e.message);}
  }

  async function createSession(e) {
    e.preventDefault();
    try {
      const classroomId = form.classroomId || classrooms[0]?.id;
      if (!classroomId) throw new Error("Create a classroom first.");
      await api("/sessions",{method:"POST",body:JSON.stringify({classroomId,title:form.title,startsAt:form.startsAt,endsAt:form.endsAt})});
      setMessage("Attendance session created."); load();
    } catch(e){setMessage(e.message);}
  }

  async function viewAttendance(id) {
    try { const d = await api("/attendance/session/"+id); setAttendance(d.attendance); } catch(e){setMessage(e.message);}
  }

  return <Dashboard title="Teacher dashboard">
    <section className="grid2">
      <form className="panel" onSubmit={createClassroom}><h2>Create classroom</h2>
        <input required placeholder="Classroom name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
        <div className="row"><input required type="number" step="any" placeholder="Latitude" value={form.latitude} onChange={e=>setForm({...form,latitude:e.target.value})}/><input required type="number" step="any" placeholder="Longitude" value={form.longitude} onChange={e=>setForm({...form,longitude:e.target.value})}/></div>
        <input required type="number" min="5" max="500" placeholder="Radius (m)" value={form.radiusM} onChange={e=>setForm({...form,radiusM:e.target.value})}/>
        <button>Create classroom</button>
      </form>
      <form className="panel" onSubmit={createSession}><h2>Create attendance session</h2>
        <select required value={form.classroomId || classrooms[0]?.id || ""} onChange={e=>setForm({...form,classroomId:e.target.value})}>{classrooms.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input required placeholder="Session title" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
        <input required type="datetime-local" value={form.startsAt} onChange={e=>setForm({...form,startsAt:e.target.value})}/>
        <input required type="datetime-local" value={form.endsAt} onChange={e=>setForm({...form,endsAt:e.target.value})}/>
        <button>Create session</button>
      </form>
    </section>
    {message && <div className="notice">{message}</div>}
    <section className="panel"><h2>Your classrooms</h2>
      {classrooms.map(c => <div key={c.id}><h3>{c.name}</h3><p className="muted">{c.latitude}, {c.longitude} · {c.radiusM}m radius</p>{c.sessions.map(s=><article className="item" key={s.id}><div><strong>{s.title}</strong><p>{new Date(s.startsAt).toLocaleString()} – {new Date(s.endsAt).toLocaleString()}</p></div><button onClick={()=>viewAttendance(s.id)}>View attendance</button></article>)}</div>)}
    </section>
    <section className="panel"><h2>Attendance records</h2>
      {attendance.length === 0 ? <p className="muted">Select a session to view records.</p> : attendance.map(a=><article className="item" key={a.id}><div><strong>{a.student.name}</strong><p>{a.student.email}</p></div><span>{Math.round(a.distanceM)}m · {new Date(a.recordedAt).toLocaleString()}</span></article>)}
    </section>
  </Dashboard>;
}

function Dashboard({title,children}) {
  const [user,setUser]=useState(null);
  useEffect(()=>{api("/auth/me").then(d=>setUser(d.user)).catch(()=>{});},[]);
  async function logout(){await api("/auth/logout",{method:"POST"}); location.reload();}
  return <main className="app"><header><div><p className="eyebrow">ClassTrack</p><h1>{title}</h1>{user&&<p className="muted">{user.name} · {user.role}</p>}</div><button className="secondary" onClick={logout}>Sign out</button></header>{children}</main>;
}

function App() {
  const [user,setUser]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{api("/auth/me").then(d=>setUser(d.user)).catch(()=>{}).finally(()=>setLoading(false));},[]);
  if(loading) return <main className="auth-shell"><p>Loading…</p></main>;
  if(!user) return <Auth onAuth={setUser}/>;
  return user.role === "TEACHER" ? <TeacherDashboard/> : <StudentDashboard/>;
}

createRoot(document.getElementById("root")).render(<App />);
