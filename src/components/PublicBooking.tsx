"use client";

import { CheckCircle2, Clock, MapPin, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BRANCH_OPENING_DATES,
  BRANCH_SHORT_NAMES,
  getBranchLocation,
  MAS_SANO_COMMON_CONTACT,
  type ActiveBranchCode
} from "@/lib/branch-locations";
import { buildAvailableDates, buildSlotsForDate, formatDisplayDate, getSlotCapacity, type ReservedSlots } from "@/lib/schedule";
import { normalizeMexicanWhatsapp } from "@/lib/whatsapp";
import type { AppointmentDraft } from "@/types/appointments";

type Step = "branch" | "date" | "time" | "details" | "done";
type SlotCountRow = { appointment_time: string; active_count: number };

const emptyDraft: AppointmentDraft = {
  firstName: "",
  lastName: "",
  whatsapp: "",
  date: "",
  time: "",
  adOrigin: "sin_identificar",
  branchCode: undefined
};

const branchOptions: Array<{ code: ActiveBranchCode; openingNote?: string }> = [
  { code: "SN" },
  { code: "MTY_SUR", openingNote: "Nueva sucursal · Apertura 3 de agosto" }
];

const adOriginOptions = [
  { value: "sin_identificar", label: "Sin identificar" },
  { value: "anuncio_n1", label: "Anuncio N1" },
  { value: "anuncio_n2", label: "Anuncio N2" },
  { value: "anuncio_n3", label: "Anuncio N3" },
  { value: "anuncio_n4", label: "Anuncio N4" },
  { value: "anuncio_n5", label: "Anuncio N5" },
  { value: "whatsapp_directo", label: "WhatsApp directo" },
  { value: "recomendacion", label: "Recomendación" },
  { value: "organico", label: "Orgánico" },
  { value: "otro", label: "Otro" }
];

const sessionIncludes = [
  "Sesión con nutrióloga certificada",
  "Plan de alimentación personalizado",
  "Auriculoterapia metabólica",
  "Seguimiento por WhatsApp",
  "Material de apoyo",
  "Atención en la sucursal que elijas"
];

const howItWorks = [
  "Elige día y horario disponible",
  "Deja tus datos",
  "Tu cita queda agendada",
  "Un día antes te contactaremos por WhatsApp para confirmar"
];

const faqs = [
  {
    question: "¿Qué incluye la sesión?",
    answer: "Incluye sesión con nutrióloga certificada, plan de alimentación personalizado, auriculoterapia metabólica, seguimiento por WhatsApp y material de apoyo."
  },
  {
    question: "¿Cómo confirmo mi cita?",
    answer: "Un día antes te contactaremos por WhatsApp para confirmar tu asistencia."
  },
  {
    question: "¿Dónde es la atención?",
    answer: "Puedes elegir entre San Nicolás y Monterrey Sur al iniciar tu reservación."
  },
  {
    question: "¿Qué pasa si necesito cambiar mi cita?",
    answer: "Puedes escribirnos por WhatsApp para revisar disponibilidad."
  }
];

