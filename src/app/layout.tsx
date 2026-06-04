import type { Metadata } from "next";
import { AuthRedirectHandler } from "@/components/AuthRedirectHandler";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agenda Mas Sano",
  description: "Agenda de citas de Mas Sano Nutricion Holistica"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AuthRedirectHandler />
        {children}
      </body>
    </html>
  );
}
