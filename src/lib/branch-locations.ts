export type ActiveBranchCode = "SN" | "MTY_SUR";

export type BranchLocation = {
  label: string;
  address: string;
  mapsUrl: string;
};

export const MAS_SANO_COMMON_CONTACT = {
  whatsapp: "+528186935634",
  whatsappUrl: "https://wa.me/528186935634",
  websiteUrl: "https://massanonh.com/",
  bookingUrl: "https://agenda.massanonh.com/",
  facebookUrl: "https://www.facebook.com/MasSanoNH"
} as const;

export const BRANCH_PUBLIC_NAMES: Record<ActiveBranchCode, string> = {
  SN: "Más Sano Nutrición Holística - Suc. San Nicolás",
  MTY_SUR: "Más Sano Nutrición Holística - Suc. Monterrey Poniente"
};

export const BRANCH_SHORT_NAMES: Record<ActiveBranchCode, string> = {
  SN: "San Nicolás",
  MTY_SUR: "Monterrey Poniente"
};

export const BRANCH_OPENING_DATES: Record<ActiveBranchCode, string | null> = {
  SN: null,
  MTY_SUR: "2026-08-03"
};

export const SAN_NICOLAS_MOVE_DATE = "2026-08-03";

const LOCATIONS: Record<ActiveBranchCode, BranchLocation[]> = {
  SN: [
    {
      label: "Las Puentes",
      address: "Av. Las Puentes 511, Col. Las Puentes 3er Sector.",
      mapsUrl: "https://maps.app.goo.gl/CwQyKxpUpvgNCEjX7"
    },
    {
      label: "Anáhuac",
      address: "Av. Topo Chico 50, Col. Anáhuac. Dentro de Edificio Anáhuac.",
      mapsUrl: "https://maps.app.goo.gl/T67AE5ndW6guX5sc8"
    }
  ],
  MTY_SUR: [{
    label: "Plaza Real · ALFAO Business Center",
    address: "Plaza Real, Av. Dr. José Eleuterio González 315, SUB-4, Jardines del Cerro, Monterrey, N.L., C.P. 64050. Segundo piso, dentro de ALFAO Business Center.",
    mapsUrl: "https://maps.app.goo.gl/HE2SPPVTPo27Zh2U6"
  }]
};

export function getMonterreyDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Monterrey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getBranchLocation(branchCode: ActiveBranchCode, dateIso = getMonterreyDateIso()) {
  if (branchCode === "SN") return dateIso >= SAN_NICOLAS_MOVE_DATE ? LOCATIONS.SN[1] : LOCATIONS.SN[0];
  return LOCATIONS.MTY_SUR[0];
}
