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

export type AppointmentRow = {
  id: string;
  first_name: string;
  last_name: string;
  whatsapp: string;
  appointment_date: string;
  appointment_time: string;
  status: AppointmentStatus;
  created_at?: string;
  updated_at?: string;
};
