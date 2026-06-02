export type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "completed";

export type AppointmentDraft = {
  firstName: string;
  lastName: string;
  whatsapp: string;
  date: string;
  time: string;
};

export type Appointment = AppointmentDraft & {
  id: string;
  status: AppointmentStatus;
};
