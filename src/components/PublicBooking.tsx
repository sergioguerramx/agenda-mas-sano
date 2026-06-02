"use client";

import { CheckCircle2, Clock, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { buildAvailableDates, buildSlotsForDate, formatDisplayDate } from "@/lib/schedule";
import { normalizeMexicanWhatsapp } from "@/lib/whatsapp";
import type { AppointmentDraft } from "@/types/appointments";

type Step = "date" | "time" | "details" | "done";

const emptyDraft: AppointmentDraft = {
  firstName: "",
  lastName: "",
  whatsapp: "",
  date: "",
  time: ""
};

export function PublicBooking() {
  const [step, setStep] = useState<Step>("date");
  const [draft, setDraft] = useState<AppointmentDraft>(emptyDraft);
  const [error, setError] = useState("");
  const dates = useMemo(() => buildAvailableDates(new Date()), []);
  const slots = useMemo(() => (draft.date ? buildSlotsForDate(draft.date, new Date()) : []), [draft.date]);
  const selectedDate = dates.find((date) => date.iso === draft.date);
  const selectedSlot = slots.find((slot) => slot.time === draft.time);

  function confirm() {
    const whatsapp = normalizeMexicanWhatsapp(draft.whatsapp);

    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      setError("Agrega nombre y apellidos para continuar.");
      return;
    }

    if (!whatsapp) {
      setError("Escribe un WhatsApp mexicano valido de 10 digitos.");
      return;
    }

    setDraft((current) => ({ ...current, whatsapp }));
    setError("");
    setStep("done");
  }

  const waPhone = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "525512345678";
  const waText = encodeURIComponent(
    `Hola, confirme mi cita en Mas Sano para ${selectedDate?.label ?? ""} a las ${selectedSlot?.label ?? ""}.`
  );

  return (
    <main className="page">
      <div className="shell">
        <header className="top">
          <div className="brand">
            <div className="mark">MS</div>
            <div>
              <p className="eyebrow">Nutricion Holistica</p>
              <h1 className="title">Mas Sano</h1>
            </div>
          </div>
          <span className="pill"><Clock size={16} />20 min</span>
        </header>

        <section className="hero">
          <div>
            <h2>Agenda tu cita</h2>
            <p>Elige fecha y horario disponible para tu visita. Te mostraremos espacios cercanos y confirmacion por WhatsApp.</p>
            <p><span className="pill">15 dias adelante</span> <span className="pill">30 min de anticipacion</span></p>
          </div>

          <section className="card">
            <div className="steps">
              {[
                ["date", "Fecha"],
                ["time", "Horario"],
                ["details", "Datos"],
                ["done", "Final"]
              ].map(([key, label]) => (
                <button className={step === key ? "active" : ""} key={key} type="button">{label}</button>
              ))}
            </div>

            <div className="content">
              {step === "date" && (
                <section>
                  <h3>Selecciona fecha</h3>
                  <p className="copy">Miercoles y domingo permanecen cerrados.</p>
                  <div className="grid">
                    {dates.map((date) => (
                      <button
                        className={`choice ${draft.date === date.iso ? "selected" : ""}`}
                        disabled={date.closed}
                        key={date.iso}
                        onClick={() => {
                          setDraft({ ...draft, date: date.iso, time: "" });
                          setStep("time");
                        }}
                        type="button"
                      >
                        <strong>{date.shortLabel}</strong>
                        <span>{date.closed ? "Cerrado" : date.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {step === "time" && (
                <section>
                  <h3>Horarios disponibles</h3>
                  <p className="copy">{selectedDate?.label}</p>
                  <div className="grid">
                    {slots.map((slot) => (
                      <button
                        className={`choice ${draft.time === slot.time ? "selected" : ""}`}
                        disabled={!slot.available}
                        key={slot.time}
                        onClick={() => {
                          setDraft({ ...draft, time: slot.time });
                          setStep("details");
                        }}
                        type="button"
                      >
                        <strong>{slot.label}</strong>
                        <span>{slot.available ? `${slot.remaining} lugares` : "No disponible"}</span>
                      </button>
                    ))}
                  </div>
                  <div className="actions"><button className="secondary" onClick={() => setStep("date")} type="button">Cambiar fecha</button></div>
                </section>
              )}

              {step === "details" && (
                <section>
                  <h3>Tus datos</h3>
                  <p className="copy">Usaremos tu WhatsApp solo para confirmar y dar seguimiento.</p>
                  <div className="fields">
                    <div className="field"><label htmlFor="firstName">Nombre</label><input id="firstName" value={draft.firstName} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} /></div>
                    <div className="field"><label htmlFor="lastName">Apellidos</label><input id="lastName" value={draft.lastName} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} /></div>
                    <div className="field"><label htmlFor="whatsapp">WhatsApp</label><input id="whatsapp" inputMode="tel" placeholder="+52 55 1234 5678" value={draft.whatsapp} onChange={(event) => setDraft({ ...draft, whatsapp: event.target.value })} /></div>
                  </div>
                  <div className="summary"><div className="row"><span>Fecha</span><strong>{draft.date ? formatDisplayDate(draft.date) : ""}</strong></div><div className="row"><span>Hora</span><strong>{draft.time}</strong></div></div>
                  {error && <p className="error">{error}</p>}
                  <div className="actions"><button className="primary" onClick={confirm} type="button"><CheckCircle2 size={18} />Confirmar cita</button><button className="secondary" onClick={() => setStep("time")} type="button">Cambiar horario</button></div>
                </section>
              )}

              {step === "done" && (
                <section className="success">
                  <CheckCircle2 size={42} />
                  <h2>Cita lista para confirmar</h2>
                  <p className="copy">En la siguiente fase se conectara Supabase, calendario, contactos y correo.</p>
                  <div className="summary"><div className="row"><span>Paciente</span><strong>{draft.firstName} {draft.lastName}</strong></div><div className="row"><span>Fecha</span><strong>{selectedDate?.label}</strong></div><div className="row"><span>Hora</span><strong>{selectedSlot?.label}</strong></div><div className="row"><span>WhatsApp</span><strong>{draft.whatsapp}</strong></div></div>
                  <div className="actions"><a className="primary" href={`https://wa.me/${waPhone}?text=${waText}`} target="_blank" rel="noreferrer"><MessageCircle size={18} />Abrir WhatsApp</a><button className="secondary" onClick={() => { setDraft(emptyDraft); setStep("date"); }} type="button">Nueva cita</button></div>
                </section>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
