import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Aviso de Privacidad | Agenda Mas Sano",
  description: "Aviso de privacidad de la agenda de Mas Sano Nutricion Holistica."
};

export default function PrivacyPage() {
  return (
    <main className="page">
      <div className="shell">
        <header className="top">
          <Link className="brand" href="/" aria-label="Volver a Agenda Mas Sano">
            <img alt="Mas Sano" className="logo" src="/logo-mas-sano.png" />
            <div>
              <p className="eyebrow">Mas Sano Nutricion Holistica</p>
              <h1 className="title">Aviso de privacidad</h1>
            </div>
          </Link>
          <Link className="secondary" href="/">Volver</Link>
        </header>

        <section className="card content" style={{ maxWidth: "860px", margin: "0 auto" }}>
          <p className="copy">
            Este aviso explica como usamos la informacion de las personas que visitan nuestra pagina, nos contactan o
            agendan una sesion en Mas Sano Nutricion Holistica.
          </p>

          <h2>Responsable</h2>
          <p className="copy">
            Mas Sano Nutricion Holistica, con atencion presencial en San Nicolas de los Garza y Monterrey Sur,
            Nuevo Leon, Mexico.
          </p>

          <h2>Datos que podemos solicitar</h2>
          <p className="copy">
            Podemos solicitar nombre, WhatsApp, fecha y horario de cita, y datos necesarios para confirmar o dar
            seguimiento a la sesion. Si la persona comparte informacion adicional por WhatsApp o durante la sesion, se
            usa solo para brindar atencion y orientacion.
          </p>

          <h2>Uso de la informacion</h2>
          <p className="copy">
            Usamos la informacion para agendar, confirmar y dar seguimiento a citas, responder dudas, mejorar el servicio
            y generar reportes internos de operacion y publicidad.
          </p>

          <h2>Herramientas utilizadas</h2>
          <p className="copy">
            Para operar la agenda podemos usar servicios como Google Calendar, Google Contacts, Vercel, Supabase y Meta.
            Cuando se envian eventos de conversion a Meta para medicion publicitaria, los datos de contacto se envian de
            forma protegida y no se incluyen detalles sensibles de la sesion.
          </p>

          <h2>Proteccion de datos</h2>
          <p className="copy">
            No vendemos datos personales. El acceso a la informacion se limita a las personas y herramientas necesarias
            para operar la agenda, confirmar citas y dar seguimiento.
          </p>

          <h2>Derechos y contacto</h2>
          <p className="copy">
            Puedes solicitar acceso, correccion o eliminacion de tus datos escribiendo a {" "}
            <a href="mailto:info.mas.sano@gmail.com">info.mas.sano@gmail.com</a> o por WhatsApp al {" "}
            <a href="https://api.whatsapp.com/send?phone=528123324511">+52 81 2332 4511</a>.
          </p>

          <h2>Actualizaciones</h2>
          <p className="copy">Ultima actualizacion: 1 de julio de 2026.</p>
        </section>
      </div>
    </main>
  );
}
