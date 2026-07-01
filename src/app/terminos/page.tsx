import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terminos y Condiciones | Agenda Mas Sano",
  description: "Terminos y condiciones de uso de la agenda de Mas Sano Nutricion Holistica."
};

export default function TermsPage() {
  return (
    <main className="page">
      <div className="shell">
        <header className="top">
          <Link className="brand" href="/" aria-label="Volver a Agenda Mas Sano">
            <img alt="Mas Sano" className="logo" src="/logo-mas-sano.png" />
            <div>
              <p className="eyebrow">Mas Sano Nutricion Holistica</p>
              <h1 className="title">Terminos y condiciones</h1>
            </div>
          </Link>
          <Link className="secondary" href="/">Volver</Link>
        </header>

        <section className="card content" style={{ maxWidth: "860px", margin: "0 auto" }}>
          <p className="copy">
            Al usar este sitio o agendar una sesion, aceptas estos terminos generales de uso y atencion.
          </p>

          <h2>Servicio</h2>
          <p className="copy">
            Mas Sano Nutricion Holistica ofrece sesiones presenciales de orientacion y acompanamiento en San Nicolas de
            los Garza, Nuevo Leon. La informacion del sitio tiene fines informativos y comerciales.
          </p>

          <h2>Agenda y disponibilidad</h2>
          <p className="copy">
            Las citas estan sujetas a disponibilidad de horario. Al agendar, el equipo puede contactarte por WhatsApp
            para confirmar datos, resolver dudas o hacer seguimiento.
          </p>

          <h2>Promocion</h2>
          <p className="copy">
            La promocion de Sesion Integral por $399 MXN puede estar sujeta a cambios, disponibilidad o condiciones de
            agenda. Cualquier ajuste se informara antes de confirmar la sesion.
          </p>

          <h2>Alcance de la atencion</h2>
          <p className="copy">
            La sesion no sustituye atencion medica, diagnostico ni tratamiento medico. Si tienes una condicion medica,
            sintomas importantes o una emergencia, consulta directamente a un profesional de salud correspondiente.
          </p>

          <h2>Uso del sitio</h2>
          <p className="copy">
            El usuario se compromete a proporcionar datos correctos al agendar. Mas Sano puede actualizar textos,
            precios, horarios o contenido del sitio cuando sea necesario.
          </p>

          <h2>Contacto</h2>
          <p className="copy">
            Para dudas sobre estos terminos puedes escribir a {" "}
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
