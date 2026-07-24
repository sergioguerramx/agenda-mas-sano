export const MAS_SANO_NEW_PRICE_START_DATE = "2026-08-03";
export const MAS_SANO_PRICE_SWITCH_AT = new Date("2026-08-01T17:00:00-06:00").getTime();

export type MasSanoOffer = {
  price: 399 | 449;
  service: "sesion_integral_399" | "sesion_integral_449";
};

export function getCurrentMasSanoOffer(now = new Date()): MasSanoOffer {
  return now.getTime() >= MAS_SANO_PRICE_SWITCH_AT
    ? { price: 449, service: "sesion_integral_449" }
    : { price: 399, service: "sesion_integral_399" };
}

export function getMasSanoAppointmentOffer(dateIso: string): MasSanoOffer {
  return dateIso >= MAS_SANO_NEW_PRICE_START_DATE
    ? { price: 449, service: "sesion_integral_449" }
    : { price: 399, service: "sesion_integral_399" };
}