export function PublicBooking() {
  const [step, setStep] = useState<Step>("branch");
  const [draft, setDraft] = useState<AppointmentDraft>(emptyDraft);
  const [reservedSlots, setReservedSlots] = useState<ReservedSlots>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [logoReady, setLogoReady] = useState(true);
  const dates = useMemo(() => {
    const openingDate = draft.branchCode ? BRANCH_OPENING_DATES[draft.branchCode] : null;
    return buildAvailableDates(new Date()).map((date) => ({
      ...date,
      closed: date.closed || Boolean(openingDate && date.iso < openingDate)
    }));
  }, [draft.branchCode]);
  const slots = useMemo(() => (
    draft.date && draft.branchCode
      ? buildSlotsForDate(draft.date, new Date(), reservedSlots, draft.branchCode)
      : []
  ), [draft.branchCode, draft.date, reservedSlots]);
  const location = useMemo(() => (
    draft.branchCode ? getBranchLocation(draft.branchCode, draft.date || undefined) : null
  ), [draft.branchCode, draft.date]);
  const selectedDate = dates.find((date) => date.iso === draft.date);
  const selectedSlot = slots.find((slot) => slot.time === draft.time);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fullName = params.get("name")?.trim().replace(/\s+/g, " ") ?? "";
    const nameParts = fullName ? fullName.split(" ") : [];
    const whatsapp = params.get("whatsapp")?.trim() ?? "";
    const adOrigin = params.get("adOrigin")?.trim() ?? "";
    const branchParam = params.get("branch")?.trim().toUpperCase() ?? "";
    const branchCode = branchParam === "SN" || branchParam === "MTY_SUR" ? branchParam : undefined;

    if (!fullName && !whatsapp && !adOrigin && !branchCode) return;

    setDraft((current) => ({
      ...current,
      firstName: nameParts[0] ?? current.firstName,
      lastName: nameParts.slice(1).join(" ") || current.lastName,
      whatsapp: whatsapp || current.whatsapp,
      adOrigin: adOriginOptions.some((option) => option.value === adOrigin) ? adOrigin : current.adOrigin,
      branchCode: branchCode ?? current.branchCode
    }));
    if (branchCode) setStep("date");
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadReservedSlots() {
      if (!draft.date || !draft.branchCode) return;

      setLoadingSlots(true);
      setError("");

      try {
        const response = await fetch(
          `/api/calendar/availability?date=${encodeURIComponent(draft.date)}&branch=${encodeURIComponent(draft.branchCode)}`
        );

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "No se pudieron cargar los horarios reales.");
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
          buildSlotsForDate(draft.date, new Date(), {}, draft.branchCode).forEach((slot) => {
            blockedSlots[slot.time] = getSlotCapacity(draft.date, slot.time, draft.branchCode!);
          });
          console.error("Google Calendar availability error", {
            message: calendarError instanceof Error ? calendarError.message : "No se pudo cargar Calendar."
          });
          setReservedSlots(blockedSlots);
          setError("No se pudieron cargar los horarios reales de Google Calendar. Intenta de nuevo.");
        }
      } finally {
        if (!ignore) setLoadingSlots(false);
      }
    }

    loadReservedSlots();

    return () => {
      ignore = true;
    };
  }, [draft.branchCode, draft.date]);

  async function confirm() {
    const whatsapp = normalizeMexicanWhatsapp(draft.whatsapp);

    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      setError("Agrega nombre y apellidos para continuar.");
      return;
    }

    if (!whatsapp) {
      setError("Escribe un WhatsApp mexicano válido de 10 dígitos.");
      return;
    }

    if (!draft.branchCode) {
      setError("Elige una sucursal para continuar.");
      return;
    }

    if (!draft.date || !draft.time || !selectedSlot?.available) {
      setError("Elige un horario disponible para continuar.");
      return;
    }

    setSaving(true);
    setDraft((current) => ({ ...current, whatsapp }));
    setError("");

    try {
      const response = await fetch("/api/appointments/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          whatsapp,
          date: draft.date,
          time: draft.time,
          adOrigin: draft.adOrigin,
          branchCode: draft.branchCode
        })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "No se pudo guardar la cita.");
      }

      setStep("done");
    } catch (bookingError) {
      const message = bookingError instanceof Error ? bookingError.message : "No se pudo guardar la cita.";
      setError(message ? `No se pudo guardar la cita: ${message}` : "No se pudo guardar la cita. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const waPhone = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? MAS_SANO_COMMON_CONTACT.whatsapp.replace(/\D/g, "");
  const waText = encodeURIComponent(
    `Hola, confirmé mi cita en Más Sano ${draft.branchCode ? BRANCH_SHORT_NAMES[draft.branchCode] : ""} para ${selectedDate?.label ?? ""} a las ${selectedSlot?.label ?? ""}.`
  );

  return (
    <main className="page">
      <div className="shell">
        <header className="top">
          <div className="brand">
            {logoReady ? (
              <img
                alt="Más Sano"
                className="logo"
                onError={() => setLogoReady(false)}
                src="/logo-mas-sano.png"
              />
            ) : (
              <div className="mark">MS</div>
            )}
            <div>
              <p className="eyebrow">Más Sano Nutrición Holística</p>
              <h1 className="title">#YoSoySano</h1>
            </div>
          </div>
          <span className="pill"><Clock size={16} />20 min</span>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <span className="price-pill">Sesión Integral $399</span>
            <h2>Agenda tu Sesión<br />en Más Sano</h2>
            <p className="lead">Ten una sesión con nutrióloga certificada y comienza con un plan adaptado a tu estilo de vida.</p>
            <div className="hero-actions">
              <a className="primary hero-cta" href="#agenda">Elegir horario</a>
            </div>

            {location && draft.branchCode ? (
              <a className="location-chip" href={location.mapsUrl} target="_blank" rel="noopener noreferrer">
                <MapPin size={18} />
                <span><strong>Sucursal {BRANCH_SHORT_NAMES[draft.branchCode]} · {location.label}</strong><small>{location.address}</small></span>
                <em>Ver mapa</em>
              </a>
            ) : (
              <div className="location-chip">
                <MapPin size={18} />
                <span><strong>Dos sucursales disponibles</strong><small>San Nicolás y Monterrey Sur</small></span>
              </div>
            )}

            <section className="info-block includes-block">
              <h3>Qué incluye tu sesión de $399</h3>
              <div className="info-grid">
                {sessionIncludes.map((item) => (
                  <div className="mini-card" key={item}>
                    <CheckCircle2 size={18} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="info-block compact">
              <h3>Cómo funciona</h3>
              <ol className="steps-list">
                {howItWorks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </section>
          </div>

          <section className="card booking-card" id="agenda">
            <div className="steps">
              {[
                ["branch", "Sucursal"],
                ["date", "Fecha"],
                ["time", "Horario"],
                ["details", "Datos"],
                ["done", "Final"]
              ].map(([key, label]) => (
                <button className={step === key ? "active" : ""} key={key} type="button">{label}</button>
              ))}
            </div>

            {draft.branchCode && location && step !== "branch" && step !== "done" && (
              <div className="booking-branch-status">
                <MapPin size={18} />
                <span>
                  <strong>Sucursal {BRANCH_SHORT_NAMES[draft.branchCode]}</strong>
                  <small>{location.address}</small>
                </span>
                <button onClick={() => setStep("branch")} type="button">Cambiar</button>
              </div>
            )}

            <div className="content">
              {step === "branch" && (
                <section>
                  <h3>Elige tu sucursal</h3>
                  <p className="copy">Selecciona dónde quieres recibir tu sesión.</p>
                  <div className="branch-grid">
                    {branchOptions.map((branch) => {
                      const branchLocation = getBranchLocation(branch.code);
                      return (
                        <button
                          className={`choice branch-choice ${draft.branchCode === branch.code ? "selected" : ""}`}
                          key={branch.code}
                          onClick={() => {
                            setDraft({ ...draft, branchCode: branch.code, date: "", time: "" });
                            setReservedSlots({});
                            setError("");
                            setStep("date");
                          }}
                          type="button"
                        >
                          <MapPin size={20} />
                          <span><strong>{BRANCH_SHORT_NAMES[branch.code]}</strong><small>{branchLocation.address}</small>{branch.openingNote && <em>{branch.openingNote}</em>}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {step === "date" && (
                <section>
                  <h3>Selecciona fecha</h3>
                  <p className="copy">{draft.branchCode ? `Sucursal ${BRANCH_SHORT_NAMES[draft.branchCode]}. ` : ""}Miércoles y domingo permanecen cerrados.</p>
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
                        <span>{date.closed ? (draft.branchCode === "MTY_SUR" && date.iso < BRANCH_OPENING_DATES.MTY_SUR! ? "Disponible desde 3 ago" : "Cerrado") : date.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="actions"><button className="secondary" onClick={() => setStep("branch")} type="button">Cambiar sucursal</button></div>
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
                    <div className="field"><label htmlFor="adOrigin">Origen de la cita</label><select id="adOrigin" value={draft.adOrigin} onChange={(event) => setDraft({ ...draft, adOrigin: event.target.value })}>{adOriginOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                  </div>
                  <div className="summary"><div className="row"><span>Sucursal</span><strong>{draft.branchCode ? BRANCH_SHORT_NAMES[draft.branchCode] : ""}</strong></div><div className="row"><span>Fecha</span><strong>{draft.date ? formatDisplayDate(draft.date) : ""}</strong></div><div className="row"><span>Hora</span><strong>{draft.time}</strong></div></div>
                  {error && <p className="error">{error}</p>}
                  <div className="actions"><button className="primary" disabled={saving} onClick={confirm} type="button"><CheckCircle2 size={18} />{saving ? "Guardando..." : "Confirmar cita"}</button><button className="secondary" onClick={() => { setError(""); setStep("time"); }} type="button">Cambiar horario</button></div>
                </section>
              )}

              {step === "done" && (
                <section className="success">
                  <CheckCircle2 size={42} />
                  <h2>Cita solicitada</h2>
                  <p className="copy">Recibimos tu solicitud. El equipo de Más Sano le dará seguimiento por WhatsApp.</p>
                  <div className="summary"><div className="row"><span>Paciente</span><strong>{draft.firstName} {draft.lastName}</strong></div><div className="row"><span>Sucursal</span><strong>{draft.branchCode ? BRANCH_SHORT_NAMES[draft.branchCode] : ""}</strong></div><div className="row"><span>Fecha</span><strong>{selectedDate?.label}</strong></div><div className="row"><span>Hora</span><strong>{selectedSlot?.label}</strong></div><div className="row"><span>WhatsApp</span><strong>{draft.whatsapp}</strong></div><div className="row"><span>Lugar</span><strong>{location?.address}</strong></div></div>
                  <div className="actions"><a className="primary" href={`https://wa.me/${waPhone}?text=${waText}`} target="_blank" rel="noreferrer"><MessageCircle size={18} />Abrir WhatsApp</a>{location && <a className="secondary" href={location.mapsUrl} target="_blank" rel="noopener noreferrer"><MapPin size={18} />Ver ubicación</a>}<button className="secondary" onClick={() => { setDraft(emptyDraft); setReservedSlots({}); setStep("branch"); }} type="button">Nueva cita</button></div>
                </section>
              )}
            </div>
          </section>
        </section>

        <section className="faq-section" aria-label="Preguntas frecuentes">
          <div>
            <p className="eyebrow">Información útil</p>
            <h2>Preguntas frecuentes</h2>
          </div>
          <div className="faq-list">
            {faqs.map((faq) => (
              <details className="faq-item" key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
