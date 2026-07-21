export type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "completed";

export type AppointmentDraft = {
  firstName: string;
  lastName: string;
  whatsapp: string;
  date: string;
  time: string;
  adOrigin?: string;
  branchCode?: "SN" | "MTY_SUR";
};

export type Appointment = AppointmentDraft & {
  id: string;
  status: AppointmentStatus;
  createdAt?: string;
  googleContactId?: string | null;
  brand?: string | null;
  modality?: string | null;
  service?: string | null;
  origin?: string | null;
  registroId?: string | null;
  clienteId?: string | null;
  correo?: string | null;
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
  brand?: string | null;
  modality?: string | null;
  service?: string | null;
  origin?: string | null;
  registro_id?: string | null;
  cliente_id?: string | null;
  correo?: string | null;
  branch_code?: "SN" | "MTY_SUR" | null;
  confirmation_first_sent_at?: string | null;
  confirmation_second_sent_at?: string | null;
  confirmation_response?: "confirmed" | "reprogram_requested" | "cancelled" | null;
  confirmation_response_at?: string | null;
  confirmation_released_at?: string | null;
  confirmation_release_notice_sent_at?: string | null;
  confirmation_original_time?: string | null;
  confirmation_last_error?: string | null;
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
  google_contact_resource_name?: string | null;
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
  googleContactId?: string | null;
};
