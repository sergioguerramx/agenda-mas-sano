import type { Appointment } from "@/types/appointments";

export const mockAppointments: Appointment[] = [
  {
    id: "apt-001",
    firstName: "Laura",
    lastName: "Hernandez",
    whatsapp: "+525512345678",
    date: "2026-06-03",
    time: "09:20",
    status: "pending"
  },
  {
    id: "apt-002",
    firstName: "Marco",
    lastName: "Santos",
    whatsapp: "+528112345678",
    date: "2026-06-04",
    time: "15:00",
    status: "confirmed"
  }
];
