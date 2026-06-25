import { notFound } from "next/navigation";
import { YoSoySanoBooking } from "@/components/YoSoySanoBooking";

export const metadata = {
  title: "Agenda tu llamada Yo Soy Sano",
  robots: {
    index: false,
    follow: false
  }
};

export default async function YoSoySanoBookingPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!token || token.split(".").length !== 2) {
    notFound();
  }

  return <YoSoySanoBooking token={token} />;
}
