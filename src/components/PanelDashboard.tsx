"use client";

import { Copy, LogIn } from "lucide-react";
import { useMemo, useState } from "react";
import { ALLOWED_ADMIN_EMAILS } from "@/lib/admin";
import { mockAppointments } from "@/lib/mock-data";
import type { Appointment, AppointmentStatus } from "@/types/appointments";

const labels: Record<AppointmentStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Completada"
};

export function PanelDashboard() {
  const [logged, setLogged] = useState(false);
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<"all" | AppointmentStatus>("all");
  const [items, setItems] = useState<Appointment[]>(mockAppointments);
  const filtered = useMemo(
    () => items.filter((item) => (!date || item.date === date) && (status === "all" || item.status === status)),
    [items, date, status]
  );

  function updateStatus(id: string, next: AppointmentStatus) {
    setItems((all) => all.map((item) => (item.id === id ? { ...item, status: next } : item)));
  }

  if (!logged) {
    return (
      <main className="page">
        <div className="shell">
          <header className="top"><div><p className="eyebrow">Panel interno</p><h1 className="title">Agenda Mas Sano</h1></div></header>
          <section className="card panel-card">
            <h2>Acceso administrativo</h2>
            <p className="copy">Preparado para Supabase Auth con Google. Solo podran entrar las cuentas autorizadas.</p>
            <div className="summary">
              {ALLOWED_ADMIN_EMAILS.map((email) => <div className="row" key={email}><span>Permitido</span><strong>{email}</strong></div>)}
            </div>
            <div className="actions"><button className="primary" onClick={() => setLogged(true)} type="button"><LogIn size={18} />Entrar con Google</button></div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="top"><div><p className="eyebrow">Panel interno</p><h1 className="title">Citas</h1></div><button className="secondary" onClick={() => setLogged(false)} type="button">Salir</button></header>
        <section className="card panel-card">
          <div className="filters">
            <div className="field"><label htmlFor="dateFilter">Fecha</label><input id="dateFilter" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
            <div className="field"><label htmlFor="statusFilter">Estado</label><select id="statusFilter" value={status} onChange={(event) => setStatus(event.target.value as "all" | AppointmentStatus)}><option value="all">Todos</option><option value="pending">Pendiente</option><option value="confirmed">Confirmada</option><option value="cancelled">Cancelada</option><option value="completed">Completada</option></select></div>
          </div>
          <div className="list">
            {filtered.map((item) => (
              <article className="apt" key={item.id}>
                <div><strong>{item.firstName} {item.lastName}</strong><p className="copy">{item.date} - {item.time} - {item.whatsapp}</p></div>
                <span className="badge">{labels[item.status]}</span>
                <div className="actions">
                  <select value={item.status} onChange={(event) => updateStatus(item.id, event.target.value as AppointmentStatus)}><option value="pending">Pendiente</option><option value="confirmed">Confirmada</option><option value="cancelled">Cancelada</option><option value="completed">Completada</option></select>
                  <button className="secondary" onClick={() => navigator.clipboard.writeText(item.whatsapp)} type="button"><Copy size={17} />Copiar</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
