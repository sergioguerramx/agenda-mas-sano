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
  google_calendar_event_id?: string | null;
  google_contact_id?: string | null;
  resend_email_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ContactRow = {
  id: string;
  first_name: string;
  last_name: string;
  whatsapp: string;
  source: string;
  branch: string;
  first_appointment_date: string;
  last_appointment_date: string;
  total_appointments: number;
  latest_status: AppointmentStatus;
  latest_appointment_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  source: string;
  branch: string;
  firstAppointmentDate: string;
  lastAppointmentDate: string;
  totalAppointments: number;
  latestStatus: AppointmentStatus;
  latestAppointmentId?: string | null;
};
