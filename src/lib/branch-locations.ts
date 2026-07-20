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
  MTY_SUR: "Más Sano Nutrición Holística - Suc. Monterrey Sur"
};

export const BRANCH_SHORT_NAMES: Record<ActiveBranchCode, string> = {
  SN: "San Nicolás",
  MTY_SUR: "Monterrey Sur"
};

const SAN_NICOLAS_MOVE_DATE = "2026-08-02";

const LOCATIONS: Record<ActiveBranchCode, BranchLocation[]> = {
  SN: [
    {
      label: "Las Puentes",
      address: "Av. Las Puentes 511, Las Puentes 3er Sector, San Nicolás de los Garza, N.L.",
      mapsUrl: "https://maps.app.goo.gl/CwQyKxpUpvgNCEjX7"
    },
    {
      label: "Anáhuac",
      address: "Col. Anáhuac, San Nicolás de los Garza, N.L.",
      mapsUrl: "https://maps.app.goo.gl/T67AE5ndW6guX5sc8"
    }
  ],
  MTY_SUR: [{
    label: "Distrito Tec",
    address: "Dentro de Equilibriovivo, Alejandría 120, Roma, Distrito Tec, 64700 Monterrey, N.L.",
    mapsUrl: "https://maps.app.goo.gl/gVdFZaETS4RWCbyNA"
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

