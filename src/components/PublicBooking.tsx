"use client";

import { CheckCircle2, Clock, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildAvailableDates, buildSlotsForDate, formatDisplayDate, type ReservedSlots } from "@/lib/schedule";
import { getSupabaseConfig, getSupabaseConfigError, isSupabaseConfigured } from "@/lib/supabase";
import { normalizeMexicanWhatsapp } from "@/lib/whatsapp";
import type { AppointmentDraft } from "@/types/appointments";

type Step = "date" | "time" | "details" | "done";
type SupabaseSafeError = { message?: string; code?: string; details?: string; hint?: string };
type SlotCountRow = { appointment_time: string; active_count: number };

const emptyDraft: AppointmentDraft = {
  firstName: "",
  lastName: "",
  whatsapp: "",
  date: "",
  time: ""
};

function logSupabaseError(context: string, supabaseError: unknown) {
  const safeError = supabaseError as SupabaseSafeError;
  console.error(context, {
    message: safeError.message,
    code: safeError.code,
    details: safeError.details,
    hint: safeError.hint
  });
}

async function callPublicRpc<T>(functionName: string, payload: Record<string, unknown>) {
  const config = getSupabaseConfig();
  const configError = getSupabaseConfigError();

  if (configError) {
    throw new Error(configError);
  }

  const response = await fetch(`${config.url.replace(/\/+$/, "")}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as SupabaseSafeError & { error?: string };
    const message = body.message ?? body.error ?? body.details ?? `Supabase respondio con error ${response.status}.`;
    const error = new Error(message) as Error & SupabaseSafeError;
    error.code = body.code;
    error.details = body.details;
    error.hint = body.hint;
    throw error;
  }

  return (await response.json().catch(() => undefined)) as T;
}

export function PublicBooking() {
  const [step, setStep] = useState<Step>("date");
  const [draft, setDraft] = useState<AppointmentDraft>(emptyDraft);
  const [reservedSlots, setReservedSlots] = useState<ReservedSlots>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dates = useMemo(() => buildAvailableDates(new Date()), []);
  const slots = useMemo(() => (draft.date ? buildSlotsForDate(draft.date, new Date(), reservedSlots) : []), [draft.date, reservedSlots]);
  const selectedDate = dates.find((date) => date.iso === draft.date);
  const selectedSlot = slots.find((slot) => slot.time === draft.time);

  useEffect(() => {
    let ignore = false;

    async function loadReservedSlots() {
      if (!draft.date) return;

      if (!isSupabaseConfigured()) {
        setReservedSlots({});
        setError("Falta conectar Supabase para ver horarios reales.");
        return;
      }

      setLoadingSlots(true);
      setError("");

      try {
        const data = await callPublicRpc<SlotCountRow[]>("public_slot_counts", {
          start_date: draft.date,
          end_date: draft.date
        });

        if (ignore) return;

        const nextSlots: ReservedSlots = {};
        (data ?? []).forEach((row) => {
          nextSlots[row.appointment_time.slice(0, 5)] = Number(row.active_count);
        });
        setReservedSlots(nextSlots);
      } catch (supabaseError) {
        if (!ignore) {
          const config = getSupabaseConfig();
          logSupabaseError("Supabase public_slot_counts error", supabaseError);
          console.error("Supabase base URL used", { url: config.url });
          setReservedSlots({});
          setError("No se pudieron confirmar los lugares disponibles. Puedes elegir horario; al confirmar validaremos disponibilidad.");
        }
      } finally {
        if (!ignore) setLoadingSlots(false);
      }
    }

    loadReservedSlots();

    return () => {
      ignore = true;
    };
  }, [draft.date]);

  async function confirm() {
    const whatsapp = normalizeMexicanWhatsapp(draft.whatsapp);

    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      setError("Agrega nombre y apellidos para continuar.");
      return;
    }

    if (!whatsapp) {
      setError("Escribe un WhatsApp mexicano valido de 10 digitos.");
      return;
    }

    if (!draft.date || !draft.time || !selectedSlot?.available) {
      setError("Elige un horario disponible para continuar.");
      return;
    }

    if (!isSupabaseConfigured()) {
      setError("Falta conectar Supabase para guardar la cita.");
      return;
    }

    setSaving(true);
    setDraft((current) => ({ ...current, whatsapp }));
    setError("");

    try {
      await callPublicRpc<void>("request_public_appointment", {
        p_first_name: draft.firstName.trim(),
        p_last_name: draft.lastName.trim(),
        p_whatsapp: whatsapp,
        p_appointment_date: draft.date,
        p_appointment_time: draft.time
      });

      setStep("done");
    } catch (supabaseError) {
      const config = getSupabaseConfig();
      logSupabaseError("Supabase request_public_appointment error", supabaseError);
      console.error("Supabase base URL used", { url: config.url });
      const message = supabaseError instanceof Error
        ? supabaseError.message
        : (supabaseError as SupabaseSafeError).message;
      setError(message ? `No se pudo guardar la cita: ${message}` : "No se pudo conectar con Supabase para guardar la cita.");
    } finally {
      setSaving(false);
    }
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
                          setError("");
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
                  {loadingSlots && <p className="copy">Cargando horarios...</p>}
                  {error && <p className="error">{error}</p>}
                  <div className="grid">
                    {slots.map((slot) => (
                      <button
                        className={`choice ${draft.time === slot.time ? "selected" : ""}`}
                        disabled={!slot.available || loadingSlots}
                        key={slot.time}
                        onClick={() => {
                          setDraft({ ...draft, time: slot.time });
                          setError("");
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
                  <div className="actions"><button className="primary" disabled={saving} onClick={confirm} type="button"><CheckCircle2 size={18} />{saving ? "Guardando..." : "Confirmar cita"}</button><button className="secondary" onClick={() => { setError(""); setStep("time"); }} type="button">Cambiar horario</button></div>
                </section>
              )}

              {step === "done" && (
                <section className="success">
                  <CheckCircle2 size={42} />
                  <h2>Cita solicitada</h2>
                  <p className="copy">Recibimos tu solicitud. El equipo de Mas Sano le dara seguimiento por WhatsApp.</p>
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
