"use client";

import { CheckCircle2, Clock, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildAvailableDates, buildSlotsForDate, formatDisplayDate, type ReservedSlots } from "@/lib/schedule";

type Step = "date" | "time" | "done";
type SlotCountRow = { appointment_time: string; active_count: number };
type TokenPreview = {
  nombre?: string;
  correo?: string;
  servicio?: "sesion_online_399" | "paquete_1199";
};

function decodeTokenPreview(token: string): TokenPreview {
  try {
    const [body] = token.split(".");
    if (!body) return {};
    const base64 = body.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(window.atob(base64)) as TokenPreview;
  } catch {
    return {};
  }
}

function getServiceLabel(service?: string) {
  return service === "paquete_1199" ? "Paquete 4 sesiones" : "Sesión Online $399";
}

export function YoSoySanoBooking({ token }: { token: string }) {
  const [step, setStep] = useState<Step>("date");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reservedSlots, setReservedSlots] = useState<ReservedSlots>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dates = useMemo(() => buildAvailableDates(new Date()), []);
  const preview = useMemo(() => decodeTokenPreview(token), [token]);
  const slots = useMemo(() => (date ? buildSlotsForDate(date, new Date(), reservedSlots) : []), [date, reservedSlots]);
  const selectedDate = dates.find((item) => item.iso === date);
  const selectedSlot = slots.find((slot) => slot.time === time);

  useEffect(() => {
    let ignore = false;

    async function loadReservedSlots() {
      if (!date) return;

      setLoadingSlots(true);
      setError("");

      try {
        const response = await fetch(`/api/calendar/availability?date=${encodeURIComponent(date)}`);

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "No se pudieron cargar los horarios.");
        }

        const data = (await response.json().catch(() => [])) as SlotCountRow[];
        if (ignore) return;

        const nextSlots: ReservedSlots = {};
        (data ?? []).forEach((row) => {
          nextSlots[row.appointment_time.slice(0, 5)] = Number(row.active_count);
        });
        setReservedSlots(nextSlots);
      } catch (calendarError) {
        if (!ignore) {
          const blockedSlots: ReservedSlots = {};
          buildSlotsForDate(date, new Date()).forEach((slot) => {
            blockedSlots[slot.time] = 2;
          });
          console.error("Yo Soy Sano availability error", {
            message: calendarError instanceof Error ? calendarError.message : "No se pudo cargar disponibilidad."
          });
          setReservedSlots(blockedSlots);
          setError("No se pudieron cargar los horarios. Intenta de nuevo.");
        }
      } finally {
        if (!ignore) setLoadingSlots(false);
      }
    }

    loadReservedSlots();

    return () => {
      ignore = true;
    };
  }, [date]);

  async function confirm() {
    if (!date || !time || !selectedSlot?.available) {
      setError("Elige un horario disponible para continuar.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/appointments/yosoysano/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, date, time })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "No se pudo guardar la llamada.");
      }

      setStep("done");
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "No se pudo guardar la llamada. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="top">
          <div className="brand">
            <img
              alt="Yo Soy Sano"
              className="logo logo-yss"
              src="https://yosoysano.com/images/logo-yosoysano.webp"
              style={{ height: "3.25rem", width: "6.9rem" }}
            />
            <div>
              <p className="eyebrow">Yo Soy Sano Online</p>
              <h1 className="title">Agenda tu llamada</h1>
            </div>
          </div>
          <span className="pill"><Clock size={16} />20-25 min</span>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <span className="price-pill">{getServiceLabel(preview.servicio)}</span>
            <h2>Elige el horario para tu llamada online.</h2>
            <p className="lead">
              Elige el día y horario que mejor se acomode para tu llamada. Te
              recomendamos agendar con tiempo para asegurar tu espacio.
            </p>
            <section className="info-block compact">
              <h3>Registro recibido</h3>
              <p className="copy"><strong>{preview.nombre ?? "Cliente Yo Soy Sano"}</strong></p>
              {preview.correo ? <p className="copy">{preview.correo}</p> : null}
            </section>
          </div>

          <section className="card booking-card" id="agenda">
            <div className="steps">
              {[
                ["date", "Fecha"],
                ["time", "Horario"],
                ["done", "Listo"]
              ].map(([key, label]) => (
                <button className={step === key ? "active" : ""} key={key} type="button">{label}</button>
              ))}
            </div>

            <div className="content">
              {step === "date" && (
                <section>
                  <h3>Selecciona fecha</h3>
                  <p className="copy">Elige un día disponible para tu llamada online.</p>
                  <div className="grid">
                    {dates.map((item) => (
                      <button
                        className={`choice ${date === item.iso ? "selected" : ""}`}
                        disabled={item.closed}
                        key={item.iso}
                        onClick={() => {
                          setDate(item.iso);
                          setTime("");
                          setError("");
                          setStep("time");
                        }}
                        type="button"
                      >
                        <strong>{item.shortLabel}</strong>
                        <span>{item.closed ? "Cerrado" : item.label}</span>
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
                        className={`choice ${time === slot.time ? "selected" : ""}`}
                        disabled={!slot.available || loadingSlots}
                        key={slot.time}
                        onClick={() => {
                          setTime(slot.time);
                          setError("");
                        }}
                        type="button"
                      >
                        <strong>{slot.label}</strong>
                        <span>{slot.available ? "Disponible" : "No disponible"}</span>
                      </button>
                    ))}
                  </div>
                  <div className="actions">
                    <button className="primary" disabled={!time || saving} onClick={confirm} type="button">
                      <CheckCircle2 size={18} />{saving ? "Guardando..." : "Confirmar llamada"}
                    </button>
                    <button className="secondary" onClick={() => setStep("date")} type="button">Cambiar fecha</button>
                  </div>
                </section>
              )}

              {step === "done" && (
                <section className="success">
                  <CheckCircle2 size={42} />
                  <h2>Llamada agendada</h2>
                  <p className="copy">Tu llamada quedó agendada. Te esperamos en el horario elegido.</p>
                  <div className="summary">
                    <div className="row"><span>Cliente</span><strong>{preview.nombre}</strong></div>
                    <div className="row"><span>Servicio</span><strong>{getServiceLabel(preview.servicio)}</strong></div>
                    <div className="row"><span>Fecha</span><strong>{date ? formatDisplayDate(date) : ""}</strong></div>
                    <div className="row"><span>Hora</span><strong>{selectedSlot?.label}</strong></div>
                    <div className="row"><span>Modalidad</span><strong>Online</strong></div>
                  </div>
                  <div className="actions">
                    <a className="primary" href="https://wa.me/528123324511" target="_blank" rel="noreferrer">
                      <MessageCircle size={18} />WhatsApp Yo Soy Sano
                    </a>
                  </div>
                </section>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
